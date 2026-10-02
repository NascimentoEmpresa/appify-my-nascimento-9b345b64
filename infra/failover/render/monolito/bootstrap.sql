-- ============================================================================
--  Papeis, schemas e extensoes que a replica precisa antes de qualquer carga
-- ============================================================================
--  POR QUE ISTO E UM ARQUIVO, E NAO SQL NA LINHA DE COMANDO
--  Porque `su postgres -c "psql -c '... do $$ ... $$'"` NAO funciona: o shell
--  expande $$ para o PID do processo ANTES do Postgres ver, e o erro que chega
--  e enigmatico:
--      ERROR: syntax error at or near "40"
--      LINE 1: do 40 begin if not exists ...
--  Medido em 01/10/2026. Num arquivo lido com -f, nenhum shell toca no texto.
--
--  A senha entra por variavel do psql (:'senha'), nunca interpolada em string
--  de shell - assim ela tambem nao aparece na lista de processos da maquina.
-- ============================================================================

\set ON_ERROR_STOP on

alter user postgres with password :'senha';

-- --- os papeis que as 1.445 policies de RLS citam ---------------------------
-- CREATE POLICY ... TO authenticated falha CALADO se o papel nao existir, no
-- meio de 8 mil objetos. Medido em 29/09/2026: sem eles, 35 de 1.445 policies
-- foram restauradas. Um banco com todos os dados e 2% da seguranca.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon          nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role  nologin noinherit bypassrls; end if;
end $$;

-- --- as contas que os processos usam para conectar --------------------------
-- Aqui esta a vantagem do Postgres puro sobre a imagem supabase/postgres: nela
-- a extensao supautils marca estes papeis como reservados, e depois do boot nem
-- o usuario `postgres` consegue definir a senha deles. Aqui criamos nos mesmos.
-- Cria se faltar, depois define a senha. Em duas etapas de proposito: o CREATE
-- precisa do bloco (nao ha "create role if not exists"), e a senha so pode
-- entrar por :'senha' FORA do bloco - dentro de $$ ... $$ o psql nao substitui
-- variavel, ela chegaria literalmente como o texto :'senha'.
do $$
begin
  if not exists (select 1 from pg_roles where rolname='authenticator')          then create role authenticator          login noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_auth_admin')    then create role supabase_auth_admin    login noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_storage_admin') then create role supabase_storage_admin login noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_admin')         then create role supabase_admin         login noinherit; end if;
end $$;

alter role authenticator          with login password :'senha';
alter role supabase_auth_admin    with login password :'senha';
alter role supabase_storage_admin with login password :'senha';
alter role supabase_admin         with login password :'senha';

-- E assim que o PostgREST troca de identidade conforme o token que recebe:
-- authenticator entra no banco e assume anon ou authenticated.
grant anon, authenticated, service_role to authenticator;

-- --- schemas dos servicos ---------------------------------------------------
-- GoTrue e Storage rodam migration propria no boot e precisam mandar no proprio
-- schema. Sem o authorization, eles sobem e falham ao criar as tabelas deles.
create schema if not exists auth    authorization supabase_auth_admin;
create schema if not exists storage authorization supabase_storage_admin;
grant create on database postgres to supabase_auth_admin, supabase_storage_admin;

-- SEM ESTAS DUAS LINHAS O LOGIN NAO SOBE.
-- O GoTrue cria uma tabela de controle propria (schema_migrations) logo no
-- boot, e sem search_path ele tenta cria-la no schema `public`, onde
-- supabase_auth_admin nao pode escrever:
--     running db migrations: ... CREATE TABLE "schema_migrations" ...
--     ERROR: permission denied for schema public (SQLSTATE 42501)
-- e o processo ENCERRA (diferente do PostgREST, que fica tentando reconectar).
-- Na Supabase real essa tabela mora em auth.schema_migrations. Medido em
-- 01/10/2026.
alter role supabase_auth_admin    set search_path = auth;
alter role supabase_storage_admin set search_path = storage;
-- Eles ainda precisam LER public: as policies de storage.objects chamam
-- funcoes de la (tem_acesso_menu, can_access).
grant usage on schema public to supabase_auth_admin, supabase_storage_admin;

-- --- as extensoes que o dump exige e NAO traz -------------------------------
-- O backup e gerado por schema, entao o "extensions" da Supabase fica de fora e
-- nenhuma EXTENSION vem junto (conferido com pg_restore -l: 8.276 entradas,
-- ZERO do tipo EXTENSION). Sem pre-criar, somem em silencio:
--   pg_trgm     -> o indice de busca por nome em "EMPREGADOS" (13.369 linhas)
--   btree_gist  -> as DUAS travas de sobreposicao (vigencia de orcamento e
--                  sala de reuniao). Sem elas o banco aceita reserva duplicada.
--   pgcrypto    -> extensions.gen_random_bytes, DEFAULT de coluna em
--                  sup_compra_pedido_envio: sem ela a TABELA nao nasce, e caem
--                  junto 2 indices, 2 FKs e 1 policy.
create schema if not exists extensions;
create extension if not exists pg_trgm    with schema public;
create extension if not exists btree_gist with schema public;
create extension if not exists unaccent   with schema public;
create extension if not exists pgcrypto   with schema extensions;

\echo 'bootstrap aplicado'
