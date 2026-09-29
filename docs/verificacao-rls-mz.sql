-- ============================================================================
--  Verificacao de visibilidade — reescrita RLS das tabelas mz_*
--  (migration 20260930000265_mz_rls_can_access_em_subquery_escalar.sql)
-- ============================================================================
--
--  PARA QUE SERVE
--  Provar que a reescrita NAO mudou quem enxerga o que. `X` e `(SELECT X)`
--  devolvem o mesmo booleano, entao as contagens tem que bater LINHA A LINHA
--  antes e depois. Se qualquer numero mudar, NAO aplique / faca rollback.
--
--  COMO USAR (no SQL Editor do projeto de producao)
--  1. Rode este arquivo INTEIRO com a policy AINDA CRUA (antes da migration).
--     Anote os numeros da coluna "linhas_visiveis".
--  2. Aplique a migration 20260930000265.
--  3. Rode este arquivo INTEIRO de novo.
--  4. Compare: os numeros de cada linha tem que ser IDENTICOS.
--     A unica diferenca esperada e o tempo (depois deve ser muito mais rapido).
--
--  Testa dois perfis reais:
--   - um ADMIN (tem 'administracao','alterar')  -> deve ver TODAS as linhas
--   - um usuario NORMAL (nao tem)               -> deve ver ZERO em todas
--  e uma amostra de 3 tabelas (pequena, media, grande). A policy das 34 e
--  identica, entao a amostra representa o conjunto.
-- ============================================================================

-- Troque pelos UUIDs reais se estes ja nao existirem.
-- (capturados em 29/09/2026: um admin e um usuario sem acesso)
\set ADMIN    '97260632-2f1a-44e3-9f93-58b2b1f3702c'
\set SEMACESSO '777fddd0-2739-4dc2-92fd-242cb1c206e6'

-- ---------------------------------------------------------------------------
-- PERFIL ADMIN — deve enxergar as linhas
-- ---------------------------------------------------------------------------
BEGIN;
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', :'ADMIN', 'role', 'authenticated')::text, true);

  SELECT 'ADMIN' AS perfil, 'mz_02_dim_empresas' AS tabela,
         count(*) AS linhas_visiveis FROM public.mz_02_dim_empresas
  UNION ALL
  SELECT 'ADMIN', 'mz_40_fato_fluxo_caixa_realizado',
         count(*) FROM public.mz_40_fato_fluxo_caixa_realizado
  UNION ALL
  SELECT 'ADMIN', 'mz_32_fato_razao_contabil',
         count(*) FROM public.mz_32_fato_razao_contabil;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- PERFIL SEM ACESSO — tem que ver ZERO em todas (antes E depois)
-- ---------------------------------------------------------------------------
BEGIN;
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', :'SEMACESSO', 'role', 'authenticated')::text, true);

  SELECT 'SEM_ACESSO' AS perfil, 'mz_02_dim_empresas' AS tabela,
         count(*) AS linhas_visiveis FROM public.mz_02_dim_empresas
  UNION ALL
  SELECT 'SEM_ACESSO', 'mz_40_fato_fluxo_caixa_realizado',
         count(*) FROM public.mz_40_fato_fluxo_caixa_realizado
  UNION ALL
  SELECT 'SEM_ACESSO', 'mz_32_fato_razao_contabil',
         count(*) FROM public.mz_32_fato_razao_contabil;
ROLLBACK;

-- ============================================================================
-- LEITURA DO RESULTADO
-- - ADMIN: os 3 numeros antes == os 3 numeros depois.
-- - SEM_ACESSO: tem que ser 0, 0, 0 — antes E depois. Se aparecer qualquer
--   numero > 0 depois, a reescrita VAZOU dado: faca rollback imediatamente.
-- ============================================================================
