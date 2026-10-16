#!/bin/bash
# ============================================================================
#  Dispara o carregar-anexos.sh DESTA maquina.
#
#  Mesmo motivo dos outros disparar-*: a carga precisa de credencial da
#  producao, e ela nao fica gravada em servidor nenhum. Este script junta as
#  tres em tempo de execucao e passa por ambiente:
#
#    SENHA_ACESSO_SUPABASE      .env.local   -> senha do postgres da producao
#    SUPABASE_URL               worker/.env  -> endereco da producao
#    SUPABASE_SERVICE_ROLE_KEY  worker/.env  -> chave que baixa o arquivo
#
#  USO (Git Bash desta maquina, na pasta do projeto):
#    bash infra/ha/disparar-anexos.sh            # carrega o que falta
#    bash infra/ha/disparar-anexos.sh --relistar # refaz a lista da producao antes
#
#  E REPETIVEL DE PROPOSITO. Quem ja esta no lugar com o tamanho certo e
#  pulado, entao rodar de novo custa so o tempo de conferir. Rodar hoje para
#  levar a massa e de novo na janela do corte para levar o delta e o uso
#  previsto -- nao e desperdicio.
#
#  O ESPELHO CUIDA DO OUTRO NO. Os dois nos tem `espelho-anexos.timer` de 1 em
#  1 minuto, um puxando do outro e nunca com --delete, entao carregar no banco1
#  chega no banco2 sozinho. Conferir com o contador no fim, nao com a sensacao
#  de que "o timer esta verde": o espelho e ENTRE OS NOS e nao traz nada da
#  producao.
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/../.."
NO="${NO:-216.238.120.171}"
EXTRA="${*:-}"

PW=$(grep -m1 '^SENHA_ACESSO_SUPABASE=' .env.local | cut -d= -f2- | tr -d '\r\n')
[ -n "$PW" ] || { echo "nao achei SENHA_ACESSO_SUPABASE em .env.local" >&2; exit 1; }

URL=$(grep -m1 '^SUPABASE_URL=' worker/.env | cut -d= -f2- | tr -d '\r\n')
KEY=$(grep -m1 '^SUPABASE_SERVICE_ROLE_KEY=' worker/.env | cut -d= -f2- | tr -d '\r\n')
[ -n "$URL" ] && [ -n "$KEY" ] || { echo "faltam SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY em worker/.env" >&2; exit 1; }

echo "== levando a versao atual do script para o $NO"
scp -P 8443 -o BatchMode=yes infra/ha/carregar-anexos.sh \
    "root@$NO:/root/carregar-anexos.sh" >/dev/null

RC=0
ssh -p 8443 -o BatchMode=yes "root@$NO" "sed -i 's/\r\$//' /root/carregar-anexos.sh
SENHA_SUPABASE='$PW' SUPABASE_URL='$URL' SUPABASE_SERVICE_ROLE_KEY='$KEY' \
  exec bash /root/carregar-anexos.sh $EXTRA" || RC=$?
exit "$RC"
