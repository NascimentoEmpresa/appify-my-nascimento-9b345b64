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
# SEM --no-privileges, de proposito. Com ele o dump sai limpo e bonito -- e
# SEM UM UNICO GRANT. O resultado: o PostgREST conecta, enxerga o schema e
# responde 42501 "permission denied for table" em tudo; o GoTrue nao consegue
# nem criar a propria tabela de controle ("permission denied for schema
# public") e fica em laco de reinicio; o storage morre com "relation
# migrations does not exist". Medido em 09-13/10/2026.
#
# Os GRANTs sao parte do modelo de acesso, nao enfeite: no Supabase o padrao
# e GRANT amplo para anon/authenticated e a RLS decidindo linha a linha. Sem
# os GRANTs, a RLS nem chega a ser consultada.
#
# --no-owner CONTINUA: os objetos passam a pertencer a quem restaura, o que
# evita erro de troca de dono e nao muda em nada o acesso -- quem manda e a
# combinacao GRANT + politica de RLS.
export PGPASSWORD="$SENHA_SUPABASE"
if [ ! -s schema-public.sql ]; then
  log "dump do schema public"
  "$PGB/pg_dump" -h "$ORIGEM_HOST" -p 5432 -U "postgres.$REF" -d postgres \
    --schema-only --schema=public --no-owner -f schema-public.sql
fi
if [ ! -s schema-auth-storage.sql ]; then
  # auth e storage vem da producao em vez de serem reescritos a mao: e o
  # contrato real que as 1.416 politicas assumem, nao uma reconstrucao.
  log "dump dos schemas auth e storage"
  "$PGB/pg_dump" -h "$ORIGEM_HOST" -p 5432 -U "postgres.$REF" -d postgres \
    --schema-only --schema=auth --schema=storage --no-owner \
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

# ── 6b. historico de migracoes do GoTrue e do Storage ───────────────────────
# O dump e schema-only, entao auth.schema_migrations e storage.migrations vem
# VAZIAS. O GoTrue e o Storage leem essas tabelas para saber o que ja rodou --
# vazias, eles concluem que nada foi aplicado e tentam criar tudo do zero por
# cima do schema restaurado. O GoTrue entra em laco de reinicio em
# 00_init_auth_schema.up.sql; o Storage morre em "relation migrations does not
# exist". Medido em 13/10/2026.
log "historico de migracoes do GoTrue e do Storage"
PGPASSWORD="$SENHA_SUPABASE" "$PGB/pg_dump" -h "$ORIGEM_HOST" -p 5432 -U "postgres.$REF" -d postgres \
  --data-only --table=auth.schema_migrations --table=storage.migrations \
  -f historico-migracoes.sql
D -d "$BANCO" -q -c "truncate auth.schema_migrations, storage.migrations" >/dev/null 2>&1 || true
D -d "$BANCO" -q -f historico-migracoes.sql >/dev/null 2>&1 || true

# ── 6c. donos, search_path e limites de tempo ───────────────────────────────
log "pos-restauracao (donos de auth/storage, search_path, timeouts)"
D -d "$BANCO" -q -f "$(dirname "$0")/pos-restauracao.sql" 2>&1 | grep -vi notice || true

# ── 6d. atributos e participacoes de papel ──────────────────────────────────
# NAO e detalhe de acabamento: sem isto o storage recusa TODA chamada e o
# service_role nao passa pela RLS. E nao vem no dump -- ver o cabecalho de
# papeis-atributos.sql, que explica por que pg_dump nao carrega isso.
log "atributos e participacoes de papel (o que o dump nao carrega)"
D -d "$BANCO" -q -f "$(dirname "$0")/papeis-atributos.sql" 2>&1 | grep -vi notice || true

# ── 7. conferencia ──────────────────────────────────────────────────────────
# A conferencia agora e um script proprio que le a PRODUCAO VIVA e compara
# objeto por objeto -- contagens, indices, restricoes e papeis.
#
# A versao antiga comparava contagens contra numeros fixos anotados no dia do
# desenho. Ela envelheceu em tres dias (a producao foi de 647 para 656 tabelas
# e toda linha passou a dizer DIFERE sem nada estar errado) e, pior, nao olhava
# indice nem atributo de papel -- as duas portas por onde os defeitos do
# storage entraram.
echo
if [ -n "${SENHA_SUPABASE:-}" ]; then
  SENHA_DESTINO="$SENHA_DESTINO" DESTINO_HOST="$DESTINO_HOST" DESTINO_PORTA=5432 \
    "$(dirname "$0")/conferir-contra-producao.sh" || true
else
  echo "  SENHA_SUPABASE nao esta no ambiente: rode a conferencia a parte"
  echo "  ./infra/ha/conferir-contra-producao.sh"
fi

echo
echo "  PRAZO DE VALIDADE DESTE RESTORE"
echo "  O schema envelhece: a producao recebe migration quase todo dia. Entre"
echo "  09/10 e 13/10 ela ganhou 2 funcoes, 1 indice e mudou 1 CHECK -- quatro"
echo "  dias, quatro mudancas. No dia da virada, rodar a conferencia ANTES de"
echo "  comecar; se acusar diferenca, refazer o restore (apagar os .sql de"
echo "  $SAIDA primeiro, senao o script reusa o dump velho)."
