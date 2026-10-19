#!/usr/bin/env bash
# ============================================================================
#  O ESTADO DO NO, em texto, para o vigia
#
#  POR QUE ISTO SAIU DE DENTRO DO backup-cluster.sh (18/10/2026)
#  O `status` morava no `--enviar`, que roda como `erpbackup` -- o usuario da
#  chave do CI. Para ler conexoes do Postgres ele lia
#  `/opt/erp/infra/failover/.env`... e funcionava. Isso era a denuncia: o
#  arquivo estava **644**, legivel por qualquer usuario local, com
#  `JWT_SECRET`, `SERVICE_ROLE_KEY` e as senhas do banco dentro.
#
#  Ou seja: a chave guardada no GitHub, que deveria conseguir apenas baixar um
#  arquivo cifrado, conseguia ler o segredo que assina os tokens e a
#  `service_role`, que ignora toda a RLS. A garantia que estava escrita no
#  workflow ("no pior caso vaza um arquivo que o vazador nao abre") nao era
#  verdadeira.
#
#  Agora: o `.env` e 600, e este script roda por `sudo` com UMA entrada em
#  /etc/sudoers.d. Ele so LE e so imprime contadores -- nenhum segredo sai.
#
#  O PAPEL VEM DA API DO PATRONI, NAO DO patronictl
#  `patronictl` precisa de `/etc/patroni/patroni.yml`, que o erpbackup nao le
#  (e nao deve). A API REST do Patroni responde o papel sem credencial, no IP
#  do tunel -- ela escuta em 10.77.0.x:8008, NAO em 127.0.0.1, que foi por que
#  o primeiro teste deu vazio e o vigia reportou "papel=" para os dois nos.
#  Um vigia que erra o papel alarmaria "0 lideres" a cada 30 minutos, e alarme
#  falso que se repete vira alarme ignorado.
# ============================================================================
set -uo pipefail

ENV_ARQ="${ENV_ARQ:-/opt/erp/infra/failover/.env}"
DESTINO="${DESTINO:-/var/backups/erp-cluster}"
WG=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep '^10\.77\.' | head -1)

echo "no=$(hostname)"
echo "carga=$(cut -d' ' -f1 /proc/loadavg)"
echo "cpus=$(nproc)"
free -m | awk '/Mem:/{print "ram_total="$2"\nram_disp="$7} /Swap:/{print "swap_total="$2"\nswap_uso="$3}'
df -BM / | awk 'NR==2{gsub("M","",$2); gsub("M","",$4); print "disco_total="$2"\ndisco_livre="$4}'

# Postgres: pelo HAProxy local, que sempre aponta para o lider.
SUP=$(grep -m1 '^PG_SENHA_SUPER=' "$ENV_ARQ" 2>/dev/null | cut -d= -f2-)
Q() { PGPASSWORD="$SUP" psql -h 127.0.0.1 -p 5000 -U postgres -d postgres -At -c "$1" 2>/dev/null; }
echo "pg_conexoes=$(Q 'select count(*) from pg_stat_activity')"
echo "pg_teto=$(Q "select current_setting('max_connections')")"
echo "pg_tamanho_mb=$(Q "select (pg_database_size('postgres')/1048576)::int")"

# Papel e saude da replicacao, pela API do Patroni DESTE no.
EST=$(curl -s -m 5 "http://${WG:-127.0.0.1}:8008/patroni" 2>/dev/null)
PAPEL=$(printf '%s' "$EST" | sed -nE 's/.*"role": *"([^"]+)".*/\1/p')
# A API diz "primary"/"replica"; traduzimos para o vocabulario do roteiro.
case "$PAPEL" in
  primary|master) echo "papel=Leader" ;;
  replica|standby_leader) echo "papel=Standby" ;;
  *) echo "papel=${PAPEL:-desconhecido}" ;;
esac
echo "pg_em_recuperacao=$(printf '%s' "$EST" | grep -c '"role": "replica"')"
# Quantos estao de fato recebendo WAL -- so o lider sabe responder isto.
echo "membros_streaming=$(Q "select count(*) from pg_stat_replication where state='streaming'")"

ULTIMO=$(ls -t "$DESTINO"/erp-cluster-*.tar.gz.gpg 2>/dev/null | head -1)
if [ -n "$ULTIMO" ]; then
  echo "backup_mais_novo_h=$(( ( $(date +%s) - $(stat -c %Y "$ULTIMO") ) / 3600 ))"
else
  echo "backup_mais_novo_h=999"
fi
VOL=$(docker volume inspect erp-pilha_storage-arquivos --format '{{.Mountpoint}}' 2>/dev/null)
echo "anexos=$(find "${VOL:-/nao-existe}/stub/stub" -type f 2>/dev/null | wc -l)"
