#!/usr/bin/env bash
# ============================================================================
#  Carrega o backup de producao na replica em container  (versao Linux)
# ============================================================================
#
#  POR QUE ESTE ARQUIVO EXISTE, JA HAVENDO O preparar-replica.ps1
#  O .ps1 roda no PC do Eduardo e serve para ENSAIAR. Mas a replica de verdade
#  vai morar num host Linux (Render, AWS, servidor proprio) onde nao existe
#  PowerShell, nao existe psql instalado e nao existe o "S:". Este script faz o
#  mesmo trabalho usando so o que o host precisa ter: docker e o dump.
#
#  E resolve um problema concreto medido em 30/09/2026: do Windows nao se
#  alcanca a porta publicada pelo Docker de dentro do WSL - nem por localhost
#  nem pelo IP do WSL, os dois dao "Connection refused". Rodando aqui dentro,
#  o Windows sai do caminho.
#
#  AS QUATRO CORRECOES QUE OS ENSAIOS REVELARAM (as mesmas do .ps1):
#    1. os papeis precisam existir ANTES do restore, senao as policies caem
#       em silencio;
#    2. o dump nao traz GRANTs (foi gerado com --no-privileges);
#    3. o dump nao traz EXTENSION nenhuma nem o schema "extensions";
#    4. as contas de servico precisam de LOGIN + senha, senao rest/auth/storage
#       ficam em restart loop com "password authentication failed".
#
#  USO:
#    ./preparar-replica.sh /caminho/producao.dump
#    (o .dump ja descriptografado; o gpg fica fora daqui de proposito)
# ============================================================================
set -euo pipefail

DUMP="${1:-}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICO_DB="${SERVICO_DB:-db}"
JOBS="${JOBS:-4}"

log() { printf '[%(%H:%M:%S)T] %s\n' -1 "$*"; }
erro() { log "FALHOU: $*" >&2; exit 1; }

[[ -n "$DUMP" ]] || erro "informe o caminho do dump: ./preparar-replica.sh producao.dump"
[[ -f "$DUMP" ]] || erro "dump nao encontrado: $DUMP"
[[ -f "$AQUI/.env" ]] || erro "falta o .env. Rode: node gerar-chaves.mjs"

# shellcheck disable=SC1091
set -a; source "$AQUI/.env"; set +a
[[ -n "${POSTGRES_PASSWORD:-}" ]] || erro ".env sem POSTGRES_PASSWORD"

cd "$AQUI"

# psql SEMPRE dentro do container: o host nao precisa ter cliente Postgres.
sql() { docker compose exec -T "$SERVICO_DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc "$1"; }
sql_ignora() { docker compose exec -T "$SERVICO_DB" psql -U postgres -d postgres -Atc "$1" 2>/dev/null || true; }

log "Preparando a replica  (dump: $(du -h "$DUMP" | cut -f1))"

# --- 1. a replica esta no ar? ----------------------------------------------
for _ in $(seq 1 60); do
  if [[ "$(sql_ignora 'select 1')" == "1" ]]; then break; fi
  sleep 2
done
[[ "$(sql_ignora 'select 1')" == "1" ]] || erro "o servico '$SERVICO_DB' nao respondeu. Rode: docker compose up -d"
log "  banco respondendo ($(sql 'show server_version'))"

# --- 2. CORRECAO 1: os papeis, ANTES do restore ------------------------------
# CREATE POLICY ... TO authenticated FALHA se o papel nao existir - e falha em
# silencio no meio de 8 mil objetos. Medido em 29/09/2026: sem os papeis, de
# 1.445 policies so 35 eram restauradas. Banco com todos os dados e 2% da
# seguranca: todo usuario enxergando tudo.
#
# A criacao aqui e BEST-EFFORT de proposito, e a diferenca em relacao ao .ps1:
# o .ps1 restaura num Postgres puro, onde nenhum papel existe. Aqui a imagem
# supabase/postgres ja trouxe quase todos - e alguns ela PROTEGE. Medido em
# 30/09/2026: "supabase_realtime_admin" is a reserved role, only superusers can
# modify it, e isso vinha do proprio postgres. Falhar ali seria parar o restore
# por causa de um papel que ja existe e que o ERP nem usa em policy.
# O que realmente importa e a conferencia logo abaixo.
log "Garantindo os papeis da Supabase..."
for papel in anon authenticated authenticator cli_login_postgres dashboard_user \
             service_role supabase_admin supabase_auth_admin supabase_etl_admin \
             supabase_functions_admin supabase_privileged_role supabase_read_only_user \
             supabase_realtime_admin supabase_replication_admin supabase_storage_admin; do
  sql_ignora "do \$\$ begin if not exists (select 1 from pg_roles where rolname='$papel') then create role \"$papel\" nologin noinherit; end if; end \$\$;" >/dev/null
done

# Estes seis NAO sao negociaveis: sao os que aparecem nas policies e nas
# conexoes dos servicos. Faltando um, o restore vai adiante e entrega um banco
# inseguro sem avisar - entao paramos aqui.
faltando=""
for papel in anon authenticated authenticator service_role supabase_auth_admin supabase_storage_admin; do
  if [[ "$(sql_ignora "select 1 from pg_roles where rolname='$papel'")" != "1" ]]; then
    faltando="$faltando $papel"
  fi
done
[[ -z "$faltando" ]] || erro "papeis essenciais ausentes:$faltando"
log "  $(sql "select count(*) from pg_roles where rolname not like 'pg\\_%'") papeis presentes, os 6 essenciais conferidos"

# --- 3. CORRECAO 3: os schemas e extensoes que o dump nao traz ---------------
# O backup e gerado por schema (public, auth, storage, espelho), entao o schema
# "extensions" da Supabase fica FORA e nenhuma EXTENSION vem junto. Conferido
# com pg_restore -l: 8.276 entradas no dump, ZERO do tipo EXTENSION.
# Sem pre-criar, o restore perde em silencio:
#   public.gin_trgm_ops         -> indice de busca por nome em "EMPREGADOS"
#   EXCLUDE USING gist          -> as DUAS travas de sobreposicao (vigencia de
#                                  orcamento e sala/horario de reuniao). Sem
#                                  elas o banco passa a aceitar reserva dupla.
#   extensions.gen_random_bytes -> DEFAULT de coluna em sup_compra_pedido_envio:
#                                  sem a funcao a TABELA nao nasce, e caem com
#                                  ela 2 indices, 2 FKs e 1 policy.
log "Criando schemas e extensoes que o dump nao traz..."
sql "create schema if not exists extensions;" >/dev/null
for ext in "pg_trgm:public" "btree_gist:public" "unaccent:public" "pgcrypto:extensions"; do
  sql "create extension if not exists ${ext%%:*} with schema ${ext##*:};" >/dev/null
done
log "  $(sql 'select count(*) from pg_extension') extensoes instaladas"

# --- 4. restaurar -------------------------------------------------------------
# O dump entra no container por docker cp: pg_restore com --jobs precisa de
# arquivo pesquisavel, nao aceita o dump por stdin.
log "Copiando o dump para dentro do container..."
docker compose cp "$DUMP" "$SERVICO_DB:/tmp/producao.dump"

# Os logs ficam ao lado do compose, nao em /tmp: /tmp do WSL some quando a
# distro reinicia, e ja perdemos o diagnostico de um restore por causa disso.
LOG_OUT="$AQUI/restore-replica.log"
LOG_ERR="$AQUI/restore-replica.err.log"

log "Restaurando com --jobs $JOBS (o aviso 'schema public already exists' e esperado)..."
inicio=$(date +%s)
set +e
docker compose exec -T "$SERVICO_DB" pg_restore \
  -U postgres -d postgres --no-owner --no-privileges --jobs "$JOBS" \
  /tmp/producao.dump > "$LOG_OUT" 2> "$LOG_ERR"
rc=$?
set -e
log "  restaurado em $(( ($(date +%s) - inicio) / 60 ))min $(( ($(date +%s) - inicio) % 60 ))s"
erros=$(grep -c '^pg_restore: error' "$LOG_ERR" || true)
log "  pg_restore saiu com $rc e ${erros:-0} erro(s) - detalhes em $LOG_ERR"

# ARMADILHA QUE JA NOS PEGOU: versao do pg_restore mais antiga que a do dump.
# Producao e Postgres 17.6 e o dump sai do pg_dump 17.11. Um servidor 15 na
# replica recusa o arquivo inteiro com UMA linha so - e "1 erro" e exatamente
# o numero que um restore BEM-SUCEDIDO produz (o benigno "schema public already
# exists"). Ou seja: o contador de erros nao distingue os dois casos. Por isso
# esta checagem e por texto, e para antes.
if grep -q 'unsupported version' "$LOG_ERR" 2>/dev/null; then
  log "  --------------------------------------------------------------"
  log "  O BANCO DA REPLICA E MAIS ANTIGO QUE O BACKUP."
  log "  $(grep -m1 'unsupported version' "$LOG_ERR")"
  log "  O dump foi gerado por um pg_dump mais novo que este servidor"
  log "  ($(sql 'show server_version')). Nada foi restaurado."
  log "  Corrija a tag da imagem 'db' no docker-compose.yml para uma versao"
  log "  >= a da producao e recrie o volume:"
  log "    docker compose down -v && docker compose up -d"
  log "  Para saber a versao do dump:  pg_restore -l backup.dump | head -8"
  log "  --------------------------------------------------------------"
  erro "versao do banco da replica incompativel com o backup"
fi

# 1 erro e o normal e benigno: CREATE SCHEMA public num banco que ja o tem.
if (( ${erros:-0} > 1 )); then
  log "  ATENCAO: mais de um erro. Confira antes de confiar nesta replica:"
  grep -A1 '^pg_restore: error' "$LOG_ERR" | head -20
fi

# --- 4b. auth e storage: restaurar COM O DONO, nao com postgres --------------
# Na imagem supabase/postgres os schemas `auth` e `storage` pertencem a
# supabase_auth_admin e supabase_storage_admin. O usuario `postgres` (que nesta
# imagem NAO e superusuario) leva "permission denied for schema auth" ao tentar
# criar objeto neles. Medido em 30/09/2026: a passada como postgres deixou 16
# das 27 tabelas de auth e 5 das 8 de storage. As 14 que faltaram sao de
# recurso novo do GoTrue/Storage (MFA, WebAuthn, OAuth, SCIM, buckets
# vetoriais) - a producao roda uma versao mais nova que a fixada neste compose,
# entao os proprios servicos nao as criam no boot.
# Os dados de login em si (auth.users, identities, sessions, refresh_tokens)
# vieram na primeira passada, porque essas tabelas a imagem ja tinha.
# O -h 127.0.0.1 NAO e enfeite. Sem ele o pg_restore usa o socket unix, onde o
# pg_hba desta imagem manda `peer`: a identidade vem do usuario do SISTEMA
# operacional dentro do container (root), e a senha e simplesmente ignorada.
# O sintoma e enganoso, porque fala de senha:
#   FATAL: Peer authentication failed for user "supabase_auth_admin"
# Por TCP a autenticacao passa a ser por senha e funciona. Com o socket, esta
# etapa rodava, nao reclamava alto e deixava auth com 16 de 27 tabelas.
log "Completando auth e storage com os papeis donos (por TCP, nao pelo socket)..."
for par in "auth:supabase_auth_admin" "storage:supabase_storage_admin"; do
  esquema="${par%%:*}"; dono="${par##*:}"
  docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" "$SERVICO_DB" \
    pg_restore -h 127.0.0.1 -U "$dono" -d postgres --no-owner --no-privileges -n "$esquema" \
    /tmp/producao.dump >> "$LOG_OUT" 2>> "$LOG_ERR" || true
  log "  $esquema: $(sql "select count(*) from information_schema.tables where table_schema='$esquema' and table_type='BASE TABLE'") tabelas"
done

docker compose exec -T "$SERVICO_DB" rm -f /tmp/producao.dump || true

# --- 5. CORRECAO 2: devolver os GRANTs ---------------------------------------
# O dump e gerado com --no-privileges (necessario para restaurar em qualquer
# Postgres). Sem os GRANTs o PostgREST nao enxerga as tabelas e a aplicacao
# abre em branco - parece backup quebrado, e e so permissao.
log "Aplicando os GRANTs..."
for esquema in public storage; do
  sql "grant usage on schema $esquema to anon, authenticated, service_role;" >/dev/null
  sql "grant all on all tables    in schema $esquema to anon, authenticated, service_role;" >/dev/null
  sql "grant all on all sequences in schema $esquema to anon, authenticated, service_role;" >/dev/null
  sql "grant all on all functions in schema $esquema to anon, authenticated, service_role;" >/dev/null
done
# authenticator precisa poder ASSUMIR os outros papeis: e assim que o PostgREST
# troca de identidade conforme o token que recebe.
sql "grant anon, authenticated, service_role to authenticator;" >/dev/null

# --- 6. CORRECAO 4: login das contas de servico ------------------------------
# A imagem supabase/postgres ja traz estes papeis, mas com senha PROPRIA dela -
# nao a do nosso .env. Medido em 30/09/2026: sem este bloco, rest e auth ficam
# em "Restarting (1)" para sempre com
#   FATAL: password authentication failed for user "authenticator"
# e o sintoma na tela e a aplicacao inteira em branco.
# Na imagem supabase/postgres isto normalmente JA foi resolvido no primeiro
# boot, por db-init/zz-senhas-dos-servicos.sh - e tem de ser lá, porque depois
# do boot a extensao supautils protege estes tres papeis e nem o usuario
# `postgres` consegue alterá-los ("only superusers can modify it").
# O ALTER abaixo e o caminho para o outro cenario: replica em Postgres PURO,
# onde os papeis nascem sem senha e nao ha supautils nenhuma.
# Por isso e TOLERANTE: falhar aqui na imagem da Supabase e o esperado, e
# derrubar o script neste ponto esconderia a conferencia do passo 7 - foi
# exatamente assim que um restore vazio passou por bom em 30/09/2026.
log "Alinhando a senha das contas de servico (rest/auth/storage)..."
for conta in authenticator supabase_auth_admin supabase_storage_admin; do
  sql_ignora "alter role \"$conta\" with login password '$POSTGRES_PASSWORD';" >/dev/null
done
# GoTrue e Storage rodam migration propria no boot e precisam mandar no proprio
# schema. Com --no-owner os schemas chegam pertencendo a postgres.
sql_ignora "alter schema auth    owner to supabase_auth_admin;"    >/dev/null
sql_ignora "alter schema storage owner to supabase_storage_admin;" >/dev/null
sql_ignora "grant all on all tables    in schema auth    to supabase_auth_admin;"    >/dev/null
sql_ignora "grant all on all sequences in schema auth    to supabase_auth_admin;"    >/dev/null
sql_ignora "grant all on all tables    in schema storage to supabase_storage_admin;" >/dev/null
sql_ignora "grant all on all sequences in schema storage to supabase_storage_admin;" >/dev/null

# --- 7. conferir --------------------------------------------------------------
log "Conferindo o que chegou:"
printf '  tabelas ......... %s\n' "$(sql "select count(*) from information_schema.tables where table_schema in ('public','auth','storage','espelho') and table_type='BASE TABLE'")"
politicas=$(sql "select count(*) from pg_policies")
printf '  policies (total)  %s\n' "$politicas"
printf '  policies public .. %s\n' "$(sql "select count(*) from pg_policies where schemaname='public'")"
printf '  funcoes ......... %s\n' "$(sql "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")"
printf '  EMPREGADOS ...... %s\n' "$(sql 'select count(*) from public."EMPREGADOS"')"
printf '  logins .......... %s\n' "$(sql 'select count(*) from auth.users')"

# Referencia medida em 30/09/2026 contra o backup de 29/09: 641 tabelas,
# 1.445 policies (1.300 em public), 154 logins, 13.369 EMPREGADOS.
if (( politicas < 500 )); then
  erro "poucas policies de RLS ($politicas). A replica NAO esta segura para uso."
fi

log "Replica carregada. Rode validar-replica.sql para a conferencia de visibilidade."
