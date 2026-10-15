#!/bin/bash
# ============================================================================
#  Dispara o resolver-conflito.sh DESTA maquina.
#
#  Mesmo motivo dos outros disparar-*: o conserto precisa da senha da producao,
#  e ela nao fica gravada em servidor nenhum. Este script a busca em
#  `.env.local` aqui e a passa na hora, por ambiente.
#
#  USO (Git Bash desta maquina):
#    bash infra/ha/disparar-conflito.sh              # so mostra o que acharia
#    bash infra/ha/disparar-conflito.sh --aplicar    # resolve
#
#  Quando usar: quando a replicacao parar e o log do lider disser
#  "duplicate key value violates unique constraint". Tipicamente depois de
#  alguem abrir o ERP apontado para o cluster -- ver o cabecalho do
#  resolver-conflito.sh, que explica por que isso escreve apesar do REVOKE.
#
#  O script roda no banco1, que e quem alcanca a producao e o cluster. Ele le
#  o log do PROPRIO no para descobrir a tabela em conflito, entao se o lider
#  for o banco2 passe o nome da tabela na mao:
#    bash infra/ha/disparar-conflito.sh --aplicar CHAMADO_SISTEMA_LEITURA
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/../.."
NO="${NO:-216.238.120.171}"
ACAO="${1:---conferir}"
TABELA="${2:-}"

PW=$(grep -m1 '^SENHA_ACESSO_SUPABASE=' .env.local | cut -d= -f2- | tr -d '\r\n')
[ -n "$PW" ] || { echo "nao achei SENHA_ACESSO_SUPABASE em .env.local" >&2; exit 1; }

echo "== levando a versao atual do script para o $NO"
scp -P 8443 -o BatchMode=yes infra/ha/resolver-conflito.sh \
    "root@$NO:/root/resolver-conflito.sh" >/dev/null

RC=0
ssh -p 8443 -o BatchMode=yes "root@$NO" "sed -i 's/\r\$//' /root/resolver-conflito.sh
SENHA_SUPABASE='$PW' exec bash /root/resolver-conflito.sh $ACAO $TABELA" || RC=$?
exit "$RC"
