#!/bin/bash
# ============================================================================
#  Vigia da pilha da API (Kong/Auth/REST/Storage/Functions). Roda nos DOIS
#  nos, a cada 2 min, por um timer do systemd.
#
#  POR QUE EXISTE (incidente de 13/11/2026)
#  O needrestart derrubou o containerd do banco1 as 04:00 BRT; o Docker voltou
#  em 17 s e a pilha NAO voltou junto. Ficou ~5 h parada ate alguem olhar.
#  Desde 17/11 a politica e `restart: always` e o docker/containerd sairam do
#  needrestart -- este vigia e a terceira camada, para o caso que as duas
#  primeiras nao cobrirem (container que o daemon nao religou, `docker stop`
#  esquecido depois de uma manutencao).
#  Ver docs/incidentes/2026-11-13-api-banco1-fora.md.
#
#  O QUE ELE FAZ -- e so isto:
#    - se o Docker estiver de pe e algum container do projeto `erp-pilha`
#      estiver parado, faz `docker start` nele (Kong por ultimo).
#  O QUE ELE NUNCA FAZ:
#    - recriar container, `compose up`, `down`, `rm`, mexer em volume ou imagem;
#    - reiniciar container que esta rodando (mesmo "unhealthy" -- isso e
#      alerta para gente, nao para robo: religar em laco esconde a causa);
#    - tocar no Docker, no Postgres/Patroni ou em qualquer servico do sistema.
#  Limite: 3 tentativas por hora. Passou disso, desiste e registra -- quem
#  avisa e a sonda por no no Grafana (probe_success, config.alloy).
#
#  PAUSAR (manutencao em que a pilha precisa ficar parada):
#    touch /etc/erp/vigia-pilha.pausado      # e apagar o arquivo ao terminar
#
#  Uso:
#    bash vigia-pilha.sh              # uma rodada (o que o timer chama)
#    bash vigia-pilha.sh --simular    # so diz o que faria
#    bash vigia-pilha.sh --instalar   # copia para /usr/local/sbin e liga o timer
#  Log:  journalctl -t vigia-pilha
# ============================================================================
set -uo pipefail

PROJETO="${PROJETO:-erp-pilha}"
PAUSA=/etc/erp/vigia-pilha.pausado
ESTADO="${ESTADO:-/var/lib/vigia-pilha}"
MAX_POR_HORA=3
ACAO="${1:-}"

log() { logger -t vigia-pilha -- "$*"; echo "$*"; }

if [ "$ACAO" = "--instalar" ]; then
  [ "$(id -u)" -eq 0 ] || { echo "rode como root"; exit 1; }
  install -m 0755 "$0" /usr/local/sbin/vigia-pilha
  cat > /etc/systemd/system/vigia-pilha.service <<'UNIT'
[Unit]
Description=Vigia da pilha da API do ERP (religa container parado, nunca recria)
After=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/vigia-pilha
UNIT
  cat > /etc/systemd/system/vigia-pilha.timer <<'UNIT'
[Unit]
Description=Vigia da pilha da API do ERP, a cada 2 min

[Timer]
# OnActiveSec: sem ele, numa instalacao nova o timer fica sem "proxima" ate o
# primeiro boot (o OnUnitActiveSec conta a partir de uma execucao que nunca
# houve) -- visto na instalacao de 18/11/2026.
OnActiveSec=1min
OnBootSec=3min
OnUnitActiveSec=2min

[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now vigia-pilha.timer
  echo "instalado: $(systemctl list-timers vigia-pilha.timer --no-pager | sed -n 2p)"
  exit 0
fi

[ -e "$PAUSA" ] && { echo "pausado ($PAUSA)"; exit 0; }

# Docker fora nao e problema deste vigia: religar o daemon e decisao humana.
if ! systemctl is-active --quiet docker; then
  log "docker.service nao esta ativo -- nada a fazer aqui, precisa de gente"
  exit 0
fi

PARADOS=$(docker ps -a --filter "label=com.docker.compose.project=$PROJETO" \
  --filter status=exited --filter status=created --filter status=dead \
  --format '{{.Names}}' | sort)
[ -z "$PARADOS" ] && exit 0

# Kong por ultimo: ele depende dos outros quatro.
ORDEM=$(echo "$PARADOS" | grep -v -- '-kong-'; echo "$PARADOS" | grep -- '-kong-')
ORDEM=$(echo "$ORDEM" | sed '/^$/d')

if [ "$ACAO" = "--simular" ]; then
  echo "religaria, nesta ordem:"; echo "$ORDEM"
  exit 0
fi

mkdir -p "$ESTADO"
AGORA=$(date +%s)
RECENTES=$(awk -v lim=$((AGORA - 3600)) '$1 > lim' "$ESTADO/tentativas" 2>/dev/null | wc -l)
if [ "$RECENTES" -ge "$MAX_POR_HORA" ]; then
  log "DESISTI: $RECENTES tentativas na ultima hora e ainda ha parados: $(echo $ORDEM)"
  exit 1
fi
echo "$AGORA" >> "$ESTADO/tentativas"

log "containers parados: $(echo $ORDEM) -- religando (docker start, sem recriar)"
FALHOU=0
for C in $ORDEM; do
  if docker start "$C" >/dev/null 2>&1; then
    log "religado: $C"
  else
    log "FALHOU ao religar: $C"; FALHOU=1
  fi
done
exit $FALHOU
