#!/usr/bin/env bash
# ============================================================================
#  LIGAR A APLICACAO AUTOMATICA DE MIGRATION NO MERGE
#
#  O QUE ISTO INSTALA
#    /usr/local/sbin/aplicar-migrations.sh   (vem de infra/ha/no-aplicar-migrations.sh)
#    /usr/local/sbin/backup-cluster.sh       (atualizado: entende a palavra "migrations")
#    /etc/sudoers.d/erpbackup-functions      (ganha o aplicador na lista)
#
#  POR QUE O sudoers PRECISA SER TOCADO
#  A chave do CI entra como `erpbackup`, que nao le `/opt/erp/infra/failover/.env`
#  (600, com a senha do banco dentro) nem deve ler. O aplicador roda como root
#  por UMA entrada nominal de sudo -- para este script e mais nada. Sem isso o
#  CI falharia com "sudo: a password is required", que e como o mesmo defeito
#  apareceu com as functions em 18/10.
#
#  O QUE ESTA PERMISSAO CONCEDE, DITO SEM RODEIO
#  Quem tiver a chave do CI consegue fazer o banco1 aplicar as migrations que
#  estao no `main` do repositorio PUBLICO. Nao consegue mandar SQL proprio,
#  nao abre shell, nao le segredo. O conteudo e sempre o que passou pela
#  portaria e pelo merge.
#
#  SO O BANCO1 APLICA MIGRATION. O banco2 recebe os arquivos por simetria (se
#  um dia ele virar o no de onde se dispara), mas o workflow chama so o
#  banco1: os dois mandariam no mesmo lider e disputariam a mesma janela.
#
#  USO
#    bash infra/ha/instalar-migracao-automatica.sh --conferir
#    bash infra/ha/instalar-migracao-automatica.sh --instalar
# ============================================================================
set -uo pipefail

BANCO1="${BANCO1:-216.238.120.171}"
BANCO2="${BANCO2:-172.237.48.8}"
PORTA_SSH="${PORTA_SSH:-8443}"
MODO="${1:---conferir}"

cd "$(dirname "$0")/../.." || exit 1
case "$MODO" in --conferir|--instalar) ;; *) sed -n '2,30p' "$0"; exit 2 ;; esac

no() { ssh -p "$PORTA_SSH" -o BatchMode=yes -o ConnectTimeout=25 \
         -o StrictHostKeyChecking=accept-new "root@$1" "${@:2}"; }

if [ "$MODO" = "--conferir" ]; then
  for H in "$BANCO1" "$BANCO2"; do
    echo "== $H"
    no "$H" 'ls -l /usr/local/sbin/aplicar-migrations.sh 2>/dev/null || echo "   aplicador: NAO instalado"
             grep -c "aplicar-migrations" /etc/sudoers.d/erpbackup-functions 2>/dev/null \
               | sed "s/^0$/   sudoers: SEM a entrada/; s/^[1-9].*/   sudoers: ok/"
             grep -qc "migrations" /usr/local/sbin/backup-cluster.sh 2>/dev/null \
               && echo "   despachante: entende a palavra" || echo "   despachante: NAO entende"'
    echo
  done
  echo "   Para instalar:  bash infra/ha/instalar-migracao-automatica.sh --instalar"
  exit 0
fi

for H in "$BANCO1" "$BANCO2"; do
  echo "== instalando em $H"
  scp -q -P "$PORTA_SSH" -o BatchMode=yes \
      infra/ha/no-aplicar-migrations.sh "root@$H:/usr/local/sbin/aplicar-migrations.sh" || exit 1
  scp -q -P "$PORTA_SSH" -o BatchMode=yes \
      infra/ha/backup-cluster.sh "root@$H:/usr/local/sbin/backup-cluster.sh" || exit 1
  no "$H" 'set -e
    # Windows escreve CRLF; o shell do Linux le o \r como parte do comando e
    # o erro que aparece e "/usr/bin/env: bash\r: No such file or directory".
    sed -i "s/\r$//" /usr/local/sbin/aplicar-migrations.sh /usr/local/sbin/backup-cluster.sh
    chown root:root /usr/local/sbin/aplicar-migrations.sh /usr/local/sbin/backup-cluster.sh
    # OS DOIS MODOS SAO DIFERENTES, e trocar isso quebra o CI inteiro.
    #
    # backup-cluster.sh e o `command=` do authorized_keys: ele roda COMO
    # erpbackup. Se nao for executavel por ele, a chave do CI para de
    # funcionar por completo -- backup diario, vigia e atualizacao das
    # functions, tudo. (Foi exatamente o que esta linha fez em 19/10, posta
    # como 700: o `--instalar` terminou dizendo "ok" e a chave ficou morta.
    # Nao apareceu ali porque a prova do instalador rodava como root.)
    chmod 755 /usr/local/sbin/backup-cluster.sh
    # aplicar-migrations.sh roda por `sudo`, ou seja, JA como root -- ele nao
    # precisa ser legivel pelo erpbackup, e nao deve: ele le a senha do banco.
    chmod 700 /usr/local/sbin/aplicar-migrations.sh

    # A linha do sudo e reescrita inteira, nominal, sem curinga.
    printf "%s\n" "erpbackup ALL=(root) NOPASSWD: /usr/local/sbin/atualizar-functions.sh, /usr/local/sbin/estado-cluster.sh, /usr/local/sbin/aplicar-migrations.sh" \
      > /etc/sudoers.d/erpbackup-functions.novo
    chmod 440 /etc/sudoers.d/erpbackup-functions.novo
    # visudo -c valida ANTES de trocar. sudoers quebrado tranca todo mundo
    # fora do sudo, inclusive quem foi consertar.
    if visudo -cf /etc/sudoers.d/erpbackup-functions.novo >/dev/null; then
      mv /etc/sudoers.d/erpbackup-functions.novo /etc/sudoers.d/erpbackup-functions
      echo "   sudoers ok"
    else
      rm -f /etc/sudoers.d/erpbackup-functions.novo
      echo "   SUDOERS INVALIDO -- nada trocado" >&2; exit 1
    fi
    mkdir -p /var/lock
    echo "   instalado"'
  echo
done

# A prova tem que andar pelo caminho DO CI, nao pelo caminho do root.
# A primeira versao disto rodava o aplicador direto como root: dava tudo
# certo e escondia que o erpbackup nem conseguia executar o despachante.
# Prova que roda num caminho que ninguem usa nao prova nada.
echo "== prova pelo caminho do CI: como erpbackup, pelo despachante"
no "$BANCO1" 'set -e
  sudo -u erpbackup test -x /usr/local/sbin/backup-cluster.sh \
    || { echo "   o erpbackup NAO executa o despachante -- a chave do CI esta morta" >&2; exit 1; }
  echo "   permissao ok"
  # Mesma palavra que o workflow manda. Com a fila vazia, e inofensivo.
  sudo -u erpbackup env SSH_ORIGINAL_COMMAND=migrations \
    /usr/local/sbin/backup-cluster.sh --enviar' || exit 1
echo
echo "   Pronto. A partir do proximo merge na main, a migration entra sozinha."
echo "   Para ver o que ela fez:  Actions > 'Cluster pós-merge' > migrations"
echo "   Se falhar, voce recebe DM no Discord com o erro."
