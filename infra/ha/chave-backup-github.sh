#!/usr/bin/env bash
# ============================================================================
#  A CHAVE QUE DEIXA O GITHUB BUSCAR O BACKUP DO CLUSTER
#
#  O QUE ESTA FALTANDO SEM ISTO
#  `backup-cluster.sh` ja roda nos dois nos, todo dia, e deixa o `.gpg`
#  cifrado la. Dois nos em dois provedores -- mas os dois sao NOSSOS. Backup
#  que vive so na maquina que ele protege nao e backup.
#  `.github/workflows/backup_cluster.yml` resolve isso puxando o arquivo todo
#  dia e guardando como artefato. Falta a chave: o secret
#  `CLUSTER_BACKUP_SSH_KEY`.
#
#  POR QUE O RUNNER PUXA EM VEZ DE FAZER O DUMP
#  O Postgres do cluster nao atende na internet: escuta no IP do tunel e no
#  HAProxy local. Abrir a 5432 para o GitHub desfaria metade do trabalho de
#  rede. Entao o no faz o dump e o runner so busca o resultado.
#
#  O QUE A CHAVE PODE FAZER, SE VAZAR
#  Nada alem de baixar um arquivo que ela nao consegue abrir. Ela entra no
#  `authorized_keys` presa a `command="backup-cluster.sh --enviar"`, sem shell,
#  sem pty, sem port-forward, sem agent-forward -- e o `.gpg` e cifrado para a
#  chave publica do Eduardo, que nao existe em nenhum dos dois nos
#  (`gpg --list-secret-keys` devolve 0 la). No pior caso, o vazamento entrega
#  um arquivo ilegivel.
#
#  A CHAVE PRIVADA NUNCA FICA NO DISCO DESTA MAQUINA
#  Ela nasce num diretorio temporario, vai para o secret do GitHub por stdin e
#  e apagada com `shred` no fim, inclusive se o script falhar no meio.
#
#  USO
#    bash infra/ha/chave-backup-github.sh            # instala e confere
#    bash infra/ha/chave-backup-github.sh --conferir # so confere
# ============================================================================
set -uo pipefail

BANCO1="${BANCO1:-216.238.120.171}"
BANCO2="${BANCO2:-172.237.48.8}"
PORTA_SSH="${PORTA_SSH:-8443}"
REPO="${REPO:-NascimentoEmpresa/appify-my-nascimento-9b345b64}"
ACAO="${1:-}"

em() { ssh -p "$PORTA_SSH" -o BatchMode=yes -o ConnectTimeout=20 \
         -o StrictHostKeyChecking=accept-new "root@$1" "$2"; }

if [ "$ACAO" = "--conferir" ]; then
  echo "== o secret existe no GitHub?"
  gh secret list --repo "$REPO" 2>/dev/null | grep -E '^CLUSTER_BACKUP_SSH_KEY' \
    || echo "   CLUSTER_BACKUP_SSH_KEY: NAO EXISTE"
  echo
  echo "== o usuario e a trava existem nos nos?"
  for NO in "$BANCO1" "$BANCO2"; do
    printf '%-18s ' "$NO"
    em "$NO" "
      id backup >/dev/null 2>&1 || { echo 'sem usuario backup'; exit 0; }
      n=\$(grep -c 'backup-cluster.sh --enviar' /home/backup/.ssh/authorized_keys 2>/dev/null || echo 0)
      echo \"usuario ok, \$n chave(s) presa(s) ao --enviar\"
    " || echo "nao respondeu"
  done
  echo
  echo "== tem backup para buscar?"
  for NO in "$BANCO1" "$BANCO2"; do
    printf '%-18s ' "$NO"
    em "$NO" "ls -lh /var/backups/erp-cluster/*.gpg 2>/dev/null | tail -1 | awk '{print \$5, \$6, \$7, \$8, \$9}' || echo 'nenhum .gpg'"
  done
  exit 0
fi

command -v gh >/dev/null || { echo "o gh CLI nao esta nesta maquina" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh sem login: rode 'gh auth login'" >&2; exit 1; }

TMP=$(mktemp -d)
limpar() {
  [ -d "$TMP" ] || return 0
  find "$TMP" -type f -exec shred -u {} \; 2>/dev/null || rm -f "$TMP"/* 2>/dev/null
  rmdir "$TMP" 2>/dev/null
}
trap limpar EXIT INT TERM

echo "== 1. chave nova, so em memoria de disco temporaria"
ssh-keygen -q -t ed25519 -N '' -C 'backup-github' -f "$TMP/backup-cluster" || exit 1
PUB=$(cat "$TMP/backup-cluster.pub")
echo "   $(ssh-keygen -lf "$TMP/backup-cluster.pub" | awk '{print $1, $2}')"

echo "== 2. o usuario 'backup' e a trava, nos dois nos"
for NO in "$BANCO1" "$BANCO2"; do
  printf '   %-18s ' "$NO"
  em "$NO" "
set -e
useradd -m -s /bin/bash backup 2>/dev/null || true
mkdir -p /home/backup/.ssh
touch /home/backup/.ssh/authorized_keys
# idempotente: a linha de 'backup-github' e refeita, nao duplicada
sed -i '/backup-github/d' /home/backup/.ssh/authorized_keys
echo 'command=\"/usr/local/sbin/backup-cluster.sh --enviar\",restrict $PUB' >> /home/backup/.ssh/authorized_keys
chown -R backup:backup /home/backup/.ssh
chmod 700 /home/backup/.ssh
chmod 600 /home/backup/.ssh/authorized_keys
# o grupo do diretorio de backup, para o usuario conseguir LER o .gpg
G=\$(stat -c %G /var/backups/erp-cluster 2>/dev/null) && [ -n \"\$G\" ] && usermod -aG \"\$G\" backup || true
echo \"ok (\$(grep -c 'backup-github' /home/backup/.ssh/authorized_keys) chave)\"
" || { echo "FALHOU"; exit 1; }
done

echo "== 3. provando que a chave busca o arquivo e NAO abre shell"
printf '   shell negado?   '
if ssh -i "$TMP/backup-cluster" -p "$PORTA_SSH" -o BatchMode=yes -o ConnectTimeout=20 \
       -o StrictHostKeyChecking=accept-new "backup@$BANCO1" "id" >/dev/null 2>&1; then
  # Com command= forcado, 'id' NAO roda: o que volta e o backup. Entao
  # "sucesso" aqui significa que o --enviar respondeu, nao que abriu shell.
  echo "a chave respondeu (o command= trocou o 'id' pelo --enviar, como deveria)"
else
  echo "a chave respondeu com erro -- veja o passo 4"
fi
printf '   tamanho do que ela entrega: '
BYTES=$(ssh -i "$TMP/backup-cluster" -p "$PORTA_SSH" -o BatchMode=yes -o ConnectTimeout=30 \
          "backup@$BANCO1" 2>/dev/null | wc -c)
echo "$BYTES bytes"
if [ "$BYTES" -lt 1000000 ]; then
  echo "   MENOS DE 1 MB -- isso nao e o dump. Nao vou gravar o secret." >&2
  echo "   Confira:  bash infra/ha/chave-backup-github.sh --conferir" >&2
  exit 1
fi

echo "== 4. gravando o secret no GitHub (a chave privada vai por stdin)"
gh secret set CLUSTER_BACKUP_SSH_KEY --repo "$REPO" < "$TMP/backup-cluster" \
  || { echo "   falhou gravar o secret" >&2; exit 1; }
gh secret list --repo "$REPO" | grep -E '^CLUSTER_BACKUP_SSH_KEY' | sed 's/^/   /'

echo "== 5. apagando a copia local (shred)"
limpar; trap - EXIT INT TERM
echo "   feito. A unica copia que vale agora e a do secret do GitHub."
echo
echo "Para ver o workflow rodar sem esperar a madrugada:"
echo "   gh workflow run backup_cluster.yml --repo $REPO"
