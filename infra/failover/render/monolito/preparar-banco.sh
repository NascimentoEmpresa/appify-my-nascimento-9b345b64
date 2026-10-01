#!/usr/bin/env bash
# ============================================================================
#  Cria o cluster e aplica o bootstrap  (roda a cada boot, idempotente)
# ============================================================================
#  Na Render o container reinicia a cada deploy e o disco persiste: na primeira
#  vez faz initdb, nas seguintes so confere.
#
#  O SQL de verdade mora em bootstrap.sql, nao aqui. Motivo medido em
#  01/10/2026: passar `do $$ ... $$` por `su postgres -c "psql -c '...'"` nao
#  funciona - o shell expande $$ para o PID antes do Postgres ver, e o erro que
#  chega e "syntax error at or near 40". Lido com -f, nenhum shell toca no SQL.
# ============================================================================
set -euo pipefail

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD nao definida}"
PGDATA="${PGDATA:-/var/lib/postgresql/data/pgdata}"
BIN=/usr/lib/postgresql/17/bin
SQL=/usr/local/share/bootstrap.sql

log() { printf '[banco %(%H:%M:%S)T] %s\n' -1 "$*"; }

mkdir -p "$PGDATA" /run/postgresql
chown -R postgres:postgres "$PGDATA" /run/postgresql
chmod 700 "$PGDATA"

if [[ ! -s "$PGDATA/PG_VERSION" ]]; then
  log "primeiro boot: criando o cluster"
  su postgres -c "$BIN/initdb -D '$PGDATA' --username=postgres --auth-local=trust --auth-host=scram-sha-256 -E UTF8" > /dev/null
  {
    echo "listen_addresses = '127.0.0.1'"
    echo "max_connections = 100"
    echo "shared_buffers = '512MB'"
    echo "maintenance_work_mem = '256MB'"
  } >> "$PGDATA/postgresql.conf"
else
  log "cluster ja existe"
fi

log "subindo o banco para aplicar o bootstrap"
su postgres -c "$BIN/pg_ctl -D '$PGDATA' -o '-c listen_addresses=127.0.0.1 -p 5432' -w -t 60 start" > /dev/null

# Sem -h: pelo socket o pg_hba manda `trust`, e no primeiro boot o usuario
# postgres ainda nao tem senha. Por TCP cairia na regra scram-sha-256 e o erro
# seria "fe_sendauth: no password supplied" - que parece senha errada, quando a
# senha ainda nem existe.
# A senha vai como VARIAVEL do psql: assim ela nao passa por shell nenhum e nao
# aparece na lista de processos da maquina.
su postgres -c "$BIN/psql -U postgres -d postgres -v ON_ERROR_STOP=1 -v senha='$POSTGRES_PASSWORD' -f '$SQL'" > /dev/null

consultar() { su postgres -c "$BIN/psql -U postgres -d postgres -Atc \"$1\""; }
log "papeis: $(consultar "select count(*) from pg_roles where rolname not like 'pg\\_%'")  extensoes: $(consultar 'select count(*) from pg_extension')  tabelas em public: $(consultar "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")"

su postgres -c "$BIN/pg_ctl -D '$PGDATA' -m fast -w stop" > /dev/null
log "pronto - o supervisor assume daqui"
