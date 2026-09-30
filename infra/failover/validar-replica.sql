-- ============================================================================
--  Valida a replica — roda CONTRA A REPLICA, nunca contra a producao
-- ============================================================================
--
--  Objetivo: provar que a replica nao e so "os dados", e sim o BANCO INTEIRO,
--  com a mesma seguranca. Um banco com os dados certos e a RLS ausente e pior
--  que um banco vazio: parece funcionar e vaza tudo.
--
--  COMO USAR
--    psql -h localhost -p 55432 -U postgres -d postgres -f validar-replica.sql
--
--  Compare os numeros com a producao no mesmo dia. Devem estar proximos
--  (a producao continua andando; diferenca de poucas linhas e normal).
-- ============================================================================

\echo '=== 1. ESTRUTURA — a replica trouxe o banco inteiro? ==='
SELECT
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema IN ('public','auth','storage','espelho') AND table_type='BASE TABLE') AS tabelas,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public')                               AS policies_rls,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public')                                                                AS funcoes,
  (SELECT count(*) FROM pg_class WHERE relkind='i')                                          AS indices;
-- Referencia MEDIDA no ensaio de 30/09/2026, contra o backup de 29/09:
--   641 tabelas | 1.300 policies em public (1.445 no banco todo) | 1.238 funcoes
-- Os numeros batem exatamente com o conteudo do dump: ele tem 641 CREATE TABLE
-- e 1.445 CREATE POLICY, e o restore terminou com UM unico erro, o benigno
-- 'schema "public" already exists'. Ou seja: 1.445 policies NAO e "quase tudo",
-- e o total.
-- O "~1.312" que estava aqui antes era uma contagem antiga so do schema public
-- e fazia parecer que faltavam 12 policies. Nao faltavam.
\echo 'Referencia medida em 30/09/2026: 641 tabelas | 1.300 policies em public | 1.238 funcoes'
\echo 'ATENCAO: policies na casa das DEZENAS = os papeis nao existiam na restauracao.'
\echo ''

\echo '=== 2. DADOS — as tabelas criticas vieram cheias? ==='
SELECT 'EMPREGADOS' AS tabela, count(*) AS linhas FROM public."EMPREGADOS"
UNION ALL SELECT 'auth.users', count(*) FROM auth.users
UNION ALL SELECT 'sup_pedido', count(*) FROM public.sup_pedido
UNION ALL SELECT 'malote_despesa', count(*) FROM public.malote_despesa;
\echo ''

\echo '=== 3. PERMISSOES — o PostgREST consegue enxergar as tabelas? ==='
\echo '(sem isto a aplicacao abre em branco, parecendo backup quebrado)'
SELECT has_table_privilege('authenticated','public.sup_pedido','SELECT') AS authenticated_le_pedido,
       has_table_privilege('anon','public.sup_pedido','SELECT')          AS anon_le_pedido,
       pg_has_role('authenticator','authenticated','MEMBER')             AS authenticator_troca_papel;
\echo 'Os tres precisam ser TRUE.'
\echo ''

\echo '=== 4. SEGURANCA — a RLS realmente filtra? ==='
\echo '(o teste que importa: um usuario sem permissao NAO pode ver tudo)'
BEGIN;
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims',
    '{"sub":"777fddd0-2739-4dc2-92fd-242cb1c206e6","role":"authenticated"}', true);
  SELECT 'usuario comum' AS perfil,
         (SELECT count(*) FROM public.sst_ca_catalogo) AS sst_ca,
         (SELECT count(*) FROM public.colaborador)     AS colaborador,
         (SELECT count(*) FROM public.notificacoes)    AS notificacoes;
ROLLBACK;
\echo 'Esperado: sst_ca 0 | colaborador 0 | notificacoes 7'
\echo 'Se vier tudo cheio, a RLS NAO esta ativa na replica. NAO use.'
\echo ''

\echo '=== 5. RLS habilitada nas tabelas? ==='
SELECT count(*) FILTER (WHERE rowsecurity) AS com_rls,
       count(*)                            AS total
  FROM pg_tables t
  JOIN pg_class c ON c.relname=t.tablename
 WHERE t.schemaname='public';
\echo 'com_rls tem que ser a grande maioria.'
