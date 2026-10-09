#!/usr/bin/env bash
# ============================================================================
#  Instala o árbitro: a terceira máquina, que NÃO roda banco.
#
#  Por que ela existe: com dois nós só, se a rede entre eles cair, cada um
#  acha que o outro morreu e os dois tentam ser primário — é assim que se
#  perde dado. Com três votos, só o lado que tem dois votos assume. O árbitro
#  nunca guarda dado do ERP, então pode ser a máquina mais barata.
#
#  Uso:
#    IP_PROPRIO=10.0.0.13 IP_BANCO1=10.0.0.11 IP_BANCO2=10.0.0.12 \
#    bash instalar-arbitro.sh
# ============================================================================
set -euo pipefail
: "${IP_PROPRIO:?defina IP_PROPRIO}"
: "${IP_BANCO1:?defina IP_BANCO1}"
: "${IP_BANCO2:?defina IP_BANCO2}"
VERSAO_ETCD="${VERSAO_ETCD:-v3.5.17}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null

if [ ! -x /usr/local/bin/etcd ]; then
  tmp=$(mktemp -d)
  curl -fsSL "https://github.com/etcd-io/etcd/releases/download/${VERSAO_ETCD}/etcd-${VERSAO_ETCD}-linux-amd64.tar.gz" \
    | tar xz -C "$tmp" --strip-components=1
  install -m 0755 "$tmp/etcd" "$tmp/etcdctl" /usr/local/bin/
  rm -rf "$tmp"
fi
id etcd >/dev/null 2>&1 || useradd --system --home /var/lib/etcd --shell /usr/sbin/nologin etcd
# 0700 porque o proprio etcd avisa no boot que drwxr-xr-x deixa o
# diretorio de dados legivel por usuario sem privilegio.
install -d -m 0700 -o etcd -g etcd /var/lib/etcd

cat > /etc/default/etcd <<FIM
ETCD_NAME=arbitro
ETCD_DATA_DIR=/var/lib/etcd
ETCD_LISTEN_PEER_URLS=http://${IP_PROPRIO}:2380
ETCD_LISTEN_CLIENT_URLS=http://${IP_PROPRIO}:2379,http://127.0.0.1:2379
ETCD_ADVERTISE_CLIENT_URLS=http://${IP_PROPRIO}:2379
ETCD_INITIAL_ADVERTISE_PEER_URLS=http://${IP_PROPRIO}:2380
ETCD_INITIAL_CLUSTER=banco1=http://${IP_BANCO1}:2380,banco2=http://${IP_BANCO2}:2380,arbitro=http://${IP_PROPRIO}:2380
ETCD_INITIAL_CLUSTER_STATE=new
ETCD_INITIAL_CLUSTER_TOKEN=erp-ha
# MEDIDO em 08/10/2026: o arbitro esta a ~132 ms dos dois bancos (ele vive em
# Ohio porque a conta AWS e travada nessa regiao; ver docs). Nos valores padrao
# -- heartbeat 100 ms, election 1000 ms -- um membro a 132 ms perde batimentos
# e dispara eleicao sem ninguem ter caido. A regra do etcd e heartbeat >= RTT e
# election = 10x heartbeat. Isto NAO atrasa o failover: quem manda nele e o
# ttl minimo de 20 s do Patroni.
ETCD_HEARTBEAT_INTERVAL=250
ETCD_ELECTION_TIMEOUT=2500
FIM

cat > /etc/systemd/system/etcd.service <<'FIM'
[Unit]
Description=etcd (arbitro da eleicao)
# O endereco em que o etcd escuta (10.77.0.x) so existe depois que o tunel
# WireGuard sobe. Sem esta dependencia o etcd falha no boot com
# "bind: cannot assign requested address" e o no some do quorum.
After=network-online.target wg-quick@wg0.service
Wants=network-online.target
Requires=wg-quick@wg0.service
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

systemctl daemon-reload
systemctl enable --now etcd
echo "arbitro pronto. conferir:  etcdctl --endpoints=http://127.0.0.1:2379 endpoint health"
