-- ATRIBUTOS E PARTICIPACOES DE PAPEL
--
-- Rode DEPOIS de preparar-destino.sql e do restore do schema:
--   psql -h 127.0.0.1 -p 5000 -U postgres -d postgres -f papeis-atributos.sql
--
-- POR QUE ISTO E UM ARQUIVO SEPARADO E OBRIGATORIO
-- pg_dump nao carrega isto. Ele exporta objetos (tabela, funcao, politica) e
-- os GRANTs sobre eles; atributo de papel vive em pg_authid e participacao de
-- papel em pg_auth_members, e os dois ficam FORA de um dump de schema. Quem
-- restaura schema, confere "656 tabelas, 1432 politicas, tudo igual" e segue
-- adiante, segue com dois defeitos que nenhuma dessas contagens revela.
--
-- Os dois defeitos, medidos em 13/10/2026 comparando com a producao viva:
--
--   1. service_role sem BYPASSRLS. Na producao ele tem. Sem isso, toda
--      operacao de service_role que uma politica de RLS nao autorize
--      explicitamente e negada -- e service_role existe justamente para ser o
--      papel que passa por cima da RLS.
--
--   2. supabase_storage_admin fora de authenticator. O storage-api conecta
--      como supabase_storage_admin e, a cada requisicao, roda
--         set_config('role', 'service_role', true)
--      Sem ser membro (direto ou herdado) de service_role, isso falha com
--      42501 -- e aqui esta a parte cruel: o storage-api traduz TODO 42501
--      para a frase
--         "new row violates row-level security policy"
--      Um GET em /storage/v1/bucket, que nao insere linha nenhuma, devolvia
--      essa frase. Da para perder dias cacando politica de RLS que nunca foi
--      o problema. A pista real estava no log do container:
--         code:42501  file:"guc.c"  routine:"call_string_check_hook"
--      guc.c e set_config. Nao e RLS.
--
-- A producao resolve por heranca, e replicamos igual em vez de atalho:
--   supabase_storage_admin -> authenticator -> {anon, authenticated, service_role}

ALTER ROLE service_role BYPASSRLS;
ALTER ROLE service_role INHERIT;

-- anon e authenticated herdam na producao.
ALTER ROLE anon          INHERIT;
ALTER ROLE authenticated INHERIT;

-- Os dois papeis de servico criam papel na producao.
ALTER ROLE supabase_auth_admin    CREATEROLE;
ALTER ROLE supabase_storage_admin CREATEROLE;

-- A participacao que faz o storage funcionar.
GRANT authenticator TO supabase_storage_admin;

-- Participacoes que a producao tem; aqui o postgres e superusuario e
-- conseguiria SET ROLE de qualquer forma, mas replicamos para a comparacao
-- fechar e para nao depender de ser superusuario.
GRANT anon, authenticated, service_role, authenticator TO postgres;

-- O QUE DE PROPOSITO NAO COPIAMOS
-- Na producao pgbouncer, dashboard_user, cli_login_postgres, supabase_admin,
-- supabase_etl_admin, supabase_functions_admin, supabase_read_only_user e
-- supabase_replication_admin tem LOGIN. Nenhum servico da nossa pilha conecta
-- com eles: existem so porque objetos restaurados citam o nome. Dar LOGIN a
-- eles seria abrir porta sem ninguem do outro lado. Ficam NOLOGIN, e o
-- conferir-contra-producao.sh conhece essa lista como divergencia deliberada.
--
-- Tambem nao copiamos postgres como NAO-superusuario. Na producao quem e
-- superusuario e o supabase_admin e o postgres tem apenas bypassrls +
-- createrole + createdb + replication. Alinhar isso exige que o supabase_admin
-- assuma o papel de superusuario aqui, e isso muda quem roda os restores --
-- mudanca de verdade, para decidir com calma, nao de passagem.

-- Conferencia:
--   select rolname, rolbypassrls, rolinherit, rolcanlogin from pg_roles
--    where rolname in ('service_role','authenticator','supabase_storage_admin');
--   select m.rolname || ' -> ' || r.rolname
--     from pg_auth_members am
--     join pg_roles r on r.oid = am.roleid
--     join pg_roles m on m.oid = am.member
--    where m.rolname = 'supabase_storage_admin';
