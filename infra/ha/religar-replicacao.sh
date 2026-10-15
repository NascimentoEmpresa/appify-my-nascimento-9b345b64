#!/bin/bash
# ============================================================================
#  Religa a replicacao logica depois que o SLOT FOI PERDIDO.
#
#  QUANDO USAR -- E SO NESTE CASO
#  O log do lider do cluster repete, de 5 em 5 segundos:
#
#    ERROR:  could not start WAL streaming: ERROR:  can no longer get changes
#            from replication slot "erp_corte"
#    DETAIL:  This slot has been invalidated because it exceeded the maximum
#             reserved size.
#
#  Isso NAO e o conflito de chave (esse e o resolver-conflito.sh) e NAO e
#  coluna faltando (esse e o sincronizar-colunas.sh). E o fim da linha: o WAL
#  que a assinatura precisava para continuar FOI APAGADO pela producao. Nao
#  existe conserto incremental -- a unica saida e copiar tudo de novo.
#
#  POR QUE O SLOT MORRE: `max_slot_wal_keep_size = 2GB` na producao
#  Medido em 15/10/2026. A producao gera WAL a ~300 MB/h, e o Postgres se
#  recusa a guardar mais de 2 GB para um slot parado. Chegando la, ele
#  INVALIDA o slot e libera o disco. Ou seja:
#
#    - a producao NUNCA enche o disco por causa de um slot parado. O limite
#      existe exatamente para isso, e e ele que manda.
#    - em troca, uma parada de replicacao tem PRAZO DE VALIDADE de cerca de
#      SETE HORAS. Passado isso, o preco deixa de ser "destravar" e passa a
#      ser "recopiar 2,3 GB".
#
#  O vigia da migration 20261014000020 alerta com 1 GB no slot -- metade do
#  limite, ~3,5 h de folga. Em 14/10 ele nao avisou ninguem porque o WORKER
#  ESTAVA MORTO (ver docs/ha-situacao-15-10.md). O alerta e o que transforma
#  este script em desnecessario.
#
#  O QUE ELE FAZ, NA ORDEM
#    1. confere que o slot esta mesmo perdido -- e RECUSA se estiver saudavel;
#    2. derruba a assinatura no cluster (DISABLE, slot_name=none, DROP);
#    3. solta o slot orfao na producao;
#    4. TRUNCATE em todas as tabelas de `public` no cluster;
#    5. recria a assinatura com copy_data=true e acompanha ate 647/647 PRONTA;
#    6. reaplica a trava de escrita da secao 1.9 e confere o slot.
#
#  O PASSO 4 APAGA O CLUSTER INTEIRO. Isso e seguro **porque ninguem usa o
#  cluster** -- ele e uma copia em paralelo, e quem atende os usuarios hoje e
#  a Supabase. Se isso tiver mudado quando voce ler isto, PARE.
#
#  O passo 5 e uma leitura longa de 2,3 GB numa instancia Small: aparece como
#  CPU e temp_files na producao, nao como travamento. Preferir horario de
#  menos movimento. Nada aqui para o ERP nem escreve em tabela de producao --
#  a unica escrita na producao e soltar o slot morto, que ja nao serve a nada.
#
#  USO (roda NO banco1, que alcanca a producao e o cluster):
#    SENHA_SUPABASE=... bash religar-replicacao.sh              # so confere
#    SENHA_SUPABASE=... bash religar-replicacao.sh --aplicar    # recopia
#
#  Da maquina do Eduardo, use o gatilho, que leva a senha por ambiente:
#    bash infra/ha/disparar-religar.sh
#    bash infra/ha/disparar-religar.sh --aplicar
# ============================================================================
set -uo pipefail
export LC_ALL=C

ACAO="${1:---conferir}"
case "$ACAO" in
  --conferir|--aplicar) ;;
  *) echo "uso: $0 [--conferir|--aplicar]" >&2; exit 2 ;;
esac

REF="${REF:-fwmzeaztjxrxxzxzxmgc}"
NOME="${NOME:-erp_corte}"
# Minutos de paciencia com a copia inicial antes de desistir de acompanhar
# (a copia continua sozinha; so o acompanhamento para).
LIMITE_MIN="${LIMITE_MIN:-240}"

[ -n "${SENHA_SUPABASE:-}" ] || { echo "falta SENHA_SUPABASE" >&2; exit 1; }
set -a; . /opt/erp/infra/failover/.env; set +a

# Para LER o catalogo e soltar o slot, o pooler serve. A CONEXAO DA ASSINATURA
# nao: ela precisa de conexao de replicacao, que so o host direto aceita (e
# ele so resolve em IPv6) -- mesmo motivo documentado no ligar-replicacao.sh.
PROD="host=db.$REF.supabase.co port=5432 user=postgres dbname=postgres sslmode=require connect_timeout=10"
CLU="host=127.0.0.1 port=5000 user=postgres dbname=postgres"
CONEXAO_ASSINATURA="host=db.$REF.supabase.co port=5432 user=postgres password=$SENHA_SUPABASE dbname=postgres sslmode=require"

prod() { PGPASSWORD="$SENHA_SUPABASE" psql "$PROD" -At "$@"; }
clu()  { PGPASSWORD="$PG_SENHA_SUPER"  psql "$CLU"  -At "$@"; }

log(){ echo "[$(date +%H:%M:%S)] $*"; }

# ── 1. diagnostico ─────────────────────────────────────────────────────────
echo "== estado agora =="

ESTADO_SLOT=$(prod -c "select coalesce(max(wal_status),'INEXISTENTE')
                         from pg_replication_slots where slot_name='$NOME';")
ATIVO_SLOT=$(prod -c "select coalesce(max(active::text),'-')
                        from pg_replication_slots where slot_name='$NOME';")
PUB_TABELAS=$(prod -c "select count(*) from pg_publication_tables where pubname='$NOME';")
ASSINATURA=$(clu -c "select count(*) from pg_subscription where subname='$NOME';")
LINHAS_CLU=$(clu -c "select coalesce(sum(n_live_tup),0) from pg_stat_user_tables where schemaname='public';")
TAM_PROD=$(prod -c "select pg_size_pretty(pg_database_size('postgres'));")
TAM_CLU=$(clu  -c "select pg_size_pretty(pg_database_size('postgres'));")

printf '  %-34s %s\n' "slot na producao"        "$ESTADO_SLOT (ativo=$ATIVO_SLOT)"
printf '  %-34s %s\n' "publicacao na producao"  "$PUB_TABELAS tabelas"
printf '  %-34s %s\n' "assinatura no cluster"   "$ASSINATURA"
printf '  %-34s %s\n' "linhas vivas em public"  "$LINHAS_CLU"
printf '  %-34s %s\n' "tamanho producao"        "$TAM_PROD"
printf '  %-34s %s\n' "tamanho cluster"         "$TAM_CLU"

clu -F' | ' -c "
  select 'sincronizacao', string_agg(estado||'='||n::text, '  ' order by estado) from (
    select case srsubstate when 'i' then 'iniciando' when 'd' then 'copiando'
                           when 'f' then 'copiada'   when 's' then 'sincronizada'
                           when 'r' then 'PRONTA'    else srsubstate::text end as estado,
           count(*) as n
      from pg_subscription_rel r join pg_subscription s on s.oid=r.srsubid
     where s.subname='$NOME' group by 1) x;" | sed 's/^/  /'

echo "  erro que o lider esta repetindo:"
# O apply worker roda no LIDER, e o lider muda. Este script roda no banco1 e
# o banco1 nao tem chave para o banco2, entao o log remoto nao esta ao
# alcance -- mesmo limite documentado no resolver-conflito.sh. Quando o lider
# for outro no, dizemos onde olhar em vez de inventar um diagnostico.
LIDER=$(/opt/patroni/bin/patronictl -c /etc/patroni/patroni.yml list -f json 2>/dev/null \
        | tr ',' '\n' | grep -B2 -i '"Leader"' | grep -oE '"banco[12]"' | head -1 | tr -d '"')
EU=$(hostname)
if [ "${LIDER:-}" = "$EU" ] || [ -z "${LIDER:-}" ]; then
  journalctl -u patroni --since '30 min ago' --no-pager 2>/dev/null \
    | grep -E 'ERROR:.*(replication slot|duplicate key|logical)' | tail -2 | sed 's/^/    /'
else
  echo "    o lider e o $LIDER, e este script roda no $EU. Para ver o erro cru:"
  echo "      ssh -p 8443 root@$([ "$LIDER" = banco1 ] && echo 216.238.120.171 || echo 172.237.48.8) \"journalctl -u patroni -n 40 --no-pager\""
fi
# O slot saudavel e o unico veredito que importa: se ele existe e tem
# restart_lsn, a replicacao e recuperavel sem recopiar nada, e recopiar seria
# destruicao gratuita.
PERDIDO=0
case "$ESTADO_SLOT" in
  lost|INEXISTENTE) PERDIDO=1 ;;
esac

echo
if [ "$PERDIDO" -eq 0 ]; then
  echo "== o slot NAO esta perdido (wal_status=$ESTADO_SLOT)."
  echo "   Este script nao serve aqui, e --aplicar vai se recusar a rodar."
  echo "   Para parada de replicacao com slot vivo, na ordem:"
  echo "     bash infra/ha/disparar-sincronia.sh --conferir   # coluna faltando?"
  echo "     bash infra/ha/disparar-conflito.sh  --conferir   # conflito de chave?"
  exit 0
fi

echo "== o slot esta PERDIDO. A unica saida e recopiar."

ALVOS_SQL="
with particoes as (select i.inhrelid as oid from pg_inherits i)
select string_agg(format('%I.%I','public',c.relname), ', ' order by c.relname)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind in ('r','p')
   and c.oid not in (select oid from particoes);"
ALVOS=$(clu -c "$ALVOS_SQL")
QUANTOS=$(clu -c "with particoes as (select i.inhrelid as oid from pg_inherits i)
  select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','p')
     and c.oid not in (select oid from particoes);")

if [ "$ACAO" = "--conferir" ]; then
  echo
  echo "  O --aplicar faria, nesta ordem:"
  echo "    1. DROP da assinatura '$NOME' no cluster"
  echo "    2. soltar o slot morto '$NOME' na producao"
  echo "    3. TRUNCATE em $QUANTOS tabelas de public no cluster ($LINHAS_CLU linhas)"
  echo "    4. CREATE SUBSCRIPTION com copy_data=true -- $TAM_PROD atravessando"
  echo "    5. acompanhar ate $PUB_TABELAS/$PUB_TABELAS PRONTA"
  echo "    6. reaplicar a trava de escrita da secao 1.9"
  echo
  echo "  Nada foi alterado. Para fazer de verdade, da sua maquina:"
  echo "    bash infra/ha/disparar-religar.sh --aplicar"
  exit 1
fi

# ── 2. derruba a assinatura ────────────────────────────────────────────────
echo
log "1/6 derrubando a assinatura no cluster"
if [ "$ASSINATURA" != "0" ]; then
  # A ordem importa: sem DISABLE o SET (slot_name) e recusado, e sem
  # slot_name=none o DROP tenta falar com a producao para apagar um slot que
  # ja nao existe -- e fica pendurado.
  clu -c "alter subscription $NOME disable;"                  | sed 's/^/    /'
  clu -c "alter subscription $NOME set (slot_name = none);"    | sed 's/^/    /'
  clu -c "drop subscription $NOME;"                            | sed 's/^/    /'
else
  echo "    (nao existia)"
fi

# ── 3. solta o slot morto na producao ──────────────────────────────────────
log "2/6 soltando o slot morto na producao"
prod -c "select 'soltando: '||pg_drop_replication_slot(slot_name)
           from pg_replication_slots where slot_name='$NOME';" | sed 's/^/    /'
prod -c "select 'slots agora na producao: '||count(*) from pg_replication_slots;" | sed 's/^/    /'

# ── 4. esvazia o public do cluster ─────────────────────────────────────────
#
#  Uma TRUNCATE so, com todas as tabelas na mesma lista: assim as chaves
#  estrangeiras entre elas ficam satisfeitas sem precisar de CASCADE. Particao
#  nao entra na lista porque o TRUNCATE do pai ja leva as filhas -- e CASCADE
#  aqui poderia levar tabela de FORA de public sem eu ver.
log "3/6 esvaziando public no cluster ($QUANTOS tabelas, $LINHAS_CLU linhas)"
if ! clu -v ON_ERROR_STOP=1 -c "set lock_timeout = '30s';
                                set statement_timeout = '900s';
                                truncate table $ALVOS;" 2>&1 | sed 's/^/    /'; then
  echo
  echo "FALHOU o TRUNCATE. Nada foi copiado; a assinatura ja foi derrubada." >&2
  echo "Se o erro citar uma tabela de fora de public, me diga qual -- nao vou" >&2
  echo "usar CASCADE sem saber o que ele levaria junto." >&2
  exit 1
fi
clu -c "select 'linhas vivas em public agora: '||coalesce(sum(n_live_tup),0)
          from pg_stat_user_tables where schemaname='public';" | sed 's/^/    /'

# ── 5. recria a assinatura e acompanha ─────────────────────────────────────
log "4/6 criando a assinatura (copy_data=true -- $TAM_PROD atravessando)"
clu -v ON_ERROR_STOP=1 -c "create subscription $NOME
  connection '$CONEXAO_ASSINATURA'
  publication $NOME
  with (copy_data = true, streaming = on);" | sed 's/^/    /' || {
  echo "FALHOU o CREATE SUBSCRIPTION. O cluster ficou VAZIO -- rode de novo." >&2
  exit 1
}

log "5/6 acompanhando a copia (ate $LIMITE_MIN min; Ctrl-C nao para a copia)"
INICIO=$(date +%s)
while :; do
  PRONTAS=$(clu -c "select count(*) from pg_subscription_rel r
                      join pg_subscription s on s.oid=r.srsubid
                     where s.subname='$NOME' and r.srsubstate='r';")
  TOTAL=$(clu -c "select count(*) from pg_subscription_rel r
                    join pg_subscription s on s.oid=r.srsubid
                   where s.subname='$NOME';")
  TAM=$(clu -c "select pg_size_pretty(pg_database_size('postgres'));")
  MIN=$(( ($(date +%s) - INICIO) / 60 ))
  printf '    %3d min  %s/%s prontas  cluster=%s\n' "$MIN" "${PRONTAS:-?}" "${TOTAL:-?}" "$TAM"
  [ -n "$PRONTAS" ] && [ "$PRONTAS" = "$TOTAL" ] && break
  [ "$MIN" -ge "$LIMITE_MIN" ] && { echo "    desisti de acompanhar -- a copia segue sozinha"; break; }
  sleep 60
done

# ── 6. trava de escrita e veredito ─────────────────────────────────────────
# A copia inicial chega com os GRANT da producao, onde escrever e permitido.
# Reaplicar a trava e parte do conserto, nao um extra (secao 1.9 do roteiro).
log "6/6 reaplicando a trava de escrita (secao 1.9)"
clu -c "REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public
          FROM anon, authenticated;
        NOTIFY pgrst, 'reload schema';"
clu -c "select 'escrita direta no cluster: '||count(*)||' (tem que ser 0)'
          from information_schema.role_table_grants
         where grantee in ('anon','authenticated') and table_schema='public'
           and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');" | sed 's/^/    /'

echo
echo "== veredito =="
prod -F' | ' -c "select 'slot na producao', wal_status||'  ativo='||active::text||'  atraso='||
                        coalesce(pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)),'?')
                   from pg_replication_slots where slot_name='$NOME';" | sed 's/^/  /'
for t in CHAMADO_SISTEMA EMPREGADOS WA_CURRICULOS; do
  a=$(prod -c "select count(*) from public.\"$t\";" 2>/dev/null)
  b=$(clu  -c "select count(*) from public.\"$t\";" 2>/dev/null)
  printf '  %-24s producao=%-9s cluster=%-9s %s\n' "$t" "${a:-?}" "${b:-?}" \
         "$([ "${a:-x}" = "${b:-y}" ] && echo ok || echo DIFERE)"
done

echo
echo "  O que a replicacao NAO trouxe e continua pendente para a virada:"
echo "    - auth e storage  -> infra/ha/carregar-auth-storage.sh"
echo "    - os anexos       -> o espelho de 1 min; conferir o delta antes do corte"
echo "    - as sequences    -> setval na Fase 2, depois do congelamento"
echo
echo "  Agora reconfira o schema, que o TRUNCATE nao toca mas a producao andou:"
echo "    bash infra/ha/disparar-schema.sh"
echo "    bash infra/ha/disparar-sincronia.sh"
