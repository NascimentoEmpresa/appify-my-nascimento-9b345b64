#!/usr/bin/env bash
# ============================================================================
#  O SCHEMA `espelho` FICOU PARA TRAS NA VIRADA
#
#  O QUE ACONTECEU
#  A virada levou `public`, `auth` e `storage`. O schema `espelho` -- a copia
#  do MySQL da Hagg, de onde vem o PONTO -- nao foi. A publicacao `erp_corte`
#  foi montada a partir do catalogo de `public`, entao ele nunca entrou na
#  lista e ninguem notou: nenhuma contagem de tabela de `public` acusa a falta
#  de um schema inteiro.
#
#  COMO APARECEU, UM DIA DEPOIS
#  A migration 20261019000004 (Pablo) chama `espelho."BiEmpregados"` e falhou
#  no merge da PR #921 com `relation "espelho.BiEmpregados" does not exist`.
#  O dev tinha testado contra o banco ANTIGO, onde o schema existe.
#
#  O ESTRAGO REAL, MEDIDO E NAO SUPOSTO
#  17 funcoes de `public` citam `espelho.`. Dessas, 10 tem guarda
#  (`to_regclass`) e DEGRADAM: devolvem vazio em vez de estourar -- que e o
#  jeito mais caro de falhar, porque a tela fica em branco sem erro nenhum.
#  As 7 sem guarda estouram de verdade. Uma delas,
#  `dir_turnover_rescisoes_dados`, e chamada pelo frontend (Relatorios da
#  Diretoria) e faz JOIN direto em `espelho."R044CAL"` e `espelho."R046VER"`.
#
#  O QUE ESTE SCRIPT **NAO** RESOLVE SOZINHO
#  Trazer os dados conserta HOJE. Mas quem alimenta o espelho e o
#  `espelho-mysql/espelho.mjs`, e ele continua escrevendo na Supabase ANTIGA
#  (`credenciais.json` -> supabase.host = aws-1-sa-east-1.pooler...). Sem
#  repontar o alimentador, esta copia congela no dia de hoje e o ponto para de
#  andar -- devagar e em silencio, que e o pior jeito.
#
#  Repontar nao e trocar uma linha: o alimentador precisa de SSH na porta 22
#  para o MySQL da Hagg (a rede da empresa bloqueia a 22 na saida) e de escrita
#  no Postgres do cluster (que nao atende na internet). O lugar que resolve os
#  dois e o proprio banco1, por timer. Isso e trabalho a parte, com decisao do
#  Eduardo -- este script nao faz, e avisa no fim.
#
#  USO
#    bash infra/ha/trazer-espelho.sh --conferir
#    bash infra/ha/trazer-espelho.sh --trazer
# ============================================================================
set -uo pipefail

BANCO1="${BANCO1:-216.238.120.171}"
PORTA_SSH="${PORTA_SSH:-8443}"
MODO="${1:---conferir}"

case "$MODO" in --conferir|--trazer) ;; *) sed -n '2,40p' "$0"; exit 2 ;; esac

no() { ssh -p "$PORTA_SSH" -o BatchMode=yes -o ConnectTimeout=30 \
         -o StrictHostKeyChecking=accept-new "root@$BANCO1" "$@"; }

# A conexao com a Supabase antiga NAO e digitada nem guardada aqui: ela ja
# esta no no, dentro de `pg_subscription.subconninfo`, da replicacao da
# virada. Reusar evita que a senha da producao passe por mais um lugar.
PREAMBULO='
SUP=$(grep -m1 "^PG_SENHA_SUPER=" /opt/erp/infra/failover/.env | cut -d= -f2-)
L() { PGPASSWORD="$SUP" psql -h 127.0.0.1 -p 5000 -U postgres -d postgres -At "$@"; }
CONN=$(L -c "select subconninfo from pg_subscription where subname = '"'"'erp_corte'"'"'")
if [ -z "$CONN" ]; then echo "sem conninfo da Supabase guardada no no" >&2; exit 1; fi
A() { psql "$CONN" -At "$@"; }
'

# O SQL vai por ARQUIVO, nunca embutido no comando remoto. Motivo concreto:
# `$$espelho$$` (dollar-quoting do Postgres) passou pelo shell do no, que leu
# `$$` como o PID dele e mandou `1706495espelho1706495` para o banco. SQL
# dentro de comando remoto tem dois interpretadores antes do Postgres.
mandar_sql() {   # $1 = arquivo local, $2 = comando psql remoto
  scp -q -P "$PORTA_SSH" -o BatchMode=yes "$1" "root@$BANCO1:/tmp/espelho-chk.sql" || return 1
  no "$PREAMBULO $2 -f /tmp/espelho-chk.sql; rm -f /tmp/espelho-chk.sql"
}

TMP="${TMPDIR:-/tmp}/espelho-chk.$$.sql"
trap 'rm -f "$TMP"' EXIT

if [ "$MODO" = "--conferir" ]; then
  cat > "$TMP" <<'SQL'
\pset format unaligned
select '   '||count(*)||' tabelas, '||pg_size_pretty(coalesce(sum(pg_total_relation_size(c.oid)),0))
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='espelho' and c.relkind='r';
SQL
  echo "== comparando o schema espelho: Supabase antiga x cluster"
  echo "   na Supabase antiga:"
  mandar_sql "$TMP" 'psql "$CONN" -At' | grep -v '^Output format'
  echo "   no cluster:"
  mandar_sql "$TMP" 'PGPASSWORD="$SUP" psql -h 127.0.0.1 -p 5000 -U postgres -d postgres -At' | grep -v '^Output format'

  cat > "$TMP" <<'SQL'
\pset format unaligned
select '   '||count(*)||' funcoes de public citam espelho, '||
       count(*) filter (where pg_get_functiondef(p.oid) !~* 'to_regclass')||
       ' SEM guarda (essas estouram)'
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and pg_get_functiondef(p.oid) ~ 'espelho\.';
SQL
  mandar_sql "$TMP" 'PGPASSWORD="$SUP" psql -h 127.0.0.1 -p 5000 -U postgres -d postgres -At' | grep -v '^Output format'
  no 'df -BM / | awk "NR==2{print \"   disco: \"\$4\" livres de \"\$2}"'
  echo
  echo "   Para trazer:  bash infra/ha/trazer-espelho.sh --trazer"
  exit 0
fi

echo "== trazendo o schema espelho para o cluster (~1,3 GB)"
echo "   Isto NAO toca em nada que ja existe: o schema nao existe aqui."
echo
no "$PREAMBULO"'
  set -uo pipefail
  if [ "$(L -c "select count(*) from pg_namespace where nspname = \x27espelho\x27")" != "0" ]; then
    echo "   o schema espelho JA existe no cluster -- nao vou por nada por cima." >&2
    echo "   Se quer recarregar, apague antes, com intencao." >&2
    exit 1
  fi
  LIVRE=$(df -BM / | awk "NR==2{gsub(\"M\",\"\",\$4); print \$4}")
  if [ "${LIVRE:-0}" -lt 6000 ]; then
    echo "   menos de 6 GB livres ($LIVRE MB) -- nao comeco." >&2; exit 1
  fi

  # Direto de um banco para o outro, sem arquivo no meio: nao da para o disco
  # encher com um dump de 1,3 GB que ninguem lembra de apagar depois.
  # --no-owner/--no-privileges NAO: aqui queremos os GRANTs, porque as
  # funcoes SECURITY DEFINER leem estas tabelas. (Foi --no-privileges que
  # apagou todos os GRANT na primeira tentativa da virada.)
  echo "   copiando..."
  pg_dump "$CONN" --schema=espelho --no-publications --no-subscriptions \
    | PGPASSWORD="$SUP" psql -h 127.0.0.1 -p 5000 -U postgres -d postgres \
        -v ON_ERROR_STOP=1 -q 2>&1 | grep -viE "^(SET|CREATE|ALTER|COPY|GRANT|REVOKE)" | head -15
  RC=${PIPESTATUS[0]}
  exit $RC
' || { echo; echo "   FALHOU -- veja acima." >&2; exit 1; }

cat > "$TMP" <<'SQL'
\pset format unaligned
select '   '||count(*)||' tabelas, '||pg_size_pretty(coalesce(sum(pg_total_relation_size(c.oid)),0))
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='espelho' and c.relkind='r';
select '   '||relname||': '||to_char(n_live_tup,'FM999G999G999')||' linhas'
  from pg_stat_all_tables where schemaname='espelho'
 order by n_live_tup desc limit 5;
SQL
echo "== conferindo o que chegou"
mandar_sql "$TMP" 'PGPASSWORD="$SUP" psql -h 127.0.0.1 -p 5000 -U postgres -d postgres -At' | grep -v '^Output format'

echo
echo "== agora a migration que estava travando pode entrar"
echo "      ssh -p 8443 root@$BANCO1 /usr/local/sbin/aplicar-migrations.sh"
echo
echo "   ⚠ FALTA O ALIMENTADOR. O espelho-mysql/espelho.mjs continua escrevendo"
echo "   na Supabase ANTIGA. Esta copia e de hoje e vai congelar: o ponto para"
echo "   de andar sem erro nenhum na tela. Decidir onde o alimentador passa a"
echo "   rodar e o proximo passo -- provavelmente no proprio banco1, por timer,"
echo "   porque so ele alcanca a 22 do MySQL da Hagg E o Postgres do cluster."
