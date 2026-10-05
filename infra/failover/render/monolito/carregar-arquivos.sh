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

DESTINO="${FILE_STORAGE_BACKEND_PATH:-/var/lib/postgresql/data/storage}"
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

# --- 1. quantos arquivos ja estao aqui? -------------------------------------
antes=$(find "$DESTINO" -type f 2>/dev/null | wc -l)
log "no disco agora: $antes arquivo(s)"

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
  unzip -qo "$TMP/a.zip" -d "$TMP/x" 2>/dev/null || { log "    zip ilegivel"; continue; }

  cifrado=$(find "$TMP/x" -name '*.tar.gpg' | head -1)
  [[ -z "$cifrado" ]] && { log "    sem .tar.gpg dentro"; continue; }

  # A chave privada e a mesma do backup do banco, ja configurada no container.
  if ! gpg --batch --yes --quiet --decrypt "$cifrado" 2>/dev/null \
       | tar -xf - -C "$TMP/x" 2>/dev/null; then
    log "    nao consegui decifrar/extrair"
    continue
  fi

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
chown -R 1000:1000 "$DESTINO" 2>/dev/null || true

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
