#!/bin/bash
# ============================================================================
#  Dispara o sincronizar-schema.sh DESTA maquina.
#
#  Mesmo motivo do disparar-sincronia.sh: a conferencia precisa da senha da
#  producao, e ela nao fica gravada em servidor nenhum. Este script a busca em
#  `.env.local` aqui e a passa na hora, por ambiente.
#
#  USO (Git Bash desta maquina):
#    bash infra/ha/disparar-schema.sh              # so confere
#    bash infra/ha/disparar-schema.sh --mostrar    # confere e imprime o DDL
#    bash infra/ha/disparar-schema.sh --aplicar    # aplica no cluster
#
#  Quando usar: junto do disparar-sincronia.sh. O de colunas responde "a
#  replicacao vai parar?"; este responde "o cluster esta igual a producao?".
#  Sao perguntas diferentes e, em 14/10/2026, a primeira dizia "tudo bem"
#  enquanto faltavam 44 funcoes, 5 triggers e 2 views no cluster.
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/../.."
NO="${NO:-216.238.120.171}"
ACAO="${1:---conferir}"

PW=$(grep -m1 '^SENHA_ACESSO_SUPABASE=' .env.local | cut -d= -f2- | tr -d '\r\n')
[ -n "$PW" ] || { echo "nao achei SENHA_ACESSO_SUPABASE em .env.local" >&2; exit 1; }

echo "== levando a versao atual do script para o $NO"
scp -P 8443 -o BatchMode=yes infra/ha/sincronizar-schema.sh \
    "root@$NO:/root/sincronizar-schema.sh" >/dev/null

RC=0
ssh -p 8443 -o BatchMode=yes "root@$NO" "sed -i 's/\r\$//' /root/sincronizar-schema.sh
SENHA_SUPABASE='$PW' exec bash /root/sincronizar-schema.sh $ACAO" || RC=$?
exit "$RC"
