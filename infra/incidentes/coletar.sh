#!/usr/bin/env bash
# ============================================================================
#  COLETAR OS LOGS DE UM DIA, SEM PESAR NO NÓ
#
#  Uso:   bash infra/incidentes/coletar.sh 2026-11-03 [ip-do-no]
#  Saída: ./incidente-AAAA-MM-DD/{postgres,kong,rest}.log.gz
#  Depois: node infra/incidentes/analisar.mjs ./incidente-AAAA-MM-DD
#
#  Por que este script existe (03/11/2026): durante a queda daquele dia um
#  `docker logs` no Kong, com o log de 4,8 GB, ocupou 38–46 % de um núcleo do
#  banco1 e aprofundou a queda. Aqui nenhum comando passa pelo dockerd: o
#  arquivo json do container é lido direto, com nice/ionice, e só a fatia do
#  dia sai do servidor, já comprimida. A análise roda na sua máquina.
#
#  O que coleta:
#    postgres.log.gz  journal do Patroni (inclui o log do Postgres), sem o
#                     "no action ... leader with the lock" de 5 em 5 s
#    kong.log.gz      log de acesso do Kong do dia (toda requisição da API)
#    rest.log.gz      log do PostgREST do dia (pool, schema cache, reconexões)
#    sar.txt          CPU, carga e memória a cada 10 min (sysstat)
#    patroni.txt      estado e histórico de líder
# ============================================================================
set -euo pipefail

DIA="${1:?uso: coletar.sh AAAA-MM-DD [ip-do-no]}"
NO="${2:-216.238.120.171}"
PORTA="${PORTA_SSH:-8443}"
SAIDA="./incidente-$DIA"
mkdir -p "$SAIDA"

# 2026-11-03 -> 03/Nov/2026 (formato do nginx) e 03 (arquivo do sysstat)
MES=(x Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec)
A="${DIA:0:4}"; M="${DIA:5:2}"; D="${DIA:8:2}"
NGINX="$D/${MES[$((10#$M))]}/$A"

ssh_no() { ssh -o BatchMode=yes -o ConnectTimeout=15 -p "$PORTA" "root@$NO" "$@"; }

echo "[$(date +%T)] postgres/patroni de $DIA ..."
ssh_no "nice -n 19 journalctl -u patroni --since '$DIA 00:00' --until '$DIA 23:59:59' --no-pager -o cat \
        | grep -v 'the leader with the lock' | gzip -1" > "$SAIDA/postgres.log.gz"

echo "[$(date +%T)] kong de $DIA (lendo o arquivo, não o dockerd) ..."
ssh_no "K=\$(docker inspect -f '{{.LogPath}}' erp-pilha-kong-1); \
        LC_ALL=C nice -n 19 ionice -c3 grep -F '[$NGINX:' \"\$K\" | gzip -1" > "$SAIDA/kong.log.gz"

echo "[$(date +%T)] postgrest de $DIA ..."
ssh_no "R=\$(docker inspect -f '{{.LogPath}}' erp-pilha-rest-1); \
        LC_ALL=C nice -n 19 ionice -c3 grep -F '\"time\":\"${DIA}T' \"\$R\" | grep -v 'HTTP/1.1' | gzip -1" > "$SAIDA/rest.log.gz"

echo "[$(date +%T)] sar e patroni ..."
ssh_no "LC_ALL=C sar -u -q -r -f /var/log/sysstat/sa$D 2>/dev/null; echo; \
        /opt/patroni/bin/patronictl -c /etc/patroni/patroni.yml list; \
        /opt/patroni/bin/patronictl -c /etc/patroni/patroni.yml history | tail -5" > "$SAIDA/sar.txt"

ls -la "$SAIDA"
echo "Agora: node infra/incidentes/analisar.mjs $SAIDA"
