#!/bin/bash
# ============================================================================
#  Sincroniza as Edge Functions do REPOSITORIO para os dois nos do cluster.
#
#  POR QUE ISTO EXISTE
#  As Edge Functions do cluster sao um bind mount de `/opt/erp/supabase/
#  functions` no container `erp-pilha-functions-1`. Elas foram copiadas do
#  repositorio um dia e nunca mais -- nao ha nada que as mantenha em dia, e
#  nenhum conferidor olhava para elas.
#
#  Medido em 15/10/2026, com o cluster "pronto para a virada":
#    tvg-ia                    FALTANDO (nasceu em 14/10)
#    whatsapp-enviar           versao de 05/08  <- dois meses atras
#    whatsapp-template-enviar  versao de 26/08
#    whatsapp-webhook          versao de 18/08
#    dev-github-sync           versao de 09/10
#
#  Ou seja: na virada, o envio de WhatsApp teria subido com o codigo de agosto
#  e a TV Gerencial abriria sem a funcao de I.A. E nenhum numero reclamaria --
#  a mesma armadilha da secao 1.11 do roteiro, agora fora do banco.
#
#  O REPOSITORIO E A FONTE DA VERDADE. Ninguem edita function no no; o que
#  existe la e copia. Por isso este script copia num sentido so.
#
#  COMPARACAO IGNORA FIM DE LINHA. O repositorio tem CRLF e LF misturados por
#  arquivo (e o `md5sum` do Git Bash ainda escreve `hash *caminho`, com
#  asterisco, enquanto o do Linux escreve com dois espacos). Comparar os dois
#  crus acusa diferenca em arquivo identico -- ja me enganou uma vez hoje.
#
#  NUNCA APAGA. Function que existe no no e nao existe no repositorio e
#  reportada, nao removida -- mesma regra do espelho de anexos.
#
#  USO (Git Bash desta maquina, na pasta do projeto):
#    bash infra/ha/disparar-functions.sh              # so compara
#    bash infra/ha/disparar-functions.sh --aplicar    # copia e reinicia
# ============================================================================
set -uo pipefail

cd "$(dirname "$0")/../.."
ACAO="${1:---conferir}"
NOS="${NOS:-216.238.120.171 172.237.48.8}"
ORIGEM="supabase/functions"
DESTINO="/opt/erp/supabase/functions"

[ -d "$ORIGEM" ] || { echo "nao achei $ORIGEM -- rode da raiz do projeto" >&2; exit 1; }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# hash por arquivo, com fim de linha normalizado e formato identico dos dois
# lados (o `cut -d' ' -f1` descarta o caminho que cada md5sum formata do seu
# jeito).
(cd "$ORIGEM" && find . -type f | sed 's#^\./##' | sort | while read -r f; do
   printf '%s %s\n' "$(tr -d '\r' < "$f" | md5sum | cut -d' ' -f1)" "$f"
 done) > "$TMP/repo.txt"

echo "== repositorio: $(wc -l < "$TMP/repo.txt") arquivos em $(ls "$ORIGEM" | wc -l) pastas"

DIVERGIU=0
for NO in $NOS; do
  echo
  echo "── $NO ──"
  if ! ssh -p 8443 -o BatchMode=yes -o ConnectTimeout=10 "root@$NO" \
       "cd $DESTINO 2>/dev/null && find . -type f | sed 's#^\./##' | sort | while read -r f; do
          printf '%s %s\n' \"\$(tr -d '\r' < \"\$f\" | md5sum | cut -d' ' -f1)\" \"\$f\"
        done" > "$TMP/no.txt" 2>/dev/null; then
    echo "  nao alcancei o no (ou $DESTINO nao existe)"
    DIVERGIU=1; continue
  fi

  FALTA=$(comm -23 <(cut -d' ' -f2- "$TMP/repo.txt" | sort) <(cut -d' ' -f2- "$TMP/no.txt" | sort))
  SOBRA=$(comm -13 <(cut -d' ' -f2- "$TMP/repo.txt" | sort) <(cut -d' ' -f2- "$TMP/no.txt" | sort))
  MUDOU=$(join -j 2 <(sort -k2 "$TMP/repo.txt") <(sort -k2 "$TMP/no.txt") 2>/dev/null \
          | awk '$2!=$3{print $1}')

  [ -n "$FALTA" ] && { echo "  FALTANDO no no:"; echo "$FALTA" | sed 's/^/    /'; DIVERGIU=1; }
  [ -n "$MUDOU" ] && { echo "  CONTEUDO diferente (o repositorio manda):"; echo "$MUDOU" | sed 's/^/    /'; DIVERGIU=1; }
  [ -n "$SOBRA" ] && { echo "  so no no (NAO vou apagar, so reporto):"; echo "$SOBRA" | sed 's/^/    /'; }
  [ -z "$FALTA$MUDOU$SOBRA" ] && echo "  identico ao repositorio"

  if [ "$ACAO" = "--aplicar" ] && [ -n "$FALTA$MUDOU" ]; then
    echo "  copiando..."
    tar -C "$ORIGEM" -cf - . | ssh -p 8443 -o BatchMode=yes "root@$NO" \
      "mkdir -p $DESTINO && tar -C $DESTINO -xf -" || { echo "  FALHOU a copia"; continue; }
    # O edge-runtime le do disco a cada requisicao, mas reiniciar e barato e
    # tira a duvida de cache. O cluster nao atende ninguem.
    ssh -p 8443 -o BatchMode=yes "root@$NO" \
      "docker restart erp-pilha-functions-1 >/dev/null 2>&1 && sleep 3 &&
       docker ps --filter name=erp-pilha-functions-1 --format '    {{.Names}} {{.Status}}'"
  fi
done

if [ "$ACAO" != "--aplicar" ]; then
  echo
  if [ "$DIVERGIU" -ne 0 ]; then
    echo "Nada foi alterado. Para copiar:"
    echo "  bash infra/ha/disparar-functions.sh --aplicar"
    exit 1
  fi
  echo "Os dois nos estao iguais ao repositorio."
fi
exit 0
