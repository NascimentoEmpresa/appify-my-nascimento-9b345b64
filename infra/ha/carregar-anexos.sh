#!/bin/bash
# ============================================================================
#  Traz os ARQUIVOS de anexo da Supabase para o volume do storage do cluster.
#
#  POR QUE ISTO NAO E "SO BAIXAR E SUBIR"
#
#  O storage-api com STORAGE_BACKEND=file guarda cada objeto num caminho que
#  termina na VERSAO dele -- conferido em 13/10/2026 no banco1:
#
#    <volume>/stub/stub/<bucket>/<nome do objeto>/<version>
#    xattr user.supabase.content-type = "text/plain"
#    xattr user.supabase.cache-control = "no-cache"
#
#  Isso manda em duas decisoes:
#
#  1. GRAVAMOS O ARQUIVO NO CAMINHO DA VERSAO DA PRODUCAO, direto no volume --
#     nao enviamos pela API do cluster. Se enviassemos pela API, ela geraria
#     uma version NOVA, e o dump de storage.objects da producao (que entra na
#     janela do corte) apontaria para caminhos que nao existem no disco. O
#     sintoma seria o que ja conhecemos: a linha aparece na tela do ERP e o
#     download estoura com 500 -- nao 404.
#
#  2. O CONTENT-TYPE NAO MORA NO BANCO: mora em xattr no proprio arquivo. Sem
#     ele, o download morre com ENODATA num erro que nao fala de arquivo
#     nenhum. Entao cada arquivo recebe os dois xattrs na hora em que e
#     instalado, a partir do metadata da producao.
#
#  O QUE ISTO E, E O QUE NAO E
#  E a carga de MASSA, feita de dia, repetivel. Roda quantas vezes quiser: quem
#  ja esta no lugar com o tamanho certo e pulado. Na janela do corte roda de
#  novo e copia so o delta (minutos).
#  NAO sobe metadado: storage.objects e storage.buckets vem do dump de `auth` e
#  `storage` na janela do corte -- a replicacao logica cobre so o schema
#  `public`. Ver docs/ha-corte-roteiro.md.
#
#  NUNCA usar --retry-all-errors no curl: ele faz o curl repetir erro de
#  aplicacao (403, 404) como se fosse falha de rede, e mascara objeto que
#  realmente nao existe mais na origem.
#
#  USO (na maquina que tem o volume -- banco1 ou banco2):
#    SENHA_SUPABASE=... \
#    SUPABASE_URL=https://<ref>.supabase.co \
#    SUPABASE_SERVICE_ROLE_KEY=... \
#    bash carregar-anexos.sh [--paralelo 6] [--relistar] [--limite 20]
#
#    --relistar   refaz a lista de objetos da producao (senao reusa a cache)
#    --limite N   processa so os N primeiros -- para ensaiar antes da carga
#    --paralelo N quantos downloads ao mesmo tempo (padrao 6)
#    --conferir   nao baixa nada: so compara disco x producao e sai
# ============================================================================
set -uo pipefail

# ── modo interno: um arquivo so, chamado pelo xargs ─────────────────────────
# Fica no topo porque e o mesmo script se reinvocando; nao e ponto de entrada
# para humano.
if [ "${1:-}" = "--um" ]; then
  # O "-" nos campos vazios nao e enfeite: no bash, TAB conta como espaco em
  # branco no IFS, entao dois tabs seguidos colapsam num so e TODAS as colunas
  # seguintes andam uma casa. Um objeto sem mimetype viraria caminho errado.
  IFS=$'\t' read -r BUCKET NOME VERSAO MIME CACHE TAM ENC <<< "$2"
  [ "$MIME" = "-" ] && MIME=""
  [ "$CACHE" = "-" ] && CACHE=""
  [ "$TAM" = "-" ] && TAM=""
  DEST="$BASE/$BUCKET/$NOME/$VERSAO"

  # Idempotencia: ja esta no lugar com o tamanho certo? Nao toca.
  if [ -n "$TAM" ] && [ -f "$DEST" ] && [ "$(stat -c%s "$DEST" 2>/dev/null)" = "$TAM" ]; then
    echo "pulado" >> "$CONTAGEM/pulados"
    exit 0
  fi

  # O temporario nasce no MESMO sistema de arquivos do destino, de proposito:
  # em /root o mv viraria copia e os 5,6 GB seriam escritos duas vezes.
  TMP=$(mktemp "$TEMPORARIOS/baixando.XXXXXX")
  COD=$(curl -sS --fail --location --max-time 900 --retry 3 --retry-delay 2 \
          -w '%{http_code}' \
          -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
          -o "$TMP" \
          "$SUPABASE_URL/storage/v1/object/$BUCKET/$ENC" 2>>"$FALHAS.curl")
  RC=$?

  if [ $RC -ne 0 ]; then
    rm -f "$TMP"
    printf '%s\t%s\t%s\tcurl rc=%s http=%s\n' "$BUCKET" "$NOME" "$VERSAO" "$RC" "${COD:-?}" >> "$FALHAS"
    exit 0
  fi

  BAIXADO=$(stat -c%s "$TMP")
  if [ -n "$TAM" ] && [ "$BAIXADO" != "$TAM" ]; then
    # Tamanho diferente do que o banco diz: nao instala. Melhor faltar o
    # arquivo (e aparecer no relatorio) do que instalar truncado e descobrir
    # quando um usuario abrir.
    rm -f "$TMP"
    printf '%s\t%s\t%s\ttamanho %s esperado %s\n' "$BUCKET" "$NOME" "$VERSAO" "$BAIXADO" "$TAM" >> "$FALHAS"
    exit 0
  fi

  mkdir -p "$(dirname "$DEST")" || { rm -f "$TMP"; printf '%s\t%s\t%s\tmkdir falhou\n' "$BUCKET" "$NOME" "$VERSAO" >> "$FALHAS"; exit 0; }
  chmod 0644 "$TMP"
  mv -f "$TMP" "$DEST"

  # Os dois xattrs, na ordem em que o storage-api os escreve.
  [ -n "$MIME" ]  && setfattr -n user.supabase.content-type  -v "$MIME"  "$DEST" 2>/dev/null
  [ -n "$CACHE" ] && setfattr -n user.supabase.cache-control -v "$CACHE" "$DEST" 2>/dev/null

  echo "$BAIXADO" >> "$CONTAGEM/baixados"
  exit 0
fi

# ── ponto de entrada ────────────────────────────────────────────────────────
PARALELO=6
RELISTAR=0
LIMITE=0
SO_CONFERIR=0
while [ $# -gt 0 ]; do
  case "$1" in
    --paralelo) PARALELO="${2:?}"; shift 2 ;;
    --limite)   LIMITE="${2:?}";   shift 2 ;;
    --relistar) RELISTAR=1; shift ;;
    --conferir) SO_CONFERIR=1; shift ;;
    *) echo "argumento desconhecido: $1" >&2; exit 2 ;;
  esac
done

: "${SENHA_SUPABASE:?senha do postgres da producao}"
: "${SUPABASE_URL:?url do projeto Supabase (https://<ref>.supabase.co)}"
: "${SUPABASE_SERVICE_ROLE_KEY:?chave service_role da producao}"

VOLUME="${VOLUME:-erp-pilha_storage-arquivos}"
# aws-1, nao aws-0: o aws-0 responde na porta e recusa o tenant. Para LER a
# lista o pooler serve -- replicacao e que exige o host direto (IPv6).
ORIGEM_HOST="${ORIGEM_HOST:-aws-1-sa-east-1.pooler.supabase.com}"
REF="${REF:-fwmzeaztjxrxxzxzxmgc}"
PSQL=$(command -v psql || echo /usr/lib/postgresql/17/bin/psql)

for t in curl jq python3 setfattr "$PSQL"; do
  command -v "$t" >/dev/null 2>&1 || { echo "falta $t nesta maquina" >&2; exit 1; }
done

MONTAGEM=$(docker volume inspect "$VOLUME" --format '{{.Mountpoint}}' 2>/dev/null)
[ -n "$MONTAGEM" ] || { echo "volume $VOLUME nao existe aqui -- a pilha subiu nesta maquina?" >&2; exit 1; }
# O "stub/stub" e o prefixo de tenant que o storage-api autogerenciado usa.
# Conferido no arquivo de teste em 13/10/2026; mudar isso quebra o caminho.
export BASE="$MONTAGEM/stub/stub"
mkdir -p "$BASE"
export TEMPORARIOS="$MONTAGEM/.carga-tmp"
mkdir -p "$TEMPORARIOS"

TRABALHO="${TRABALHO:-/root/migracao/anexos}"
mkdir -p "$TRABALHO"
export TRABALHO
LISTA="$TRABALHO/objetos.tsv"
export FALHAS="$TRABALHO/falhas-$(date +%Y%m%d-%H%M%S).tsv"
export CONTAGEM="$TRABALHO/contagem"
rm -rf "$CONTAGEM"; mkdir -p "$CONTAGEM"
: > "$CONTAGEM/baixados"; : > "$CONTAGEM/pulados"

log(){ echo "[$(date +%H:%M:%S)] $*"; }

# ── 1. a lista de objetos, direto do catalogo da producao ──────────────────
# Sai como TSV com uma coluna extra: o nome JA codificado para URL. Codificar
# aqui, uma vez, em vez de 11 mil vezes dentro do laco -- cada chamada de
# python3 custa ~50ms, o que daria quase 10 minutos so de partida de processo.
if [ $RELISTAR -eq 1 ] || [ ! -s "$LISTA" ]; then
  log "lendo storage.objects da producao"
  PGPASSWORD="$SENHA_SUPABASE" "$PSQL" \
    -h "$ORIGEM_HOST" -p 5432 -U "postgres.$REF" -d postgres -At -c "
    select json_build_object(
             'b', bucket_id, 'n', name, 'v', version,
             'm', metadata->>'mimetype', 'c', metadata->>'cacheControl',
             's', metadata->>'size')
      from storage.objects
     where version is not null
       and coalesce(is_delete_marker, false) = false
     order by (metadata->>'size')::bigint desc nulls last;" \
  | python3 -c '
import sys, json, urllib.parse
for linha in sys.stdin:
    linha = linha.strip()
    if not linha:
        continue
    o = json.loads(linha)
    # safe="/" preserva as pastas: o nome do objeto carrega a hierarquia
    # dentro do bucket e a barra NAO pode virar %2F.
    enc = urllib.parse.quote(o["n"], safe="/")
    # "-" no lugar de campo vazio: ver o comentario do modo --um sobre TAB.
    print("\t".join([o["b"], o["n"], o["v"], o.get("m") or "-", o.get("c") or "-", o.get("s") or "-", enc]))
' > "$LISTA.novo" && mv "$LISTA.novo" "$LISTA"
fi

TOTAL=$(wc -l < "$LISTA")
BYTES_ESPERADOS=$(awk -F'\t' '{s+=$6} END {print s+0}' "$LISTA")
log "lista: $TOTAL objetos, $((BYTES_ESPERADOS/1024/1024)) MB"

# ── 2. conferencia (nao baixa nada) ────────────────────────────────────────
confere(){
  local presentes=0 bytes=0 faltando=0 semxattr=0
  while IFS=$'\t' read -r B N V M C S E; do
    local D="$BASE/$B/$N/$V"
    local NODISCO=""
    [ -f "$D" ] && NODISCO=$(stat -c%s "$D" 2>/dev/null)
    # Objeto sem size no metadata (existe 1 na producao): basta o arquivo estar
    # la -- nao ha numero para comparar.
    if [ -n "$NODISCO" ] && { [ "$S" = "-" ] || [ "$NODISCO" = "$S" ]; }; then
      presentes=$((presentes+1)); bytes=$((bytes+NODISCO))
      getfattr -n user.supabase.content-type "$D" >/dev/null 2>&1 || semxattr=$((semxattr+1))
    else
      faltando=$((faltando+1))
      [ -n "${1:-}" ] && printf '%s/%s\n' "$B" "$N" >> "$TRABALHO/faltando.txt"
    fi
  done < "$LISTA"
  echo
  echo "  no disco com o tamanho certo : $presentes de $TOTAL"
  echo "  bytes no disco               : $((bytes/1024/1024)) MB de $((BYTES_ESPERADOS/1024/1024)) MB"
  echo "  faltando                     : $faltando"
  echo "  sem o xattr de content-type   : $semxattr"
}

if [ $SO_CONFERIR -eq 1 ]; then
  rm -f "$TRABALHO/faltando.txt"
  log "conferindo disco contra a producao (nada sera baixado)"
  confere listar
  [ -s "$TRABALHO/faltando.txt" ] && echo "  (os que faltam estao em $TRABALHO/faltando.txt)"
  exit 0
fi

# ── 3. a carga ─────────────────────────────────────────────────────────────
export SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY
ENTRADA="$LISTA"
if [ "$LIMITE" -gt 0 ]; then
  ENTRADA="$TRABALHO/recorte.tsv"
  head -n "$LIMITE" "$LISTA" > "$ENTRADA"
  log "ENSAIO: so os $LIMITE maiores objetos"
fi

INICIO=$(date +%s)
log "baixando com $PARALELO em paralelo -- destino $BASE"
# -I@ ja implica uma linha por chamada; nao combinar com -n, que brigaria com
# ele. A lista vem pelo -a para o stdin ficar livre.
xargs -a "$ENTRADA" -d '\n' -P "$PARALELO" -I@ bash "$0" --um "@"
FIM=$(date +%s)
rmdir "$TEMPORARIOS" 2>/dev/null || true

BAIXADOS=$(wc -l < "$CONTAGEM/baixados")
PULADOS=$(wc -l < "$CONTAGEM/pulados")
BYTES=$(awk '{s+=$1} END {print s+0}' "$CONTAGEM/baixados")
QFALHAS=0; [ -f "$FALHAS" ] && QFALHAS=$(wc -l < "$FALHAS")

echo
log "terminou em $((FIM-INICIO))s"
echo "  baixados agora : $BAIXADOS ($((BYTES/1024/1024)) MB)"
echo "  ja estavam la  : $PULADOS"
echo "  falharam       : $QFALHAS"
[ "$QFALHAS" -gt 0 ] && echo "  detalhe das falhas: $FALHAS"

# A conferencia roda sempre no fim: o relatorio que importa e o do disco, nao
# o do laco. Laco diz o que ele tentou; disco diz o que o ERP vai encontrar.
if [ "$LIMITE" -eq 0 ]; then
  log "conferindo o disco contra a producao"
  confere
fi

echo
echo "Proximo passo: levar para o outro no --"
echo "  bash /root/espelhar-anexos.sh    (ou esperar o timer de 1 minuto)"
