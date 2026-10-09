#!/usr/bin/env bash
# ============================================================================
#  Traz o schema do Supabase para o cluster novo, na ORDEM que funciona.
#
#  Provado em 08/10/2026: ao final, as oito contagens batem exatamente com a
#  producao -- 647 tabelas, 1.416 politicas de RLS, 1.449 funcoes, 30 views,
#  786 tipos, 126 sequences, 493 triggers, 643 tabelas com RLS ligada.
#
#  SO LE a producao. Nao cria publicacao, nao cria slot, nao escreve nada no
#  Supabase. Pode rodar em horario comercial.
#
#  A ORDEM E O SEGREDO. Restaurando o dump direto, das 1.416 politicas entra
#  UMA -- e o banco sobe funcionando e sem controle de acesso, sem erro visivel.
#  A causa: o dump cita 3.156 vezes auth.uid() e 1.397 vezes o papel
#  "authenticated". Faltando o papel, o CREATE POLICY inteiro falha e o psql
#  segue adiante.
#
#  Uso:
#    SENHA_SUPABASE=... SENHA_DESTINO=... DESTINO_HOST=10.77.0.12 \
#    BANCO=erp bash restaurar-schema.sh
# ============================================================================
set -euo pipefail
: "${SENHA_SUPABASE:?senha do postgres da producao}"
: "${SENHA_DESTINO:?senha do postgres do cluster novo}"
DESTINO_HOST="${DESTINO_HOST:-10.77.0.12}"   # o LIDER do cluster
# "postgres" de proposito: e o nome que o Supabase usa, entao as strings de
# conexao nao mudam de forma nenhuma na virada.
BANCO="${BANCO:-postgres}"
REF="${REF:-fwmzeaztjxrxxzxzxmgc}"
# aws-1, nao aws-0: o aws-0 responde na porta mas recusa o tenant.
ORIGEM_HOST="${ORIGEM_HOST:-aws-1-sa-east-1.pooler.supabase.com}"
PGB="${PGB:-/usr/lib/postgresql/17/bin}"
SAIDA="${SAIDA:-/root/migracao}"
mkdir -p "$SAIDA"; cd "$SAIDA"
log(){ echo "[$(date +%H:%M:%S)] $*"; }
D(){ PGPASSWORD="$SENHA_DESTINO" psql -h "$DESTINO_HOST" -p 5432 -U postgres "$@"; }

# ── 1. dump da producao (leitura pura) ──────────────────────────────────────
export PGPASSWORD="$SENHA_SUPABASE"
if [ ! -s schema-public.sql ]; then
  log "dump do schema public"
  "$PGB/pg_dump" -h "$ORIGEM_HOST" -p 5432 -U "postgres.$REF" -d postgres \
    --schema-only --schema=public --no-owner --no-privileges -f schema-public.sql
fi
if [ ! -s schema-auth-storage.sql ]; then
  # auth e storage vem da producao em vez de serem reescritos a mao: e o
  # contrato real que as 1.416 politicas assumem, nao uma reconstrucao.
  log "dump dos schemas auth e storage"
  "$PGB/pg_dump" -h "$ORIGEM_HOST" -p 5432 -U "postgres.$REF" -d postgres \
    --schema-only --schema=auth --schema=storage --no-owner --no-privileges \
    -f schema-auth-storage.sql
fi

# ── 2. destino limpo ────────────────────────────────────────────────────────
log "recriando o banco $BANCO"
D -d postgres -q -c "drop database if exists $BANCO" -c "create database $BANCO"

# ── 3. preparacao: papeis, schemas, extensoes ───────────────────────────────
log "preparando (papeis, schemas, extensoes)"
D -d "$BANCO" -q -v ON_ERROR_STOP=1 -f "$(dirname "$0")/preparar-destino.sql"

# ── 4. auth e storage, primeira passada ─────────────────────────────────────
# Vai acusar ~116 erros de "type does not exist": estes schemas referenciam
# tipos e funcoes do public, que ainda nao existe. E esperado, nao e falha.
log "auth/storage (1 de 2) -- erros de tipo aqui sao esperados"
D -d "$BANCO" -f schema-auth-storage.sql >/dev/null 2>passo4.log || true

# ── 5. o schema do ERP ──────────────────────────────────────────────────────
log "schema public"
D -d "$BANCO" -f schema-public.sql >/dev/null 2>passo5.log || true
echo "       erros: $(grep -c 'ERROR' passo5.log || echo 0)"

# ── 6. auth e storage, segunda passada ──────────────────────────────────────
# Agora o public existe e o que falhou no passo 4 entra. Os erros desta
# passada sao todos "already exists" -- sinal de que nada ficou faltando.
log "auth/storage (2 de 2) -- aqui so deve sobrar 'already exists'"
D -d "$BANCO" -f schema-auth-storage.sql >/dev/null 2>passo6.log || true

# ── 7. conferencia ──────────────────────────────────────────────────────────
echo
echo "=============== CONFERENCIA ==============="
conf(){ printf "  %-22s %6s   (esperado %s)%s\n" "$1" "$3" "$2" "$([ "$2" = "$3" ] && echo "" || echo "   <<< DIFERE")"; }
conf "tabelas em public" 647  "$(D -d "$BANCO" -At -c "select count(*) from pg_tables where schemaname='public'")"
conf "politicas de RLS"  1416 "$(D -d "$BANCO" -At -c "select count(*) from pg_policies where schemaname='public'")"
conf "funcoes em public" 1449 "$(D -d "$BANCO" -At -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'")"
conf "views"             30   "$(D -d "$BANCO" -At -c "select count(*) from pg_views where schemaname='public'")"
conf "tipos"             786  "$(D -d "$BANCO" -At -c "select count(*) from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype in ('e','c','d')")"
conf "sequences"         126  "$(D -d "$BANCO" -At -c "select count(*) from pg_sequences where schemaname='public'")"
conf "triggers"          493  "$(D -d "$BANCO" -At -c "select count(*) from pg_trigger g join pg_class c on c.oid=g.tgrelid join pg_namespace n on n.oid=c.relnamespace where not g.tgisinternal and n.nspname='public'")"
conf "tabelas com RLS"   643  "$(D -d "$BANCO" -At -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relrowsecurity")"
echo "==========================================="
echo
echo "  Qualquer linha com DIFERE: NAO seguir para a copia de dados."
echo "  As contagens vem de docs/migracao-supabase.md; se a producao mudou,"
echo "  conferir os numeros novos antes de culpar o restore."
