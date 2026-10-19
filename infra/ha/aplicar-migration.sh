#!/usr/bin/env bash
# ============================================================================
#  APLICAR UMA MIGRATION NO CLUSTER
#
#  O QUE ISTO SUBSTITUI
#  Ate a virada, migration se aplicava colando o `.sql` no SQL Editor da
#  Supabase. O editor sumiu com ela. Este script e o lugar novo -- e ganha
#  tres coisas que o editor nao tinha:
#
#    1. `lock_timeout`. Um `ALTER TABLE` que espera nao fica esperando quieto:
#       ele entra na fila e passa a BARRAR as leituras que chegam depois.
#       Em 2026 isso travou duas telas por 63 segundos. Com o timeout, a
#       migration desiste em 5 s e o ERP nem percebe -- voce roda de novo
#       mais tarde.
#    2. Transacao unica. Ou entra inteira, ou nao entra nada. Meia migration
#       aplicada e a pior situacao possivel: o codigo novo espera a coluna
#       que existe, e a constraint que nao.
#    3. Registro. Grava em `supabase_migrations.schema_migrations`, que na
#       Supabase quase nunca era preenchido (228 registros para 1.359
#       arquivos). Dai para a frente da para saber o que entrou.
#
#  O QUE ELE NAO FAZ
#  Nao decide por voce. Migration e DDL, e DDL no banco que esta no ar e a
#  unica coisa desta infraestrutura que nao deve rodar sozinha no merge.
#
#  USO
#    bash infra/ha/aplicar-migration.sh supabase/migrations/2026...sql
#    bash infra/ha/aplicar-migration.sh --pendentes      # o que falta aplicar
#    LOCK=30s bash infra/ha/aplicar-migration.sh <arquivo>
# ============================================================================
set -uo pipefail

BANCO1="${BANCO1:-216.238.120.171}"
PORTA_SSH="${PORTA_SSH:-8443}"
LOCK="${LOCK:-5s}"
ARQ="${1:-}"

cd "$(dirname "$0")/../.." || exit 1
[ -n "$ARQ" ] || { sed -n '2,32p' "$0"; exit 2; }

no() { ssh -p "$PORTA_SSH" -o BatchMode=yes -o ConnectTimeout=20 \
         -o StrictHostKeyChecking=accept-new "root@$BANCO1" "$@"; }

# ── --semear: marcar como aplicado tudo que ja estava dentro na virada ────
#
#  O livro `supabase_migrations.schema_migrations` do cluster nasceu vazio (o
#  dump nao traz esse schema), e a producao so tinha 228 registros para 1.359
#  arquivos -- ele nunca foi usado de verdade.
#
#  Sem semear, `--pendentes` lista 1.042 arquivos para sempre, e uma lista que
#  esta sempre errada deixa de ser lida. Com a semeadura, ela passa a mostrar
#  exatamente o que importa: o que entrou no repositorio DEPOIS da virada.
#
#  A afirmacao que a semeadura faz e verdadeira e verificavel: na noite da
#  virada o schema do cluster foi conferido contra a producao e bateu em tudo
#  -- 680 tabelas, 917 indices, 1.600 funcoes, 1.497 politicas, 2.492
#  constraints. Entao "o cluster contem o efeito destes arquivos" e um fato
#  medido, nao uma suposicao.
if [ "$ARQ" = "--semear" ]; then
  echo "== semeando o livro de migrations do cluster"
  ls supabase/migrations/*.sql 2>/dev/null | xargs -n1 basename \
    | awk -F'_' '/^[0-9]+_/ {v=$1; sub(/^[0-9]+_/,"",$0); printf "%s|%s\n", v, $0}' > /tmp/sem.txt
  echo "   $(grep -c . /tmp/sem.txt) arquivos versionados no repositorio"
  {
    echo "CREATE SCHEMA IF NOT EXISTS supabase_migrations;"
    echo "CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text primary key, statements text[], name text);"
    while IFS='|' read -r V N; do
      [ -n "$V" ] || continue
      printf "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('%s', '%s') ON CONFLICT DO NOTHING;\n" \
        "$V" "$(printf '%s' "$N" | sed "s/'/''/g")"
    done < /tmp/sem.txt
  } | no "SUP=\$(grep -m1 '^PG_SENHA_SUPER=' /opt/erp/infra/failover/.env | cut -d= -f2-)
          PGPASSWORD=\"\$SUP\" psql -h 127.0.0.1 -p 5000 -U postgres -d postgres -q -f -" 2>&1 | tail -3
  echo -n "   registradas agora: "
  no "SUP=\$(grep -m1 '^PG_SENHA_SUPER=' /opt/erp/infra/failover/.env | cut -d= -f2-)
      PGPASSWORD=\"\$SUP\" psql -h 127.0.0.1 -p 5000 -U postgres -d postgres -At -c \
        'select count(*) from supabase_migrations.schema_migrations'"
  rm -f /tmp/sem.txt
  exit 0
fi

if [ "$ARQ" = "--pendentes" ]; then
  echo "== migrations do repositorio que NAO estao registradas no cluster"
  no "SUP=\$(grep -m1 '^PG_SENHA_SUPER=' /opt/erp/infra/failover/.env | cut -d= -f2-)
      PGPASSWORD=\"\$SUP\" psql -h 127.0.0.1 -p 5000 -U postgres -d postgres -At -c \
        \"select version from supabase_migrations.schema_migrations\" 2>/dev/null" \
    | LC_ALL=C sort > /tmp/aplicadas.txt
  ls supabase/migrations/*.sql 2>/dev/null | xargs -n1 basename 2>/dev/null \
    | sed -E 's/^([0-9]+).*/\1/' | LC_ALL=C sort -u > /tmp/todas.txt
  N=$(LC_ALL=C comm -23 /tmp/todas.txt /tmp/aplicadas.txt | grep -c . || true)
  echo "   no repositorio: $(grep -c . /tmp/todas.txt)   registradas no cluster: $(grep -c . /tmp/aplicadas.txt)"
  echo "   sem registro:   $N"
  echo
  echo "   ⚠ 'sem registro' NAO quer dizer 'nao aplicada'. O registro quase"
  echo "   nunca foi preenchido na Supabase, entao a maioria dessas JA esta no"
  echo "   banco. Vale para as NOVAS, daqui para a frente."
  LC_ALL=C comm -23 /tmp/todas.txt /tmp/aplicadas.txt | tail -8 | sed 's/^/     /'
  rm -f /tmp/aplicadas.txt /tmp/todas.txt
  exit 0
fi

[ -f "$ARQ" ] || { echo "arquivo nao encontrado: $ARQ" >&2; exit 1; }
VERSAO=$(basename "$ARQ" | sed -E 's/^([0-9]+).*/\1/')
echo "== $ARQ  (versao $VERSAO)"
echo "   $(wc -l < "$ARQ") linhas, $(grep -ciE '^\s*(create|alter|drop)' "$ARQ" || true) comandos de DDL"

JA=$(no "SUP=\$(grep -m1 '^PG_SENHA_SUPER=' /opt/erp/infra/failover/.env | cut -d= -f2-)
        PGPASSWORD=\"\$SUP\" psql -h 127.0.0.1 -p 5000 -U postgres -d postgres -At -c \
          \"select count(*) from supabase_migrations.schema_migrations where version='$VERSAO'\" 2>/dev/null")
if [ "${JA:-0}" != "0" ]; then
  echo "   ja registrada no cluster. Nada a fazer."
  exit 0
fi

echo "== aplicando com lock_timeout=$LOCK, em UMA transacao"
# O arquivo vai por stdin: nada e gravado no no.
{
  echo "\\set ON_ERROR_STOP on"
  echo "BEGIN;"
  echo "SET LOCAL lock_timeout = '$LOCK';"
  cat "$ARQ"
  echo ";"
  echo "CREATE SCHEMA IF NOT EXISTS supabase_migrations;"
  echo "CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text primary key, statements text[], name text);"
  echo "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('$VERSAO', '$(basename "$ARQ")') ON CONFLICT DO NOTHING;"
  echo "COMMIT;"
} | no "SUP=\$(grep -m1 '^PG_SENHA_SUPER=' /opt/erp/infra/failover/.env | cut -d= -f2-)
        PGPASSWORD=\"\$SUP\" psql -h 127.0.0.1 -p 5000 -U postgres -d postgres -v ON_ERROR_STOP=1 -f -" 2>&1 | tail -15
RC=${PIPESTATUS[0]}

echo
if [ "$RC" -eq 0 ]; then
  echo "   aplicada e registrada."
  echo "   Se ela criou tabela ou policy, reconfira a trava de escrita:"
  echo "      bash infra/ha/rollback-virada.sh --conferir"
else
  echo "   FALHOU -- nada foi aplicado (transacao unica)." >&2
  echo "   Se o erro foi 'canceling statement due to lock timeout', alguem" >&2
  echo "   estava usando a tabela. Tente de novo em alguns minutos, ou com" >&2
  echo "   LOCK=30s se for fora do horario." >&2
fi
exit "$RC"
