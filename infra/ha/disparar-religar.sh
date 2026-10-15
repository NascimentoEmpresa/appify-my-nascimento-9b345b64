#!/bin/bash
# ============================================================================
#  Dispara o religar-replicacao.sh DESTA maquina.
#
#  Mesmo motivo dos outros disparar-*: a recopia precisa da senha da producao,
#  e ela nao fica gravada em servidor nenhum. Este script a busca em
#  `.env.local` aqui e a passa na hora, por ambiente.
#
#  USO (Git Bash desta maquina, na pasta do projeto):
#    bash infra/ha/disparar-religar.sh              # so diz o que faria
#    bash infra/ha/disparar-religar.sh --aplicar    # recopia os 2,3 GB
#
#  QUANDO USAR: so quando o slot da producao estiver `lost`. O proprio script
#  confere isso e se recusa a rodar com slot saudavel. Leia o cabecalho do
#  religar-replicacao.sh antes do --aplicar: o passo 3 dele APAGA o cluster
#  inteiro para recopiar do zero.
#
#  O --aplicar demora. Rode em janela que voce possa deixar aberta, ou em
#  `screen`/`tmux`; se o terminal cair, a copia continua no banco (quem para e
#  so o acompanhamento) e `bash infra/ha/disparar-religar.sh` mostra onde esta.
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/../.."
NO="${NO:-216.238.120.171}"
ACAO="${1:---conferir}"

PW=$(grep -m1 '^SENHA_ACESSO_SUPABASE=' .env.local | cut -d= -f2- | tr -d '\r\n')
[ -n "$PW" ] || { echo "nao achei SENHA_ACESSO_SUPABASE em .env.local" >&2; exit 1; }

echo "== levando a versao atual do script para o $NO"
scp -P 8443 -o BatchMode=yes infra/ha/religar-replicacao.sh \
    "root@$NO:/root/religar-replicacao.sh" >/dev/null

RC=0
ssh -p 8443 -o BatchMode=yes "root@$NO" "sed -i 's/\r\$//' /root/religar-replicacao.sh
SENHA_SUPABASE='$PW' exec bash /root/religar-replicacao.sh $ACAO" || RC=$?
exit "$RC"
