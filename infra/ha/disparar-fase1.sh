#!/bin/bash
# ============================================================================
#  Dispara a Fase 1 do corte (replicacao logica) a partir DESTA maquina.
#
#  POR QUE ESTE INTERMEDIARIO EXISTE
#  O comando precisa juntar duas senhas que moram em lugares diferentes -- a da
#  producao em `.env.local` aqui, a do cluster no `.env` da pilha, no proprio
#  banco1 -- e nenhuma das duas pode aparecer no que se digita nem ficar
#  gravada no servidor. Este script busca cada uma no lugar dela.
#
#  Ele tambem solta o processo com `setsid nohup`: a carga dos 2,3 GB leva
#  minutos e NAO pode morrer quando o ssh terminar. Essa ja foi uma lição
#  cara neste projeto.
#
#  USO (no Git Bash desta maquina, ou pelo prefixo `!` dentro do Claude Code):
#    bash infra/ha/disparar-fase1.sh
#
#  Ele devolve o console em ~25 segundos; a carga continua sozinha. Depois:
#    ssh -p 443 root@216.238.120.171 'tail -20 /root/migracao/fase1.log'
#    ssh -p 443 root@216.238.120.171 'bash /root/ligar-replicacao.sh --conferir'
#  E para desistir, a qualquer momento:
#    ssh -p 443 root@216.238.120.171 'bash /root/ligar-replicacao.sh --desfazer'
# ============================================================================
set -euo pipefail

# --pre: roda so a bateria de pre-requisitos e sai sem escrever nada. Serve
# para provar a corrente toda (atalho -> Git Bash -> ssh -> cluster -> producao)
# antes de disparar de verdade.
SO_PRE=0
[ "${1:-}" = "--pre" ] && SO_PRE=1

cd "$(dirname "$0")/../.."
NO="${NO:-216.238.120.171}"   # banco1: alcanca a producao por IPv6 e o cluster pelo HAProxy

PW=$(grep -m1 '^SENHA_ACESSO_SUPABASE=' .env.local | cut -d= -f2- | tr -d '\r\n')
[ -n "$PW" ] || { echo "nao achei SENHA_ACESSO_SUPABASE em .env.local" >&2; exit 1; }

echo "== levando a versao atual do script para o $NO"
scp -P 443 -o BatchMode=yes infra/ha/ligar-replicacao.sh "root@$NO:/root/ligar-replicacao.sh" >/dev/null

echo "== conferindo os pre-requisitos (nada e alterado se algum falhar)"
ssh -p 443 -o BatchMode=yes "root@$NO" "sed -i 's/\r\$//' /root/ligar-replicacao.sh
set -a; . /opt/erp/infra/failover/.env; set +a
SENHA_SUPABASE='$PW' SENHA_DESTINO=\"\$PG_SENHA_SUPER\" bash /root/ligar-replicacao.sh --pre" || {
  echo "pre-requisito faltando -- nada foi ligado" >&2; exit 1; }

if [ "$SO_PRE" = "1" ]; then
  echo
  echo "== era so o ensaio (--pre). NADA foi ligado."
  exit 0
fi

echo
echo "== ligando a replicacao (segue em segundo plano, sobrevive ao fim do ssh)"
ssh -p 443 -o BatchMode=yes "root@$NO" "mkdir -p /root/migracao
set -a; . /opt/erp/infra/failover/.env; set +a
SENHA_SUPABASE='$PW' SENHA_DESTINO=\"\$PG_SENHA_SUPER\" \
  setsid nohup bash /root/ligar-replicacao.sh > /root/migracao/fase1.log 2>&1 < /dev/null &
sleep 25
cat /root/migracao/fase1.log
echo
echo '-- segue rodando. Log: /root/migracao/fase1.log'"
