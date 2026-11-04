#!/usr/bin/env bash
# ============================================================================
#  APLICAR NOS NÓS O QUE MUDOU NO COMPOSE DA PILHA E NO HAPROXY
#
#  Uso:   bash infra/ha/aplicar-pilha.sh            (mostra o que faria)
#         bash infra/ha/aplicar-pilha.sh --aplicar  (faz)
#
#  Fora do horário comercial: recriar um container da API derruba a API
#  DAQUELE nó por alguns segundos (o outro registro A segue respondendo).
#
#  O QUE FAZ, NÓ A NÓ — banco2 (standby) PRIMEIRO, banco1 (líder) depois:
#    1. copia infra/failover/docker-compose.cluster.yml para
#       /opt/erp/infra/failover (guarda o anterior com a data);
#    2. gera o haproxy.cfg a partir de infra/ha/modelos/haproxy.cfg, confere
#       com `haproxy -c` e faz `systemctl reload` — reload, não restart: o
#       processo velho termina as conexões abertas e o novo pega as novas;
#    3. (ARQUIVAR=1) guarda o log atual do Kong comprimido em /root antes de
#       o container ser recriado — o arquivo morre com o container;
#    4. `docker compose up -d`: o Compose só recria o serviço cuja definição
#       mudou;
#    5. espera a API DAQUELE nó responder 200 em /rest/v1/rpc/sistema_saude
#       (pelo próprio IP, com --resolve) antes de passar ao próximo. Não
#       respondeu em 90 s: PARA e não toca no outro nó.
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/../.."

APLICAR=0; [ "${1:-}" = "--aplicar" ] && APLICAR=1
PORTA="${PORTA_SSH:-8443}"
NOS=("172.237.48.8:banco2" "216.238.120.171:banco1")
DOMINIO="api.grpnascimento.com.br"
COMPOSE=infra/failover/docker-compose.cluster.yml
DESTINO=/opt/erp/infra/failover
QUANDO=$(date +%Y%m%d-%H%M)

ANON=$(grep -E '^VITE_SUPABASE_ANON_KEY=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d '\015' || true)
[ -n "$ANON" ] || { echo "não achei VITE_SUPABASE_ANON_KEY no .env da raiz"; exit 1; }

hap_renderizado() {
  tr -d '\r' < infra/ha/modelos/haproxy.cfg | sed 's/__IP_BANCO1__/10.77.0.11/; s/__IP_BANCO2__/10.77.0.12/'
}

saude() { # $1 = ip
  curl -s -o /dev/null -w '%{http_code}' --max-time 8 --resolve "$DOMINIO:443:$1" \
    -X POST "https://$DOMINIO/rest/v1/rpc/sistema_saude" \
    -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H 'Content-Type: application/json' -d '{}'
}

for par in "${NOS[@]}"; do
  IP="${par%%:*}"; NOME="${par##*:}"
  echo "================ $NOME ($IP)"
  S="ssh -o BatchMode=yes -o ConnectTimeout=15 -p $PORTA root@$IP"

  echo "-- compose: diferença para o que está no nó"
  $S "cat $DESTINO/docker-compose.cluster.yml" | diff - "$COMPOSE" | head -40 || true
  echo "-- haproxy: diferença para o que está no nó"
  $S "cat /etc/haproxy/haproxy.cfg" | tr -d '\r' | diff - <(hap_renderizado) || true

  [ $APLICAR -eq 1 ] || { echo "(só mostrando — rode com --aplicar)"; continue; }

  echo "-- antes: $(saude "$IP")"
  $S "cp $DESTINO/docker-compose.cluster.yml $DESTINO/docker-compose.cluster.yml.$QUANDO \
      && cp /etc/haproxy/haproxy.cfg /etc/haproxy/haproxy.cfg.$QUANDO"
  $S "cat > $DESTINO/docker-compose.cluster.yml" < "$COMPOSE"
  hap_renderizado | $S "cat > /tmp/haproxy.novo && haproxy -c -q -f /tmp/haproxy.novo \
      && cp /tmp/haproxy.novo /etc/haproxy/haproxy.cfg && systemctl reload haproxy && echo haproxy recarregado"

  if [ "${ARQUIVAR:-0}" = "1" ]; then
    echo "-- arquivando o log atual do Kong (nice, pode levar alguns minutos)"
    $S "K=\$(docker inspect -f '{{.LogPath}}' erp-pilha-kong-1); \
        nice -n 19 ionice -c3 gzip -1 -c \"\$K\" > /root/kong-log-ate-$QUANDO.json.gz && ls -la /root/kong-log-ate-$QUANDO.json.gz"
  fi

  $S "cd $DESTINO && docker compose -f docker-compose.cluster.yml up -d 2>&1 | tail -8"

  for i in $(seq 1 30); do
    c=$(saude "$IP"); [ "$c" = "200" ] && break; sleep 3
  done
  echo "-- depois: $c"
  [ "$c" = "200" ] || { echo "!! $NOME não voltou em 90 s — PARANDO antes do próximo nó"; exit 1; }
  $S "docker inspect -f '{{.Name}} {{.HostConfig.LogConfig.Config}}' \$(docker ps -q)"
done
