#!/usr/bin/env bash
# ============================================================================
#  Mantem a replica atualizada, de dentro do proprio container
# ============================================================================
#  POR QUE NAO UM CRON JOB SEPARADO NA RENDER
#  Porque custaria mais US$ 7/mes por um processo que roda 2 minutos por vez.
#  Rodando aqui dentro sai de graca - o container ja tem psql, pg_restore, gpg,
#  curl, jq e unzip.
#
#  POR QUE UM LOOP E NAO O cron DO SISTEMA
#  O cron NAO herda o ambiente do processo que o iniciou, e esse detalhe quebra
#  em silencio: o job roda e falha por falta de POSTGRES_PASSWORD. Um loop que
#  dorme ate a hora certa nao tem esse problema.
#
#  OS HORARIOS ACOMPANHAM O BACKUP, E ISSO NAO E DETALHE
#  A cadeia e:  producao -> backup -> artefato -> recarga da replica.
#  O elo mais LENTO define o atraso. Recarregar de hora em hora com backup de
#  12 em 12 nao adianta nada: a replica buscaria o MESMO arquivo 12 vezes.
#  Por isso estes horarios ficam 30 min depois dos do backup_storage.yml
#  (07, 10, 13, 16 e 20h de Brasilia = 10, 13, 16, 19 e 23h UTC) - tempo
#  suficiente para o backup terminar (leva 6 a 9 min) e publicar o artefato.
#
#  DESLIGADO POR PADRAO (RECARGA_AUTOMATICA != sim). Sem GITHUB_TOKEN e a
#  chave GPG configurados, ligar isto so geraria erro no log cinco vezes ao dia.
# ============================================================================
set -uo pipefail

# 10:30, 13:30, 16:30, 19:30 e 23:30 UTC = 07:30, 10:30, 13:30, 16:30 e 20:30
# de Brasilia. Formato: lista separada por virgula, em horas UTC.
HORAS_UTC="${RECARGA_HORAS_UTC:-10,13,16,19,23}"
MINUTO="${RECARGA_MINUTO:-30}"

log() { printf '[recarga %(%Y-%m-%d %H:%M:%S)T] %s\n' -1 "$*"; }

if [[ "${RECARGA_AUTOMATICA:-nao}" != "sim" ]]; then
  log "desligada (RECARGA_AUTOMATICA != sim). A replica tera a idade da ultima carga manual."
  # Dorme para sempre em vez de sair: saindo, o supervisor tentaria reiniciar
  # em loop e encheria o log de todo mundo.
  while true; do sleep 86400; done
fi

IFS=',' read -ra LISTA <<< "$HORAS_UTC"
log "ligada - recarga as ${HORAS_UTC//,/h, }h UTC (minuto $MINUTO)"

# --- qual o proximo horario da lista ----------------------------------------
proximo_alvo() {
  local agora menor=0 h candidato
  agora=$(date -u +%s)
  for h in "${LISTA[@]}"; do
    candidato=$(date -u -d "today ${h}:${MINUTO}" +%s 2>/dev/null) || continue
    (( candidato <= agora )) && candidato=$(date -u -d "tomorrow ${h}:${MINUTO}" +%s)
    if (( menor == 0 || candidato < menor )); then menor=$candidato; fi
  done
  echo "$menor"
}

while true; do
  alvo=$(proximo_alvo)
  if [[ -z "$alvo" || "$alvo" == "0" ]]; then
    log "ERRO: nao consegui calcular o proximo horario a partir de '$HORAS_UTC'. Tentando em 1h."
    sleep 3600
    continue
  fi
  espera=$(( alvo - $(date -u +%s) ))
  (( espera < 0 )) && espera=60
  log "proxima recarga em $(( espera / 3600 ))h $(( (espera % 3600) / 60 ))min  ($(date -u -d "@$alvo" '+%H:%M UTC'))"
  sleep "$espera"

  # --- a trava contra apagar o trabalho dos usuarios ------------------------
  # Se a replica virou producao (a Supabase caiu e o trafego veio para ca),
  # recarregar APAGARIA o que foi escrito aqui desde a promocao. Esta e a
  # primeira peca da protecao contra split-brain.
  if [[ -f /var/lib/postgresql/data/PROMOVIDA ]]; then
    log "ARQUIVO PROMOVIDA PRESENTE - esta replica esta servindo usuarios. Recarga CANCELADA."
    continue
  fi

  log "=== iniciando recarga ==="
  export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGDATABASE=postgres
  export PGPASSWORD="$POSTGRES_PASSWORD"
  if /usr/local/bin/recarga-render.sh 2>&1 | sed 's/^/[recarga] /'; then
    log "=== recarga concluida ==="
  else
    # Nao e motivo para parar o loop: a replica continua com os dados da carga
    # anterior, que e melhor que nada, e a proxima tentativa e daqui a 3 horas.
    log "=== RECARGA FALHOU - a replica segue com os dados anteriores ==="
  fi
done
