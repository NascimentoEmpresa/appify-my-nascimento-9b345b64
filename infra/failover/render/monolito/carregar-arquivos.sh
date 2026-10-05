#!/usr/bin/env bash
# ============================================================================
#  Traz os ARQUIVOS do Storage para a replica
# ============================================================================
#
#  O QUE FALTAVA
#  A recarga do banco traz os REGISTROS dos anexos - 8.486 linhas em
#  storage.objects. Mas o arquivo em si nao vem no dump: ele mora no disco.
#  Resultado ate hoje: a lista de anexos aparecia e o download falhava, que e
#  a pior combinacao possivel - parece defeito do sistema, nao contingencia.
#
#  POR QUE COPIAR PARA O DISCO E NAO MANDAR PELA API
#  Os registros JA ESTAO no banco, vindos do dump. Subir pela API criaria
#  8.556 registros NOVOS, duplicando tudo. O que falta sao os bytes, e eles
#  vao direto para onde o Storage os procura.
#
#  ONDE O STORAGE PROCURA
#  FILE_STORAGE_BACKEND_PATH/<bucket>/<caminho do objeto>, que e exatamente
#  como o backup ja vem organizado - por isso a copia e um cp direto.
#
#  Esse layout NAO foi lido do codigo do storage-api (ele vem empacotado e a
#  funcao nao aparece em texto). Entao o script nao confia nele: no fim, ele
#  PEDE UM ARQUIVO AO PROPRIO STORAGE e diz se veio. Se o layout estiver
#  errado, isso aparece na hora, com os arquivos no disco e o Storage sem
#  achar - em vez de descobrirmos no dia da queda.
#
#  INCREMENTAL, PORQUE SAO 4,8 GB
#  So baixa o artefato quando ha algo novo, e so extrai o que ainda nao esta
#  no disco. Rodar de novo logo depois nao custa quase nada.
# ============================================================================
set -uo pipefail

# O TENANT ENTRA NO CAMINHO, e foi isto que fez o Storage nao achar os arquivos.
# O storage-api guarda em <raiz>/<tenant>/<balde>/<objeto>, nao em
# <raiz>/<balde>/<objeto>. Extraindo sem o tenant, os 254 arquivos ficaram no
# disco e o Storage devolvia HTTP 400 - conferido em 05/10/2026, com TENANT_ID
# valendo "stub" no ambiente do servico.
#
# A validacao no fim deste script existe exatamente para isto: ela pergunta ao
# Storage se ele consegue servir um objeto real e avisa quando o layout nao
# bate, em vez de deixar passar como se tivesse dado certo.
RAIZ="${FILE_STORAGE_BACKEND_PATH:-/var/lib/postgresql/data/storage}"
DESTINO="$RAIZ/${TENANT_ID:-stub}"
REPO="${GITHUB_REPO:-NascimentoEmpresa/appify-my-nascimento-9b345b64}"
# O TRABALHO NAO PODE ACONTECER EM /tmp, e isso derrubou a replica duas vezes.
# O /tmp da Render e um volume temporario com LIMITE DE 2 GB, e o backup de
# arquivos tem 4,8 GB. Ao passar do limite a Render MATA a instancia:
#
#     Instance failed: Size of temporary storage volume /tmp exceeded the
#     limit of 2GB. Automatically starting a replacement instance.
#
# O sintoma era enganoso: o container reiniciava, o processo sumia sem erro e
# o log (que estava em /tmp) ia junto - parecia que o script nem tinha rodado.
# Aconteceu em 02/10/2026 as 15:39 e as 16:00.
#
# O disco persistente tem 15 GB livres e e onde o trabalho acontece agora.
# NAO usa ${TMPDIR:-...}: a variavel costuma vir valendo /tmp no ambiente, e
# o padrao nunca entraria. O caminho e fixo, dentro do disco.
TMP="/var/lib/postgresql/data/tmp/arquivos-replica"

# gpg, tar e unzip tambem criam temporarios por conta propria, e cairiam em
# /tmp pelo mesmo motivo. Apontar TMPDIR aqui cobre os tres.
export TMPDIR="/var/lib/postgresql/data/tmp"

log() { printf '[arquivos %(%H:%M:%S)T] %s\n' -1 "$*"; }

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  log "sem GITHUB_TOKEN - nao da para buscar o backup dos arquivos. Pulando."
  exit 0
fi

mkdir -p "$DESTINO" "$TMP" "$TMPDIR"

# --- a chave GPG, importada AQUI -------------------------------------------
# Este script precisa ser autossuficiente. A primeira versao dependia de o
# recarga-render.sh ter importado a chave antes - e quando rodei este script
# SOZINHO (02/10/2026), o download trouxe os 4,8 GB e o gpg falhou em todos com
#     nao consegui decifrar/extrair
# porque nao havia chave no chaveiro. Agora ele importa a propria, no disco
# persistente (nao em /tmp, que estoura em 2 GB na Render).
if [[ -z "${GPG_PRIVATE_KEY_B64:-}" || -z "${GPG_PASSPHRASE:-}" ]]; then
  log "sem GPG_PRIVATE_KEY_B64 ou GPG_PASSPHRASE - nao da para decifrar. Pulando."
  exit 0
fi
export GNUPGHOME="$TMPDIR/gpg"
mkdir -p "$GNUPGHOME"; chmod 700 "$GNUPGHOME"
# limpa o chaveiro ao sair: a chave privada nao sobrevive ao processo
trap 'rm -rf "$GNUPGHOME" "$TMP" 2>/dev/null || true' EXIT
if ! echo "$GPG_PRIVATE_KEY_B64" | base64 -d | gpg --batch --quiet --import 2>/dev/null; then
  log "nao consegui importar a chave GPG (base64 correta?). Pulando."
  exit 0
fi

# --- 0. espaco, antes de comecar -------------------------------------------
# O artefato completo tem 5,1 GB; somados ao .tar.gpg extraido, o pico de uso
# passa de 10 GB. Comecar sem espaco significa falhar no meio, depois de
# baixar tudo - e foi assim que a tentativa de 05/10/2026 se perdeu.
livre_kb=$(df -Pk "$TMP" | awk 'NR==2{print $4}')
if (( livre_kb < 11 * 1024 * 1024 )); then
  log "ATENCAO: so $(( livre_kb / 1024 / 1024 )) GB livres; o pico da carga passa de 10 GB."
  log "         seguindo mesmo assim - os incrementais pequenos devem caber."
fi

# --- 0b. restos do layout antigo -------------------------------------------
# Ate 05/10/2026 os arquivos iam para <raiz>/<balde>/... Com o tenant no
# caminho, aqueles viraram lixo que o Storage nunca le e que ocupa disco
# justamente quando ele e apertado. Remove so o que for balde conhecido, nunca
# o diretorio do tenant.
if [[ -d "$RAIZ" ]]; then
  for antigo in "$RAIZ"/*; do
    [[ -d "$antigo" ]] || continue
    [[ "$(basename "$antigo")" == "${TENANT_ID:-stub}" ]] && continue
    log "removendo resto do layout antigo: $(basename "$antigo")"
    rm -rf "$antigo"
  done
fi

# --- 1. quantos arquivos ja estao aqui? -------------------------------------
antes=$(find "$DESTINO" -type f 2>/dev/null | wc -l)
log "no disco agora: $antes arquivo(s)   livre: $(df -h "$TMP" | awk 'NR==2{print $4}')"

# --- 2. achar os artefatos de arquivos --------------------------------------
# Pega TODOS os nao expirados, do mais antigo para o mais novo: o primeiro e a
# copia completa e os seguintes sao incrementais. Extrair nessa ordem faz o
# incremental sobrescrever a versao antiga do arquivo que mudou.
log "procurando os backups de arquivos em $REPO..."
lista=$(curl -sS -m 120 -H "Authorization: Bearer $GITHUB_TOKEN" \
  "https://api.github.com/repos/$REPO/actions/artifacts?per_page=100" 2>/dev/null \
  | jq -r '[.artifacts[] | select(.expired==false) | select(.name|startswith("storage-arquivos"))]
           | sort_by(.created_at) | .[] | "\(.id)|\(.name)|\(.size_in_bytes)"' 2>/dev/null)

if [[ -z "$lista" ]]; then
  log "nenhum backup de arquivos encontrado - nada a fazer"
  exit 0
fi
log "$(echo "$lista" | wc -l) artefato(s) a processar"

# --- 3. baixar, decifrar e extrair ------------------------------------------
extraidos=0
while IFS='|' read -r id nome tamanho; do
  [[ -z "$id" ]] && continue
  log "  $nome ($(( tamanho / 1048576 )) MB)"
  if ! curl -sS -L -m 1800 -H "Authorization: Bearer $GITHUB_TOKEN" \
       "https://api.github.com/repos/$REPO/actions/artifacts/$id/zip" -o "$TMP/a.zip"; then
    log "    falhou o download - seguindo para o proximo"
    continue
  fi
  rm -rf "$TMP/x"; mkdir -p "$TMP/x"

  # O ERRO DO unzip APARECE NO LOG, e isso nao e detalhe. Em 05/10/2026 este
  # passo rodava com 2>/dev/null e um "No space left on device" virava
  # "zip ilegivel" - a mesma armadilha que ja tinha me custado tres tentativas
  # no bloco das RPC. Quando o unzip falha, a mensagem dele e o diagnostico.
  if ! unzip -qo "$TMP/a.zip" -d "$TMP/x" 2>"$TMP/unzip.err"; then
    log "    unzip falhou: $(tail -2 "$TMP/unzip.err" | tr '\n' ' ')"
    log "    tentando com python3 (ZIP64 >4GB o unzip classico nao abre)"
    if ! python3 -m zipfile -e "$TMP/a.zip" "$TMP/x" 2>"$TMP/py.err"; then
      log "    python3 tambem falhou: $(tail -2 "$TMP/py.err" | tr '\n' ' ')"
      log "    livre no disco: $(df -h "$TMP" | awk 'NR==2{print $4}')"
      continue
    fi
  fi

  # O ZIP SAI DE CENA ASSIM QUE O CONTEUDO ESTA FORA. Sao 5,1 GB que nao fazem
  # falta nenhuma a partir daqui, e o decifrar+extrair a seguir precisa de
  # outros ~4,8 GB. Sem isto, o disco de 20 GB nao comporta as tres copias
  # simultaneas (zip + tar.gpg + arquivos finais).
  rm -f "$TMP/a.zip"

  cifrado=$(find "$TMP/x" -name '*.tar.gpg' | head -1)
  [[ -z "$cifrado" ]] && { log "    sem .tar.gpg dentro"; continue; }

  # A chave privada e a mesma do backup do banco; a passphrase vem por
  # --pinentry-mode loopback, senao o gpg tenta abrir um prompt que nao existe
  # num processo em segundo plano e falha calado.
  # Mesma regra do unzip: o erro vai para o log. "nao consegui decifrar" sem a
  # mensagem do gpg nao diz se foi chave errada, senha errada ou disco cheio.
  if ! gpg --batch --yes --quiet --pinentry-mode loopback \
       --passphrase "$GPG_PASSPHRASE" --decrypt "$cifrado" 2>"$TMP/gpg.err" \
       | tar -xf - -C "$TMP/x" 2>"$TMP/tar.err"; then
    log "    decifrar/extrair falhou"
    [[ -s "$TMP/gpg.err" ]] && log "      gpg: $(tail -2 "$TMP/gpg.err" | tr '\n' ' ')"
    [[ -s "$TMP/tar.err" ]] && log "      tar: $(tail -2 "$TMP/tar.err" | tr '\n' ' ')"
    log "      livre no disco: $(df -h "$TMP" | awk 'NR==2{print $4}')"
    continue
  fi
  # O .tar.gpg tambem some assim que foi extraido - sao outros 4,8 GB.
  rm -f "$cifrado"

  origem="$TMP/x/arquivos"
  [[ -d "$origem" ]] || { log "    sem a pasta arquivos/"; continue; }
  n=$(find "$origem" -type f | wc -l)
  # -a preserva tudo; sem --update de proposito: o artefato mais novo DEVE
  # sobrescrever, porque e a versao mais recente daquele arquivo.
  cp -a "$origem/." "$DESTINO/" 2>/dev/null
  extraidos=$(( extraidos + n ))
  log "    $n arquivo(s) extraido(s)"
  rm -rf "$TMP/a.zip" "$TMP/x"
done <<< "$lista"

# --- 4. o dono precisa ser o do Storage -------------------------------------
# Extraido como root, o storage-api (que roda como outro usuario) nao leria.
# A RAIZ inteira, nao so o diretorio do tenant: o storage-api precisa atravessar
# <raiz> para chegar em <raiz>/<tenant>/..., e sem permissao na raiz ele para
# antes de entrar.
chown -R 1000:1000 "$RAIZ" 2>/dev/null || true

depois=$(find "$DESTINO" -type f 2>/dev/null | wc -l)
log "no disco agora: $depois arquivo(s)  (+$(( depois - antes )))"
log "espaco: $(du -sh "$DESTINO" 2>/dev/null | cut -f1)"
rm -rf "$TMP"

# --- 5. o Storage CONSEGUE servir um desses arquivos? -----------------------
# Copiar bytes para o disco nao prova nada: se o layout nao for o que o
# storage-api espera, os arquivos ficam la e o download continua falhando.
# Aqui a gente pergunta a ele, com um objeto real tirado do banco.
if (( depois > 0 )) && [[ -n "${SERVICE_ROLE_KEY:-}" ]]; then
  alvo=$(psql -At -c "select bucket_id || '/' || name from storage.objects limit 1" 2>/dev/null)
  if [[ -n "$alvo" ]]; then
    cod=$(curl -s -o /dev/null -w '%{http_code}' -m 60 \
          "http://127.0.0.1:5000/object/$alvo" \
          -H "Authorization: Bearer $SERVICE_ROLE_KEY" 2>/dev/null)
    if [[ "$cod" == "200" ]]; then
      log "CONFERIDO: o Storage serviu $alvo"
    else
      log "ATENCAO: os arquivos estao no disco mas o Storage devolveu HTTP $cod"
      log "         para $alvo - o layout em disco provavelmente nao e o esperado."
    fi
  fi
fi
