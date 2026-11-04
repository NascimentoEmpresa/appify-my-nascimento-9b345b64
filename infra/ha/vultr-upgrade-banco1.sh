#!/usr/bin/env bash
# ============================================================================
#  UPGRADE DO banco1 NA VULTR: 2 vCPU -> 4 vCPU
#
#  Uso:
#    bash infra/ha/vultr-upgrade-banco1.sh            # só olha (padrão)
#    bash infra/ha/vultr-upgrade-banco1.sh --vigiar   # olha a cada 10 min até ter
#    bash infra/ha/vultr-upgrade-banco1.sh --aplicar  # pede o upgrade (REINICIA o banco1)
#
#  POR QUE O PAINEL NÃO MOSTRA A OPÇÃO (medido em 03/11/2026, 23:50 UTC)
#  A Vultr só oferece "Change Plan" para plano da MESMA família que tenha
#  máquina livre NA REGIÃO. A API respondeu, para o banco1:
#      GET /v2/instances/<id>/upgrades  ->  {"plans": []}
#  e São Paulo, na família vc2, só tinha vc2-1c-1gb disponível. Sem estoque
#  do vc2-4c-8gb lá, a lista do painel fica vazia — não é permissão nem
#  configuração da conta. A capacidade da Vultr SP oscila ao longo do dia
#  (já vista sumir e voltar em 08/10/2026), por isso o --vigiar.
#
#  O QUE O --aplicar FAZ
#  PATCH /v2/instances/<id> {"plan": "vc2-4c-8gb"}: a Vultr redimensiona e
#  REINICIA a máquina. O banco1 é o LÍDER do Patroni: reiniciar o líder custa
#  ~48 s de erro (docs/infra/upgrade-vultr.md). Por isso o script RECUSA
#  aplicar com o banco1 líder, a não ser com FORCAR=1 — o certo é trocar o
#  líder para o banco2 antes (fora do horário), subir o plano, e devolver.
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/../.."

ID="f3b98878-f172-4b8a-9d40-6520a45717a2"   # banco1, 216.238.120.171
ALVO="${PLANO:-vc2-4c-8gb}"
K=$(grep -E '^VULTR_API_KEY=' .env.local | cut -d= -f2- | tr -d '"\r')
[ -n "$K" ] || { echo "falta VULTR_API_KEY no .env.local"; exit 1; }
api() { curl -s -H "Authorization: Bearer $K" "$@"; }

olhar() {
  local plano dispo upg
  plano=$(api "https://api.vultr.com/v2/instances/$ID" | grep -o '"plan":"[^"]*"' | cut -d'"' -f4)
  dispo=$(curl -s https://api.vultr.com/v2/regions/sao/availability | grep -c "\"$ALVO\"" || true)
  upg=$(api "https://api.vultr.com/v2/instances/$ID/upgrades?type=plans" | grep -c "\"$ALVO\"" || true)
  echo "[$(date +%H:%M)] banco1 hoje: $plano · $ALVO em São Paulo: $([ "$dispo" -gt 0 ] && echo DISPONÍVEL || echo sem estoque) · upgrade oferecido ao banco1: $([ "$upg" -gt 0 ] && echo SIM || echo não)"
  [ "$upg" -gt 0 ]
}

case "${1:-}" in
  --vigiar)
    until olhar; do sleep 600; done
    echo "Pode fazer: Vultr > banco1 > Settings > Change Plan > $ALVO (ou --aplicar)." ;;
  --aplicar)
    olhar || { echo "Ainda não há upgrade disponível — nada feito."; exit 1; }
    LIDER=$(ssh -o BatchMode=yes -p 8443 root@216.238.120.171 \
      "/opt/patroni/bin/patronictl -c /etc/patroni/patroni.yml list -f json" | grep -o '"Member": "[^"]*", "Host": "[^"]*", "Role": "Leader"' | cut -d'"' -f4)
    # Só segue com o líder CONFIRMADO no banco2 (vazio = não deu para saber = não segue).
    if [ "$LIDER" != "banco2" ] && [ "${FORCAR:-0}" != "1" ]; then
      echo "Líder atual: ${LIDER:-não identificado}. Troque o líder para o banco2 antes (fora do horário):"
      echo "  ssh -p 8443 root@216.238.120.171 '/opt/patroni/bin/patronictl -c /etc/patroni/patroni.yml switchover --leader banco1 --candidate banco2 --force'"
      echo "ou rode com FORCAR=1 aceitando ~48 s de erro para quem estiver usando."
      exit 1
    fi
    api -X PATCH "https://api.vultr.com/v2/instances/$ID" -H "Content-Type: application/json" -d "{\"plan\":\"$ALVO\"}" -w "\nHTTP %{http_code}\n"
    echo "Pedido feito. A máquina reinicia; acompanhe com: bash infra/ha/estado-cluster.sh" ;;
  *) olhar || true ;;
esac
