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

# ONDE O STORAGE PROCURA: <raiz>/<balde>/<nome>/<versao>
#
# Levou varias tentativas ate medir isto direito. O storage-api NAO guarda em
# <raiz>/<balde>/<nome>: o "nome" vira um DIRETORIO, e o arquivo de verdade
# chama-se com o UUID da coluna storage.objects.version. Conferido em
# 05/10/2026 na propria tabela:
#
#     bucket_id = integration-uploads
#     name      = 5a61c769-.../d963bd54-...xlsx
#     version   = 90638add-08da-4b31-9049-67ea0b588b65
#
#   disco: <raiz>/integration-uploads/5a61c769-.../d963bd54-...xlsx/90638add-...
#
# E NAO HA TENANT no caminho. A tentativa anterior acrescentou "stub" (o
# TENANT_ID do ambiente) e os 8.936 arquivos continuaram invisiveis para o
# Storage, que seguia devolvendo HTTP 400.
#
# O backup traz os objetos como <balde>/<nome>; a etapa 3b converte cada um
# para o formato versionado, por rename - sem copiar e sem espaco extra.
#
# A validacao no fim deste script existe exatamente para isto: ela pergunta ao
# Storage se ele consegue servir um objeto real e avisa quando o layout nao
# bate, em vez de deixar passar como se tivesse dado certo.
# O CAMINHO COMPLETO, lido do proprio erro do storage-api em 05/10/2026:
#
#     ENOENT: stat '/var/lib/postgresql/data/storage/stub/stub/
#              integration-uploads/<nome>/90638add-...'
#
# e no mesmo log:  "tenantId":"stub"   "project":"stub"
#
#   <raiz>/<tenant>/<projeto>/<balde>/<nome>/<versao>
#
# Sao DOIS niveis antes do balde, nao um. A tentativa anterior colocou so o
# tenant e continuou dando erro; esta leitura veio do log do servico, que
# imprime o caminho exato que ele procurou - muito mais confiavel que deduzir.
TENANT="${TENANT_ID:-stub}"
RAIZ="${FILE_STORAGE_BACKEND_PATH:-/var/lib/postgresql/data/storage}"
DESTINO="$RAIZ/$TENANT/$TENANT"
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
# Com a cadeia (curl|funzip|gpg|tar) o unico consumo e o dos arquivos FINAIS,
# ~4,8 GB - nenhum intermediario toca o disco. O aviso usa 6 GB para dar
# alguma folga; antes disso, a carga nao vale a pena comecar.
livre_kb=$(df -Pk "$DESTINO" | awk 'NR==2{print $4}')
if (( livre_kb < 6 * 1024 * 1024 )); then
  log "ATENCAO: so $(( livre_kb / 1024 / 1024 )) GB livres, e os anexos somam ~4,8 GB."
  log "         seguindo mesmo assim - os incrementais pequenos devem caber."
fi

# --- 0b. aproveitar o que ja esta no disco ---------------------------------
# As tentativas anteriores deixaram os arquivos em dois lugares errados:
#
#   <raiz>/<balde>/...          (sem prefixo nenhum)
#   <raiz>/<tenant>/<balde>/... (com um nivel so)
#
# Os bytes estao certos - so o prefixo esta errado. MOVER e instantaneo
# (rename no mesmo sistema de arquivos) e evita rebaixar 4,8 GB.
mkdir -p "$DESTINO"
for origem_errada in "$RAIZ" "$RAIZ/$TENANT"; do
  [[ -d "$origem_errada" ]] || continue
  for balde in "$origem_errada"/*; do
    [[ -d "$balde" ]] || continue
    nome_balde="$(basename "$balde")"
    # nunca mover o proprio diretorio do tenant nem um destino ja correto
    [[ "$nome_balde" == "$TENANT" ]] && continue
    [[ "$balde" == "$DESTINO"* ]] && continue
    if [[ -d "$DESTINO/$nome_balde" ]]; then
      # ja existe no lugar certo: o errado e sobra
      log "removendo sobra: $balde"
      rm -rf "$balde"
    else
      log "movendo para o caminho certo: $nome_balde"
      mv "$balde" "$DESTINO/$nome_balde" 2>/dev/null || true
    fi
  done
done

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
# O descompactador de stream vive AQUI DENTRO, escrito em disco a cada
# execucao, e nao como arquivo proprio copiado pelo Dockerfile. De proposito:
# assim o script e autossuficiente e pode ser testado puxando SO ele do branch
# para dentro do container, antes de qualquer merge. Foi como esta carga passou
# a ser validada.
cat > "$TMP/desunzip.py" <<'PYZIP'
#!/usr/bin/env python3
# Extrai o PRIMEIRO membro de um zip lido da entrada padrao para a saida
# padrao. Substitui o funzip, que nao trata ZIP64 e por isso falhava no
# artefato completo de 4,8 GB.
import sys, struct, zlib

ent = sys.stdin.buffer
sai = sys.stdout.buffer
BLOCO = 1 << 20

assinatura = ent.read(4)
if assinatura != b'PK\x03\x04':
    sys.stderr.write('nao parece um zip (assinatura %r)\n' % assinatura)
    sys.exit(3)

cabecalho = ent.read(26)
if len(cabecalho) < 26:
    sys.stderr.write('cabecalho do zip truncado\n')
    sys.exit(3)

(_versao, bandeiras, metodo, _hora, _data,
 _crc, _tam_comprimido, tam_original,
 tam_nome, tam_extra) = struct.unpack('<HHHHHIIIHH', cabecalho)

ent.read(tam_nome)
ent.read(tam_extra)

# Bandeira 0x08: os tamanhos reais vem DEPOIS dos dados, num descritor. Para
# deflate isso nao importa (zlib detecta o fim do stream), mas para "armazenado"
# ficaria impossivel saber onde os dados terminam.
tamanhos_desconhecidos = bool(bandeiras & 0x08)

try:
    if metodo == 0:
        if tamanhos_desconhecidos or tam_original == 0:
            sys.stderr.write('membro armazenado sem tamanho conhecido\n')
            sys.exit(3)
        restante = tam_original
        while restante > 0:
            pedaco = ent.read(min(BLOCO, restante))
            if not pedaco:
                sys.stderr.write('stream terminou antes do fim do membro\n')
                sys.exit(3)
            sai.write(pedaco)
            restante -= len(pedaco)
    elif metodo == 8:
        inflador = zlib.decompressobj(-15)
        while True:
            pedaco = ent.read(BLOCO)
            if not pedaco:
                break
            sai.write(inflador.decompress(pedaco))
            if inflador.eof:
                break
        sai.write(inflador.flush())
    else:
        sys.stderr.write('metodo de compressao %d nao suportado\n' % metodo)
        sys.exit(3)
    sai.flush()
except BrokenPipeError:
    # gpg ou tar fecharam antes. Quem reporta o erro de verdade e eles.
    sys.exit(0)
PYZIP

extraidos=0
while IFS='|' read -r id nome tamanho; do
  [[ -z "$id" ]] && continue
  log "  $nome ($(( tamanho / 1048576 )) MB)"
  antes_deste=$(find "$DESTINO" -type f 2>/dev/null | wc -l)

  # TUDO EM CADEIA, SEM ARQUIVO INTERMEDIARIO
  #
  # A versao anterior baixava o zip (5,1 GB), extraia o .tar.gpg (4,8 GB) e so
  # entao decifrava - precisando de ~15 GB de espaco temporario. Em 05/10/2026
  # isso estourou o disco de 20 GB, com a mensagem
  #     unzip: write error (disk full?)
  #     python3: [Errno 28] No space left on device
  #     livre no disco: 48K
  # porque o pgdata havia crescido para 12 GB (restores repetidos incham o
  # banco) e sobravam apenas 8,2 GB.
  #
  # Transmitindo em cadeia, nada disso toca o disco: so os arquivos finais
  # (~4,8 GB) sao gravados, e cabem com folga.
  #
  #   curl  ->  desunzip.py  ->  gpg  ->  tar
  #
  # POR QUE NAO funzip
  # Porque ele NAO abre o artefato completo. Medido em 05/10/2026, com 3 GB
  # livres (ou seja, nao era disco):
  #     funzip: funzip error: invalid compressed data--len
  # funzip nao trata ZIP64, e um artefato de 4,8 GB obriga ZIP64. O efeito era
  # grave e silencioso: os incrementais (pequenos) passavam, o completo falhava,
  # e como a replica JA tinha os arquivos no disco ninguem notava. Numa replica
  # VAZIA - exatamente o caso de desastre - nao teria entrado nada.
  #
  # desunzip.py faz o mesmo papel sem a limitacao: le o cabecalho local do
  # primeiro membro e infla com zlib, em blocos, sem nunca precisar buscar no
  # stream (o que descarta zipfile, que exige arquivo buscavel). bsdtar e 7z
  # nao existem nesta imagem; python3 existe.
  #
  # --strip-components=1 remove o prefixo "arquivos/" com que o backup foi
  # criado, para os objetos caírem direto em <destino>/<balde>/...
  : > "$TMP/curl.err"; : > "$TMP/desunzip.err"; : > "$TMP/gpg.err"; : > "$TMP/tar.err"
  if curl -sS -L -m 3600 -H "Authorization: Bearer $GITHUB_TOKEN" \
       "https://api.github.com/repos/$REPO/actions/artifacts/$id/zip" 2>"$TMP/curl.err" \
     | python3 "$TMP/desunzip.py" 2>"$TMP/desunzip.err" \
     | gpg --batch --quiet --pinentry-mode loopback \
           --passphrase "$GPG_PASSPHRASE" --decrypt 2>"$TMP/gpg.err" \
     | tar -xf - -C "$DESTINO" --strip-components=1 2>"$TMP/tar.err"
  then
    depois_deste=$(find "$DESTINO" -type f 2>/dev/null | wc -l)
    n=$(( depois_deste - antes_deste ))
    extraidos=$(( extraidos + n ))
    log "    $n arquivo(s) novo(s)   livre: $(df -h "$DESTINO" | awk 'NR==2{print $4}')"
  else
    # FALHA TOTAL E FALHA PARCIAL NAO SAO A MESMA COISA.
    #
    # O tar sai != 0 se UM unico nome deu problema, mesmo tendo gravado todos
    # os outros. Dizer so "falhou" nesse caso manda investigar rede, chave e
    # zip quando o que houve foi conflito de um objeto - aconteceu aqui, e
    # mascarou o problema de layout por varias rodadas. Por isso contamos
    # quantos arquivos entraram ANTES de chamar a cadeia de falha.
    depois_deste=$(find "$DESTINO" -type f 2>/dev/null | wc -l)
    n=$(( depois_deste - antes_deste ))
    extraidos=$(( extraidos + n ))
    if (( n > 0 )); then
      log "    PARCIAL: $n arquivo(s) entraram, mas a cadeia reportou erro:"
    else
      log "    falhou nesta cadeia, nenhum arquivo entrou:"
    fi
    # Cada etapa reporta o proprio erro. Sem isto, "falhou" nao diz se foi
    # rede, zip, chave, senha ou disco - e foi o que me custou tres rodadas.
    for etapa in curl desunzip gpg tar; do
      [[ -s "$TMP/$etapa.err" ]] && log "      $etapa: $(tail -2 "$TMP/$etapa.err" | tr '\n' ' ')"
    done
    log "      livre no disco: $(df -h "$DESTINO" | awk 'NR==2{print $4}')"
    continue
  fi
done <<< "$lista"

# --- 3b. cada objeto vira <nome>/<versao> ----------------------------------
# O backup guarda os objetos como <balde>/<nome> (um arquivo). O storage-api
# espera <balde>/<nome>/<versao>, onde <nome> e um DIRETORIO e o arquivo real
# se chama com o UUID de storage.objects.version.
#
# A conversao e por RENAME, no mesmo sistema de arquivos: nao copia nada e nao
# precisa de espaco extra - o que importa num disco que ja chegou a 48K livres.
#
# A fonte da verdade e o BANCO, nao um palpite sobre o formato: a versao de
# cada objeto vem de storage.objects. Objeto sem versao e pulado.
#
# O separador e | porque nome de arquivo nao contem | (contem espaco, acento e
# parenteses, que quebrariam uma leitura ingenua).
log "Convertendo os objetos para <nome>/<versao> (formato do Storage)..."
convertidos=0
ja_ok=0
sem_versao=0
# Sem 2>/dev/null: psql calado aqui significa ZERO objetos convertidos, e o
# sintoma seria um 500 no download sem nenhuma pista no log desta carga.
psql -At -c "select bucket_id || '|' || name || '|' || coalesce(version,'') from storage.objects where bucket_id is not null and name is not null" \
  > "$TMP/objetos.txt" 2>"$TMP/psql-obj.err" \
  || log "  ATENCAO: psql falhou: $(tail -1 "$TMP/psql-obj.err" 2>/dev/null)"
while IFS='|' read -r balde nome versao; do
  [[ -z "$balde" || -z "$nome" ]] && continue
  if [[ -z "$versao" ]]; then sem_versao=$(( sem_versao + 1 )); continue; fi
  alvo="$DESTINO/$balde/$nome"
  # Ja convertido numa execucao anterior.
  if [[ -d "$alvo" && -f "$alvo/$versao" ]]; then ja_ok=$(( ja_ok + 1 )); continue; fi
  # Ainda no formato do backup: <nome> e um arquivo comum.
  if [[ -f "$alvo" ]]; then
    mv "$alvo" "$alvo.__conv" 2>/dev/null || continue
    mkdir -p "$alvo" 2>/dev/null
    mv "$alvo.__conv" "$alvo/$versao" 2>/dev/null && convertidos=$(( convertidos + 1 ))
  fi
done < "$TMP/objetos.txt"
rm -f "$TMP/objetos.txt"
log "  convertidos: $convertidos   ja estavam: $ja_ok   sem versao: $sem_versao"

# --- 3c. o tipo do arquivo mora num ATRIBUTO ESTENDIDO, nao no banco --------
# Este foi o ULTIMO erro da cadeia, e o mais escondido de todos. Com o caminho
# certo e os bytes certos no lugar certo, o download AINDA devolvia 500:
#
#     {"code":"ENODATA","errno":61}
#     "The extended attribute does not exist."
#
# O storage-api com STORAGE_BACKEND=file nao guarda o content-type no banco:
# ele grava DOIS atributos estendidos no proprio arquivo e os le de volta a
# cada GET (conferido em /opt/storage/dist em 05/10/2026):
#
#     user.supabase.content-type
#     user.supabase.cache-control
#
# O tar NAO carrega xattr por padrao, entao todo arquivo restaurado chega sem
# eles - e sem o content-type o GET morre antes de enviar um unico byte. E o
# erro nao diz nada sobre arquivo: diz "atributo estendido", num GET que o
# usuario fez de um .xlsx. Foi preciso ler o log do servico para achar.
#
# POR QUE python3 E NAO setfattr
# setfattr (pacote attr) NAO existe nesta imagem - conferido no container.
# python3 existe e tem os.setxattr na biblioteca padrao, sem instalar nada.
#
# POR QUE O VALOR VEM DO BANCO
# Porque e o mimetype que a producao gravou no upload. Adivinhar pela extensao
# daria "application/octet-stream" em metade dos anexos, e o navegador baixaria
# arquivo em vez de abrir imagem.
if command -v python3 >/dev/null 2>&1; then
  log "Marcando o tipo de cada arquivo (atributo estendido)..."
  psql -At -c "select bucket_id || '|' || name || '|' || coalesce(version,'') || '|' || coalesce(metadata->>'mimetype','application/octet-stream') || '|' || coalesce(metadata->>'cacheControl','max-age=3600') from storage.objects where bucket_id is not null and name is not null and version is not null" \
    > "$TMP/metadados.txt" 2>"$TMP/psql-meta.err" \
    || log "  ATENCAO: psql falhou: $(tail -1 "$TMP/psql-meta.err" 2>/dev/null)"
  python3 - "$DESTINO" "$TMP/metadados.txt" <<'PY' || log "  ATENCAO: python3 falhou ao marcar os atributos"
import os, sys

destino, lista = sys.argv[1], sys.argv[2]
marcados = ausentes = erros = 0

with open(lista, encoding='utf-8', errors='surrogateescape') as f:
    for linha in f:
        partes = linha.rstrip('\n').split('|')
        if len(partes) < 5:
            continue
        # O nome pode conter '|'; balde/versao/tipo/cache nunca contem. Por
        # isso o nome e o que sobra no meio, nao partes[1].
        balde = partes[0]
        nome = '|'.join(partes[1:-3])
        versao, tipo, cache = partes[-3], partes[-2], partes[-1]
        caminho = os.path.join(destino, balde, nome, versao)
        if not os.path.isfile(caminho):
            ausentes += 1
            continue
        try:
            os.setxattr(caminho, 'user.supabase.content-type', tipo.encode('utf-8'))
            os.setxattr(caminho, 'user.supabase.cache-control', cache.encode('utf-8'))
            marcados += 1
        except OSError as e:
            erros += 1
            if erros == 1:
                print('  primeiro erro de xattr: %s' % e, flush=True)

print('  marcados: %d   sem arquivo no disco: %d   falharam: %d'
      % (marcados, ausentes, erros), flush=True)
PY
  rm -f "$TMP/metadados.txt" "$TMP/psql-meta.err"
else
  log "ATENCAO: python3 ausente - nao consigo gravar o content-type nos arquivos."
  log "         Sem isso o Storage devolve 500 (ENODATA) em TODO download."
fi

# --- 4. o dono precisa ser o do Storage -------------------------------------
# Extraido como root, o storage-api (que roda como outro usuario) nao leria.
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
