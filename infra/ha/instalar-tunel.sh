#!/usr/bin/env bash
# ============================================================================
#  Liga o túnel cifrado num nó. Rodar como root, depois de copiar o .conf
#  que o gerar-tunel.sh produziu para esta máquina.
#
#  Uso:  CONF=/root/banco1.conf bash instalar-tunel.sh
# ============================================================================
set -euo pipefail
: "${CONF:?aponte CONF para o arquivo .conf desta maquina}"
[ -f "$CONF" ] || { echo "nao achei $CONF"; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq wireguard wireguard-tools >/dev/null

install -d -m 700 /etc/wireguard
install -m 600 "$CONF" /etc/wireguard/wg0.conf

# O túnel precisa subir ANTES do etcd e do Patroni: sem ele, os nós não se
# enxergam e o Patroni conclui que está sozinho.
systemctl enable --now wg-quick@wg0

for u in etcd patroni; do
  if systemctl list-unit-files | grep -q "^${u}.service"; then
    install -d /etc/systemd/system/${u}.service.d
    cat > /etc/systemd/system/${u}.service.d/tunel.conf <<FIM
[Unit]
After=wg-quick@wg0.service
Requires=wg-quick@wg0.service
FIM
  fi
done
systemctl daemon-reload

echo "tunel no ar. conferir:"
echo "  wg show                       (tem que listar 2 pares com handshake recente)"
echo "  ping -c2 10.77.0.11           (e .12 e .13)"
