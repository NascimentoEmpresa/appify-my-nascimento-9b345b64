-- ===========================================================================
--  Prepara um PostgreSQL limpo para receber o dump do Supabase.
--
--  POR QUE EXISTE: restaurar o dump direto num Postgres comum produz 2.436
--  erros, e o pior deles é silencioso -- das 1.416 políticas de RLS do ERP,
--  UMA entra. O banco sobe funcionando e SEM controle de acesso.
--
--  A causa nunca foi dificuldade, foi ORDEM: o dump referencia 3.156 vezes
--  auth.uid() e 1.397 vezes o papel "authenticated". Faltando o papel, o
--  CREATE POLICY inteiro falha -- e o psql segue em frente.
--
--  Rodar ANTES de qualquer dump, num banco vazio. Idempotente.
-- ===========================================================================

-- ── 1. papéis ──────────────────────────────────────────────────────────────
-- São só nomes aos quais as políticas concedem acesso; quem autentica de
-- verdade é a camada de API. NOLOGIN porque ninguém se conecta como eles
-- diretamente -- o PostgREST faz SET ROLE depois de validar o token.
DO $$
DECLARE p text;
BEGIN
  FOREACH p IN ARRAY ARRAY[
    'anon', 'authenticated', 'service_role', 'authenticator',
    'supabase_admin', 'supabase_auth_admin', 'supabase_storage_admin',
    'supabase_functions_admin', 'supabase_realtime_admin',
    'supabase_replication_admin', 'supabase_read_only_user',
    'supabase_etl_admin', 'supabase_privileged_role',
    'dashboard_user', 'pgbouncer', 'cli_login_postgres'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = p) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT', p);
    END IF;
  END LOOP;
END $$;

-- O authenticator troca de papel conforme o token; é assim que o PostgREST
-- aplica RLS por usuário.
GRANT anon, authenticated, service_role TO authenticator;

-- ── 2. schemas ─────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;        -- preenchido pelo dump de auth
CREATE SCHEMA IF NOT EXISTS storage;     -- idem
CREATE SCHEMA IF NOT EXISTS extensions;  -- onde o Supabase instala pgcrypto
CREATE SCHEMA IF NOT EXISTS vault;

-- ── 3. extensões ───────────────────────────────────────────────────────────
-- pgcrypto vai em "extensions" porque o dump chama extensions.gen_random_bytes
-- em duas funções do ERP (geração de token).
CREATE EXTENSION IF NOT EXISTS pgcrypto    WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
-- btree_gist resolve o "data type uuid has no default operator class for
-- access method gist" que aparece num índice de exclusão.
CREATE EXTENSION IF NOT EXISTS btree_gist;
-- pg_trgm e btree_gist ficam em "public", pgcrypto/uuid-ossp/pg_stat_statements
-- em "extensions": e exatamente onde o Supabase os instala. Conferido lendo
-- pg_extension da producao, nao por suposicao -- e importante porque o schema
-- do ERP chama essas funcoes sem qualificar.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- pg_stat_statements tambem em "extensions", como no Supabase. Em "public"
-- ele acrescenta 3 funcoes e 2 views que fazem a conferencia de contagens
-- (docs/migracao-rollback.md) acusar diferenca sem haver problema nenhum.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;

-- ── 4. pg_cron ─────────────────────────────────────────────────────────────
-- Exige pg_cron em shared_preload_libraries e cron.database_name no DCS do
-- Patroni -- NAO no postgresql.conf na mao, porque o Patroni reescreve o
-- arquivo e a alteracao some no proximo restart.
--
-- PERIGO: a producao tem 5 agendamentos, e TRES mandam mensagem de verdade
-- para gente de verdade (whatsapp-retomada-tick, regua-cobranca-tick,
-- comite-etica-alertas). Enquanto o Supabase estiver no ar, criar esses
-- agendamentos aqui faz o usuario receber TUDO EM DOBRO -- uma vez de cada
-- banco. Eles so nascem na virada, depois que o Supabase for desligado.
-- Nunca antes, nem "so para testar".
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ── 5. vault ───────────────────────────────────────────────────────────────
-- O supabase_vault não existe fora do Supabase. O ERP lê de
-- vault.decrypted_secrets em uma função. Aqui fica a mesma forma, com o
-- segredo em claro -- o que é ACEITÁVEL só porque o banco não é alcançável
-- fora do túnel. Trocar por um cofre de verdade antes da virada definitiva.
CREATE TABLE IF NOT EXISTS vault.secrets (
  id          uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  name        text UNIQUE,
  description text NOT NULL DEFAULT '',
  secret      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE VIEW vault.decrypted_secrets AS
  SELECT id, name, description, secret,
         secret AS decrypted_secret,
         created_at, updated_at
    FROM vault.secrets;

-- ── 6. permissões de uso ───────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public, auth, storage, extensions, vault
  TO anon, authenticated, service_role;
