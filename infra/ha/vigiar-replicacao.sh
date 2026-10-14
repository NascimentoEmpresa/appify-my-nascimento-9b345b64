#!/bin/bash
# ============================================================================
#  Vigia da replicacao logica, para rodar de cron no banco1.
#
#  POR QUE SEM A SENHA DA PRODUCAO
#  Guardar a senha do banco de producao num servidor que fica ligado o tempo
#  todo e um custo permanente por um ganho pontual. Entao esta vigia olha so o
#  lado do CLUSTER -- o que basta para saber que a replicacao parou:
#
#    received_lsn nulo  ou  last_msg_receipt_time velho  =  parou de aplicar
#
#  O conserto que precisa da producao (recriar coluna que falta) continua
#  sendo disparado da maquina do Eduardo, por `sincronizar-colunas.sh`, que
#  junta a senha na hora. Ver infra/ha/disparar-fase1.sh para o mesmo padrao.
#
#  O QUE ELA CONSERTA SOZINHA
#  So o caso do worker pendurado -- metade do incidente de 14/10/2026, em que
#  o processo ficou 30 min preso numa conexao morta e `ALTER SUBSCRIPTION
#  DISABLE/ENABLE` nao o derrubou. `pg_terminate_backend` e idempotente e sem
#  efeito colateral: o Postgres recria o worker em seguida.
#
#  O que ela NAO conserta (coluna faltando) ela SINALIZA, e com o motivo
#  extraido do log, para o conserto nao comecar as cegas.
#
#  INSTALACAO
#    */10 * * * * /root/vigiar-replicacao.sh >> /var/log/vigia-replicacao.log 2>&1
# ============================================================================
set -uo pipefail

ASSINATURA="${ASSINATURA:-erp_corte}"
PARADO_APOS_MIN="${PARADO_APOS_MIN:-10}"
BANDEIRA=/var/run/replicacao-precisa-coluna
LOG() { echo "$(date '+%d/%m %H:%M:%S') $*"; }

set -a; . /opt/erp/infra/failover/.env; set +a
clu() { PGPASSWORD="$PG_SENHA_SUPER" psql 'host=127.0.0.1 port=5000 user=postgres dbname=postgres' -At "$@" 2>/dev/null; }

ESTADO=$(clu -F'|' -c "
  select coalesce(received_lsn::text,''),
         coalesce(extract(epoch from (now() - last_msg_receipt_time))::bigint::text,'999999')
    from pg_stat_subscription where subname = '$ASSINATURA';")

if [ -z "$ESTADO" ]; then
  LOG "ALERTA: assinatura '$ASSINATURA' nao existe ou o banco nao respondeu."
  exit 1
fi

LSN="${ESTADO%%|*}"
IDADE="${ESTADO##*|}"

if [ -n "$LSN" ] && [ "$IDADE" -lt $((PARADO_APOS_MIN * 60)) ]; then
  # Saudavel. Se a bandeira de coluna estava levantada, a causa sumiu.
  [ -f "$BANDEIRA" ] && { LOG "normalizou: replicacao aplicando de novo."; rm -f "$BANDEIRA"; }
  exit 0
fi

LOG "ALERTA: replicacao parada (received_lsn='$LSN', sem mensagem ha ${IDADE}s)."

# A causa so aparece no log do Postgres do no LIDER, e o lider pode ser o
# outro no -- por isso pergunto aos dois pelo tunel.
MOTIVO=""
for IP in 10.77.0.11 10.77.0.12; do
  PAPEL=$(curl -s -m 5 "http://$IP:8008/patroni" | grep -o '"role": *"[a-z_]*"' | head -1)
  case "$PAPEL" in *primary*) ;; *) continue;; esac
  if [ "$IP" = "$(hostname -I | tr ' ' '\n' | grep -m1 '^10\.77\.')" ]; then
    MOTIVO=$(journalctl -u patroni --since "15 min ago" --no-pager 2>/dev/null \
             | grep -m1 'missing replicated columns')
  else
    MOTIVO=$(ssh -o BatchMode=yes -o ConnectTimeout=5 "root@$IP" \
             "journalctl -u patroni --since '15 min ago' --no-pager 2>/dev/null | grep -m1 'missing replicated columns'" 2>/dev/null)
  fi
done

if [ -n "$MOTIVO" ]; then
  # Coluna faltando: reiniciar o worker nao resolve, so repete o ciclo. Marca
  # e para, para o conserto vir de quem tem a senha da producao.
  LOG "CAUSA: coluna faltando no cluster. Rode da maquina do Eduardo:"
  LOG "       bash infra/ha/disparar-sincronia.sh --aplicar"
  LOG "       $MOTIVO"
  echo "$MOTIVO" > "$BANDEIRA"
  exit 2
fi

# Sem coluna faltando: e o worker pendurado. Esse caso a vigia resolve.
LOG "CAUSA: worker pendurado (sem erro de coluna no log). Reiniciando a forca."
clu -c "select pg_terminate_backend(pid) from pg_stat_subscription
         where subname = '$ASSINATURA' and pid is not null;" >/dev/null
sleep 10

DEPOIS=$(clu -At -c "select coalesce(received_lsn::text,'') from pg_stat_subscription where subname = '$ASSINATURA';")
if [ -n "$DEPOIS" ]; then
  LOG "resolvido: voltou a aplicar em $DEPOIS."
  exit 0
fi
LOG "ALERTA: reiniciei e continua sem aplicar -- precisa de olho humano."
exit 3
