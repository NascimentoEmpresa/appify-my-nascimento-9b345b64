#!/bin/bash
# ============================================================================
#  Vigia da replicacao logica. Instalar no cron dos DOIS nos de banco.
#
#  POR QUE NOS DOIS, E NAO SO NO BANCO1
#  A primeira versao rodava so no banco1 e ia ler o log do lider por ssh. Nao
#  funciona: o banco1 nao tem chave para o banco2, e o lider costuma ser o
#  banco2. Em 14/10/2026 isso fez a vigia registrar "precisa de olho humano"
#  quando a causa estava escrita no log, a um comando de distancia.
#
#  Agora ela roda nos dois e CADA UM so age se for o lider. O lider tem tudo
#  localmente: o Postgres com a assinatura e o journal com o motivo. Zero ssh,
#  zero chave, e funciona depois de qualquer failover sem reconfigurar nada.
#
#  POR QUE SEM A SENHA DA PRODUCAO
#  Guardar a senha do banco de producao num servidor ligado o tempo todo e um
#  custo permanente por um ganho pontual. Olhar so o lado do cluster basta:
#
#    received_lsn nulo  ou  last_msg_receipt_time velho  =  parou de aplicar
#
#  O conserto que precisa da producao (recriar coluna que falta) continua
#  sendo disparado da maquina do Eduardo, por `disparar-sincronia.sh`, que
#  junta a senha na hora.
#
#  O QUE ELA CONSERTA SOZINHA
#  So o caso do worker pendurado -- metade do incidente de 14/10, em que o
#  processo ficou 30 min preso numa conexao morta e `ALTER SUBSCRIPTION
#  DISABLE/ENABLE` nao o derrubou (o PID continuava o mesmo). O
#  `pg_terminate_backend` e idempotente e sem efeito colateral.
#
#  O que ela NAO conserta (coluna faltando) ela SINALIZA com o motivo extraido
#  do log, para o conserto nao comecar as cegas.
#
#  INSTALACAO, nos dois nos:
#    */10 * * * * /root/vigiar-replicacao.sh >> /var/log/vigia-replicacao.log 2>&1
# ============================================================================
set -uo pipefail

ASSINATURA="${ASSINATURA:-erp_corte}"
PARADO_APOS_MIN="${PARADO_APOS_MIN:-10}"
BANDEIRA=/var/run/replicacao-precisa-coluna
LOG() { echo "$(date '+%d/%m %H:%M:%S') [$(hostname)] $*"; }

# Quem nao e lider nao tem assinatura para vigiar. Sai calado: o outro no esta
# fazendo o trabalho, e dois alertas para o mesmo fato viram ruido.
#
# ATENCAO: o Patroni NAO escuta em 127.0.0.1 -- ele escuta no IP do tunel
# (10.77.0.x:8008). Perguntar ao localhost devolve vazio, o papel nunca casa
# com 'primary' e a vigia vira um no-op que sai 0 e parece saudavel. Esse erro
# passou despercebido em 14/10 justamente porque o sintoma e silencio.
IP_TUNEL=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -m1 '^10\.77\.')
if [ -z "$IP_TUNEL" ]; then
  LOG "ALERTA: nao achei o IP do tunel neste no -- o tunel caiu?"
  exit 1
fi
PAPEL=$(curl -s -m 5 "http://$IP_TUNEL:8008/patroni" 2>/dev/null | grep -oE '"role": *"[a-z_]+"' | head -1)
if [ -z "$PAPEL" ]; then
  LOG "ALERTA: Patroni nao respondeu em $IP_TUNEL:8008."
  exit 1
fi
case "$PAPEL" in *primary*) ;; *) exit 0;; esac

set -a; . /opt/erp/infra/failover/.env; set +a
# 5432 local: sou o lider, entao nao preciso do HAProxy para achar a mim mesmo.
clu() { PGPASSWORD="$PG_SENHA_SUPER" psql 'host=127.0.0.1 port=5432 user=postgres dbname=postgres' -At "$@" 2>/dev/null; }

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
  [ -f "$BANDEIRA" ] && { LOG "normalizou: replicacao aplicando de novo."; rm -f "$BANDEIRA"; }
  exit 0
fi

LOG "ALERTA: replicacao parada (received_lsn='$LSN', sem mensagem ha ${IDADE}s)."

# Local, porque so o lider chega aqui. Pega tanto 'column' quanto 'columns':
# a mensagem do Postgres muda de numero conforme falte uma ou varias.
MOTIVO=$(journalctl -u patroni --since "15 min ago" --no-pager 2>/dev/null \
         | grep -m1 -E 'missing replicated columns?')

if [ -n "$MOTIVO" ]; then
  # Coluna faltando: religar o worker so repete o ciclo de 5 em 5 segundos.
  LOG "CAUSA: coluna faltando no cluster. Rode da maquina do Eduardo:"
  LOG "       bash infra/ha/disparar-sincronia.sh --aplicar"
  LOG "       ${MOTIVO##*ERROR:  }"
  echo "$MOTIVO" > "$BANDEIRA"
  exit 2
fi

LOG "CAUSA: worker pendurado (sem erro de coluna no log). Reiniciando a forca."
clu -c "select pg_terminate_backend(pid) from pg_stat_subscription
         where subname = '$ASSINATURA' and pid is not null;" >/dev/null
sleep 10

DEPOIS=$(clu -c "select coalesce(received_lsn::text,'') from pg_stat_subscription where subname = '$ASSINATURA';")
if [ -n "$DEPOIS" ]; then
  LOG "resolvido: voltou a aplicar em $DEPOIS."
  exit 0
fi
LOG "ALERTA: reiniciei e continua sem aplicar -- precisa de olho humano."
exit 3
