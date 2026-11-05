-- =========================================================================
-- TREINAMENTOS POR CONTRATO — índice da FK solicitacao_id (04/11/2026)
--
-- O guardião (M2) reprovou a 20261104006000: solicitacao_id é FOREIGN KEY sem
-- índice, então apagar uma TRN_SOLICITACAO varre TRN_CONTRATO_TREINAMENTO.
-- O índice entrou também naquele arquivo, mas ela já está registrada como
-- aplicada no banco1 e o aplicador não a roda de novo. Esta migration é o que
-- cria o índice lá. Idempotente: onde já existir, não faz nada.
-- =========================================================================

CREATE INDEX IF NOT EXISTS idx_trn_ct_solicitacao ON public."TRN_CONTRATO_TREINAMENTO"(solicitacao_id);

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP INDEX IF EXISTS public.idx_trn_ct_solicitacao;
