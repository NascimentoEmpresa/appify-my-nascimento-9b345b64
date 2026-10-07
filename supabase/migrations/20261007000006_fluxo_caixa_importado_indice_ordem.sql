-- ============================================================================
-- Fluxo de Caixa — índice para a paginação da view da importação
-- ============================================================================
-- O Fluxo lê v_fluxo_caixa_importado_fluxo_caixa em páginas de 1.000 linhas
-- com ORDER BY despesa_id, linha_id (= COALESCE(rateio_grupo_id, id), id).
-- Sem índice nessa expressão, CADA página relia as ~20,8 mil linhas, fazia as
-- junções e ordenava tudo em disco (external merge ~6 MB, ~0,9 s por página,
-- 21 páginas, várias em paralelo): o PostgREST estourava o tempo e devolvia 500,
-- e a tela ficava em "Carregando…". O índice é parcial com o MESMO filtro da
-- view, para o planejador poder ler já na ordem pedida e parar no LIMIT.
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS public.idx_fci_ordem_fluxo;

SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_fci_ordem_fluxo
  ON public.fluxo_caixa_importado ((COALESCE(rateio_grupo_id, id)), id)
  WHERE deleted_at IS NULL AND conferencia <> 'ja_existe_no_erp';

ANALYZE public.fluxo_caixa_importado;

NOTIFY pgrst, 'reload schema';
