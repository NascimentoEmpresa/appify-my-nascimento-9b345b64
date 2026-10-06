#!/usr/bin/env bash
# ============================================================================
#  Ensaia instalar-banco.sh e instalar-arbitro.sh em três containers Ubuntu
#  24.04 com systemd de verdade, ANTES de gastar dinheiro com máquina.
#
#  Não substitui o ensaio na Vultr, mas pega o que costuma quebrar: pacote que
#  mudou de nome, caminho errado, modelo com variável não substituída, unidade
#  systemd que não sobe.
# ============================================================================
set -euo pipefail
REDE=ha-ensaio
IMG=ha-ensaio-ubuntu
AQUI="$(cd "$(dirname "$0")" && pwd)"

limpar() { docker rm -f ha-banco1 ha-banco2 ha-arbitro >/dev/null 2>&1 || true
           docker network rm "$REDE" >/dev/null 2>&1 || true; }
trap limpar EXIT

limpar
docker network create --subnet 10.0.0.0/24 "$REDE" >/dev/null

echo "### construindo imagem Ubuntu com systemd"
docker build -q -t "$IMG" - >/dev/null <<'DOCKER'
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive container=docker
RUN apt-get update -qq && apt-get install -y -qq systemd systemd-sysv dbus curl ca-certificates sudo \
 && rm -rf /var/lib/apt/lists/* \
 && find /etc/systemd/system /lib/systemd/system -path '*.wants/*' \
      -not -name '*journald*' -not -name '*systemd-tmpfiles*' -delete
CMD ["/sbin/init"]
DOCKER

subir() {
  docker run -d --name "$1" --hostname "$1" --network "$REDE" --ip "$2" \
    --privileged --cgroupns=host -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
    -v "$AQUI":/ha:ro "$IMG" >/dev/null
}
echo "### subindo containers"
subir ha-banco1 10.0.0.11
subir ha-banco2 10.0.0.12
subir ha-arbitro 10.0.0.13
sleep 8

echo "### instalando o árbitro"
docker exec -e IP_PROPRIO=10.0.0.13 -e IP_BANCO1=10.0.0.11 -e IP_BANCO2=10.0.0.12 \
  ha-arbitro bash /ha/instalar-arbitro.sh 2>&1 | tail -3

for N in 1 2; do
  echo "### instalando banco$N (demora: compila/baixa Postgres e Patroni)"
  docker exec -e NOME="banco$N" -e IP_PROPRIO="10.0.0.1$N" \
    -e IP_BANCO1=10.0.0.11 -e IP_BANCO2=10.0.0.12 -e IP_ARBITRO=10.0.0.13 \
    -e SENHA_SUPER=ensaio123 -e SENHA_REPL=ensaiorepl123 \
    "ha-banco$N" bash /ha/instalar-banco.sh 2>&1 | tail -4
done

echo "### esperando o cluster formar"
for i in $(seq 1 60); do
  SAIDA=$(docker exec ha-banco1 /opt/patroni/bin/patronictl -c /etc/patroni/patroni.yml list 2>/dev/null || true)
  echo "$SAIDA" | grep -q "Sync Standby" && break
  sleep 3
done
echo "$SAIDA"

if ! echo "$SAIDA" | grep -q "Sync Standby"; then
  echo "FALHOU: não formou com standby síncrona. Últimas linhas do Patroni:"
  docker exec ha-banco1 journalctl -u patroni -n 25 --no-pager 2>&1 | tail -25
  exit 1
fi
echo
echo "=== OK: cluster formado com replicação síncrona pelos scripts de produção ==="
