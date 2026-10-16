#!/bin/bash
# ============================================================================
#  Dispara o carregar-auth-storage.sh DESTA maquina.
#
#  Traz `auth` e `storage` da producao para o cluster -- os logins e o
#  metadado dos anexos, que a replicacao logica NAO cobre (ela so leva
#  `public`).
#
#  USO (Git Bash desta maquina, na pasta do projeto):
#    bash infra/ha/disparar-auth-storage.sh --conferir   # so compara os numeros
#    bash infra/ha/disparar-auth-storage.sh              # trunca e recarrega
#
#  ORDEM QUE IMPORTA: os ARQUIVOS primeiro (`disparar-anexos.sh`), o METADADO
#  depois. Ao contrario, `storage.objects` aponta para caminho que ainda nao
#  existe no disco, e o sintoma e o pior tipo: a linha aparece na tela do ERP e
#  o download estoura com 500 -- nao 404.
#
#  E REPETIVEL: ele trunca e recarrega. Enquanto o cluster nao atende ninguem,
#  rodar de novo nao custa nada alem do tempo. Na janela do corte roda mais uma
#  vez, DEPOIS do congelamento da escrita, para pegar quem entrou no meio.
#
#  So LE a producao. A senha do cluster o script busca sozinho no
#  /opt/erp/infra/failover/.env do proprio no.
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/../.."
NO="${NO:-216.238.120.171}"
ACAO="${1:-}"

PW=$(grep -m1 '^SENHA_ACESSO_SUPABASE=' .env.local | cut -d= -f2- | tr -d '\r\n')
[ -n "$PW" ] || { echo "nao achei SENHA_ACESSO_SUPABASE em .env.local" >&2; exit 1; }

echo "== levando a versao atual do script para o $NO"
scp -P 8443 -o BatchMode=yes infra/ha/carregar-auth-storage.sh \
    "root@$NO:/root/carregar-auth-storage.sh" >/dev/null

RC=0
ssh -p 8443 -o BatchMode=yes "root@$NO" "sed -i 's/\r\$//' /root/carregar-auth-storage.sh
set -a; . /opt/erp/infra/failover/.env; set +a
SENHA_SUPABASE='$PW' SENHA_DESTINO=\"\$PG_SENHA_SUPER\" \
  exec bash /root/carregar-auth-storage.sh $ACAO" || RC=$?
exit "$RC"
