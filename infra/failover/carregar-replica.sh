#!/usr/bin/env bash
# ============================================================================
#  Carrega o backup de producao num Postgres, onde quer que ele esteja
# ============================================================================
#
#  ESTE E O UNICO LUGAR com as correcoes do restore. O preparar-replica.sh e um
#  atalho que chama este script apontando para o container local; a recarga da
#  Render chama este mesmo arquivo apontando para o servico erp-db. Ter as
#  correcoes em um lugar so e proposital: elas sao sutis e silenciosas, e duas
#  copias divergiriam sem ninguem perceber - ate a hora em que a replica
#  precisasse funcionar.
#
#  Ele fala com o banco por TCP, com psql/pg_restore comuns. Nao depende de
#  docker, nem de compose, nem de estar na mesma maquina.
#
#  AS QUATRO CORRECOES (todas descobertas rodando, todas silenciosas)
#    1. os papeis precisam existir ANTES do restore, senao as policies caem
#       (medido: 35 de 1.445);
#    2. o dump nao traz EXTENSION nenhuma nem o schema "extensions";
#    3. o dump nao traz GRANTs (foi gerado com --no-privileges);
#    4. auth e storage so restauram completos se restaurados pelos DONOS.
#
#  USO
#    PGHOST=... PGPORT=5432 PGUSER=postgres PGPASSWORD=... \
#      ./carregar-replica.sh /caminho/producao.dump
#
#  A senha vem do ambiente (PGPASSWORD), nunca de argumento: argumento aparece
#  na lista de processos da maquina inteira.
# ============================================================================
set -uo pipefail

DUMP="${1:-}"
export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-55432}"
export PGUSER="${PGUSER:-postgres}"
export PGDATABASE="${PGDATABASE:-postgres}"
JOBS="${JOBS:-4}"
LOG_ERR="${LOG_ERR:-/tmp/carregar-replica.err.log}"

log() { printf '[%(%H:%M:%S)T] %s\n' -1 "$*"; }
erro() { log "FALHOU: $*" >&2; exit 1; }

[[ -n "$DUMP" && -f "$DUMP" ]] || erro "informe o dump: ./carregar-replica.sh producao.dump"
command -v psql >/dev/null || erro "psql nao encontrado (instale postgresql-client-17)"
command -v pg_restore >/dev/null || erro "pg_restore nao encontrado"

sql()        { psql -v ON_ERROR_STOP=1 -Atc "$1"; }
sql_ignora() { psql -Atc "$1" 2>/dev/null || true; }

log "Carregando em $PGHOST:$PGPORT  (dump: $(du -h "$DUMP" | cut -f1))"

# --- 0. o banco responde? ---------------------------------------------------
pronto=nao
for _ in $(seq 1 60); do
  [[ "$(sql_ignora 'select 1')" == "1" ]] && { pronto=sim; break; }
  sleep 2
done
[[ "$pronto" == "sim" ]] || erro "o banco em $PGHOST:$PGPORT nao respondeu"
SERVIDOR="$(sql 'show server_version')"
log "  servidor: $SERVIDOR"

# --- 1. a versao do servidor aguenta este dump? -----------------------------
# Checagem ANTES de qualquer coisa, porque a falha por versao e a mais traicoeira
# de todas: o pg_restore recusa o arquivo inteiro com UMA linha, e "1 erro" e
# exatamente o que um restore BEM-SUCEDIDO produz (o benigno "schema public
# already exists"). Contar erros nao distingue os dois casos.
if command -v pg_restore >/dev/null; then
  CRIADO_POR="$(pg_restore -l "$DUMP" 2>/dev/null | grep -m1 'Dumped by pg_dump version' | grep -oE '[0-9]+' | head -1)"
  MAIOR_SERVIDOR="${SERVIDOR%%.*}"
  if [[ -n "$CRIADO_POR" ]] && (( CRIADO_POR > MAIOR_SERVIDOR )); then
    erro "o backup foi gerado pelo pg_dump $CRIADO_POR e este servidor e $MAIOR_SERVIDOR. Ele recusaria o arquivo inteiro e a replica ficaria VAZIA. Suba a versao do servidor."
  fi
  log "  dump gerado por pg_dump ${CRIADO_POR:-?}, servidor $MAIOR_SERVIDOR - compativel"
fi

# --- 2. CORRECAO 1: os papeis, ANTES ----------------------------------------
# CREATE POLICY ... TO authenticated falha CALADO se o papel nao existe, no meio
# de 8 mil objetos. Medido em 29/09/2026: sem eles, 35 de 1.445 policies.
# Best-effort: na imagem supabase/postgres alguns papeis ja existem e sao
# protegidos pela supautils ("reserved role"). O que vale e a conferencia
# logo abaixo.
log "Garantindo os papeis..."
for papel in anon authenticated authenticator cli_login_postgres dashboard_user \
             service_role supabase_admin supabase_auth_admin supabase_etl_admin \
             supabase_functions_admin supabase_privileged_role supabase_read_only_user \
             supabase_realtime_admin supabase_replication_admin supabase_storage_admin; do
  sql_ignora "do \$\$ begin if not exists (select 1 from pg_roles where rolname='$papel') then create role \"$papel\" nologin noinherit; end if; end \$\$;" >/dev/null
done
faltando=""
for papel in anon authenticated authenticator service_role supabase_auth_admin supabase_storage_admin; do
  [[ "$(sql_ignora "select 1 from pg_roles where rolname='$papel'")" == "1" ]] || faltando="$faltando $papel"
done
[[ -z "$faltando" ]] || erro "papeis essenciais ausentes:$faltando"
log "  $(sql "select count(*) from pg_roles where rolname not like 'pg\\_%'") papeis, os 6 essenciais conferidos"

# --- 3. CORRECAO 2: extensoes e o schema "extensions" -----------------------
# O backup e gerado por schema, entao o "extensions" da Supabase fica de fora e
# nenhuma EXTENSION vem junto (conferido: 8.276 entradas no dump, ZERO do tipo
# EXTENSION). Sem pre-criar, somem em silencio: o indice de busca de
# "EMPREGADOS" (gin_trgm_ops), as DUAS travas de sobreposicao (EXCLUDE USING
# gist - vigencia de orcamento e sala de reuniao) e a tabela
# sup_compra_pedido_envio inteira, cujo DEFAULT chama extensions.gen_random_bytes.
log "Criando schemas e extensoes que o dump nao traz..."
sql_ignora "create schema if not exists extensions;" >/dev/null
for ext in "pg_trgm:public" "btree_gist:public" "unaccent:public" "pgcrypto:extensions"; do
  sql_ignora "create extension if not exists ${ext%%:*} with schema ${ext##*:};" >/dev/null
done
log "  $(sql 'select count(*) from pg_extension') extensoes"

# --- 4. restaurar -----------------------------------------------------------
log "Restaurando com --jobs $JOBS..."
inicio=$(date +%s)
pg_restore --no-owner --no-privileges --jobs "$JOBS" -d "$PGDATABASE" "$DUMP" \
  > /tmp/carregar-replica.log 2> "$LOG_ERR"
rc=$?
erros=$(grep -c '^pg_restore: error' "$LOG_ERR" 2>/dev/null || echo 0)
log "  pg_restore saiu com $rc e ${erros} erro(s)"

if grep -q 'unsupported version' "$LOG_ERR" 2>/dev/null; then
  erro "o servidor e mais antigo que o backup - nada foi restaurado. Ver $LOG_ERR"
fi

# --- 5. CORRECAO 4: auth e storage pelos DONOS ------------------------------
# Como `postgres` (que na imagem supabase/postgres NAO e superusuario) vem
# "permission denied for schema auth" e faltam 14 tabelas - as de recurso novo
# do GoTrue/Storage (MFA, WebAuthn, OAuth, SCIM). Os dados de login em si vem na
# primeira passada, porque essas tabelas a imagem ja tinha.
# O -h explicito aqui NAO e enfeite: pelo socket unix o pg_hba manda `peer`, a
# identidade vem do usuario do sistema e a senha e ignorada - o erro diz
# "Peer authentication failed", que parece problema de senha.
log "Completando auth e storage com os papeis donos..."
for par in "auth:supabase_auth_admin" "storage:supabase_storage_admin"; do
  esquema="${par%%:*}"; dono="${par##*:}"
  PGUSER="$dono" pg_restore -h "$PGHOST" -p "$PGPORT" --no-owner --no-privileges \
    -n "$esquema" -d "$PGDATABASE" "$DUMP" >> /tmp/carregar-replica.log 2>> "$LOG_ERR" || true
  log "  $esquema: $(sql "select count(*) from information_schema.tables where table_schema='$esquema' and table_type='BASE TABLE'") tabelas"
done

# --- 6. CORRECAO 3: devolver os GRANTs --------------------------------------
# O dump e gerado com --no-privileges (necessario para restaurar em qualquer
# Postgres). Sem os GRANTs o PostgREST nao enxerga as tabelas e a aplicacao
# abre em branco - parece backup quebrado, e e so permissao.
log "Aplicando os GRANTs..."
for esquema in public storage; do
  sql_ignora "grant usage on schema $esquema to anon, authenticated, service_role;" >/dev/null
  sql_ignora "grant all on all tables    in schema $esquema to anon, authenticated, service_role;" >/dev/null
  sql_ignora "grant all on all sequences in schema $esquema to anon, authenticated, service_role;" >/dev/null
  sql_ignora "grant all on all functions in schema $esquema to anon, authenticated, service_role;" >/dev/null
done
# E assim que o PostgREST troca de identidade conforme o token recebido.
sql_ignora "grant anon, authenticated, service_role to authenticator;" >/dev/null

# Nota: alinhar a senha das contas de servico NAO acontece aqui. Na imagem
# supabase/postgres a extensao supautils protege esses papeis depois do boot -
# quem faz isso e o db-init/, na inicializacao. Num Postgres puro, o operador
# cria os papeis com senha antes de rodar este script.

# --- 7. conferir ------------------------------------------------------------
tabelas=$(sql_ignora "select count(*) from information_schema.tables where table_schema in ('public','auth','storage','espelho') and table_type='BASE TABLE'")
policies=$(sql_ignora "select count(*) from pg_policies")
logins=$(sql_ignora "select count(*) from auth.users")
segundos=$(( $(date +%s) - inicio ))

log "Resultado: ${tabelas} tabelas | ${policies} policies | ${logins} logins | ${segundos}s"
# Referencia medida em 30/09/2026: 641 tabelas, 1.445 policies, 154 logins.

problemas=""
(( ${tabelas:-0}  >= 600  )) || problemas="$problemas tabelas=${tabelas:-0}(<600)"
(( ${policies:-0} >= 1400 )) || problemas="$problemas policies=${policies:-0}(<1400)"
(( ${logins:-0}   >= 100  )) || problemas="$problemas logins=${logins:-0}(<100)"
[[ -z "$problemas" ]] || erro "a replica ficou incompleta:$problemas"

log "Carga concluida."
