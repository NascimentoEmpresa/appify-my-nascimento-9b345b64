#!/usr/bin/env bash
# ============================================================================
#  REINICIAR OS DOIS NOS SEM DERRUBAR O BANCO
#
#  POR QUE ISTO PRECISA ACONTECER, E ANTES DA VIRADA
#  Os dois nos tem kernel novo esperando (`linux-image-6.8.0-147-generic`,
#  `linux-base`) desde que o `apt-daily-upgrade.timer` o instalou. Enquanto
#  nao reiniciam, o kernel que roda e o antigo -- inclusive as correcoes de
#  seguranca que vieram com ele.
#
#  E ISTO E O MOMENTO: hoje o cluster nao atende usuario nenhum. Depois da
#  virada, o mesmo reboot vira janela de manutencao com gente usando o ERP, e
#  um erro no meio e incidente em vez de contratempo. Fazer agora e de graca.
#
#  NAO E `reboot` NOS DOIS
#  Reiniciar o lider sem avisar o Patroni derruba a escrita por ~20 segundos
#  (`ttl`) ate o outro assumir, e deixa o lider antigo voltando como standby
#  com a timeline atrasada. Reiniciar os dois ao mesmo tempo e pior: sem quorum
#  no etcd (2 de 3 nos do DCS estao nos proprios bancos), ninguem assume.
#
#  A ORDEM QUE ESTE SCRIPT SEGUE
#    1. reinicia o STANDBY, e espera ele voltar a streaming com lag 0
#    2. `patronictl switchover` -- troca de lider de proposito, pela porta da
#       frente, com o Patroni sabendo
#    3. reinicia o outro no (que agora e standby)
#    4. confere os dois: Patroni, HAProxy, Caddy, HTTPS, anexos
#
#  O QUE JA FOI CONFERIDO E PERMITE ISTO (16/10/2026)
#    net.ipv4.ip_nonlocal_bind=1  persistido em /etc/sysctl.d/80-haproxy-bind.conf
#    nos dois nos  -- sem isso o HAProxy nao sobe no boot, porque a ponte do
#    Docker (onde ele se amarra) so nasce depois dos containers
#    haproxy, patroni, docker, caddy, wg-quick@wg0, etcd: enabled nos dois
#
#  SOBRE A ESCRITA DURANTE O PASSO 1
#  O cluster roda em `synchronous_mode: true` com um standby so. Derrubar esse
#  standby faria a escrita esperar para sempre SE `synchronous_mode_strict`
#  estivesse ligado. Ele esta DESLIGADO, de proposito: o Patroni tira o nome
#  do standby de `synchronous_standby_names` e a escrita segue, sem replica
#  sincrona, ate ele voltar. E a razao pratica para manter o strict desligado.
#
#  USO
#    bash infra/ha/reboot-controlado.sh --conferir
#    bash infra/ha/reboot-controlado.sh --rodar
# ============================================================================
set -uo pipefail

BANCO1="${BANCO1:-216.238.120.171}"
BANCO2="${BANCO2:-172.237.48.8}"
PORTA_SSH="${PORTA_SSH:-8443}"
DOMINIO="${DOMINIO:-api.grpnascimento.com.br}"
PCTL="/opt/patroni/bin/patronictl -c /etc/patroni/patroni.yml"
ESPERA_MAX="${ESPERA_MAX:-300}"
ACAO="${1:---conferir}"

em() { ssh -p "$PORTA_SSH" -o BatchMode=yes -o ConnectTimeout=20 \
         -o StrictHostKeyChecking=accept-new "root@$1" "$2"; }

# A leitura de papel que funciona: o JSON do patronictl vem numa linha so, e
# `grep -B2` nele devolve o nome do CLUSTER em vez do no (erro que me pegou em
# 15/10). Entao sai do proprio -f json, por membro.
papel_de() {  # papel_de <ip_ssh> <nome_do_membro>
  em "$1" "$PCTL list -f json 2>/dev/null" \
    | tr '{' '\n' | sed -nE "s/.*\"Member\": \"$2\".*\"Role\": \"([^\"]+)\".*/\1/p" | head -1
}
estado_de() {
  em "$1" "$PCTL list -f json 2>/dev/null" \
    | tr '{' '\n' | sed -nE "s/.*\"Member\": \"$2\".*\"State\": \"([^\"]+)\".*/\1/p" | head -1
}

mostrar() { em "$1" "$PCTL list 2>/dev/null" | sed 's/^/   /'; }

# reiniciar_e_esperar <ip_do_alvo> <nome_do_alvo>
#
# Reinicia e so volta quando a maquina tiver REINICIADO DE FATO -- conferido
# pelo horario de boot, nao por "o SSH respondeu" e muito menos por "o Patroni
# diz que esta streaming". Em 16/10/2026 a versao anterior anunciou "voltou"
# 25 segundos depois de mandar reiniciar, com o no ainda comecando a desligar:
# a pergunta foi feita ao OUTRO no, que ainda via o estado antigo. A
# conferencia seguinte mostrou o kernel velho e o reboot pendente intacto.
# Um reboot que o script acha que fez e nao fez e pior do que nao ter script.
reiniciar_e_esperar() {
  local ALVO="$1" NOME="$2" ANTES DEPOIS FIM
  ANTES=$(em "$ALVO" "uptime -s" | tr -d '\r')
  [ -n "$ANTES" ] || { echo "   nao consegui ler o boot atual do $NOME" >&2; return 1; }
  echo "   boot atual do $NOME: $ANTES"
  em "$ALVO" "nohup sh -c 'sleep 2; systemctl reboot' >/dev/null 2>&1 &" || true
  sleep 25
  printf '   esperando o %s REINICIAR de fato' "$NOME"
  FIM=$(( $(date +%s) + ESPERA_MAX ))
  DEPOIS=""
  while [ "$(date +%s)" -lt "$FIM" ]; do
    DEPOIS=$(em "$ALVO" "uptime -s" 2>/dev/null | tr -d '\r')
    [ -n "$DEPOIS" ] && [ "$DEPOIS" != "$ANTES" ] && break
    printf '.'; sleep 10
  done
  echo
  if [ -z "$DEPOIS" ] || [ "$DEPOIS" = "$ANTES" ]; then
    echo "   o $NOME nao reiniciou (boot continua $ANTES)" >&2; return 1
  fi
  printf '   boot novo: %s   kernel: %s\n' "$DEPOIS" "$(em "$ALVO" "uname -r" | tr -d '\r')"
}

esperar_streaming() {  # esperar_streaming <ip_de_quem_pergunta> <membro>
  local fim=$(( $(date +%s) + ESPERA_MAX ))
  while [ "$(date +%s)" -lt "$fim" ]; do
    local E; E=$(estado_de "$1" "$2")
    case "$E" in
      streaming|running) echo "   $2: $E"; return 0 ;;
      "")                printf '.' ;;
      *)                 printf '%s.' "$E" ;;
    esac
    sleep 10
  done
  echo
  echo "   $2 nao voltou a streaming em ${ESPERA_MAX}s" >&2
  return 1
}

conferir_tudo() {
  echo "== Patroni"
  mostrar "$BANCO1"
  echo "== servicos e kernel"
  for NO in "$BANCO1" "$BANCO2"; do
    printf '   %-18s ' "$NO"
    em "$NO" "
      printf 'kernel %s | ' \$(uname -r)
      printf 'reboot pendente: %s | ' \$([ -f /var/run/reboot-required ] && echo SIM || echo nao)
      for S in patroni haproxy caddy docker etcd espelho-anexos.timer backup-cluster.timer; do
        printf '%s=%s ' \$S \$(systemctl is-active \$S 2>/dev/null)
      done
      echo
    " || echo "nao respondeu"
  done
  echo "== HTTPS pelo nome, nos dois nos"
  ANON=$(em "$BANCO1" "grep -m1 '^ANON_KEY=' /opt/erp/infra/failover/.env | cut -d= -f2-" | tr -d '\r\n')
  for NO in "$BANCO1" "$BANCO2"; do
    printf '   %-18s ' "$NO"
    for P in /auth/v1/health '/rest/v1/CHAMADO_SISTEMA?select=id&limit=1'; do
      printf '%s ' "$(curl -s -o /dev/null -w '%{http_code}' -m 20 \
        --resolve "$DOMINIO:443:$NO" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
        "https://$DOMINIO$P")"
    done
    echo
  done
  echo "== anexos (os dois tem que ter o mesmo numero)"
  for NO in "$BANCO1" "$BANCO2"; do
    printf '   %-18s %s arquivos\n' "$NO" \
      "$(em "$NO" "find \$(docker volume inspect erp-pilha_storage-arquivos --format '{{.Mountpoint}}') -type f 2>/dev/null | wc -l")"
  done
}

case "$ACAO" in

--conferir)
  conferir_tudo
  echo
  echo "Para reiniciar os dois, em ordem:  bash infra/ha/reboot-controlado.sh --rodar"
  ;;

--rodar)
  echo "== estado antes"
  mostrar "$BANCO1"

  P1=$(papel_de "$BANCO1" banco1); P2=$(papel_de "$BANCO1" banco2)
  echo "   banco1=$P1  banco2=$P2"
  case "$P1/$P2" in
    Leader/*)  LIDER=$BANCO1; LIDER_N=banco1; STBY=$BANCO2; STBY_N=banco2 ;;
    */Leader)  LIDER=$BANCO2; LIDER_N=banco2; STBY=$BANCO1; STBY_N=banco1 ;;
    *) echo "nao consegui identificar o lider ($P1/$P2) -- nao vou reiniciar nada" >&2; exit 1 ;;
  esac
  echo "   lider: $LIDER_N   standby: $STBY_N"

  # Quem ainda PRECISA reiniciar. Sem isto, rodar o script de novo (depois de
  # uma interrupcao no meio, que foi o que aconteceu em 16/10) reiniciaria um
  # no que ja esta com o kernel novo -- uma parada a toa, e uma troca de lider
  # a toa junto. Reiniciar maquina sem motivo nao e inofensivo.
  precisa() { em "$1" "[ -f /var/run/reboot-required ] && echo sim || echo nao"; }
  P_LIDER=$(precisa "$LIDER"); P_STBY=$(precisa "$STBY")
  echo "   reboot pendente:  $LIDER_N=$P_LIDER  $STBY_N=$P_STBY"
  if [ "$P_LIDER" = "nao" ] && [ "$P_STBY" = "nao" ]; then
    echo
    echo "   Os dois ja estao com o kernel novo. Nada a fazer."
    conferir_tudo
    exit 0
  fi

  # Trava: lag tem que estar em 0 antes de mexer. Reiniciar com lag e perder
  # dado se o lider cair enquanto o standby sobe.
  #
  # Os nomes das chaves sao "Receive Lag" e "Replay Lag" -- NAO "Lag in MB",
  # que e o rotulo da tabela de texto. Procurar pelo nome errado devolvia vazio
  # e a trava disparava sempre, como se houvesse lag. As duas tem que estar em
  # zero: recebido sem aplicado nao protege de nada.
  JSON=$(em "$LIDER" "$PCTL list -f json 2>/dev/null" | tr '{' '\n' | grep "\"Member\": \"$STBY_N\"")
  LAG_R=$(printf '%s' "$JSON" | sed -nE 's/.*"Receive Lag": ([0-9]+).*/\1/p')
  LAG_A=$(printf '%s' "$JSON" | sed -nE 's/.*"Replay Lag": ([0-9]+).*/\1/p')
  echo "   lag do standby: recebido=${LAG_R:-?}  aplicado=${LAG_A:-?}"
  [ "${LAG_R:-99}" = "0" ] && [ "${LAG_A:-99}" = "0" ] \
    || { echo "   lag diferente de 0 (ou nao consegui ler) -- parando aqui" >&2; exit 1; }

  if [ "$P_STBY" = "sim" ]; then
    echo
    echo "== 1/4 reiniciando o STANDBY ($STBY_N). A escrita segue no lider."
    reiniciar_e_esperar "$STBY" "$STBY_N" || exit 1
    printf '   esperando voltar a replicar'
    esperar_streaming "$LIDER" "$STBY_N" || exit 1
  else
    echo
    echo "== 1/4 o standby ($STBY_N) ja esta com o kernel novo -- pulando"
  fi

  if [ "$P_LIDER" = "nao" ]; then
    echo
    echo "== 2/4 o lider ($LIDER_N) nao precisa reiniciar -- sem troca de lider"
    echo
    echo "== 4/4 conferindo tudo"
    conferir_tudo
    exit 0
  fi

  echo
  echo "== 2/4 trocando de lider de proposito ($LIDER_N -> $STBY_N)"
  em "$LIDER" "$PCTL switchover --leader $LIDER_N --candidate $STBY_N --force" 2>&1 | sed 's/^/   /'
  # O switchover reinicia o Postgres dos dois lados, e logo depois o SSH do no
  # que acabou de assumir pode recusar conexao por alguns segundos (visto em
  # 16/10: "connection refused" na 8443 com o Patroni ja respondendo normal
  # pelo outro no). Perguntar uma vez so transformava isso em "o switchover
  # nao passou" -- e abortava uma troca que tinha dado certo.
  NOVO=""
  for T in 1 2 3 4 5 6; do
    sleep 10
    NOVO=$(papel_de "$STBY" "$STBY_N" 2>/dev/null)
    [ -z "$NOVO" ] && NOVO=$(papel_de "$LIDER" "$STBY_N" 2>/dev/null)
    [ "$NOVO" = "Leader" ] && break
    printf '   ainda nao consegui confirmar (tentativa %s de 6)\n' "$T"
  done
  echo "   $STBY_N agora e: ${NOVO:-?}"
  [ "$NOVO" = "Leader" ] || { echo "   o switchover nao passou -- NAO vou reiniciar o outro no" >&2; exit 1; }

  echo
  echo "== 3/4 reiniciando o antigo lider ($LIDER_N), agora standby"
  reiniciar_e_esperar "$LIDER" "$LIDER_N" || exit 1
  printf '   esperando voltar a replicar'
  esperar_streaming "$STBY" "$LIDER_N" || exit 1

  echo
  echo "== 4/4 conferindo tudo"
  conferir_tudo
  echo
  echo "   Se os dois nos estao com o kernel novo, sem reboot pendente, com"
  echo "   Patroni em streaming e os quatro 200, a manutencao acabou."
  echo "   O lider agora e o $STBY_N -- isso nao e problema nenhum, e sinal de"
  echo "   que a troca funcionou. Nao ha razao para voltar atras."
  ;;

*)
  sed -n '2,45p' "$0"
  exit 2
  ;;
esac
