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
#  (/var/run/replicacao-precisa-coluna), ou depois de qualquer migration
#  aplicada na producao que acrescente coluna.
#
#  A BANDEIRA MORA NO LIDER, E O LIDER MUDA
#  A vigia roda nos dois nos e so o LIDER escreve a bandeira -- hoje o banco2,
#  amanha o banco1, conforme o Patroni decidir. A primeira versao daqui apagava
#  a bandeira so no $NO (banco1), onde ela quase nunca esta: em 14/10/2026 o
#  conserto deu certo e a bandeira continuou de pe no banco2. Nao foi grave
#  porque a propria vigia a limpa no ciclo seguinte ("normalizou"), mas por ate
#  10 minutos o servidor afirmava um problema que ja nao existia -- e bandeira
#  que mente e bandeira que se aprende a ignorar. Agora limpamos nos DOIS nos
#  daqui, o unico lugar com chave para ambos: o banco1 nao tem chave para o
#  banco2.
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/../.."
NO="${NO:-216.238.120.171}"
NO2="${NO2:-172.237.48.8}"
ACAO="${1:---conferir}"

PW=$(grep -m1 '^SENHA_ACESSO_SUPABASE=' .env.local | cut -d= -f2- | tr -d '\r\n')
[ -n "$PW" ] || { echo "nao achei SENHA_ACESSO_SUPABASE em .env.local" >&2; exit 1; }

echo "== levando a versao atual do script para o $NO"
scp -P 8443 -o BatchMode=yes infra/ha/sincronizar-colunas.sh "root@$NO:/root/sincronizar-colunas.sh" >/dev/null

# O `|| RC=$?` existe por causa do `set -e`: sem ele, o script morre aqui e a
# bandeira nunca e limpa justamente quando o conserto apontou pendencia.
RC=0
ssh -p 8443 -o BatchMode=yes "root@$NO" "sed -i 's/\r\$//' /root/sincronizar-colunas.sh
SENHA_SUPABASE='$PW' exec bash /root/sincronizar-colunas.sh $ACAO" || RC=$?

# A bandeira so some quando o conserto foi aplicado E deu certo. Nos dois nos,
# porque ela mora no lider e o lider muda (ver cabecalho).
if [ "$ACAO" = '--aplicar' ] && [ "$RC" -eq 0 ]; then
  for N in "$NO" "$NO2"; do
    if ssh -p 8443 -o BatchMode=yes -o ConnectTimeout=10 "root@$N" \
         'rm -f /var/run/replicacao-precisa-coluna' 2>/dev/null; then
      echo "== bandeira limpa no $N"
    else
      echo "== nao alcancei o $N para limpar a bandeira (a vigia limpa sozinha em <=10 min)"
    fi
  done
fi

exit "$RC"
