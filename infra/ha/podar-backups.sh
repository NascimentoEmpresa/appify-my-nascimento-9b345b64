#!/bin/bash
# ============================================================================
#  Apaga do no os backups que JA ESTAO no servidor da empresa. Roda como root
#  nos dois nos, todo dia (timer), depois do puxar-backups do servidor local.
#
#  POR QUE (18/11/2026): disco do banco2 em 91%, 16 GB em
#  /var/backups/erp-cluster. O servidor da empresa (servidornascimento2) puxa
#  os .gpg e devolve um recibo "nome tamanho sha256" em
#  /var/backups/erp-cluster-recibos/. Ver infra/servidor-local/puxar-backups.sh.
#
#  REGRA -- so apaga quando TUDO isto vale:
#    - existe recibo para o arquivo, e o tamanho do recibo = tamanho daqui
#      (copia parcial ou arquivo que ainda crescia nao confere);
#    - banco (erp-cluster-*): tem mais de $DIAS dias (padrao 3) -- os ultimos
#      dias ficam sempre aqui, para restaurar rapido sem depender da empresa;
#    - anexos: nunca o mais novo.
#  Sem recibo, nada muda: vale a retencao antiga do backup-cluster.sh (14 dias
#  de banco, 2 copias de anexos). O pior caso de o servidor da empresa parar
#  e o disco voltar a encher devagar -- nunca perder backup.
#
#  Uso:  bash podar-backups.sh [--simular]   |   --instalar (timer diario)
#  Log:  journalctl -t podar-backups
# ============================================================================
set -uo pipefail
export LC_ALL=C

DIR="${DIR:-/var/backups/erp-cluster}"
REC="${REC:-/var/backups/erp-cluster-recibos}"
DIAS="${DIAS:-3}"
ACAO="${1:-}"

log() { logger -t podar-backups -- "$*"; echo "$*"; }

if [ "$ACAO" = "--instalar" ]; then
  install -m 0755 "$0" /usr/local/sbin/podar-backups.sh
  cat > /etc/systemd/system/podar-backups.service <<'UNIT'
[Unit]
Description=Apaga backups ja confirmados no servidor da empresa (recibo)

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/podar-backups.sh
UNIT
  cat > /etc/systemd/system/podar-backups.timer <<'UNIT'
[Unit]
Description=Poda dos backups confirmados, todo dia

[Timer]
OnCalendar=*-*-* 11:30:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now podar-backups.timer
  systemctl list-timers podar-backups.timer --no-pager | sed -n 2p
  exit 0
fi

[ -d "$REC" ] || { log "sem pasta de recibos ($REC) -- nada a fazer"; exit 0; }
AGORA=$(date +%s)
ANEXO_MAIS_NOVO=$(ls -t "$DIR"/anexos-*.gpg 2>/dev/null | head -1)
APAGADOS=0; LIBERADO=0

for F in "$DIR"/*.gpg; do
  [ -e "$F" ] || continue
  N=$(basename "$F"); R="$REC/$N.ok"
  [ -f "$R" ] || continue
  # O recibo vem de fora: le so tres campos, compara, nunca executa nada.
  read -r RN RT RS < "$R" || continue
  T=$(stat -c %s "$F")
  if [ "$RN" != "$N" ] || [ "$RT" != "$T" ]; then
    log "recibo de $N nao confere (aqui $T bytes, recibo ${RT:-?}) -- mantido"; continue
  fi
  case "$N" in
    anexos-*)      [ "$F" = "$ANEXO_MAIS_NOVO" ] && continue ;;
    erp-cluster-*) [ $(( (AGORA - $(stat -c %Y "$F")) / 86400 )) -ge "$DIAS" ] || continue ;;
    *)             continue ;;
  esac
  if [ "$ACAO" = "--simular" ]; then
    echo "apagaria: $N ($((T / 1048576)) MB)"
  else
    rm -f "$F"; log "apagado (confirmado no servidor da empresa): $N"
  fi
  APAGADOS=$((APAGADOS + 1)); LIBERADO=$((LIBERADO + T))
done

# Recibo de arquivo que nao existe mais aqui nao serve para nada.
[ "$ACAO" = "--simular" ] || for R in "$REC"/*.ok; do
  [ -e "$R" ] || continue
  [ -e "$DIR/$(basename "$R" .ok)" ] || rm -f "$R"
done

# O servidor da empresa parou de confirmar? Nao e urgente (nada se perde),
# mas o disco volta a encher -- fica registrado.
MAIS_NOVO=$(ls -t "$REC"/*.ok 2>/dev/null | head -1)
if [ -n "$MAIS_NOVO" ]; then
  H=$(( (AGORA - $(stat -c %Y "$MAIS_NOVO")) / 3600 ))
  [ "$H" -gt 48 ] && log "ATENCAO: o servidor da empresa nao confirma backup ha ${H}h"
fi
log "$APAGADOS arquivo(s), $((LIBERADO / 1048576)) MB $([ "$ACAO" = "--simular" ] && echo 'seriam liberados' || echo 'liberados')"
exit 0
