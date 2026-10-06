#!/usr/bin/env bash
# ============================================================================
#  Gera as chaves e os três arquivos de configuração do túnel cifrado.
#
#  POR QUE EXISTE: os três nós ficam em provedores diferentes (Vultr, Linode e
#  AWS Lightsail). Não existe rede privada entre provedores — o tráfego de
#  replicação iria pela internet aberta. Com WireGuard os três enxergam uns aos
#  outros numa rede 10.77.0.0/24 que só existe dentro do túnel, cifrada.
#
#  Resultado: do ponto de vista do Patroni e do etcd, é como se as três
#  máquinas estivessem na mesma rede local — e os scripts de instalação não
#  precisam saber que são provedores diferentes.
#
#  RODAR UMA VEZ SÓ, na sua máquina. As chaves privadas nascem aqui e cada uma
#  vai para a sua máquina. Nunca mande chave privada por chat ou e-mail.
#
#  Uso:
#    IP_PUB_BANCO1=<ip publico Vultr> \
#    IP_PUB_BANCO2=<ip publico Linode> \
#    IP_PUB_ARBITRO=<ip publico Lightsail> \
#      bash gerar-tunel.sh
# ============================================================================
set -euo pipefail
: "${IP_PUB_BANCO1:?IP publico da maquina da Vultr}"
: "${IP_PUB_BANCO2:?IP publico da maquina do Linode}"
: "${IP_PUB_ARBITRO:?IP publico da maquina do Lightsail}"

command -v wg >/dev/null || { echo "instale wireguard-tools (apt install wireguard-tools)"; exit 1; }

SAIDA="${SAIDA:-./tunel}"
mkdir -p "$SAIDA"; chmod 700 "$SAIDA"

# Endereços DENTRO do túnel. Nunca mudam, mesmo que o IP público do provedor
# mude — é por isto que o Patroni é configurado com estes, e não com o público.
IP_T_BANCO1=10.77.0.11
IP_T_BANCO2=10.77.0.12
IP_T_ARBITRO=10.77.0.13
PORTA=51820

for N in banco1 banco2 arbitro; do
  wg genkey > "$SAIDA/$N.priv"; chmod 600 "$SAIDA/$N.priv"
  wg pubkey < "$SAIDA/$N.priv" > "$SAIDA/$N.pub"
done

montar() {  # $1=nome  $2=ip no tunel  $3,$4=nomes dos pares  $5,$6=ips publicos dos pares  $7,$8=ips no tunel dos pares
  cat > "$SAIDA/$1.conf" <<FIM
# Túnel do cluster de alta disponibilidade do ERP — nó $1
[Interface]
Address = $2/24
ListenPort = $PORTA
PrivateKey = $(cat "$SAIDA/$1.priv")

[Peer]
# $3
PublicKey = $(cat "$SAIDA/$3.pub")
AllowedIPs = $7/32
Endpoint = $5:$PORTA
# Mantém o caminho aberto através de NAT e firewall do provedor, e faz a queda
# do outro lado ser percebida mais rápido.
PersistentKeepalive = 25

[Peer]
# $4
PublicKey = $(cat "$SAIDA/$4.pub")
AllowedIPs = $8/32
Endpoint = $6:$PORTA
PersistentKeepalive = 25
FIM
  chmod 600 "$SAIDA/$1.conf"
}

montar banco1  $IP_T_BANCO1  banco2 arbitro $IP_PUB_BANCO2 $IP_PUB_ARBITRO $IP_T_BANCO2 $IP_T_ARBITRO
montar banco2  $IP_T_BANCO2  banco1 arbitro $IP_PUB_BANCO1 $IP_PUB_ARBITRO $IP_T_BANCO1 $IP_T_ARBITRO
montar arbitro $IP_T_ARBITRO banco1 banco2  $IP_PUB_BANCO1 $IP_PUB_BANCO2  $IP_T_BANCO1 $IP_T_BANCO2

rm -f "$SAIDA"/*.priv "$SAIDA"/*.pub   # já estão dentro dos .conf

cat <<FIM

Gerados em $SAIDA/:
  banco1.conf   -> copiar para a máquina da Vultr      (vira /etc/wireguard/wg0.conf)
  banco2.conf   -> copiar para a máquina do Linode
  arbitro.conf  -> copiar para a máquina do Lightsail

Endereços dentro do túnel (use ESTES na instalação, nunca os públicos):
  banco1  = $IP_T_BANCO1
  banco2  = $IP_T_BANCO2
  arbitro = $IP_T_ARBITRO

No firewall de cada provedor, liberar APENAS a porta UDP $PORTA, e só para os
IPs públicos dos outros dois. Postgres (5432) e etcd (2379/2380) não devem
aceitar nada vindo da internet — eles só escutam dentro do túnel.
FIM
