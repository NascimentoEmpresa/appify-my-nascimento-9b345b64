#!/bin/bash
# ============================================================================
#  Backup cifrado do CLUSTER -- o que a Supabase fazia por nos e ninguem mais
#  faz depois da virada.
#
#  POR QUE ISTO EXISTE
#  Hoje quem faz copia do banco e a Supabase, e os dois workflows do GitHub
#  (`backup_banco.yml`, `backup_storage.yml`) apontam para ela. No dia seguinte
#  a virada o cluster PASSA A SER A PRODUCAO -- e, sem isto, sem backup nenhum.
#  Levantado em 15/10/2026: era o item mais facil de esquecer e o mais caro.
#
#  O QUE ELE GUARDA, E POR QUE SAO DOIS ARQUIVOS
#    banco.dump    pg_dump -Fc do `postgres` inteiro (public, auth, storage)
#    globais.sql   pg_dumpall --globals-only: OS PAPEIS E AS SENHAS DELES
#
#  O segundo nao e detalhe. `pg_dump` NAO leva papel nenhum, e restaurar sem
#  os papeis prontos ja nos custou um susto documentado: entra 1 politica de
#  RLS de 1.416 e o banco sobe sem controle de acesso, em silencio. Restaurar
#  e: criar os papeis com `globais.sql` PRIMEIRO, depois `pg_restore`.
#
#  NUNCA `--no-privileges`. Ele apaga todos os GRANT do dump e o storage passa
#  a mentir dizendo "violates row-level security policy". Esta frase esta aqui
#  porque a tentacao de "limpar o dump" ja apareceu antes.
#
#  CIFRADO SEMPRE, com a MESMA chave publica dos outros backups
#  (`.github/backup-chave-publica.asc`, rsa4096 ...3595EC2). So o Eduardo tem a
#  privada. Isso e o que permite levar o arquivo para fora sem medo -- inclusive
#  para dentro de um repositorio publico, que e como o backup da Supabase ja
#  viaja hoje.
#
#  DE ONDE ELE LE: 127.0.0.1:5000, o HAProxy, que e sempre o LIDER. Tirar do
#  standby local pareceria mais gentil, mas `pg_dump` longo em standby morre
#  com "canceling statement due to conflict with recovery". No lider e um
#  snapshot: NAO trava escrita, nao bloqueia ninguem.
#
#  O QUE ELE NAO COBRE: os ARQUIVOS dos anexos (5,8 GB). Eles ja vivem nos dois
#  nos, em dois provedores, pelo espelho de 1 minuto -- mas isso e redundancia,
#  nao backup: apagou dos dois, apagou. Ver o fim de docs/ha-corte-roteiro.md.
#
#  USO (no proprio no):
#    bash backup-cluster.sh              # faz o backup
#    bash backup-cluster.sh --conferir   # so lista o que ja existe
#
#  Instalacao do timer diario e o --instalar, no fim.
# ============================================================================
set -uo pipefail
export LC_ALL=C

ACAO="${1:-}"
DESTINO="${DESTINO:-/var/backups/erp-cluster}"
GUARDAR_DIAS="${GUARDAR_DIAS:-14}"
IMPRESSAO="53B1F5DE1075BAA392D1AD1D346F5F8723595EC2"
CHAVE_PUB="${CHAVE_PUB:-/opt/erp/infra/failover/backup-chave-publica.asc}"
PSQL_BIN="/usr/lib/postgresql/17/bin"

log(){ echo "[$(date +%H:%M:%S)] $*"; }

mkdir -p "$DESTINO"

# ── --enviar: cospe o backup mais novo no stdout, e so isso ────────────────
#
#  Este modo existe para ser o `command=` de uma chave SSH restrita no
#  authorized_keys. Quem entra com aquela chave NAO ganha shell: ganha um
#  arquivo cifrado. Mesmo que o secret do GitHub vaze, o que o atacante leva e
#  um .gpg que so a chave privada do Eduardo abre -- e ela nao esta em lugar
#  nenhum deste servidor.
if [ "$ACAO" = "--enviar" ]; then
  A=$(ls -t "$DESTINO"/erp-cluster-*.tar.gz.gpg 2>/dev/null | head -1)
  [ -n "$A" ] || { echo "sem backup em $DESTINO" >&2; exit 1; }
  exec cat "$A"
fi

# ── --conferir: so olha ────────────────────────────────────────────────────
if [ "$ACAO" = "--conferir" ]; then
  echo "== backups em $DESTINO"
  if ! ls -1 "$DESTINO"/*.gpg >/dev/null 2>&1; then
    echo "  NENHUM. O cluster esta sem backup."
    exit 1
  fi
  ls -lt --time-style=long-iso "$DESTINO"/*.gpg | awk '{printf "  %-17s %8.1f MB  %s\n", $6" "$7, $5/1048576, $8}'
  MAIS_NOVO=$(ls -t "$DESTINO"/*.gpg | head -1)
  IDADE=$(( ( $(date +%s) - $(stat -c %Y "$MAIS_NOVO") ) / 3600 ))
  echo "  mais recente tem $IDADE h"
  [ "$IDADE" -gt 30 ] && { echo "  >>> VELHO DEMAIS: o timer nao esta rodando."; exit 1; }
  echo "  ok"
  exit 0
fi

# ── --instalar: timer diario ───────────────────────────────────────────────
if [ "$ACAO" = "--instalar" ]; then
  log "instalando o timer diario (${HORA_TIMER:-03:10} UTC)"
  install -m 755 "$0" /usr/local/sbin/backup-cluster.sh
  cat > /etc/systemd/system/backup-cluster.service <<'UNIDADE'
[Unit]
Description=Backup cifrado do cluster (banco + papeis)
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/backup-cluster.sh
UNIDADE
  cat > /etc/systemd/system/backup-cluster.timer <<UNIDADE
[Unit]
Description=Backup cifrado do cluster, todo dia

[Timer]
OnCalendar=*-*-* ${HORA_TIMER:-03:10}:00
Persistent=true

[Install]
WantedBy=timers.target
UNIDADE
  systemctl daemon-reload
  systemctl enable --now backup-cluster.timer
  systemctl list-timers backup-cluster.timer --no-pager | sed 's/^/  /'
  exit 0
fi

# ── o backup ───────────────────────────────────────────────────────────────
[ -f "$CHAVE_PUB" ] || { echo "nao achei a chave publica em $CHAVE_PUB" >&2; exit 1; }
set -a; . /opt/erp/infra/failover/.env; set +a
: "${PG_SENHA_SUPER:?falta PG_SENHA_SUPER no /opt/erp/infra/failover/.env}"

# A chave publica entra no chaveiro do root uma vez; importar de novo e barato
# e idempotente.
gpg --quiet --batch --import "$CHAVE_PUB" 2>/dev/null || true
gpg --list-keys "$IMPRESSAO" >/dev/null 2>&1 || {
  echo "a chave $IMPRESSAO nao entrou no chaveiro" >&2; exit 1; }

CARIMBO=$(date +%Y%m%d-%H%M)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
CONEXAO="host=127.0.0.1 port=5000 user=postgres dbname=postgres"

log "1/5 papeis e senhas (pg_dumpall --globals-only)"
PGPASSWORD="$PG_SENHA_SUPER" "$PSQL_BIN/pg_dumpall" \
  -h 127.0.0.1 -p 5000 -U postgres --globals-only > "$TMP/globais.sql" || {
  echo "falhou o dump dos papeis" >&2; exit 1; }
printf '    %s papeis\n' "$(grep -c '^CREATE ROLE' "$TMP/globais.sql")"

log "2/5 banco (pg_dump -Fc, com os GRANT)"
PGPASSWORD="$PG_SENHA_SUPER" "$PSQL_BIN/pg_dump" "$CONEXAO" \
  --format=custom --compress=9 --file="$TMP/banco.dump" || {
  echo "falhou o pg_dump" >&2; exit 1; }
printf '    %.1f MB\n' "$(stat -c %s "$TMP/banco.dump" | awk '{print $1/1048576}')"

# Backup que nao se le nao e backup. Isto nao e a restauracao completa (essa
# fica no workflow), mas pega o caso que mais acontece: arquivo truncado por
# disco cheio ou conexao cortada no meio.
log "3/5 conferindo que o dump se le"
TABELAS=$("$PSQL_BIN/pg_restore" -l "$TMP/banco.dump" 2>/dev/null | grep -c 'TABLE DATA') || TABELAS=0
printf '    pg_restore -l enxerga %s tabelas com dados\n' "$TABELAS"
[ "$TABELAS" -lt 100 ] && { echo "    SUSPEITO: menos de 100 tabelas. Nao vou publicar." >&2; exit 1; }

log "4/5 empacotando e cifrando"
ARQUIVO="$DESTINO/erp-cluster-$CARIMBO.tar.gz.gpg"
tar -C "$TMP" -czf - globais.sql banco.dump \
  | gpg --batch --yes --trust-model always --recipient "$IMPRESSAO" \
        --encrypt --compress-algo none --output "$ARQUIVO" || {
  echo "falhou a cifragem" >&2; rm -f "$ARQUIVO"; exit 1; }
printf '    %s  %.1f MB\n' "$ARQUIVO" "$(stat -c %s "$ARQUIVO" | awk '{print $1/1048576}')"

log "5/5 limpando o que passou de $GUARDAR_DIAS dias"
find "$DESTINO" -name 'erp-cluster-*.tar.gz.gpg' -mtime "+$GUARDAR_DIAS" -print -delete | sed 's/^/    apagado: /'

echo
echo "== pronto. Para restaurar e preciso a chave PRIVADA do Eduardo:"
echo "   gpg --decrypt $ARQUIVO | tar -xz"
echo "   psql -f globais.sql          <- PRIMEIRO os papeis"
echo "   pg_restore -d postgres banco.dump"
