#!/usr/bin/env bash
# ============================================================================
#  Espera o Postgres aceitar conexao e so entao executa o comando recebido
# ============================================================================
#  POR QUE ISTO EXISTE
#  O PostgREST reconecta sozinho quando o banco ainda nao esta pronto. O GoTrue
#  e o Storage NAO: eles encerram com codigo 1 na primeira falha. O supervisor
#  reinicia, falha de novo, e acaba desistindo - foi o que aconteceu em
#  01/10/2026, com os dois em BACKOFF enquanto o resto subia normalmente.
#
#  O sintoma engana porque o postgres aparece RUNNING: ele esta no ar, mas
#  ainda no meio da recuperacao inicial e recusando conexao.
# ============================================================================
set -euo pipefail

for _ in $(seq 1 150); do
  if pg_isready -h 127.0.0.1 -p 5432 -U postgres -q; then
    exec "$@"
  fi
  sleep 2
done

echo "esperar-banco: o Postgres nao aceitou conexao em 5 minutos; desistindo de: $*" >&2
exit 1
