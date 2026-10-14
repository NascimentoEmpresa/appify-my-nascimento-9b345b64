#!/bin/bash
# ============================================================================
#  Conserta a deriva de colunas que PARA a replicacao logica.
#
#  POR QUE ISTO EXISTE
#  Enquanto a replicacao esta ligada, toda migration aplicada na producao que
#  acrescenta coluna numa tabela publicada DERRUBA a replicacao: o processo de
#  aplicacao do cluster morre com
#
#    ERROR: logical replication target relation "public.X" is missing
#           replicated columns: "a", "b"
#
#  ...e renasce a cada 5 segundos, para sempre, sem nunca avancar. O slot
#  deixa de ser consumido e o WAL se ACUMULA NA PRODUCAO. Em 14/10/2026 isso
#  ficou 1h50 sem ninguem ver e segurou 840 MB de WAL. Ninguem viu porque o
#  worker de alertas estava desligado.
#
#  TRES ARMADILHAS, todas pagas em 14/10/2026:
#
#  1. Corrigir a coluna NAO basta. O processo pode ficar pendurado numa conexao
#     morta, e `ALTER SUBSCRIPTION ... DISABLE/ENABLE` NAO o derruba -- o PID
#     continua o mesmo. So `pg_terminate_backend` resolve. Por isso o --aplicar
#     termina reiniciando o worker a forca.
#
#  2. Comparar a linha inteira (tipo+default) da falso positivo: o mesmo
#     default aparece como `gen_random_bytes` na producao e
#     `extensions.gen_random_bytes` no cluster, porque o search_path do restore
#     qualificou a funcao. O que importa e a coluna EXISTIR.
#
#  3. DEFAULT nao pode entrar na tabela de comparacao: ha coluna cujo default e
#     um texto com quebra de linha e `|` dentro ("Precisamos entrar em contato
#     com voce..."), e isso destroi qualquer formato de uma-linha-por-coluna.
#     Aqui a comparacao usa so tabela|coluna|tipo|notnull, e o default e
#     buscado individualmente, por coluna, so para as poucas que faltam.
#
#  USO (a partir do banco1, que alcanca a producao e o cluster):
#    SENHA_SUPABASE=... bash sincronizar-colunas.sh --conferir   # so olha
#    SENHA_SUPABASE=... bash sincronizar-colunas.sh --aplicar    # corrige
#
#  O --conferir nao escreve nada em lugar nenhum e serve para rodar de rotina.
#  Sai com codigo 1 quando acha divergencia, para servir de alerta.
# ============================================================================
set -euo pipefail
export LC_ALL=C

ACAO="${1:---conferir}"
REF="${REF:-fwmzeaztjxrxxzxzxmgc}"
[ -n "${SENHA_SUPABASE:-}" ] || { echo "falta SENHA_SUPABASE" >&2; exit 1; }

set -a; . /opt/erp/infra/failover/.env; set +a
PROD="host=db.$REF.supabase.co port=5432 user=postgres dbname=postgres sslmode=require connect_timeout=10"
CLU="host=127.0.0.1 port=5000 user=postgres dbname=postgres"

prod() { PGPASSWORD="$SENHA_SUPABASE" psql "$PROD" -At "$@"; }
clu()  { PGPASSWORD="$PG_SENHA_SUPER"  psql "$CLU"  -At "$@"; }

# Sem default: so identificadores e tipo, que nunca tem quebra de linha.
Q="select c.relname||'|'||a.attname||'|'||format_type(a.atttypid,a.atttypmod)
       ||'|'||a.attnotnull::text
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     join pg_attribute a on a.attrelid = c.oid
    where n.nspname = 'public' and c.relkind in ('r','p')
      and a.attnum > 0 and not a.attisdropped
    order by 1;"

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
prod -c "$Q" | sort > "$TMP/prod"
clu  -c "$Q" | sort > "$TMP/clu"

cut -d'|' -f1,2 "$TMP/prod" | sort > "$TMP/chave_prod"
cut -d'|' -f1,2 "$TMP/clu"  | sort > "$TMP/chave_clu"
cut -d'|' -f1   "$TMP/prod" | sort -u > "$TMP/tab_prod"
cut -d'|' -f1   "$TMP/clu"  | sort -u > "$TMP/tab_clu"

TAB_FALTA=$(comm -23 "$TMP/tab_prod" "$TMP/tab_clu" || true)

# Coluna ausente SO conta se a tabela ja existe no cluster -- tabela inteira
# ausente nao esta na publicacao e nao derruba a replicacao.
: > "$TMP/falta"
comm -23 "$TMP/chave_prod" "$TMP/chave_clu" > "$TMP/dif" || true
while IFS='|' read -r t c; do
  [ -n "$t" ] || continue
  grep -qF "$t|" "$TMP/chave_clu" || continue
  grep -m1 -F "$t|$c|" "$TMP/prod" >> "$TMP/falta" || true
done < "$TMP/dif"

# Tipo divergente em coluna presente dos dois lados: nao para a replicacao na
# hora, mas vira erro de conversao ou dado truncado. So reporta.
: > "$TMP/tipo"
comm -12 "$TMP/chave_prod" "$TMP/chave_clu" > "$TMP/comuns" || true
while IFS='|' read -r t c; do
  [ -n "$t" ] || continue
  TP=$(grep -m1 -F "$t|$c|" "$TMP/prod" | cut -d'|' -f3) || TP=''
  TC=$(grep -m1 -F "$t|$c|" "$TMP/clu"  | cut -d'|' -f3) || TC=''
  [ "$TP" = "$TC" ] || echo "  $t.$c: producao=$TP  cluster=$TC" >> "$TMP/tipo"
done < "$TMP/comuns"

echo "colunas na producao: $(wc -l < "$TMP/prod")   no cluster: $(wc -l < "$TMP/clu")"
echo

if [ -n "$TAB_FALTA" ]; then
  echo "=== TABELAS inteiras que faltam no cluster (NAO param a replicacao,"
  echo "    mas precisam existir antes do Marco B) ==="
  echo "$TAB_FALTA" | sed 's/^/  - /'
  echo
fi

if [ -s "$TMP/tipo" ]; then
  echo "=== TIPOS divergentes (nao param a replicacao, mas revise) ==="
  cat "$TMP/tipo"
  echo
fi

if [ ! -s "$TMP/falta" ]; then
  echo "=== COLUNAS: nenhuma faltando. A replicacao nao vai parar por isso. ==="
  { [ -z "$TAB_FALTA" ] && [ ! -s "$TMP/tipo" ]; } && exit 0
  exit 1
fi

echo "=== COLUNAS faltando no cluster -- ESTAS PARAM A REPLICACAO ==="
cut -d'|' -f1,2,3 "$TMP/falta" | sed 's/^/  /'
echo

# O DEFAULT e buscado AQUI, uma coluna de cada vez, direto do catalogo da
# producao -- nunca passa por grep/cut, justamente por causa da armadilha 3.
: > "$TMP/ddl"
while IFS='|' read -r t c tp nn; do
  DF=$(prod -c "select coalesce(pg_get_expr(d.adbin, d.adrelid), '')
                  from pg_class k
                  join pg_namespace n on n.oid = k.relnamespace
                  join pg_attribute a on a.attrelid = k.oid
                  left join pg_attrdef d on d.adrelid = k.oid and d.adnum = a.attnum
                 where n.nspname = 'public' and k.relname = '$t' and a.attname = '$c';")
  LINHA="ALTER TABLE public.\"$t\" ADD COLUMN IF NOT EXISTS \"$c\" $tp"
  [ -n "$DF" ] && LINHA="$LINHA DEFAULT $DF"
  if [ "$nn" = "t" ]; then
    if [ -z "$DF" ]; then
      echo "  !! $t.$c e NOT NULL sem DEFAULT -- revise a mao, nao vou adivinhar" >&2
      continue
    fi
    LINHA="$LINHA NOT NULL"
  fi
  printf '%s;\n' "$LINHA" >> "$TMP/ddl"
done < "$TMP/falta"

if [ "$ACAO" != "--aplicar" ]; then
  echo "=== DDL que o --aplicar executaria (nada foi feito) ==="
  cat "$TMP/ddl"
  exit 1
fi

echo "=== aplicando no cluster ==="
{ echo "SET lock_timeout = '10s';"; cat "$TMP/ddl"; } | clu -v ON_ERROR_STOP=1

# Reinicio a forca: DISABLE/ENABLE nao derruba worker pendurado (armadilha 1).
echo "=== reiniciando o worker de replicacao ==="
clu -c "select pg_terminate_backend(pid) from pg_stat_subscription
         where subname = 'erp_corte' and pid is not null;" >/dev/null
sleep 10

echo "=== estado do slot na producao ==="
prod -F'|' -c "select slot_name, 'ativo='||active::text,
  pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(),
    coalesce(confirmed_flush_lsn, restart_lsn))) from pg_replication_slots;"
