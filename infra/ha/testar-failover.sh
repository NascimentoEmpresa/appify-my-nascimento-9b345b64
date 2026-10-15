#!/bin/bash
# ============================================================================
#  Mede o failover de verdade: quanto tempo a API fica fora quando o lider do
#  banco troca.
#
#  POR QUE UM SCRIPT, E NAO "roda o patronictl e ve se deu"
#  "Deu certo" nao e uma medida. O que interessa e o numero que o usuario
#  sente: quantos segundos o ERP ficou sem responder. Para isso a sonda tem de
#  estar rodando ANTES, bater no caminho COMPLETO (nao no banco direto) e
#  registrar o instante de cada tentativa -- um `curl` depois do switchover so
#  prova que voltou, nao quanto tempo ficou fora.
#
#  O caminho que a sonda percorre e o mesmo do navegador:
#    HTTPS -> Caddy (banco1:443) -> Kong -> PostgREST -> HAProxy -> lider
#
#  POR QUE ISSO NAO AFETA O USUARIO FINAL HOJE
#  Hoje o ERP dos usuarios fala com a Supabase; este cluster roda em paralelo.
#  O unico "usuario" da api.grpnascimento.com.br somos nos. Depois do Marco B a
#  conversa muda, e e justamente por isso que o numero tem de ser medido ANTES.
#
#  O QUE ESPERAR
#  O HAProxy pergunta /primary aos dois nos a cada 1s (inter 1s fall 2 rise 1)
#  e derruba as conexoes presas no no que saiu (on-marked-down
#  shutdown-sessions). Switchover comandado deve custar poucos segundos. Queda
#  nao planejada e outra conta: ai manda o ttl do Patroni (20s) -- e esse caso
#  NAO se testa desligando maquina de proposito sem combinar antes.
#
#  USO (Git Bash da maquina do Eduardo):
#    bash infra/ha/testar-failover.sh              # ida e volta (recomendado)
#    bash infra/ha/testar-failover.sh --so-ida     # troca e fica
#
#  Ele termina devolvendo a lideranca para onde estava, para o estado do
#  cluster amanha ser o mesmo de hoje.
# ============================================================================
set -uo pipefail

cd "$(dirname "$0")/../.."
NO="${NO:-216.238.120.171}"
API="${API:-https://api.grpnascimento.com.br}"
ALVO="${API}/rest/v1/CHAMADO_SISTEMA?select=id&limit=1"
PCTL="/opt/patroni/bin/patronictl -c /etc/patroni/patroni.yml"
SO_IDA=0
[ "${1:-}" = "--so-ida" ] && SO_IDA=1

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

no_remoto() { ssh -p 8443 -o BatchMode=yes "root@$NO" "$@"; }

echo "== estado do cluster agora"
no_remoto "$PCTL list" || { echo "nao alcancei o $NO na porta 8443" >&2; exit 1; }

LIDER=$(no_remoto "$PCTL list -f json" \
        | tr ',' '\n' | grep -B2 -i '"Leader"' | grep -oE '"banco[12]"' | head -1 | tr -d '"')
case "$LIDER" in
  banco1) OUTRO=banco2;;
  banco2) OUTRO=banco1;;
  *) echo "nao consegui identificar o lider (li '$LIDER')" >&2; exit 1;;
esac
echo "== lider: $LIDER   candidato: $OUTRO"

echo "== chave anon (nao e gravada em arquivo nenhum)"
ANON=$(no_remoto "grep -m1 '^ANON_KEY=' /opt/erp/infra/failover/.env | cut -d= -f2-" | tr -d '\r\n')
[ -n "$ANON" ] || { echo "nao consegui ler a ANON_KEY" >&2; exit 1; }

# A sonda. Arquivo cru: epoch_ms|codigo. A analise vem depois, para o laco ser
# o mais curto possivel e nao introduzir atraso proprio na medida.
sondar() {
  local saida="$1" seg="$2"
  local fim=$(( $(date +%s) + seg ))
  while [ "$(date +%s)" -lt "$fim" ]; do
    printf '%s|%s\n' "$(date +%s%3N)" \
      "$(curl -s -o /dev/null -m 4 -w '%{http_code}' \
           -H "apikey: $ANON" -H "Authorization: Bearer $ANON" "$ALVO" 2>/dev/null || echo 000)" \
      >> "$saida"
    sleep 0.4
  done
}

# Le o arquivo da sonda e devolve a maior sequencia de falhas em segundos.
# Conta a JANELA (do ultimo 200 antes ao primeiro 200 depois), nao o numero de
# falhas x intervalo: se o curl demora, o intervalo real nao e 0,4s e a
# multiplicacao mentiria.
analisar() {
  local arq="$1" rotulo="$2"
  local total ok falhas
  total=$(wc -l < "$arq")
  ok=$(grep -c '|200$' "$arq" || true)
  falhas=$(( total - ok ))
  echo "   $rotulo: $total sondagens, $ok OK, $falhas falha(s)"
  if [ "$falhas" -eq 0 ]; then
    echo "   >>> JANELA DE INDISPONIBILIDADE: nenhuma. A API respondeu 200 em todas."
    return
  fi
  awk -F'|' '
    $2 == 200 { if (fora) { d = $1 - ini; if (d > max) max = d; fora = 0 }; ult = $1; next }
    { if (!fora) { fora = 1; ini = ult } }
    END {
      if (fora) print "   >>> AINDA FORA no fim da sonda -- olhar na mao"
      else printf "   >>> JANELA DE INDISPONIBILIDADE: %.1f s\n", max/1000
    }' "$arq"
  echo "   códigos vistos: $(cut -d'|' -f2 "$arq" | sort | uniq -c | tr '\n' ' ')"
}

virar() {
  local de="$1" para="$2" arq="$3"
  echo
  echo "===================================================================="
  echo "  switchover  $de  ->  $para"
  echo "===================================================================="
  : > "$arq"
  sondar "$arq" 6 &                       # 6s de base, antes de mexer
  local S=$!
  sleep 6; wait $S
  echo "   base: $(grep -c '|200$' "$arq") OK de $(wc -l < "$arq")"

  sondar "$arq" 60 &                      # 60s cobrindo o switchover
  S=$!
  sleep 1
  echo "   disparando em $(date '+%H:%M:%S')"
  no_remoto "$PCTL switchover --leader $de --candidate $para --force" 2>&1 | sed 's/^/   /'
  echo "   devolveu em $(date '+%H:%M:%S')"
  wait $S

  analisar "$arq" "janela medida"
  echo "   estado:"
  no_remoto "$PCTL list" | sed 's/^/   /'
}

virar "$LIDER" "$OUTRO" "$TMP/ida.txt"

if [ "$SO_IDA" -eq 0 ]; then
  echo
  echo "== esperando 20s para a replica voltar a streaming antes de devolver"
  sleep 20
  virar "$OUTRO" "$LIDER" "$TMP/volta.txt"
fi

echo
echo "===================================================================="
echo "  depois do teste: a replicacao logica sobreviveu?"
echo "===================================================================="
# A assinatura mora NO BANCO, entao ela acompanha o lider -- mas o trabalhador
# e um processo, e processo nao migra. Quem assumiu tem de ter subido um novo.
# Se este bloco mostrar LSN nulo, e o caso do pg_terminate_backend.
no_remoto "set -a; . /opt/erp/infra/failover/.env; set +a
  PGPASSWORD=\"\$PG_SENHA_SUPER\" psql 'host=127.0.0.1 port=5000 user=postgres dbname=postgres' -At -c \"
    select 'assinatura: '||coalesce(received_lsn::text,'NULO')
        ||', ultima msg ha '||coalesce(extract(epoch from (now()-last_msg_receipt_time))::int::text,'-')||'s'
      from pg_stat_subscription where subname='erp_corte';
    select 'tabelas prontas: '||count(*)||' de '||(select count(*) from pg_subscription_rel)
      from pg_subscription_rel where srsubstate='r';\"" | sed 's/^/   /'

echo
echo "Se a assinatura voltou NULO, rode:  bash infra/ha/disparar-sincronia.sh --aplicar"
echo "(ele derruba o trabalhador pendurado -- DISABLE/ENABLE nao resolve)"
