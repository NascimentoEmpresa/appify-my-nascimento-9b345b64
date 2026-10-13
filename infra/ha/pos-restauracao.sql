-- ===========================================================================
--  Roda DEPOIS do restore do schema. Ajusta o que o dump nao traz.
--
--  POR QUE EXISTE: o dump e feito com --no-owner, entao tudo nasce pertencendo
--  a quem restaurou (postgres). Isso e bom para o schema public -- evita erro
--  de troca de dono e nao muda o acesso, que quem decide e GRANT + RLS.
--
--  Mas o GoTrue e o Storage NAO aceitam isso: eles rodam as proprias migracoes
--  no boot e precisam ser DONOS das tabelas que administram. Sem isto:
--     auth    -> "permission denied for schema public" em laco de reinicio
--     storage -> "permission denied for table migrations"
--  Medido em 13/10/2026.
--
--  Os valores abaixo foram LIDOS da producao (pg_roles.rolconfig e
--  pg_tables.tableowner), nao escolhidos.
-- ===========================================================================

-- ── 1. search_path dos papeis de servico ────────────────────────────────────
-- E isto que faz o GoTrue criar a tabela de controle dele em "auth" e nao em
-- "public". Sem a linha, ele tenta no public, nao tem permissao e morre.
ALTER ROLE supabase_auth_admin    SET search_path = auth;
ALTER ROLE supabase_auth_admin    SET idle_in_transaction_session_timeout = 60000;
ALTER ROLE supabase_auth_admin    SET log_statement = none;
ALTER ROLE supabase_storage_admin SET search_path = storage;
ALTER ROLE supabase_storage_admin SET log_statement = none;

-- ── 2. limites de tempo, como na producao ───────────────────────────────────
-- Protegem o banco de consulta travada vinda da API. O anon tem o limite mais
-- curto de proposito: e o papel que qualquer visitante da internet usa.
--
-- NAO replicamos o "session_preload_libraries=safeupdate" que a producao tem
-- no authenticator: safeupdate e uma extensao propria da Supabase e, se a
-- biblioteca nao existir, TODA conexao do papel falha no handshake.
ALTER ROLE anon          SET statement_timeout = '3s';
ALTER ROLE authenticated SET statement_timeout = '8s';
ALTER ROLE authenticator SET statement_timeout = '8s';
ALTER ROLE authenticator SET lock_timeout = '8s';

-- ── 3. donos de auth e storage ──────────────────────────────────────────────
-- Na producao as 27 tabelas de auth pertencem ao supabase_auth_admin e as 8 de
-- storage ao supabase_storage_admin. O --no-owner do dump desfaz isso.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT 'auth' AS s, 'supabase_auth_admin' AS d
           UNION ALL SELECT 'storage', 'supabase_storage_admin' LOOP
    EXECUTE format('ALTER SCHEMA %I OWNER TO %I', r.s, r.d);
    -- tabelas, sequences e views do schema passam para o mesmo dono
    PERFORM 1 FROM pg_tables WHERE schemaname = r.s;
    EXECUTE (
      SELECT coalesce(string_agg(format('ALTER TABLE %I.%I OWNER TO %I;', schemaname, tablename, r.d), ' '), 'SELECT 1')
        FROM pg_tables WHERE schemaname = r.s);
    EXECUTE (
      SELECT coalesce(string_agg(format('ALTER SEQUENCE %I.%I OWNER TO %I;', schemaname, sequencename, r.d), ' '), 'SELECT 1')
        FROM pg_sequences WHERE schemaname = r.s);
    EXECUTE (
      SELECT coalesce(string_agg(format('ALTER VIEW %I.%I OWNER TO %I;', schemaname, viewname, r.d), ' '), 'SELECT 1')
        FROM pg_views WHERE schemaname = r.s);
  END LOOP;
END $$;
