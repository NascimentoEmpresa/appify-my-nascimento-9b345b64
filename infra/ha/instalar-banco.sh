#!/usr/bin/env bash
# ============================================================================
#  Instala um nó de banco do cluster de alta disponibilidade.
#  Roda em Ubuntu 24.04 limpo (Vultr, São Paulo). Rodar como root.
#
#  O nó ganha três coisas:
#    - Postgres 17        (o banco)
#    - Patroni            (quem decide qual dos dois é o primário)
#    - etcd (um membro)   (onde os três votam; o terceiro voto é o árbitro)
#
#  NÃO instala HAProxy. O HAProxy mora na máquina da API, em 127.0.0.1 —
#  assim ele não vira um ponto único de falha novo, e não precisamos de IP
#  flutuante nem de script nosso remanejando endereço na hora da troca.
#
#  Uso:
#    NOME=banco1 IP_PROPRIO=10.0.0.11 IP_BANCO1=10.0.0.11 IP_BANCO2=10.0.0.12 \
#    IP_ARBITRO=10.0.0.13 SENHA_SUPER=... SENHA_REPL=... bash instalar-banco.sh
#
#  É idempotente: rodar de novo não quebra nada.
# ============================================================================
set -euo pipefail

: "${NOME:?defina NOME (banco1 ou banco2)}"
: "${IP_PROPRIO:?defina IP_PROPRIO (IP privado desta máquina)}"
: "${IP_BANCO1:?defina IP_BANCO1}"
: "${IP_BANCO2:?defina IP_BANCO2}"
: "${IP_ARBITRO:?defina IP_ARBITRO}"
: "${SENHA_SUPER:?defina SENHA_SUPER (senha do usuário postgres)}"
: "${SENHA_REPL:?defina SENHA_REPL (senha do usuário de replicação)}"

VERSAO_ETCD="${VERSAO_ETCD:-v3.5.17}"
VERSAO_PG="${VERSAO_PG:-17}"
log() { echo "[$(date +%H:%M:%S)] $*"; }

# ── 1. pacotes ──────────────────────────────────────────────────────────────
log "instalando Postgres $VERSAO_PG e dependências"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg python3-venv python3-dev \
                      libpq-dev gcc >/dev/null

install -d /usr/share/postgresql-common/pgdg
curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
     https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
http://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo $VERSION_CODENAME)-pgdg main" \
     > /etc/apt/sources.list.d/pgdg.list
apt-get update -qq
apt-get install -y -qq "postgresql-${VERSAO_PG}" "postgresql-client-${VERSAO_PG}" >/dev/null

# O Patroni cria e administra o cluster. O que o pacote do Ubuntu sobe sozinho
# atrapalha: ele segura a porta 5432 com um banco que o Patroni não conhece.
log "desligando o Postgres que o pacote do Ubuntu sobe sozinho"
systemctl disable --now postgresql >/dev/null 2>&1 || true
pg_dropcluster --stop "$VERSAO_PG" main >/dev/null 2>&1 || true

# ── 2. etcd (um dos três votos) ─────────────────────────────────────────────
if [ ! -x /usr/local/bin/etcd ]; then
  log "baixando etcd $VERSAO_ETCD"
  tmp=$(mktemp -d)
  curl -fsSL "https://github.com/etcd-io/etcd/releases/download/${VERSAO_ETCD}/etcd-${VERSAO_ETCD}-linux-amd64.tar.gz" \
    | tar xz -C "$tmp" --strip-components=1
  install -m 0755 "$tmp/etcd" "$tmp/etcdctl" /usr/local/bin/
  rm -rf "$tmp"
fi
id etcd >/dev/null 2>&1 || useradd --system --home /var/lib/etcd --shell /usr/sbin/nologin etcd
install -d -o etcd -g etcd /var/lib/etcd

cat > /etc/default/etcd <<FIM
ETCD_NAME=${NOME}
ETCD_DATA_DIR=/var/lib/etcd
ETCD_LISTEN_PEER_URLS=http://${IP_PROPRIO}:2380
ETCD_LISTEN_CLIENT_URLS=http://${IP_PROPRIO}:2379,http://127.0.0.1:2379
ETCD_ADVERTISE_CLIENT_URLS=http://${IP_PROPRIO}:2379
ETCD_INITIAL_ADVERTISE_PEER_URLS=http://${IP_PROPRIO}:2380
ETCD_INITIAL_CLUSTER=banco1=http://${IP_BANCO1}:2380,banco2=http://${IP_BANCO2}:2380,arbitro=http://${IP_ARBITRO}:2380
ETCD_INITIAL_CLUSTER_STATE=new
ETCD_INITIAL_CLUSTER_TOKEN=erp-ha
FIM

cat > /etc/systemd/system/etcd.service <<'FIM'
[Unit]
Description=etcd (eleicao do primario)
After=network-online.target
Wants=network-online.target
[Service]
User=etcd
EnvironmentFile=/etc/default/etcd
ExecStart=/usr/local/bin/etcd
Restart=always
RestartSec=5
LimitNOFILE=65536
[Install]
WantedBy=multi-user.target
FIM

# ── 3. Patroni ──────────────────────────────────────────────────────────────
# venv porque o Ubuntu 24.04 recusa pip no sistema (PEP 668), e porque assim a
# versão do Patroni não muda sozinha num apt upgrade.
if [ ! -x /opt/patroni/bin/patroni ]; then
  log "instalando Patroni num venv em /opt/patroni"
  python3 -m venv /opt/patroni
  /opt/patroni/bin/pip install -q --upgrade pip
  /opt/patroni/bin/pip install -q "patroni[etcd3]" psycopg2-binary
fi

install -d -o postgres -g postgres -m 0700 /var/lib/postgresql/dados
install -d -o postgres -g postgres /etc/patroni

sed -e "s|__NOME__|${NOME}|g" \
    -e "s|__IP__|${IP_PROPRIO}|g" \
    -e "s|__IP_BANCO1__|${IP_BANCO1}|g" \
    -e "s|__IP_BANCO2__|${IP_BANCO2}|g" \
    -e "s|__IP_ARBITRO__|${IP_ARBITRO}|g" \
    -e "s|__SENHA_SUPER__|${SENHA_SUPER}|g" \
    -e "s|__SENHA_REPL__|${SENHA_REPL}|g" \
    -e "s|__VERSAO_PG__|${VERSAO_PG}|g" \
    "$(dirname "$0")/modelos/patroni.yml" > /etc/patroni/patroni.yml
chown postgres:postgres /etc/patroni/patroni.yml
chmod 600 /etc/patroni/patroni.yml

cat > /etc/systemd/system/patroni.service <<'FIM'
[Unit]
Description=Patroni (alta disponibilidade do Postgres)
After=network-online.target etcd.service
Wants=network-online.target
[Service]
User=postgres
Group=postgres
ExecStart=/opt/patroni/bin/patroni /etc/patroni/patroni.yml
ExecReload=/bin/kill -HUP $MAINPID
KillMode=process
TimeoutSec=30
Restart=no
[Install]
WantedBy=multi-user.target
FIM
# Restart=no de propósito: se o Patroni morrer, o nó TEM que ficar fora. Subir
# sozinho um Patroni confuso é o caminho para dois primários ao mesmo tempo.

systemctl daemon-reload
systemctl enable --now etcd
sleep 3
systemctl enable --now patroni

log "pronto. conferir com:  /opt/patroni/bin/patronictl -c /etc/patroni/patroni.yml list"
