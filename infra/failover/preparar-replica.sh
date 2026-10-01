#!/usr/bin/env bash
# ============================================================================
#  Atalho: carrega o backup na replica que este docker-compose subiu
# ============================================================================
#
#  Este arquivo NAO tem logica de restauracao. Ele so descobre o endereco e a
#  senha do compose local e chama o carregar-replica.sh, que e onde vivem as
#  quatro correcoes do restore.
#
#  POR QUE ASSIM
#  Ate 30/09/2026 este script tinha a copia dele proprio das correcoes, e a
#  recarga da Render teria uma terceira. Sao correcoes sutis e SILENCIOSAS -
#  papel faltando derruba 1.410 policies sem uma linha de erro. Tres copias
#  divergiriam sem ninguem notar, e o lugar onde isso apareceria seria a
#  emergencia em que a replica precisasse funcionar. Uma copia so.
#
#  USO
#    ./preparar-replica.sh producao.dump
# ============================================================================
set -uo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DUMP="${1:-}"

erro() { echo "FALHOU: $*" >&2; exit 1; }

[[ -n "$DUMP" && -f "$DUMP" ]] || erro "informe o dump: ./preparar-replica.sh producao.dump"
[[ -f "$AQUI/.env" ]] || erro "falta o .env. Rode: node gerar-chaves.mjs"

command -v psql >/dev/null || erro "psql nao encontrado. Instale com:
    sudo apt-get install -y postgresql-client-17
  (o cliente pode ser mais novo que o servidor; mais ANTIGO nao serve - ele
   recusa o arquivo inteiro com 'unsupported version in file header')"

# shellcheck disable=SC1091
set -a; source "$AQUI/.env"; set +a
[[ -n "${POSTGRES_PASSWORD:-}" ]] || erro ".env sem POSTGRES_PASSWORD"

# O compose publica o banco nesta porta do host (ver PORTA_POSTGRES no .env).
export PGHOST=127.0.0.1
export PGPORT="${PORTA_POSTGRES:-55432}"
export PGUSER=postgres
export PGDATABASE=postgres
export PGPASSWORD="$POSTGRES_PASSWORD"
export LOG_ERR="$AQUI/restore-replica.err.log"

exec "$AQUI/carregar-replica.sh" "$DUMP"
