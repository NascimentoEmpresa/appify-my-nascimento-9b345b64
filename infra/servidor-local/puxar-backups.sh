#!/bin/bash
# ============================================================================
#  Puxa os backups cifrados do cluster (banco1 e banco2) para o servidor da
#  empresa (servidornascimento2, 192.168.100.59) e devolve um RECIBO de cada
#  arquivo recebido. Roda como `erpcopia`, todo dia, por um timer do systemd.
#
#  POR QUE EXISTE (18/11/2026)
#  O disco do banco2 chegou a 91% (49 GB, 16 GB so de backup). A regra do
#  Eduardo: o que e antigo sai da nuvem e fica no servidor fisico da empresa.
#  Ver docs/incidentes/2026-11-13-api-banco1-fora.md (disco do banco2).
#
#  POR QUE O SERVIDOR DA EMPRESA PUXA, E NAO A NUVEM EMPURRA
#  - Nao precisa abrir porta nenhuma no roteador da empresa.
#  - Um no da nuvem comprometido nao alcanca a rede interna.
#  - A saida pela 8443 e liberada na rede da empresa (a 22 nao e).
#  As chaves usadas aqui sao RESTRITAS no `erpbackup` de cada no:
#    leitura  -> `rrsync -ro /var/backups/erp-cluster`   (so le os .gpg)
#    recibos  -> `rrsync -wo /var/backups/erp-cluster-recibos` (so escreve recibo)
#  Nenhuma das duas abre shell.
#
#  O QUE CHEGA E CIFRADO. Os .gpg so abrem com a chave privada do Eduardo,
#  que NAO esta neste servidor (nem nos nos). Restaurar: docs/restaurar-backup.md.
#
#  RECIBO = "nome tamanho sha256". O `podar-backups.sh` dos nos so apaga um
#  arquivo da nuvem se existir recibo com o MESMO tamanho do arquivo de la --
#  ou seja, nada sai da nuvem sem estar aqui inteiro.
#
#  Retencao AQUI: banco diario por 365 dias; anexos (semanal, ~8 GB) os 12
#  mais novos de cada no. Sem `--delete` no rsync: o que a nuvem apaga
#  continua aqui.
#
#  Log: /dados/erp/logs/puxar-backups.log  (e journalctl -u puxar-backups)
# ============================================================================
set -uo pipefail
export LC_ALL=C
cd /   # rodando por `sudo -u erpcopia` de outra pasta, o `find` reclamava do diretorio

BASE="${BASE:-/dados/erp}"
LOG="$BASE/logs/puxar-backups.log"
GUARDAR_BANCO_DIAS="${GUARDAR_BANCO_DIAS:-365}"
GUARDAR_ANEXOS="${GUARDAR_ANEXOS:-12}"
declare -A IP=([banco1]=216.238.120.171 [banco2]=172.237.48.8)
CHAVES="${CHAVES:-/var/lib/erpcopia/.ssh}"
# Limite de banda em KB/s (0 = sem limite). O timer roda as 05:00 BRT, fora do
# expediente: a primeira carga sao ~32 GB, e a internet da empresa e a mesma
# por onde os usuarios usam o ERP. Para rodar de dia: BWLIMIT=5000.
BWLIMIT="${BWLIMIT:-0}"
# Teste: so os arquivos que casam com o padrao, ex. SO="erp-cluster-20261118-*"
SO="${SO:-}"
FILTRO=(); [ -n "$SO" ] && FILTRO=(--include="$SO" --exclude="*")

log() { echo "$(date '+%F %T') $*" | tee -a "$LOG"; }
ssh_com() { echo "ssh -p 8443 -i $CHAVES/$1 -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ConnectTimeout=20"; }

FALHOU=0
log "=== inicio"
for NO in banco1 banco2; do
  DESTINO="$BASE/backups/$NO"; RECIBOS="$BASE/recibos/$NO"
  mkdir -p "$DESTINO" "$RECIBOS"

  # 1. copiar. --partial-dir: transferencia cortada continua de onde parou.
  if ! rsync -a --partial-dir=.parcial --timeout=900 --bwlimit="$BWLIMIT" "${FILTRO[@]}" -e "$(ssh_com leitura)" \
         "erpbackup@${IP[$NO]}:./" "$DESTINO/" 2>>"$LOG"; then
    log "$NO: FALHOU a copia -- nenhum recibo enviado, a nuvem nao apaga nada"
    FALHOU=1; continue
  fi

  # 2. recibo de cada .gpg (o sha256 so e recalculado se o tamanho mudou).
  NOVOS=0
  for F in "$DESTINO"/*.gpg; do
    [ -e "$F" ] || continue
    N=$(basename "$F"); T=$(stat -c %s "$F"); R="$RECIBOS/$N.ok"
    if [ ! -f "$R" ] || [ "$(cut -d' ' -f2 "$R")" != "$T" ]; then
      echo "$N $T $(sha256sum "$F" | cut -d' ' -f1)" > "$R"; NOVOS=$((NOVOS+1))
    fi
  done

  # 3. devolver os recibos (so os de arquivos que ainda existem aqui).
  if rsync -a --timeout=300 -e "$(ssh_com recibos)" "$RECIBOS/" "erpbackup@${IP[$NO]}:./" 2>>"$LOG"; then
    log "$NO: ok -- $(ls "$DESTINO"/*.gpg 2>/dev/null | wc -l) arquivos aqui, $NOVOS recibo(s) novo(s)"
  else
    log "$NO: copia ok, mas FALHOU devolver recibos (a nuvem so nao apaga ainda)"
    FALHOU=1
  fi

  # 4. retencao local.
  find "$DESTINO" -maxdepth 1 -name 'erp-cluster-*.gpg' -mtime +"$GUARDAR_BANCO_DIAS" -print -delete \
    | while read -r V; do log "$NO: apagado por idade (> $GUARDAR_BANCO_DIAS dias): $(basename "$V")"; rm -f "$RECIBOS/$(basename "$V").ok"; done
  ls -t "$DESTINO"/anexos-*.gpg 2>/dev/null | tail -n +$((GUARDAR_ANEXOS + 1)) | while read -r V; do
    log "$NO: apagado (mais de $GUARDAR_ANEXOS copias de anexos): $(basename "$V")"
    rm -f "$V" "$RECIBOS/$(basename "$V").ok"
  done
done

USO=$(df --output=pcent "$BASE" | tail -1 | tr -dc 0-9)
[ "$USO" -ge 85 ] && log "ATENCAO: /dados com ${USO}% de uso"
log "=== fim (uso de /dados: ${USO}%)"
exit $FALHOU
