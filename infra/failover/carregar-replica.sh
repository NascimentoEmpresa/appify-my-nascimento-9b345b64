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
# --- 3b. auth e storage TEM QUE VIR DO DUMP, nao do servico ----------------
# O GoTrue e o Storage criam as tabelas deles no boot, com a estrutura da
# VERSAO QUE RODA AQUI. A producao roda versoes mais novas, com colunas que
# essas nao tem - e o COPY do dump morre com
#     column "is_delete_marker" of relation "objects" does not exist
# e os 7.735 registros de storage.objects simplesmente nao entram. Em silencio,
# no meio de milhares de linhas de log.
#
# Medido em 01/10/2026 na Render:
#   a replica tinha  ... metadata, path_tokens, version, owner_id, user_metadata
#   o dump esperava  ... metadata, version, owner_id, user_metadata,
#                        archived_at, is_delete_marker, is_versioned
#
# Por isso apagamos os dois schemas antes de restaurar: assim as tabelas nascem
# com a estrutura da PRODUCAO, e nao com a da versao embutida nesta imagem.
# Os servicos reclamam enquanto isso e reconectam depois - a replica nao atende
# ninguem durante uma recarga.
#
# E por isso tambem que a conferencia do passo 7 conta LINHAS, e nao tabelas:
# contar tabelas daria 8 e pareceria certo.
log "Apagando auth e storage para que venham do dump (e nao dos servicos)..."
sql_ignora "drop schema if exists auth    cascade;" >/dev/null
sql_ignora "drop schema if exists storage cascade;" >/dev/null
sql_ignora "create schema auth    authorization supabase_auth_admin;"    >/dev/null
sql_ignora "create schema storage authorization supabase_storage_admin;" >/dev/null
sql_ignora "grant usage on schema public to supabase_auth_admin, supabase_storage_admin;" >/dev/null

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

# --- 6b. O SCHEMA auth PRECISA DOS SEUS PROPRIOS GRANTS ---------------------
# As tabelas de auth nascem na PRIMEIRA passada do pg_restore, feita como
# `postgres` - entao pertencem a ele, nao ao supabase_auth_admin, que e quem o
# GoTrue usa para conectar. Sem isto o login sobe, conecta, e falha em TODA
# leitura de usuario:
#     {"code":500,"error_code":"unexpected_failure",
#      "msg":"Database error loading user"}
# Medido na Render em 01/10/2026. O erro nao diz "permission denied" em lugar
# nenhum - fala em "database error", o que manda procurar no lugar errado.
sql_ignora "grant usage on schema auth to supabase_auth_admin, service_role;"                >/dev/null
sql_ignora "grant all on all tables    in schema auth to supabase_auth_admin;"                >/dev/null
sql_ignora "grant all on all sequences in schema auth to supabase_auth_admin;"                >/dev/null
sql_ignora "grant all on all functions in schema auth to supabase_auth_admin;"                >/dev/null
# O dono tambem muda: sem isso o GoTrue nao consegue ALTERAR as tabelas dele
# (ele roda migration propria a cada boot).
sql_ignora "do \$\$ declare t record; begin for t in select tablename from pg_tables where schemaname='auth' loop execute format('alter table auth.%I owner to supabase_auth_admin', t.tablename); end loop; end \$\$;" >/dev/null
sql_ignora "do \$\$ declare s record; begin for s in select sequencename from pg_sequences where schemaname='auth' loop execute format('alter sequence auth.%I owner to supabase_auth_admin', s.sequencename); end loop; end \$\$;" >/dev/null
# Mesmo tratamento para storage, pelo mesmo motivo.
sql_ignora "do \$\$ declare t record; begin for t in select tablename from pg_tables where schemaname='storage' loop execute format('alter table storage.%I owner to supabase_storage_admin', t.tablename); end loop; end \$\$;" >/dev/null

# --- 6c. AVISAR O PostgREST QUE O SCHEMA MUDOU ------------------------------
# Ele carrega o schema UMA VEZ, no boot. Numa replica recem-criada isso
# aconteceu com o banco VAZIO - entao, depois da carga, ele continua sem
# enxergar as 581 tabelas e as 1.213 funcoes. O sintoma e enganoso: a tabela
# responde (ela ja estava no cache de outro jeito) mas as RPCs somem com
#     PGRST202: Could not find the function public.X in the schema cache
# e parece que o restore nao trouxe as funcoes. Trouxe - o PostgREST e que nao
# foi avisado. E o mesmo NOTIFY que as migrations deste ERP usam no fim.
log "Avisando o PostgREST para recarregar o schema..."
sql_ignora "notify pgrst, 'reload schema';" >/dev/null

# Nota: alinhar a senha das contas de servico NAO acontece aqui. Na imagem
# supabase/postgres a extensao supautils protege esses papeis depois do boot -
# quem faz isso e o db-init/, na inicializacao. Num Postgres puro, o operador
# cria os papeis com senha antes de rodar este script.

# --- 6d. A TRAVA DE SOMENTE LEITURA, REAPLICADA ----------------------------
# Tem que ser AQUI, depois de cada restore: as permissoes vem do dump da
# PRODUCAO, onde escrever e permitido. Todo restore desfaz esta trava, entao
# reaplica-la no fim de cada carga e o que a torna permanente.
#
# POR QUE REVOKE E NAO default_transaction_read_only
# A primeira tentativa foi
#     alter role authenticated set default_transaction_read_only = on;
# Testado na replica em 02/10/2026 contra a API real: a configuracao aparece
# em pg_roles nos TRES papeis e MESMO ASSIM o POST devolveu 201 e o PATCH
# devolveu 204 - a escrita entrou. O motivo: o PostgREST abre a transacao
# declarando o modo conforme o metodo HTTP, e esse BEGIN ... READ WRITE
# sobrescreve o default do papel. Aquela configuracao nao protege nada neste
# caminho. REVOKE e verificado pelo Postgres independente do modo da
# transacao, entao e o que de fato recusa.
#
# O QUE ISTO COBRE: toda escrita direta pela API REST (POST, PATCH, PUT,
# DELETE em tabela), que e como o ERP grava na enorme maioria das telas.
#
# O QUE NAO COBRE: RPC marcada SECURITY DEFINER, que roda com os privilegios
# do DONO e por isso ignora este REVOKE. Fechar exigiria revogar EXECUTE
# funcao a funcao, separando as que escrevem das que so leem - trabalho ainda
# nao feito, anotado no README. Enquanto nao for, a contingencia e segura
# para consulta, e uma tela que grave por RPC ainda conseguiria gravar.
#
# O GoTrue e o Storage ficam de fora: login ESCREVE (sessao, refresh token,
# last_sign_in_at) e uma replica onde ninguem entra nao serve de nada. Eles
# usam supabase_auth_admin e supabase_storage_admin.
#
# Liberar escrita e decisao humana: promover.sh promover.
if [[ -f /var/lib/postgresql/data/PROMOVIDA ]]; then
  log "replica PROMOVIDA - deixando a escrita liberada (nao travando)"
else
  log "Reaplicando a trava de somente leitura (o restore acabou de apaga-la)..."
  sql_ignora "revoke insert, update, delete, truncate on all tables in schema public from authenticated, anon;" >/dev/null
  sql_ignora "revoke usage on all sequences in schema public from authenticated, anon;" >/dev/null
  # --- e as RPC que escrevem -----------------------------------------------
  # O REVOKE acima nao alcanca funcao SECURITY DEFINER: ela roda com os
  # privilegios do DONO, nao de quem chamou. Sem este bloco, uma tela que grave
  # por RPC continuaria gravando na replica - e esse dado morreria na recarga
  # seguinte, que e exatamente o que a contingencia promete nao deixar
  # acontecer.
  #
  # O criterio e o corpo da funcao: se tem INSERT/UPDATE/DELETE/TRUNCATE, ela
  # escreve. Falso positivo aqui e seguro (revoga uma funcao de leitura que
  # tinha a palavra solta num comentario, e em modo consulta isso nao faz
  # falta); falso negativo seria o perigo, e so aconteceria com escrita montada
  # por EXECUTE dinamico.
  #
  # AS FUNCOES DE RLS FICAM DE FORA, E ISSO NAO E OPCIONAL
  # can_access aparece 2.063 vezes dentro de policies, has_screen_access 830,
  # tem_acesso_menu 750. Elas sao chamadas DENTRO da policy, com os privilegios
  # de quem esta consultando. Revogar EXECUTE delas nao deixaria o banco mais
  # seguro: derrubaria TODA a leitura, porque cada policy passaria a dar erro
  # de permissao. A replica viraria uma tela de erro.
  log "Revogando as RPC que escrevem (SECURITY DEFINER passa por cima do REVOKE)..."
  sql_ignora "do \$BLOCO\$
    declare
      f record;
      n int := 0;
    begin
      for f in
        select p.oid::regprocedure as assinatura
          from pg_proc p
          join pg_namespace ns on ns.oid = p.pronamespace
         where ns.nspname = 'public'
           and p.prosecdef
           and p.prosrc ~* '\m(insert|update|delete|truncate)\M'
           and p.proname not in (
             'can_access','has_screen_access','tem_acesso_menu',
             'get_user_empresa','has_role','is_admin'
           )
      loop
        execute format('revoke execute on function %s from authenticated, anon', f.assinatura);
        n := n + 1;
      end loop;
      raise notice 'rpc de escrita revogadas: %', n;
    end
  \$BLOCO\$;" >/dev/null
  sql_ignora "notify pgrst, 'reload schema';" >/dev/null
fi

# --- 7. conferir ------------------------------------------------------------
tabelas=$(sql_ignora "select count(*) from information_schema.tables where table_schema in ('public','auth','storage','espelho') and table_type='BASE TABLE'")
policies=$(sql_ignora "select count(*) from pg_policies")
logins=$(sql_ignora "select count(*) from auth.users")
# CONTA LINHAS, nao tabelas. Contar tabelas foi o que deixou passar, por dias,
# uma replica com storage.objects VAZIO: as 8 tabelas existiam (criadas pelo
# proprio storage-api no boot) e a conferencia dava sucesso.
anexos=$(sql_ignora "select count(*) from storage.objects")
baldes=$(sql_ignora "select count(*) from storage.buckets")
empregados=$(sql_ignora 'select count(*) from public."EMPREGADOS"')
segundos=$(( $(date +%s) - inicio ))

log "Resultado: ${tabelas} tabelas | ${policies} policies | ${logins} logins | ${empregados} empregados | ${anexos} anexos em ${baldes} baldes | ${segundos}s"
# Referencia medida em 01/10/2026: 641 tabelas, 1.445 policies, 154 logins,
# 13.369 empregados, 7.735 anexos.

problemas=""
(( ${tabelas:-0}    >= 600   )) || problemas="$problemas tabelas=${tabelas:-0}(<600)"
(( ${policies:-0}   >= 1400  )) || problemas="$problemas policies=${policies:-0}(<1400)"
(( ${logins:-0}     >= 100   )) || problemas="$problemas logins=${logins:-0}(<100)"
(( ${empregados:-0} >= 10000 )) || problemas="$problemas empregados=${empregados:-0}(<10000)"
# Os REGISTROS dos anexos (nao os arquivos - esses ainda nao sao copiados).
(( ${anexos:-0}     >= 5000  )) || problemas="$problemas anexos=${anexos:-0}(<5000)"
[[ -z "$problemas" ]] || erro "a replica ficou incompleta:$problemas"

log "Carga concluida."
