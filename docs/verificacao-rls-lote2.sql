-- ============================================================================
--  Verificacao de visibilidade — reescrita RLS lote 2 (tabelas fora do mz_*)
--  (migration ..._rls_can_access_subquery_lote2_fora_mz.sql)
-- ============================================================================
--
--  Mesma logica da docs/verificacao-rls-mz.sql: as contagens tem que bater
--  LINHA A LINHA antes e depois. Se qualquer numero mudar, faca rollback.
--
--  COMO USAR (SQL Editor do projeto de producao)
--  1. Rode este arquivo ANTES da migration. Confira os numeros abaixo.
--  2. Aplique a migration do lote 2.
--  3. Rode de novo. Os numeros tem que ser IDENTICOS (so o tempo muda).
--
--  Gabarito capturado em 29/09/2026 (antes da reescrita):
--    ADMIN: sst_ca_catalogo 42373 | colaborador 8847 | sup_funcao_item 10926 | orcamento_contrato_linha 0
--    OUTRO: 0 | 0 | 0 | 0
--  (o ADMIN ve 0 em orcamento_contrato_linha porque nao tem o menu 'orcamento';
--   o que importa e que o MESMO usuario veja o MESMO numero antes e depois.)
-- ============================================================================

-- ADMIN — troque pelo UUID real se necessario
BEGIN;
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims',
    '{"sub":"97260632-2f1a-44e3-9f93-58b2b1f3702c","role":"authenticated"}', true);
  SELECT 'ADMIN' AS perfil, 'sst_ca_catalogo' AS tabela, count(*) AS linhas_visiveis FROM public.sst_ca_catalogo
  UNION ALL SELECT 'ADMIN','colaborador', count(*) FROM public.colaborador
  UNION ALL SELECT 'ADMIN','sup_funcao_item', count(*) FROM public.sup_funcao_item
  UNION ALL SELECT 'ADMIN','orcamento_contrato_linha', count(*) FROM public.orcamento_contrato_linha;
ROLLBACK;

-- OUTRO usuario (sem esses acessos) — tem que ver ZERO em tudo, antes E depois
BEGIN;
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims',
    '{"sub":"777fddd0-2739-4dc2-92fd-242cb1c206e6","role":"authenticated"}', true);
  SELECT 'OUTRO' AS perfil, 'sst_ca_catalogo' AS tabela, count(*) AS linhas_visiveis FROM public.sst_ca_catalogo
  UNION ALL SELECT 'OUTRO','colaborador', count(*) FROM public.colaborador
  UNION ALL SELECT 'OUTRO','sup_funcao_item', count(*) FROM public.sup_funcao_item
  UNION ALL SELECT 'OUTRO','orcamento_contrato_linha', count(*) FROM public.orcamento_contrato_linha;
ROLLBACK;

-- ============================================================================
-- Se os 8 numeros baterem com o gabarito depois de aplicar, esta seguro.
-- Qualquer divergencia (principalmente OUTRO deixando de ser 0) = rollback.
-- ============================================================================
