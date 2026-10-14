#!/bin/bash
# ============================================================================
#  Fase 1 do corte: liga a replicacao logica da producao para o cluster.
#
#  O QUE ELE FAZ, NA ORDEM, E O QUE CADA COISA CUSTA
#    1. confere pre-requisitos (so leitura) e PARA se algum nao bater;
#    2. REPLICA IDENTITY FULL nas tres tabelas de negocio sem chave primaria;
#    3. cria a publicacao na producao, com a lista montada do catalogo;
#    4. cria a assinatura no cluster, com copy_data=true -- os 2,3 GB;
#    5. acompanha a sincronizacao tabela por tabela ate o fim.
#
#  NADA AQUI PARA O ERP. A producao segue atendendo; o passo 4 e o unico que
#  pesa, por ser uma leitura longa numa instancia Small.
#
#  O RISCO QUE MANDA EM TUDO: slot que para de ser consumido impede a producao
#  de apagar WAL -- disco enche, banco sai do ar. Por isso o --desfazer existe
#  e e a primeira coisa a usar quando algo nao se explica em poucos minutos.
#  O vigia por DM (migration 20261014000020 + worker/src/saudeBanco.js) tem que
#  estar de pe ANTES de deixar isto ligado da noite para o dia.
#
#  POR QUE A LISTA DA PUBLICACAO E MONTADA DO CATALOGO, NAO ESCRITA A MAO
#  Em 08/10/2026 eram 11 tabelas sem chave primaria; em 13/10/2026 ja eram 13
#  (nasceram CTRL_REUNIAO_BKP_20261009 e CTRL_REUNIAO_REGISTRO_BKP_20261009).
#  Replicacao logica NAO replica UPDATE/DELETE em tabela sem PK: a assinatura
#  trava e para de consumir o slot. Lista escrita a mao envelhece em dias e o
#  preco do envelhecimento e a producao cair. A consulta e auto-corretiva: a
#  tabela entra sozinha quando ganha PK ou REPLICA IDENTITY FULL.
#
#  E AS PARTICOES: public.audit_log e particionada (2026_04, _05, _06, default).
#  A publicacao leva o PAI com publish_via_partition_root = true, nao as
#  particoes. Assim, se a producao criar uma particao nova que o cluster nao
#  tem, a linha chega como sendo do pai e o cluster roteia para a particao
#  dele (ou para a default) -- em vez de travar a assinatura por relacao
#  inexistente.
#
#  USO (no banco1 ou banco2, que alcancam producao e cluster):
#    SENHA_SUPABASE=... SENHA_DESTINO=... bash ligar-replicacao.sh
#    SENHA_SUPABASE=... SENHA_DESTINO=... bash ligar-replicacao.sh --conferir
#    SENHA_SUPABASE=... SENHA_DESTINO=... bash ligar-replicacao.sh --desfazer
# ============================================================================
set -uo pipefail

ACAO="${1:-ligar}"
case "$ACAO" in
  ligar|--ligar) ACAO=ligar ;;
  --conferir) ACAO=conferir ;;
  --desfazer) ACAO=desfazer ;;
  # --pre roda so a bateria de pre-requisitos e sai. Serve para provar que a
  # unica coisa faltando e a autorizacao de escrever na producao.
  --pre) ACAO=pre ;;
  *) echo "uso: $0 [--pre|--conferir|--desfazer]" >&2; exit 2 ;;
esac

: "${SENHA_SUPABASE:?senha do postgres da producao}"
: "${SENHA_DESTINO:?senha do postgres do cluster}"

REF="${REF:-fwmzeaztjxrxxzxzxmgc}"
# Para LER o catalogo o pooler serve. A ASSINATURA, nao: ela precisa de
# conexao de replicacao, que so o host direto aceita -- e ele so resolve em
# IPv6. Medido em 13/10/2026: pelo pooler, o IDENTIFY_SYSTEM volta como erro
# de sintaxe, porque ele tenta interpretar o comando como SQL.
ORIGEM_HOST="${ORIGEM_HOST:-aws-1-sa-east-1.pooler.supabase.com}"
ORIGEM_REPL="${ORIGEM_REPL:-db.$REF.supabase.co}"
DESTINO_HOST="${DESTINO_HOST:-127.0.0.1}"
DESTINO_PORTA="${DESTINO_PORTA:-5000}"   # HAProxy: sempre o primario
BANCO="${BANCO:-postgres}"
NOME="${NOME:-erp_corte}"                # publicacao, assinatura e slot
PSQL=$(command -v psql || echo /usr/lib/postgresql/17/bin/psql)

log(){ echo "[$(date +%H:%M:%S)] $*"; }
P(){ PGPASSWORD="$SENHA_SUPABASE" "$PSQL" -h "$ORIGEM_HOST" -p 5432 -U "postgres.$REF" -d "$BANCO" -At "$@"; }
C(){ PGPASSWORD="$SENHA_DESTINO" "$PSQL" -h "$DESTINO_HOST" -p "$DESTINO_PORTA" -U postgres -d "$BANCO" -At "$@"; }

# ── a consulta que monta a lista, usada para criar e para conferir ──────────
LISTA_SQL="
with sem_identidade as (
  -- sem PK e sem REPLICA IDENTITY FULL: UPDATE/DELETE nelas travaria a
  -- assinatura. Ficam de fora (sao copias de seguranca antigas).
  select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r'
     and not exists (select 1 from pg_index i where i.indrelid=c.oid and i.indisprimary)
     and c.relreplident <> 'f'
), particoes as (
  -- particao nao entra: vem pelo pai, com publish_via_partition_root.
  select i.inhrelid as oid from pg_inherits i
    join pg_class p on p.oid=i.inhparent
    join pg_namespace n on n.oid=p.relnamespace
   where n.nspname='public' and p.relkind='p'
)
select string_agg(format('%I.%I','public',c.relname), ', ' order by c.relname)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind in ('r','p')
   and c.oid not in (select oid from sem_identidade)
   and c.oid not in (select oid from particoes);"

estado(){
  echo
  echo "  ── producao ──"
  P -F' | ' -c "
    select 'publicacao '||pubname, (select count(*)::text from pg_publication_tables t where t.pubname=p.pubname)||' tabelas'
      from pg_publication p where p.pubname='$NOME'
    union all
    select 'slot '||slot_name, 'ativo='||active::text||'  atraso='||
           coalesce(pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), coalesce(confirmed_flush_lsn, restart_lsn))),'?')
      from pg_replication_slots where slot_name='$NOME';" | sed 's/^/    /'
  echo "  ── cluster ──"
  C -F' | ' -c "
    select 'assinatura '||subname, case when subenabled then 'habilitada' else 'desabilitada' end
      from pg_subscription where subname='$NOME'
    union all
    select 'sincronizacao', string_agg(estado||'='||n::text, '  ' order by estado) from (
      select case srsubstate when 'i' then 'iniciando' when 'd' then 'copiando'
                             when 'f' then 'copiada' when 's' then 'sincronizada'
                             when 'r' then 'PRONTA' else srsubstate::text end as estado,
             count(*) as n
        from pg_subscription_rel r join pg_subscription s on s.oid=r.srsubid
       where s.subname='$NOME' group by 1) x
    union all
    select 'linhas vivas em public', coalesce(sum(n_live_tup),0)::text from pg_stat_user_tables where schemaname='public';" | sed 's/^/    /'
}

# ── --conferir ─────────────────────────────────────────────────────────────
if [ "$ACAO" = "conferir" ]; then
  log "estado da replicacao (nada sera alterado)"
  estado
  echo
  echo "  ── amostra: as 5 maiores tabelas, dos dois lados ──"
  for t in $(P -c "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.reltuples desc limit 5;"); do
    a=$(P -c "select count(*) from public.\"$t\";" 2>/dev/null)
    b=$(C -c "select count(*) from public.\"$t\";" 2>/dev/null)
    printf '    %-42s producao=%-10s cluster=%-10s %s\n' "$t" "${a:-?}" "${b:-?}" "$([ "${a:-x}" = "${b:-y}" ] && echo ok || echo difere)"
  done
  exit 0
fi

# ── --desfazer: o ponto de desistencia ─────────────────────────────────────
if [ "$ACAO" = "desfazer" ]; then
  log "DESFAZENDO: a producao volta a ficar exatamente como estava"
  # Ordem importa: primeiro a assinatura (que consome), depois a publicacao.
  C -c "alter subscription $NOME disable;" 2>/dev/null | sed 's/^/  /'
  if ! C -c "drop subscription $NOME;" 2>&1 | sed 's/^/  /'; then
    # Caminho de emergencia: se a producao estiver inalcancavel, o DROP fica
    # preso tentando soltar o slot remoto. Desamarra e solta o slot a mao.
    log "DROP preso -- desamarrando o slot da assinatura"
    C -c "alter subscription $NOME set (slot_name = none); drop subscription $NOME;" 2>&1 | sed 's/^/  /'
  fi
  P -c "drop publication if exists $NOME;" 2>&1 | sed 's/^/  /'
  # O slot NAO desaparece sozinho se a assinatura foi desamarrada.
  P -c "select 'soltando slot orfao: '||pg_drop_replication_slot('$NOME') from pg_replication_slots where slot_name='$NOME';" 2>&1 | sed 's/^/  /'
  P -c "select 'ainda existe slot? '||count(*)::text from pg_replication_slots where slot_name='$NOME';" | sed 's/^/  /'
  echo
  echo "  O REPLICA IDENTITY FULL das tres tabelas foi deixado como esta: ele"
  echo "  nao custa nada e vai ser necessario de novo. Para reverter tambem:"
  echo "    ALTER TABLE public.\"CONTRATOS\" REPLICA IDENTITY DEFAULT;  (idem ESCALAS, SETORES)"
  exit 0
fi

# ── 1. pre-requisitos, todos por leitura ───────────────────────────────────
log "conferindo pre-requisitos"
falhou=0
checar(){ # rotulo, valor obtido, valor esperado
  if [ "$2" = "$3" ]; then printf '  ok    %-46s %s\n' "$1" "$2"
  else printf '  FALHA %-46s %s (esperado %s)\n' "$1" "$2" "$3"; falhou=1; fi
}

checar "wal_level da producao" "$(P -c 'show wal_level;')" "logical"
checar "slots em uso na producao" "$(P -c 'select count(*) from pg_replication_slots;')" "0"
checar "publicacao $NOME ainda nao existe" "$(P -c "select count(*) from pg_publication where pubname='$NOME';")" "0"
checar "assinatura $NOME ainda nao existe" "$(C -c "select count(*) from pg_subscription where subname='$NOME';")" "0"
# public vazio no cluster: com copy_data=true, dado preexistente viraria
# conflito de chave na carga inicial e a assinatura pararia no primeiro erro.
checar "public do cluster vazio" "$(C -c "select coalesce(sum(n_live_tup),0) from pg_stat_user_tables where schemaname='public';")" "0"
# O destino tem que ser o PRIMARIO -- assinatura nao se cria em standby.
checar "destino aceita escrita (e o primario)" "$(C -c 'select current_setting(E'"'"'transaction_read_only'"'"');')" "off"

# IPv6 ate o host de replicacao: sem isso o CREATE SUBSCRIPTION nao conecta.
if timeout 12 bash -c "cat < /dev/null > /dev/tcp/$ORIGEM_REPL/5432" 2>/dev/null; then
  printf '  ok    %-46s %s\n' "alcanca $ORIGEM_REPL:5432" "sim"
else
  printf '  FALHA %-46s %s\n' "alcanca $ORIGEM_REPL:5432" "NAO (falta IPv6 nesta maquina)"
  falhou=1
fi

if [ "$falhou" -ne 0 ]; then
  echo
  echo "Pre-requisito faltando. NADA foi alterado." >&2
  exit 1
fi

if [ "$ACAO" = "pre" ]; then
  echo
  echo "Todos os pre-requisitos atendidos. Nada foi alterado."
  echo "Para ligar de verdade, rode sem --pre."
  exit 0
fi

# ── 2. REPLICA IDENTITY FULL nas tres de negocio ───────────────────────────
#
#  LOCK_TIMEOUT NAO E DETALHE -- E O QUE PROTEGE O ERP.
#
#  Aconteceu em 13/10/2026, 23:12 UTC: estes tres ALTER rodaram sem
#  lock_timeout e ficaram 63 segundos esperando. ALTER TABLE pede ACCESS
#  EXCLUSIVE; enquanto ele espera, ele ENTRA NA FILA e todo pedido posterior
#  de leitura da mesma tabela espera atras dele. Duas consultas do ERP (pelo
#  PostgREST) ficaram presas 43s e 19s -- usuario real esperando tela.
#
#  Quem segurava: uma sessao `idle in transaction` com 5 minutos de vida,
#  entrando pelo pooler como `postgres`, fazendo introspecao de dump (a
#  plataforma Supabase, nao nosso script). Isso vai acontecer de novo: nao se
#  controla quando a plataforma abre uma transacao longa.
#
#  Com lock_timeout, o pior caso vira 3 segundos de fila por tentativa, e a
#  falha e limpa. Cada ALTER vai em sua propria transacao, para o lock de um
#  nao segurar o do outro. DDL em tabela viva deste banco sempre assim.
log "REPLICA IDENTITY FULL em CONTRATOS, ESCALAS e SETORES (lock_timeout 3s)"

avisa_quem_segura(){
  P -F' | ' -c "
    select '    segurando lock: pid '||pid||'  app='||coalesce(application_name,'-')||
           '  transacao aberta ha '||round(extract(epoch from now()-xact_start))||'s'
      from pg_stat_activity
     where datname=current_database() and state='idle in transaction'
       and xact_start < now() - interval '20 seconds';"
}

for TB in CONTRATOS ESCALAS SETORES; do
  ATUAL=$(P -c "select relreplident from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname='$TB';")
  if [ "$ATUAL" = "f" ]; then log "  $TB ja esta FULL"; continue; fi
  OK=0
  for TENTATIVA in 1 2 3 4 5 6 7 8 9 10; do
    if P -v ON_ERROR_STOP=1 -c "SET lock_timeout = '3s'; ALTER TABLE public.\"$TB\" REPLICA IDENTITY FULL;" >/dev/null 2>&1; then
      log "  $TB -> FULL (tentativa $TENTATIVA)"; OK=1; break
    fi
    [ "$TENTATIVA" = 1 ] && avisa_quem_segura
    log "  $TB: lock ocupado, tentativa $TENTATIVA de 10 -- esperando 20s"
    sleep 20
  done
  if [ "$OK" -ne 1 ]; then
    echo "Nao consegui o lock de $TB em 10 tentativas. NADA foi criado." >&2
    echo "Alguem mantem transacao longa aberta na producao. Rode de novo mais tarde." >&2
    exit 1
  fi
done
P -F' | ' -c "select '  '||relname||' -> '||case relreplident when 'f' then 'FULL' else relreplident::text end
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and relname in ('CONTRATOS','ESCALAS','SETORES') order by 1;"

# ── 3. a publicacao ────────────────────────────────────────────────────────
log "montando a lista da publicacao a partir do catalogo"
TABELAS=$(P -c "$LISTA_SQL")
[ -n "$TABELAS" ] || { echo "lista vazia -- abortando" >&2; exit 1; }
QUANTAS=$(( $(echo "$TABELAS" | tr -cd ',' | wc -c) + 1 ))
log "$QUANTAS tabelas entram; as de fora:"
P -c "
with sem_identidade as (
  select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r'
     and not exists (select 1 from pg_index i where i.indrelid=c.oid and i.indisprimary)
     and c.relreplident <> 'f')
select '    sem PK: '||string_agg(relname, ', ' order by relname) from sem_identidade;"

P -v ON_ERROR_STOP=1 -c "CREATE PUBLICATION $NOME FOR TABLE $TABELAS WITH (publish_via_partition_root = true);" \
  || { echo "falhou a publicacao -- rode com --desfazer para limpar" >&2; exit 1; }
log "publicacao criada: $(P -c "select count(*) from pg_publication_tables where pubname='$NOME';") tabelas (particoes contam pelo pai)"

# ── 4. a assinatura: aqui comecam os 2,3 GB ────────────────────────────────
log "criando a assinatura no cluster (copy_data=true -- os 2,3 GB)"
C -v ON_ERROR_STOP=1 -c "
CREATE SUBSCRIPTION $NOME
  CONNECTION 'host=$ORIGEM_REPL port=5432 user=postgres dbname=$BANCO sslmode=require password=$SENHA_SUPABASE'
  PUBLICATION $NOME
  WITH (copy_data = true, streaming = on);" \
  || { echo "falhou a assinatura. A publicacao ficou criada -- use --desfazer" >&2; exit 1; }
log "assinatura criada; a copia roda em segundo plano"

# ── 5. acompanhar ──────────────────────────────────────────────────────────
log "acompanhando a sincronizacao (Ctrl+C nao interrompe a copia, so o relatorio)"
for i in $(seq 1 240); do   # ate 2h
  PRONTAS=$(C -c "select count(*) from pg_subscription_rel r join pg_subscription s on s.oid=r.srsubid where s.subname='$NOME' and r.srsubstate='r';")
  TOTAL=$(C -c "select count(*) from pg_subscription_rel r join pg_subscription s on s.oid=r.srsubid where s.subname='$NOME';")
  ATRASO=$(P -c "select coalesce(pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)),'?') from pg_replication_slots where slot_name='$NOME';")
  LINHAS=$(C -c "select coalesce(sum(n_live_tup),0) from pg_stat_user_tables where schemaname='public';")
  printf '[%s] prontas %s/%s | linhas no cluster %s | atraso do slot %s\n' "$(date +%H:%M:%S)" "${PRONTAS:-?}" "${TOTAL:-?}" "${LINHAS:-?}" "${ATRASO:-?}"
  [ -n "${PRONTAS:-}" ] && [ "${PRONTAS:-0}" = "${TOTAL:-1}" ] && { log "TODAS as $TOTAL tabelas sincronizadas"; break; }
  sleep 30
done

estado
echo
echo "A partir daqui o cluster acompanha a producao em tempo real."
echo "Conferir quando quiser:  bash ligar-replicacao.sh --conferir"
echo "Desistir a qualquer hora: bash ligar-replicacao.sh --desfazer"
