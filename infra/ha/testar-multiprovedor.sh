#!/usr/bin/env bash
# ============================================================================
#  Ensaio do desenho de TRÊS PROVEDORES, antes de criar máquina em qualquer um.
#
#  Cada container é um provedor. Eles só se enxergam por uma rede que simula a
#  internet pública, e todo o tráfego do cluster passa pelo túnel cifrado —
#  exatamente como vai ser entre Vultr, Linode e AWS.
#
#  A pergunta que este ensaio responde:
#    "A Vultr cai inteira. Quanto tempo até o Linode estar gravando?"
# ============================================================================
set -euo pipefail
REDE=ha-internet
IMG=ha-provedor
AQUI="$(cd "$(dirname "$0")" && pwd)"
# IPs "públicos" (a internet simulada)
PUB1=172.29.0.11; PUB2=172.29.0.12; PUB3=172.29.0.13; PUBC=172.29.0.20
# IPs dentro do túnel (os que o cluster usa)
T1=10.77.0.11;    T2=10.77.0.12;    T3=10.77.0.13

limpar() { docker rm -f ha-vultr ha-linode ha-aws ha-cliente >/dev/null 2>&1 || true
           docker network rm "$REDE" >/dev/null 2>&1 || true; }
trap limpar EXIT
limpar
docker network create --subnet 172.29.0.0/24 "$REDE" >/dev/null

echo "### imagem com systemd + wireguard"
docker build -q -t "$IMG" - >/dev/null <<'DOCKER'
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive container=docker
RUN apt-get update -qq && apt-get install -y -qq systemd systemd-sysv dbus \
      wireguard wireguard-tools iproute2 iputils-ping curl ca-certificates haproxy \
 && rm -rf /var/lib/apt/lists/* \
 && find /etc/systemd/system /lib/systemd/system -path '*.wants/*' \
      -not -name '*journald*' -not -name '*systemd-tmpfiles*' -delete
CMD ["/sbin/init"]
DOCKER

subir() { docker run -d --name "$1" --hostname "$1" --network "$REDE" --ip "$2" \
            --privileged --cgroupns=host -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
            -v "$AQUI":/ha:ro "$IMG" >/dev/null; }
echo "### subindo os tres provedores"
subir ha-vultr  $PUB1     # banco1
subir ha-linode $PUB2     # banco2
subir ha-aws    $PUB3     # arbitro
sleep 8

echo "### gerando o tunel (chaves nascem dentro do container, nao no disco do repo)"
docker exec -e IP_PUB_BANCO1=$PUB1 -e IP_PUB_BANCO2=$PUB2 -e IP_PUB_ARBITRO=$PUB3 \
  -e SAIDA=/tmp/tunel ha-vultr bash /ha/gerar-tunel.sh >/dev/null
for par in "banco1:ha-vultr" "banco2:ha-linode" "arbitro:ha-aws"; do
  N="${par%%:*}"; C="${par##*:}"
  docker exec ha-vultr cat /tmp/tunel/$N.conf | docker exec -i "$C" tee /root/wg.conf >/dev/null
  docker exec -e CONF=/root/wg.conf "$C" bash /ha/instalar-tunel.sh >/dev/null 2>&1
done
sleep 4
echo "--- handshake do tunel (visto da Vultr):"
docker exec ha-vultr wg show | grep -E "peer|handshake|transfer" | head -6
docker exec ha-vultr ping -c1 -W3 $T2 >/dev/null && echo "    Vultr alcanca Linode pelo tunel: OK"
docker exec ha-vultr ping -c1 -W3 $T3 >/dev/null && echo "    Vultr alcanca AWS pelo tunel:    OK"

echo "### instalando (os nos so conhecem os IPs do tunel)"
docker exec -e IP_PROPRIO=$T3 -e IP_BANCO1=$T1 -e IP_BANCO2=$T2 ha-aws bash /ha/instalar-arbitro.sh >/dev/null
docker exec -e NOME=banco1 -e IP_PROPRIO=$T1 -e IP_BANCO1=$T1 -e IP_BANCO2=$T2 -e IP_ARBITRO=$T3 \
  -e SENHA_SUPER=ensaio123 -e SENHA_REPL=repl123 ha-vultr bash /ha/instalar-banco.sh 2>&1 | tail -1
docker exec -e NOME=banco2 -e IP_PROPRIO=$T2 -e IP_BANCO1=$T1 -e IP_BANCO2=$T2 -e IP_ARBITRO=$T3 \
  -e SENHA_SUPER=ensaio123 -e SENHA_REPL=repl123 ha-linode bash /ha/instalar-banco.sh 2>&1 | tail -1

echo "### HAProxy nos dois nos de banco (no ensaio escuta em 0.0.0.0 para o cliente externo alcancar;"
echo "    em producao escuta so em 127.0.0.1, junto da API)"
for par in "ha-vultr" "ha-linode"; do
  docker exec "$par" bash -c "sed -e 's|__IP_BANCO1__|$T1|g' -e 's|__IP_BANCO2__|$T2|g' \
      -e 's|bind 127.0.0.1:5000|bind 0.0.0.0:5000|' /ha/modelos/haproxy.cfg > /etc/haproxy/haproxy.cfg
    systemctl restart haproxy" 
done

echo "### esperando o cluster formar pelo tunel"
for i in $(seq 1 60); do
  S=$(docker exec ha-vultr /opt/patroni/bin/patronictl -c /etc/patroni/patroni.yml list 2>/dev/null || true)
  echo "$S" | grep -q "Sync Standby" && break
  sleep 3
done
echo "$S"
echo "$S" | grep -q "Sync Standby" || { echo "FALHOU ao formar"; docker exec ha-vultr journalctl -u patroni -n 20 --no-pager; exit 1; }

# Garante que a VULTR e a lider, para o ensaio ser "o provedor primario caiu"
if ! echo "$S" | awk -F'|' '/\| Leader/{print $2}' | grep -q banco1; then
  echo "### promovendo banco1 (Vultr) para o ensaio fazer sentido"
  docker exec ha-vultr /opt/patroni/bin/patronictl -c /etc/patroni/patroni.yml switchover \
    --leader banco2 --candidate banco1 --force >/dev/null 2>&1 || true
  sleep 25
fi
docker exec ha-vultr /opt/patroni/bin/patronictl -c /etc/patroni/patroni.yml list

echo
echo "### cliente conectado ao LINODE (o sobrevivente), gravando a cada 50ms"
docker rm -f ha-cliente >/dev/null 2>&1 || true
docker run -d --name ha-cliente --network "$REDE" --ip $PUBC \
  -v "$AQUI/medir-multi.js":/app/medir.js:ro -e ALVO=$PUB2 -e SENHA=ensaio123 -e DURACAO=90 -w /app node:22-alpine \
  sh -c "npm i pg --silent --no-fund --no-audit >/dev/null 2>&1 && node /app/medir.js" >/dev/null
sleep 25

echo "### DERRUBANDO A VULTR INTEIRA em $(date +%H:%M:%S)"
docker kill ha-vultr >/dev/null
echo "    (provedor fora: banco1 + etcd + API, tudo junto)"

docker wait ha-cliente >/dev/null 2>&1
echo
echo "========== RESULTADO =========="
docker logs ha-cliente 2>&1 | tail -30
echo "========== CLUSTER (visto do Linode) =========="
docker exec ha-linode /opt/patroni/bin/patronictl -c /etc/patroni/patroni.yml list 2>/dev/null
