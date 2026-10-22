#!/usr/bin/env bash
# =====================================================================
# RÁPIDA DO PONTO EM LAÇO (21/10/2026) — chamado pelo espelho_mysql.yml.
#
# Por que não um cron de 10 em 10 minutos: o GitHub não cumpre. Medido em
# 20-21/10/2026: o '*/10 * * * *' disparou 5 vezes em 24 h (21:52, 02:26,
# 07:24, 12:25…), de 2 a 5 h entre uma e outra — e o ERP ficava horas atrás
# da Flex (às 15:35 a Flex tinha batidas até 15:30; o ERP, até 12:25).
#
# Agora o cron é de hora em hora e cada execução FICA de pé quase 6 h,
# rodando a rápida a cada 10 min cravados (00, 10, 20…). Com o grupo de
# concorrência próprio (espelho-ponto), a próxima execução espera na fila e
# entra assim que esta sai: o GitHub pular disparos deixa de abrir buraco.
#
# Falha avulsa (túnel da Flex que não responde, trava que não veio — a carga
# já tenta 3x sozinha) não derruba o laço: a próxima rodada tenta de novo. Só
# 3 falhas SEGUIDAS (30 min sem ponto) encerram com erro, e aí o passo de
# aviso do workflow manda o Discord.
#
# Variáveis: DURACAO_MIN (padrão 340 — o teto do job é 355), INTERVALO_SEG
# (padrão 600), B1 (host do túnel do cluster, para reabrir se cair).
# =====================================================================
set -uo pipefail

DURACAO_MIN="${DURACAO_MIN:-340}"
INTERVALO_SEG="${INTERVALO_SEG:-600}"
FIM=$(( $(date +%s) + DURACAO_MIN * 60 ))
SEGUIDAS=0
RODADAS=0
FALHAS=0

tunel_vivo() { (exec 3<>/dev/tcp/127.0.0.1/5433) 2>/dev/null; }

reabrir_tunel() {
  # A chave foi gravada pelo passo "Abrir o túnel até o banco1"; o túnel dele
  # pode cair em horas de job (queda de rede do runner ou do nó).
  [ -n "${B1:-}" ] && [ -f ~/.ssh/tunel ] || return 1
  pkill -f "5433:127.0.0.1:5000" 2>/dev/null || true
  ssh -i ~/.ssh/tunel -p 8443 -o BatchMode=yes -o ExitOnForwardFailure=yes \
      -o ServerAliveInterval=30 -f -N -L 5433:127.0.0.1:5000 "pgtunel@$B1" || return 1
  for _ in $(seq 1 10); do tunel_vivo && return 0; sleep 1; done
  return 1
}

while :; do
  RODADAS=$((RODADAS + 1))
  echo "::group::rodada $RODADAS — $(TZ=America/Sao_Paulo date '+%d/%m %H:%M') (Brasília)"
  if ! tunel_vivo; then
    echo "túnel do cluster caiu — reabrindo"
    reabrir_tunel || echo "::warning::não consegui reabrir o túnel do cluster"
  fi
  if node espelho.mjs sincronizar --commit --tabelas BiSituacoes,BiEmpregados,BiMarcacoes --dias 1; then
    SEGUIDAS=0
  else
    SEGUIDAS=$((SEGUIDAS + 1))
    FALHAS=$((FALHAS + 1))
    echo "::warning::rodada $RODADAS falhou ($SEGUIDAS seguida(s))"
  fi
  echo "::endgroup::"

  if [ "$SEGUIDAS" -ge 3 ]; then
    echo "::error::3 rodadas seguidas da rápida do ponto falharam — o ERP está sem batidas novas há 30 min"
    exit 1
  fi

  AGORA=$(date +%s)
  PROXIMA=$(( (AGORA / INTERVALO_SEG + 1) * INTERVALO_SEG ))
  if [ "$PROXIMA" -ge "$FIM" ]; then break; fi
  sleep $(( PROXIMA - AGORA ))
done

echo "fim do laço: $RODADAS rodada(s), $FALHAS falha(s) avulsa(s)"
