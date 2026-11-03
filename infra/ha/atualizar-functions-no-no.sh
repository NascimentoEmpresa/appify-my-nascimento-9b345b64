#!/usr/bin/env bash
# ============================================================================
#  O NO PUXA AS EDGE FUNCTIONS DO REPOSITORIO, SOZINHO
#
#  O PROBLEMA QUE ISTO RESOLVE
#  Na Supabase, a Edge Function subia junto com o deploy. No cluster ela e um
#  *bind mount* de `/opt/erp/supabase/functions` -- se ninguem copiar, o
#  frontend novo chama uma funcao velha. Em 15/10/2026 quatro functions
#  estavam na versao de agosto e nenhum conferidor olhava para elas.
#
#  Depois da virada isso vira um problema de ROTINA: todo dia um dev mergeia
#  uma PR. Se a atualizacao depender de alguem lembrar de rodar um script, ela
#  vai falhar numa terca-feira qualquer, e o dev vai descobrir pelo usuario.
#
#  POR QUE O NO PUXA, EM VEZ DE O CI EMPURRAR
#  Empurrar exigiria uma chave SSH com permissao de ESCRITA nos nos guardada
#  no GitHub. Puxar nao exige nada: o repositorio e publico, o no baixa por
#  HTTPS e a chave restrita do CI so serve para DISPARAR isto -- ela nao
#  carrega conteudo nenhum.
#
#  O que vem e sempre o `main`: codigo que passou pela portaria e pelo merge.
#
#  O QUE ELE NAO FAZ
#  Nao apaga function que existe so no no (reporta), nao toca em banco, nao
#  mexe em migration. Edge Function e arquivo; migration e DDL, e DDL nao se
#  aplica sozinho -- ver a secao do roteiro sobre o fluxo dos devs.
#
#  USO (no no, normalmente chamado pelo CI)
#    /usr/local/sbin/atualizar-functions.sh
#    /usr/local/sbin/atualizar-functions.sh --conferir
# ============================================================================
set -uo pipefail

REPO="${REPO:-https://github.com/NascimentoEmpresa/appify-my-nascimento-9b345b64.git}"
RAMO="${RAMO:-main}"
TRABALHO="${TRABALHO:-/opt/erp-repo}"
DESTINO="${DESTINO:-/opt/erp/supabase}"
ACAO="${1:-}"

log() { echo "[$(date +%H:%M:%S)] $*"; }

command -v git >/dev/null || { echo "git nao instalado neste no" >&2; exit 1; }
[ -d "$DESTINO/functions" ] || { echo "$DESTINO/functions nao existe -- a pilha subiu aqui?" >&2; exit 1; }

# Clone raso: so a ultima versao, sem historico. Sao ~40 MB em vez de 1 GB.
if [ -d "$TRABALHO/.git" ]; then
  git -C "$TRABALHO" remote set-url origin "$REPO"
  git -C "$TRABALHO" fetch --depth 1 origin "$RAMO" --quiet || { echo "falhou o fetch" >&2; exit 1; }
  git -C "$TRABALHO" reset --hard "origin/$RAMO" --quiet || exit 1
else
  rm -rf "$TRABALHO"
  git clone --depth 1 --branch "$RAMO" --quiet "$REPO" "$TRABALHO" || { echo "falhou o clone" >&2; exit 1; }
fi
COMMIT=$(git -C "$TRABALHO" rev-parse --short HEAD)
log "repositorio em $COMMIT ($RAMO)"

ORIGEM="$TRABALHO/supabase/functions"
[ -d "$ORIGEM" ] || { echo "o repositorio nao tem supabase/functions" >&2; exit 1; }

# Quantas existem de cada lado, e o que difere. Comparacao com fim de linha
# normalizado: o repositorio tem CRLF e LF misturados por arquivo, e comparar
# cru acusa diferenca em arquivo identico.
DIF=0; NOVAS=0
while IFS= read -r F; do
  REL=${F#"$ORIGEM/"}
  if [ ! -f "$DESTINO/functions/$REL" ]; then NOVAS=$((NOVAS+1)); DIF=$((DIF+1)); continue; fi
  A=$(tr -d '\r' < "$F" | md5sum | cut -d' ' -f1)
  B=$(tr -d '\r' < "$DESTINO/functions/$REL" | md5sum | cut -d' ' -f1)
  [ "$A" = "$B" ] || DIF=$((DIF+1))
done < <(find "$ORIGEM" -type f)
TOTAL=$(find "$ORIGEM" -type f | wc -l)
log "$TOTAL arquivos no repositorio, $DIF diferentes aqui ($NOVAS novos)"

# So no no, nunca no repositorio: reporta, nao apaga. Apagar o que nao
# entendemos e como se perde function que alguem subiu a mao numa emergencia.
SOBRANDO=$(comm -13 <(cd "$ORIGEM" && find . -type f | LC_ALL=C sort) \
                    <(cd "$DESTINO/functions" && find . -type f | LC_ALL=C sort) | grep -c . || true)
[ "$SOBRANDO" -gt 0 ] && log "AVISO: $SOBRANDO arquivo(s) existem so no no -- nao vou apagar"

if [ "$ACAO" = "--conferir" ] || [ "$DIF" = "0" ]; then
  [ "$DIF" = "0" ] && log "nada a fazer: ja esta igual ao $RAMO"
  exit 0
fi

log "copiando"
rsync -a --delete-excluded --exclude='.*' "$ORIGEM/" "$DESTINO/functions/" || exit 1
[ -f "$TRABALHO/supabase/config.toml" ] && cp -f "$TRABALHO/supabase/config.toml" "$DESTINO/config.toml"

log "reiniciando o runtime"
# `docker restart`, e nao `docker compose up -d functions`: o `up -d` so
# recria o container se a DEFINICAO do servico mudou -- com o mesmo compose,
# ele nao faz nada e o roteador (infra/failover/functions-main) continua com o
# config.toml que leu no boot. Foi assim em 29/10/2026 (SIS-2026-0786): a
# function nova `dev-github-pr-registrar`, com verify_jwt = false, chegou nos
# dois nos e mesmo assim respondia "JWT invalido ou ausente" ao CI. Function
# protegida nao sentia o defeito; so as publicas novas (CI, webhook, Etica).
docker restart erp-pilha-functions-1 >/dev/null 2>&1
sleep 6
EST=$(docker inspect -f '{{.State.Status}}' erp-pilha-functions-1 2>/dev/null)
log "container: $EST"
[ "$EST" = "running" ] || { echo "o runtime nao subiu" >&2; exit 1; }
log "pronto, em $COMMIT"
