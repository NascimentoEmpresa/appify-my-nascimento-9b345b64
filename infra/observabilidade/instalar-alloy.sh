#!/usr/bin/env bash
# ============================================================================
#  INSTALAR O GRAFANA ALLOY NOS DOIS NÓS (item 8, 03/11/2026)
#
#  Uso (terminal do PC, prompt do Claude Code):
#     ! bash infra/observabilidade/instalar-alloy.sh            (mostra o plano)
#     ! bash infra/observabilidade/instalar-alloy.sh --aplicar
#
#  Pré-requisito: as 5 linhas do Grafana Cloud no .env.local da raiz (passo a
#  passo em infra/observabilidade/README.md, passo 1):
#     GC_PROM_URL=  GC_PROM_USER=  GC_LOKI_URL=  GC_LOKI_USER=  GC_TOKEN=
#  O token NUNCA vai para o git: o script o grava só em /etc/default/alloy
#  (chmod 600, dono root) em cada nó.
#
#  O que faz em cada nó (banco2 primeiro):
#    1. instala o pacote `alloy` do repositório oficial da Grafana (apt);
#    2. cria/atualiza o papel `monitor` no Postgres (só no líder; a réplica
#       recebe pela replicação) com pg_monitor e senha sorteada;
#    3. grava /etc/default/alloy e /etc/alloy/config.alloy;
#    4. põe o usuário alloy nos grupos docker e systemd-journal (ler
#       docker.sock e o journal do patroni);
#    5. sobe o serviço e confere `systemctl is-active` + se o Alloy enviou.
#
#  Custo no nó: ~80–120 MB de RAM e <2 % de um núcleo (medir no painel
#  "containers/máquina" na primeira hora). banco2 tem ~850 MB disponíveis.
# ============================================================================
set -euo pipefail
# 03/11/2026: sem isto, um erro no meio (com set -e) saía CALADO — a primeira
# execução real terminou sem uma linha de saída e sem instalar nada.
trap 'echo "!! instalar-alloy.sh parou com erro na linha $LINENO" >&2' ERR
cd "$(dirname "$0")/../.."

APLICAR=0; [ "${1:-}" = "--aplicar" ] && APLICAR=1
PORTA="${PORTA_SSH:-8443}"
NOS=("172.237.48.8:banco2:10.77.0.12" "216.238.120.171:banco1:10.77.0.11")

# `|| true`: chave ausente é resposta válida (vazio), não erro — com pipefail o
# grep sem achar derrubava o script inteiro em silêncio.
ler() { { grep -E "^$1=" .env.local || true; } | head -1 | cut -d= -f2- | tr -d '"' | tr -d '\015'; }
for v in GC_PROM_URL GC_PROM_USER GC_LOKI_URL GC_LOKI_USER GC_TOKEN; do
  [ -n "$(ler $v)" ] || { echo "falta $v no .env.local — ver infra/observabilidade/README.md, passo 1"; exit 1; }
done

SENHA_MONITOR=$(ler PG_SENHA_MONITOR)
if [ -z "$SENHA_MONITOR" ]; then
  SENHA_MONITOR=$(node -e 'console.log(require("crypto").randomBytes(24).toString("base64url"))')
  [ $APLICAR -eq 1 ] && printf '\nPG_SENHA_MONITOR=%s\n' "$SENHA_MONITOR" >> .env.local
fi

for par in "${NOS[@]}"; do
  IFS=: read -r IP NOME TUNEL <<<"$par"
  echo "================ $NOME ($IP)"
  if [ $APLICAR -eq 0 ]; then echo "(plano) instalar alloy, papel monitor, /etc/default/alloy, config.alloy, grupos, subir serviço"; continue; fi
  S="ssh -o BatchMode=yes -o ConnectTimeout=15 -p $PORTA root@$IP"

  $S 'set -e
    if ! command -v alloy >/dev/null; then
      mkdir -p /etc/apt/keyrings
      curl -fsSL https://apt.grafana.com/gpg.key | gpg --dearmor -o /etc/apt/keyrings/grafana.gpg
      echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main" > /etc/apt/sources.list.d/grafana.list
      apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq alloy >/dev/null
    fi
    alloy --version | head -1'

  # papel de leitura para o exporter — só no líder (CREATE ROLE replica)
  $S "/opt/patroni/bin/patronictl -c /etc/patroni/patroni.yml list -f json" | grep -q "\"Member\": \"$NOME\", \"Host\": \"$TUNEL\", \"Role\": \"Leader\"" && \
  $S "sudo -u postgres psql -X -q -v ON_ERROR_STOP=1" <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'monitor') THEN CREATE ROLE monitor LOGIN; END IF;
END \$\$;
ALTER ROLE monitor WITH LOGIN PASSWORD '$SENHA_MONITOR' CONNECTION LIMIT 3;
ALTER ROLE monitor SET statement_timeout = '5s';
GRANT pg_monitor TO monitor;
SQL

  {
    echo 'CONFIG_FILE="/etc/alloy/config.alloy"'
    echo 'CUSTOM_ARGS="--disable-reporting"'
    echo 'RESTART_ON_UPGRADE=true'
    echo "NO=$NOME"
    echo "IP_TUNEL=$TUNEL"
    echo "PG_MONITOR_DSN=postgresql://monitor:$SENHA_MONITOR@127.0.0.1:5432/postgres?sslmode=disable"
    for v in GC_PROM_URL GC_PROM_USER GC_LOKI_URL GC_LOKI_USER GC_TOKEN; do echo "$v=$(ler $v)"; done
  } | $S 'umask 077; cat > /etc/default/alloy; chown root:root /etc/default/alloy; chmod 600 /etc/default/alloy'

  # Confere a sintaxe ANTES de trocar: config com erro não chega a subir.
  tr -d '\r' < infra/observabilidade/config.alloy | $S 'mkdir -p /etc/alloy && cat > /etc/alloy/config.alloy.novo \
    && alloy fmt /etc/alloy/config.alloy.novo >/dev/null && mv /etc/alloy/config.alloy.novo /etc/alloy/config.alloy \
    && echo "config.alloy: sintaxe ok"'
  # Teto do PRÓPRIO agente: a monitoração nunca pode derrubar a produção (em
  # 03/11/2026 um `docker logs` agravou a queda). Medido na instalação: 234 MB
  # no banco2 e 317 MB no banco1. Passou de 400 MB, o systemd o reinicia; CPU
  # no máximo 25 % de um núcleo.
  $S 'mkdir -p /etc/systemd/system/alloy.service.d \
      && printf "%s\n" "[Service]" "MemoryHigh=350M" "MemoryMax=400M" "CPUQuota=25%" > /etc/systemd/system/alloy.service.d/limite.conf \
      && systemctl daemon-reload && echo "limite do alloy: $(systemctl show alloy -p MemoryMax --value | numfmt --to=iec) de memória, CPU $(systemctl show alloy -p CPUQuotaPerSecUSec --value)/s"'
  $S 'usermod -aG docker,systemd-journal alloy
      systemctl enable alloy >/dev/null 2>&1; systemctl restart alloy; sleep 20
      echo "alloy: $(systemctl is-active alloy) · mem $(ps -o rss= -C alloy | awk "{s+=\$1} END {printf \"%d MB\", s/1024}")"
      journalctl -u alloy --since "-1 min" --no-pager -o cat | grep -iE "error|fail" | tail -5 || true'
done
if [ $APLICAR -eq 1 ]; then echo "Pronto. Painel: https://redgarlic110.grafana.net/d/erp-saude-producao"; fi
