#!/usr/bin/env bash
# ============================================================================
#  Mantem a replica atualizada, de dentro do proprio container
# ============================================================================
#  POR QUE NAO UM CRON JOB SEPARADO NA RENDER
#  Porque custaria mais US$ 7/mes por um processo que roda 2 minutos por dia.
#  Rodando aqui dentro, sai de graca - e o container ja tem tudo de que ele
#  precisa (psql, pg_restore, gpg, curl, jq, unzip).
#
#  POR QUE UM LOOP E NAO O cron DO SISTEMA
#  O cron precisaria de mais um daemon no supervisord e de um jeito de levar as
#  variaveis de ambiente ate ele - o cron NAO herda o ambiente do processo que
#  o iniciou, e esse detalhe quebra em silencio (o job roda e falha por falta de
#  POSTGRES_PASSWORD). Um loop que dorme ate a hora certa nao tem esse problema.
#
#  HORARIO: 06:00 UTC = 03:00 em Brasilia. O backup do workflow sai as 09:00 e
#  21:00 UTC, entao as 06:00 pegamos o das 21:00 do dia anterior, ja pronto.
#  E e o horario de menor uso, caso a carga pese.
#
#  DESLIGADO POR PADRAO (RECARGA_AUTOMATICA != sim). Enquanto nao houver
#  GITHUB_TOKEN e a chave GPG configurados, ligar isto so geraria erro no log
#  todo dia as 3 da manha.
# ============================================================================
set -uo pipefail

HORA_ALVO="${RECARGA_HORA_UTC:-6}"

log() { printf '[recarga %(%Y-%m-%d %H:%M:%S)T] %s\n' -1 "$*"; }

if [[ "${RECARGA_AUTOMATICA:-nao}" != "sim" ]]; then
  log "desligada (RECARGA_AUTOMATICA != sim). A replica tera a idade da ultima carga manual."
  # Dorme para sempre em vez de sair: saindo, o supervisor tentaria reiniciar
  # em loop e encheria o log.
  while true; do sleep 86400; done
fi

log "ligada - recarga diaria as ${HORA_ALVO}:00 UTC"

while true; do
  agora=$(date -u +%s)
  # proxima ocorrencia do horario alvo, em UTC
  alvo=$(date -u -d "today ${HORA_ALVO}:00" +%s)
  (( alvo <= agora )) && alvo=$(date -u -d "tomorrow ${HORA_ALVO}:00" +%s)
  espera=$(( alvo - agora ))
  log "proxima recarga em $(( espera / 3600 ))h $(( (espera % 3600) / 60 ))min"
  sleep "$espera"

  log "=== iniciando recarga ==="
  # A trava PROMOVIDA: se a replica virou producao (a Supabase caiu e o trafego
  # veio para ca), recarregar APAGARIA o que os usuarios escreveram.
  if [[ -f /var/lib/postgresql/data/PROMOVIDA ]]; then
    log "ARQUIVO PROMOVIDA PRESENTE - esta replica esta servindo usuarios. Recarga CANCELADA."
    continue
  fi

  export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGDATABASE=postgres
  export PGPASSWORD="$POSTGRES_PASSWORD"
  if /usr/local/bin/recarga-render.sh 2>&1 | sed 's/^/[recarga] /'; then
    log "=== recarga concluida ==="
  else
    log "=== RECARGA FALHOU - a replica continua com os dados anteriores ==="
  fi
done
