#!/bin/bash
# ============================================================================
#  Dispara a conferencia/conserto de colunas DESTA maquina.
#
#  Existe pelo mesmo motivo do disparar-fase1.sh: o conserto precisa da senha
#  da producao, e ela nao fica gravada no servidor. Este script a busca em
#  `.env.local` aqui e a passa na hora.
#
#  USO (Git Bash desta maquina, ou prefixo `!` dentro do Claude Code):
#    bash infra/ha/disparar-sincronia.sh              # so confere
#    bash infra/ha/disparar-sincronia.sh --aplicar    # corrige e religa
#
#  Quando usar: quando a vigia do cron levantar a bandeira
#  (/var/run/replicacao-precisa-coluna no banco1), ou depois de qualquer
#  migration aplicada na producao que acrescente coluna.
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/../.."
NO="${NO:-216.238.120.171}"
ACAO="${1:---conferir}"

PW=$(grep -m1 '^SENHA_ACESSO_SUPABASE=' .env.local | cut -d= -f2- | tr -d '\r\n')
[ -n "$PW" ] || { echo "nao achei SENHA_ACESSO_SUPABASE em .env.local" >&2; exit 1; }

echo "== levando a versao atual do script para o $NO"
scp -P 8443 -o BatchMode=yes infra/ha/sincronizar-colunas.sh "root@$NO:/root/sincronizar-colunas.sh" >/dev/null

ssh -p 8443 -o BatchMode=yes "root@$NO" "sed -i 's/\r\$//' /root/sincronizar-colunas.sh
SENHA_SUPABASE='$PW' bash /root/sincronizar-colunas.sh $ACAO
rc=\$?
# A bandeira so some quando o conserto foi aplicado E deu certo.
if [ '$ACAO' = '--aplicar' ] && [ \$rc -eq 0 ]; then rm -f /var/run/replicacao-precisa-coluna; fi
exit \$rc"
