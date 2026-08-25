-- =========================================================================
-- PATRIMÔNIO — VALOR ESTIMADO
--
-- A coluna `valor_estimado` JÁ EXISTIA em JUR_PATRIMONIOS quando isto foi
-- escrito (24/08/2026), com 23 dos 26 patrimônios preenchidos — veio junto
-- da importação da planilha, mas nunca apareceu no formulário nem na tabela
-- da carteira. Quem cadastrava um bem novo não tinha onde informar, e quem
-- olhava a lista não via o que já estava gravado.
--
-- Esta migration existe para (a) garantir a coluna em qualquer ambiente que
-- não a tenha e (b) documentar a diferença que confunde todo mundo:
--   valor_contrato  → o que se pagou (ou se vai pagar) pelo bem, do papel;
--   valor_estimado  → o que o bem vale hoje, que é o que interessa para
--                     decidir venda, garantia e seguro.
-- Por isso o estimado NÃO entra no total de contratos somado pela tela.
--
-- Idempotente.
-- ROLLBACK: não apagar a coluna — ela tem dados desde a importação.
-- =========================================================================

ALTER TABLE public."JUR_PATRIMONIOS"
  ADD COLUMN IF NOT EXISTS valor_estimado numeric;

COMMENT ON COLUMN public."JUR_PATRIMONIOS".valor_estimado IS
  'Quanto o bem vale hoje (avaliação/mercado). Não confundir com valor_contrato, que é o valor da aquisição.';

SELECT count(*) AS patrimonios, count(valor_estimado) AS com_valor_estimado
  FROM public."JUR_PATRIMONIOS";

NOTIFY pgrst, 'reload schema';
