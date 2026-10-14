#!/bin/bash
# ============================================================================
#  Resolve CONFLITO DE CHAVE que para a replicacao logica.
#
#  O QUE ACONTECEU EM 14/10/2026 -- E POR QUE A TRAVA NAO SEGUROU
#  O cluster estava com `INSERT/UPDATE/DELETE` REVOGADOS de anon e
#  authenticated (secao 1.9 do roteiro), e eu afirmei que ele era "somente
#  leitura". Nao era.
#
#  Durante a aceitacao pelo navegador, o Eduardo abriu tres chamados. Cada
#  abertura marca o chamado como lido, e essa marcacao passa por uma funcao
#  SECURITY DEFINER. Funcao SECURITY DEFINER roda com os privilegios do DONO,
#  nao do chamador -- ou seja, ela ESCREVE independente do REVOKE. Tres linhas
#  entraram em CHAMADO_SISTEMA_LEITURA as 20:08:23, 20:08:47 e 20:09:15.
#
#  As 20:09:41 a producao inseriu, de verdade, uma linha com a MESMA chave
#  (chamado_id, user_id) que o cluster ja havia criado localmente. A replicacao
#  tentou aplicar e morreu:
#
#     ERROR: duplicate key value violates unique constraint
#            "CHAMADO_SISTEMA_LEITURA_pkey"
#
#  A partir dai, o mesmo ciclo da coluna faltando: trabalhador morrendo a cada
#  5 s, slot parado, WAL preso na producao.
#
#  A LICAO, QUE VALE MAIS QUE ESTE SCRIPT
#  `REVOKE ... FROM anon, authenticated` NAO torna um banco somente-leitura.
#  Ele fecha o acesso DIRETO as tabelas e deixa aberto todo caminho que passa
#  por funcao SECURITY DEFINER -- e neste ERP isso e a regra, nao a exceccao
#  (1.532 funcoes, boa parte delas SECURITY DEFINER por causa da RLS).
#  `default_transaction_read_only` tambem nao resolve: o PostgREST abre
#  transacao READ WRITE explicitamente para verbo que modifica.
#
#  Consequencia pratica: enquanto o cluster for assinante, ABRIR O ERP CONTRA
#  ELE E UMA OPERACAO DE ESCRITA. Vale fazer -- a aceitacao pelo navegador
#  achou coisa que nenhum curl acharia -- mas sabendo que vai gerar conflito, e
#  com este script a mao. Nao e um teste "sem efeito".
#
#  COMO ELE RESOLVE, EM DUAS FASES
#  Fase 1: apaga do cluster as linhas divergentes. Isso libera a chave e a fila
#          da replicacao anda.
#  Fase 2: depois que o atraso zera, recopia da producao as linhas que ela tem
#          e o cluster nao. Necessario porque a producao NAO reenvia linha
#          antiga: se o teste sobrescreveu (UPSERT) uma linha de 07/10, apagar
#          sem recopiar deixaria um furo permanente.
#
#  A ordem importa e nao e intercambiavel: recopiar antes de a fila andar
#  reocuparia a chave e o conflito voltaria no mesmo lugar.
#
#  USO (roda NO banco1):
#    SENHA_SUPABASE=... bash resolver-conflito.sh                 # so mostra
#    SENHA_SUPABASE=... bash resolver-conflito.sh --aplicar
#    SENHA_SUPABASE=... bash resolver-conflito.sh --aplicar TABELA # tabela na mao
#
#  Pelo gatilho, da maquina do Eduardo:
#    bash infra/ha/disparar-conflito.sh
#    bash infra/ha/disparar-conflito.sh --aplicar
# ============================================================================
set -uo pipefail
export LC_ALL=C

ACAO="${1:---conferir}"
TABELA_MANUAL="${2:-}"
REF="${REF:-fwmzeaztjxrxxzxzxmgc}"
ASSINATURA="${ASSINATURA:-erp_corte}"
[ -n "${SENHA_SUPABASE:-}" ] || { echo "falta SENHA_SUPABASE" >&2; exit 1; }

set -a; . /opt/erp/infra/failover/.env; set +a
PROD="host=db.$REF.supabase.co port=5432 user=postgres dbname=postgres sslmode=require connect_timeout=10"
CLU="host=127.0.0.1 port=5000 user=postgres dbname=postgres"
prod() { PGPASSWORD="$SENHA_SUPABASE" psql "$PROD" -At "$@"; }
clu()  { PGPASSWORD="$PG_SENHA_SUPER"  psql "$CLU"  -At "$@"; }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# ── 1. descobrir a tabela em conflito ───────────────────────────────────────
# O erro nao diz a tabela, diz a RESTRICAO. O catalogo faz a ponte. Buscar no
# log LOCAL porque so o lider aplica -- e so o lider chega a rodar isto.
if [ -n "$TABELA_MANUAL" ]; then
  TABELA="$TABELA_MANUAL"
  echo "== tabela informada na mao: $TABELA"
else
  RESTRICAO=$(journalctl -u patroni --since "30 min ago" --no-pager 2>/dev/null \
              | grep -oE 'violates unique constraint "[^"]+"' | tail -1 \
              | sed 's/.*"\(.*\)"/\1/')
  if [ -z "$RESTRICAO" ]; then
    echo "nao achei conflito de chave no log dos ultimos 30 min."
    echo "Se a replicacao esta parada por OUTRO motivo, veja:"
    echo "  journalctl -u patroni --since '30 min ago' | grep ERROR"
    echo "Se for coluna faltando:  bash infra/ha/disparar-sincronia.sh --aplicar"
    exit 1
  fi
  echo "== restricao em conflito: $RESTRICAO"
  TABELA=$(clu -c "select t.relname from pg_constraint c
                     join pg_class t on t.oid = c.conrelid
                     join pg_namespace n on n.oid = t.relnamespace
                    where n.nspname = 'public' and c.conname = '$RESTRICAO';")
  [ -n "$TABELA" ] || { echo "nao achei a tabela da restricao $RESTRICAO" >&2; exit 1; }
fi
echo "== tabela: public.$TABELA"

# ── 2. chave primaria e colunas ─────────────────────────────────────────────
PK=$(clu -c "select string_agg(quote_ident(a.attname), ',' order by k.ord)
               from pg_constraint c
               join lateral unnest(c.conkey) with ordinality as k(att, ord) on true
               join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.att
              where c.conrelid = 'public.\"$TABELA\"'::regclass and c.contype = 'p';")
[ -n "$PK" ] || { echo "a tabela $TABELA nao tem chave primaria -- resolver na mao" >&2; exit 1; }
echo "== chave primaria: $PK"

# Chave como texto, e o conteudo da linha inteira como md5. Comparar a linha
# toda (e nao coluna a coluna) pega divergencia em qualquer campo sem eu ter de
# saber quais existem. A ordem das colunas e a mesma dos dois lados -- isso foi
# conferido pelo sincronizar-schema.sh, bloco COLUNAS.
Q="select concat_ws('|', $PK) || E'\t' || md5(t::text) from public.\"$TABELA\" t;"
prod -c "$Q" | sort > "$TMP/prod"
clu  -c "$Q" | sort > "$TMP/clu"

cut -f1 "$TMP/prod" | sort > "$TMP/kp"
cut -f1 "$TMP/clu"  | sort > "$TMP/kc"

# Divergente = chave que existe no cluster e cujo conteudo nao bate com a
# producao (inclui a chave que existe SO no cluster).
comm -13 "$TMP/prod" "$TMP/clu" | cut -f1 | sort -u > "$TMP/suspeitas"
comm -12 "$TMP/suspeitas" "$TMP/kc" > "$TMP/apagar"

echo
echo "linhas na producao: $(wc -l < "$TMP/prod")   no cluster: $(wc -l < "$TMP/clu")"
if [ ! -s "$TMP/apagar" ]; then
  echo "=== nenhuma linha divergente em public.$TABELA ==="
  echo "    O conflito pode ter sido em outra tabela, ou ja resolvido."
  exit 1
fi

echo "=== $(wc -l < "$TMP/apagar") linha(s) divergente(s) no cluster ==="
head -20 "$TMP/apagar" | sed 's/^/    /'
[ "$(wc -l < "$TMP/apagar")" -gt 20 ] && echo "    ... (+$(( $(wc -l < "$TMP/apagar") - 20 )))"

if [ "$ACAO" != "--aplicar" ]; then
  echo
  # O caminho a mostrar e o do GATILHO, na maquina do Eduardo. Imprimir "$0"
  # daria /root/resolver-conflito.sh, que e o caminho aqui dentro do servidor
  # e nao serve para quem esta lendo isto de la.
  echo "=== nada foi feito. Para resolver, da sua maquina: ==="
  echo "    bash infra/ha/disparar-conflito.sh --aplicar $TABELA"
  exit 1
fi

# ── 3. FASE 1: apagar as divergentes do cluster ─────────────────────────────
# Uma condicao por linha, com a chave montada do mesmo jeito que na leitura:
# assim nao preciso decompor chave composta nem adivinhar tipo.
echo
echo "=== FASE 1: apagando as divergentes do cluster ==="
{
  echo "BEGIN;"
  while IFS= read -r K; do
    [ -n "$K" ] || continue
    KE=${K//\'/\'\'}
    echo "DELETE FROM public.\"$TABELA\" t WHERE concat_ws('|', $PK) = '$KE';"
  done < "$TMP/apagar"
  echo "COMMIT;"
} > "$TMP/fase1.sql"
clu -v ON_ERROR_STOP=1 -f "$TMP/fase1.sql" | tail -3 || { echo "FASE 1 falhou" >&2; exit 2; }

# ── 4. destravar o trabalhador ──────────────────────────────────────────────
# Ele esta num ciclo de 5 s; derrubar a conexao faz a proxima tentativa ja
# encontrar a chave livre, em vez de esperar o ciclo.
echo "=== derrubando o trabalhador para a proxima tentativa pegar a chave livre ==="
clu -c "select pg_terminate_backend(pid) from pg_stat_subscription
         where subname = '$ASSINATURA' and pid is not null;" >/dev/null

echo "=== esperando o atraso zerar (ate 3 min) ==="
for i in $(seq 1 36); do
  sleep 5
  LSN=$(clu -c "select coalesce(received_lsn::text,'') from pg_stat_subscription where subname='$ASSINATURA';")
  ATRASO=$(prod -c "select pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)::bigint
                      from pg_replication_slots where slot_name='$ASSINATURA';")
  if [ -n "$LSN" ] && [ "${ATRASO:-999999}" -lt 2000000 ]; then
    echo "   aplicando de novo: LSN $LSN, atraso $ATRASO bytes"
    break
  fi
  [ $((i % 6)) -eq 0 ] && echo "   ... $((i * 5))s, atraso ${ATRASO:-?} bytes"
done

# ── 5. FASE 2: recopiar o que a producao tem e o cluster nao ────────────────
# Depois da fila andar, o que ainda falta e linha antiga que a producao nao
# reenvia. COPY em CSV em vez de INSERT montado a mao: ele respeita todo tipo
# (jsonb, array, timestamp com fuso) sem eu escrever conversao nenhuma.
echo
echo "=== FASE 2: recopiando da producao o que ficou faltando ==="
prod -c "$Q" | sort | cut -f1 | sort > "$TMP/kp2"
clu  -c "$Q" | sort | cut -f1 | sort > "$TMP/kc2"
comm -23 "$TMP/kp2" "$TMP/kc2" > "$TMP/recopiar"

if [ ! -s "$TMP/recopiar" ]; then
  echo "   nada a recopiar -- a replicacao trouxe tudo."
else
  echo "   $(wc -l < "$TMP/recopiar") linha(s) a recopiar"
  LISTA=$(sed "s/'/''/g; s/^/'/; s/\$/'/" "$TMP/recopiar" | paste -sd, -)
  PGPASSWORD="$SENHA_SUPABASE" psql "$PROD" -c \
    "\\copy (select * from public.\"$TABELA\" t where concat_ws('|', $PK) in ($LISTA)) to '$TMP/linhas.csv' with csv" \
    >/dev/null || { echo "   falhou ao exportar da producao" >&2; exit 2; }
  PGPASSWORD="$PG_SENHA_SUPER" psql "$CLU" -v ON_ERROR_STOP=1 -c \
    "\\copy public.\"$TABELA\" from '$TMP/linhas.csv' with csv" \
    || { echo "   falhou ao importar no cluster" >&2; exit 2; }
fi

# ── 6. a trava, de novo ─────────────────────────────────────────────────────
echo
echo "=== reaplicando a trava de escrita (secao 1.9) ==="
clu -c "REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public
          FROM anon, authenticated;
        NOTIFY pgrst, 'reload schema';" >/dev/null

echo "=== estado final ==="
clu -c "$Q" | sort > "$TMP/clu3"
prod -c "$Q" | sort > "$TMP/prod3"
if diff -q "$TMP/prod3" "$TMP/clu3" >/dev/null; then
  echo "   public.$TABELA: IDENTICA nos dois lados ($(wc -l < "$TMP/clu3") linhas)"
else
  echo "   public.$TABELA: ainda difere em $(comm -3 "$TMP/prod3" "$TMP/clu3" | wc -l) linha(s)"
  echo "   (pode ser escrita nova da producao chegando -- rode de novo em 1 min)"
fi
prod -c "select '   slot na producao: '||pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn))||', ativo='||active
           from pg_replication_slots where slot_name='$ASSINATURA';"
clu -c "select '   assinatura: '||coalesce(received_lsn::text,'NULO')||', ultima msg ha '||coalesce(extract(epoch from (now()-last_msg_receipt_time))::int::text,'-')||'s'
          from pg_stat_subscription where subname='$ASSINATURA';"
