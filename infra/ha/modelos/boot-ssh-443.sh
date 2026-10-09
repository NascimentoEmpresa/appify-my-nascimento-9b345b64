#!/bin/bash
# Script de primeiro boot de toda maquina do cluster HA.
# Colar em: Vultr "Startup Script" / Lightsail userData / Linode StackScript.
#
# POR QUE ISSO EXISTE
# A rede da Grupo Nascimento filtra saida nas portas 22 e 2222 (medido em
# 08/10/2026 do PC do Eduardo: github.com:22 e 1.1.1.1:2222 falham; 1.1.1.1:443
# e ssh.github.com:443 passam, o ultimo completando o SSH ate "Permission denied
# (publickey)"). Sem expor o sshd na 443, a maquina nasce inacessivel de dentro
# da empresa.
#
# DUAS REGRAS APRENDIDAS NA MARRA, as duas custaram uma maquina refeita:
#
# 1. NUNCA use "set -e" aqui. Um tropeco em algo secundario (o swap, por
#    exemplo) aborta o script antes do SSH, e a maquina nasce inacessivel --
#    sem SSH nao da nem para ir ver o que falhou.
#
# 2. NUNCA desligue o ssh.socket para "voltar ao sshd classico". O Ubuntu 24.04
#    ativa o sshd por socket, e o "Port" do sshd_config e ignorado nesse modo --
#    mas se o ssh.service nao subir, voce fica sem NENHUMA das portas. Na Vultr
#    a troca funcionou; no Lightsail derrubou o SSH inteiro. O certo e
#    configurar OS DOIS caminhos e nao desligar o que ja funciona.
#
# O SSH vem primeiro no script de proposito: e a unica parte cuja falha nao tem
# conserto remoto.
exec > /var/log/boot-ha.log 2>&1
set -x

# --- 1. SSH tambem na 443, pelos dois mecanismos ---------------------------
# ListenStream= vazio zera a lista herdada antes de declarar as portas; sem ele
# elas se acumulam de forma imprevisivel entre reboots.
mkdir -p /etc/systemd/system/ssh.socket.d
printf '[Socket]\nListenStream=\nListenStream=22\nListenStream=443\n' \
  > /etc/systemd/system/ssh.socket.d/99-porta-443.conf
grep -q '^Port 443$' /etc/ssh/sshd_config || printf 'Port 22\nPort 443\n' >> /etc/ssh/sshd_config

# 00- no nome porque o sshd usa o PRIMEIRO valor que encontra e le os drop-ins
# em ordem alfabetica: o 50-cloud-init.conf da imagem liga PasswordAuthentication.
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\n' \
  > /etc/ssh/sshd_config.d/00-endurecimento.conf

sshd -t
systemctl daemon-reload
systemctl restart ssh.socket || systemctl restart ssh
systemctl restart ssh || true

# --- 2. firewall do proprio sistema ----------------------------------------
# ARMADILHA DA IMAGEM DA VULTR: ela entrega o ufw ATIVO liberando so 22/tcp.
# O sintoma engana -- "ss -ltn" mostra 0.0.0.0:443 em LISTEN e a conexao expira,
# porque o pacote morre antes do sshd. Sondar de fora (check-host.net) separa
# isso de um bloqueio da borda da empresa. Detalhe util: "connection refused"
# e firewall ok + ninguem escutando; "timed out" e pacote descartado no caminho.
if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
  ufw allow 443/tcp
fi

# --- 3. swap, para os nos pequenos -----------------------------------------
# O arbitro do Lightsail tem 512 MB nominais (412 MB uteis). etcd cabe, mas sem
# folga nenhuma.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

ss -ltn
logger -t boot-ha "SSH em 22+443, login por senha desligado, swap 2G"
