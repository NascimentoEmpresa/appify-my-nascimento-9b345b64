#!/usr/bin/env bash
# ============================================================================
#  Recarga automatica da replica na Render  (roda como Cron Job)
# ============================================================================
#
#  O CICLO
#    1. acha o backup mais recente publicado pelo workflow backup_banco.yml
#    2. baixa (o artefato vem como .zip)
#    3. descriptografa com a chave GPG
#    4. carrega no erp-db pela rede privada da Render
#
#  POR QUE O ARTEFATO DO GITHUB, E NAO O "S:"
#  O servidor de arquivos da empresa esta na rede interna (192.168.100.60). A
#  Render nao alcanca. O artefato do GitHub e o unico lugar que os dois lados
#  enxergam. Retencao de 14 dias - mais que suficiente para uma recarga diaria.
#
#  ===========================================================================
#  ATENCAO, DECISAO DE SEGURANCA QUE PRECISA SER CONSCIENTE
#  ===========================================================================
#  Para rodar sozinho, este job precisa da CHAVE PRIVADA de GPG. Ou seja: a
#  chave que abre TODOS os backups da empresa passa a existir tambem na Render.
#  Se a conta da Render for comprometida, os backups ficam legiveis.
#
#  Isso e uma troca, nao um descuido: sem chave, nao ha recarga automatica, e
#  sem recarga a replica envelhece ate virar inutil.
#
#  O jeito de reduzir o estrago (recomendado, ainda NAO feito): gerar uma
#  SEGUNDA chave GPG so para a replica e fazer o backup_banco.yml cifrar para
#  as duas (gpg -r eduardo -r replica). Assim, comprometer a Render nao expoe
#  a chave do Eduardo, e revogar a da replica nao invalida nada do que ja
#  existe. Enquanto isso nao for feito, a chave aqui e a mesma - trate o acesso
#  a este servico como acesso aos backups.
#  ===========================================================================
#
#  VARIAVEIS (todas como "secret file"/env no painel da Render)
#    GITHUB_REPO          NascimentoEmpresa/appify-my-nascimento-9b345b64
#    GITHUB_TOKEN         token so de leitura de Actions
#    GPG_PRIVATE_KEY_B64  a chave privada exportada, em base64
#    GPG_PASSPHRASE       a senha da chave
#    PGHOST / PGPORT / PGUSER / PGPASSWORD   o erp-db
# ============================================================================
set -uo pipefail

log() { printf '[%(%Y-%m-%d %H:%M:%S)T] %s\n' -1 "$*"; }
erro() { log "FALHOU: $*" >&2; exit 1; }

: "${GITHUB_REPO:?defina GITHUB_REPO}"
: "${GITHUB_TOKEN:?defina GITHUB_TOKEN}"
: "${GPG_PRIVATE_KEY_B64:?defina GPG_PRIVATE_KEY_B64}"
: "${GPG_PASSPHRASE:?defina GPG_PASSPHRASE}"
: "${PGHOST:?defina PGHOST}"
: "${PGPASSWORD:?defina PGPASSWORD}"

# O /tmp da Render e limitado a 2 GB, e passar disso NAO da erro: a Render
# mata a instancia e sobe outra -
#     Instance failed: Size of temporary storage volume /tmp exceeded 2GB
# O dump de hoje tem 109 MB e cabe com folga, mas o banco cresce, e esse
# limite nao avisa antes de morder. Quando o disco persistente existir, o
# trabalho acontece la; fora da Render, /tmp mesmo.
if [[ -d /var/lib/postgresql/data ]]; then
  mkdir -p /var/lib/postgresql/data/tmp
  TRABALHO="$(mktemp -d -p /var/lib/postgresql/data/tmp)"
else
  TRABALHO="$(mktemp -d)"
fi
limpar() {
  # O dump em claro e a chave privada NAO podem sobreviver ao job.
  rm -rf "$TRABALHO" "$GNUPGHOME" 2>/dev/null || true
}
trap limpar EXIT

log "=== recarga da replica na Render ==="

# --- 1. achar o backup mais recente -----------------------------------------
log "procurando o backup mais recente em $GITHUB_REPO..."
LISTA="$TRABALHO/artefatos.json"
curl -sS -f -H "Authorization: Bearer $GITHUB_TOKEN" \
     -H "Accept: application/vnd.github+json" \
     "https://api.github.com/repos/$GITHUB_REPO/actions/artifacts?per_page=100" \
     -o "$LISTA" || erro "nao consegui listar os artefatos (token sem permissao de Actions?)"

# expired=false importa: artefato vencido ainda aparece na listagem, mas o
# download devolve 410 e a mensagem nao e obvia.
ESCOLHIDO=$(jq -r '
  [ .artifacts[]
    | select(.expired == false)
    | select(.name | test("^backup-.*\\.dump\\.gpg$"))
  ] | sort_by(.created_at) | reverse | .[0]
  | if . == null then "" else "\(.id)\t\(.name)\t\(.created_at)" end
' "$LISTA")
[[ -n "$ESCOLHIDO" ]] || erro "nenhum artefato 'backup-*.dump.gpg' valido. O backup_banco.yml rodou nos ultimos 14 dias?"

ID=$(cut -f1 <<<"$ESCOLHIDO"); NOME=$(cut -f2 <<<"$ESCOLHIDO"); QUANDO=$(cut -f3 <<<"$ESCOLHIDO")
IDADE_H=$(( ( $(date -u +%s) - $(date -u -d "$QUANDO" +%s) ) / 3600 ))
log "  $NOME  (gerado ha ${IDADE_H}h)"
(( IDADE_H <= 30 )) || log "  AVISO: o backup mais novo tem mais de 30h. Conferir o workflow backup_banco.yml."

# --- 2. baixar --------------------------------------------------------------
log "baixando..."
curl -sS -f -L -H "Authorization: Bearer $GITHUB_TOKEN" \
     "https://api.github.com/repos/$GITHUB_REPO/actions/artifacts/$ID/zip" \
     -o "$TRABALHO/artefato.zip" || erro "download falhou"
unzip -qo "$TRABALHO/artefato.zip" -d "$TRABALHO" || erro "o artefato nao e um zip valido"
CIFRADO=$(find "$TRABALHO" -name '*.dump.gpg' | head -1)
[[ -n "$CIFRADO" ]] || erro "o zip nao tinha nenhum .dump.gpg dentro"
log "  $(du -h "$CIFRADO" | cut -f1) cifrados"

# --- 3. descriptografar -----------------------------------------------------
# GNUPGHOME em caminho curto de proposito: o gpg-agent nao sobe em caminho
# comprido e o erro que ele da ("Unknown system error") nao ajuda em nada.
export GNUPGHOME="/tmp/gpg$$"
mkdir -p "$GNUPGHOME"; chmod 700 "$GNUPGHOME"
echo "$GPG_PRIVATE_KEY_B64" | base64 -d | \
  gpg --batch --quiet --import 2>/dev/null || erro "nao consegui importar a chave privada (base64 correta?)"

# Confere que a chave tem subchave de CIFRAGEM. Uma chave exportada antes da
# subchave [E] existir parece valida e nao descriptografa nada - ja aconteceu
# em 28/09/2026.
gpg --list-secret-keys --with-colons 2>/dev/null | grep -q '^ssb' \
  || erro "a chave importada nao tem subchave de cifragem (ssb). Ela nao abre backup nenhum."

DUMP="$TRABALHO/producao.dump"
gpg --batch --yes --quiet --pinentry-mode loopback \
    --passphrase "$GPG_PASSPHRASE" -o "$DUMP" -d "$CIFRADO" \
  || erro "gpg nao abriu o backup (senha errada?)"
# Testando isto a mao, atencao: o gpg-agent GUARDA a senha em cache depois do
# primeiro sucesso. Uma segunda tentativa com a senha ERRADA passa, e parece
# que a verificacao nao funciona. Para testar de verdade, use um GNUPGHOME novo
# e rode `gpgconf --kill gpg-agent` antes. Aqui isso nao acontece porque cada
# execucao do cron comeca num container limpo.
log "  $(du -h "$DUMP" | cut -f1) em claro"

# --- 4. carregar ------------------------------------------------------------
# Mesmo script que roda no PC do Eduardo. As quatro correcoes do restore vivem
# la, num lugar so.
# O carregar-replica.sh mora em lugares diferentes conforme a imagem:
#   imagem do cron (Dockerfile.recarga) ... /app/carregar-replica.sh, e este
#                                           script fica em /app/render/
#   imagem unica (Dockerfile.monolito) .... os dois lado a lado em /usr/local/bin/
# Fixar "../carregar-replica.sh" quebrava na segunda, e so na hora da carga -
# depois de baixar e descriptografar 110 MB. Medido em 01/10/2026.
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CARREGAR=""
for tentativa in "$AQUI/carregar-replica.sh" "$AQUI/../carregar-replica.sh" "/usr/local/bin/carregar-replica.sh" "/app/carregar-replica.sh"; do
  [[ -x "$tentativa" ]] && { CARREGAR="$tentativa"; break; }
done
[[ -n "$CARREGAR" ]] || erro "nao achei o carregar-replica.sh (procurei em $AQUI, $AQUI/.., /usr/local/bin e /app)"
log "usando $CARREGAR"

export LOG_ERR="$TRABALHO/restore.err.log"
"$CARREGAR" "$DUMP" || erro "a carga falhou - ver o log acima"

# --- os ARQUIVOS do Storage ------------------------------------------------
# O dump traz os REGISTROS dos anexos; os arquivos moram no disco e vem por
# fora. Sem isto, a lista de anexos aparece e o download falha - a pior
# combinacao, porque parece defeito do sistema e nao contingencia.
#
# Roda DEPOIS da carga do banco de proposito: o script confere o resultado
# pedindo um objeto real ao Storage, e para isso os registros precisam estar
# no lugar.
#
# Nao derruba a recarga se falhar: banco atualizado sem os anexos e muito
# melhor que nenhum dos dois.
if [[ -x /usr/local/bin/carregar-arquivos.sh ]]; then
  /usr/local/bin/carregar-arquivos.sh || log "os arquivos do Storage falharam - o banco esta carregado mesmo assim"
else
  log "carregar-arquivos.sh ausente - os anexos nao serao copiados"
fi

log "=== recarga concluida ==="
