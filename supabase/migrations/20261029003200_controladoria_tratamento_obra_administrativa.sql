-- SIS-2026-0749: Fechamento da Empresa ganha a coluna "Obras Adm". O contrato "OBRAS ADM - HAGG" / "OBRAS ADM - SN" passa a ter um tratamento próprio
-- ("Obra administrativa", padrão pelo nome), igual ao Investimento: fora das despesas e do lucro dos contratos, com o valor em coluna própria no Fechamento.
-- O padrão por nome é feito no código (não grava linha); aqui só se libera o novo valor para quem configurar o tratamento à mão em Tratamento dos contratos.
SET lock_timeout = '5s';

ALTER TABLE public.controladoria_contrato_tratamento DROP CONSTRAINT IF EXISTS controladoria_contrato_tratamento_tratamento_check;
ALTER TABLE public.controladoria_contrato_tratamento
  ADD CONSTRAINT controladoria_contrato_tratamento_tratamento_check
  CHECK (tratamento IN ('normal', 'fora_das_despesas', 'investimento', 'obra_administrativa'));

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DELETE FROM public.controladoria_contrato_tratamento WHERE tratamento = 'obra_administrativa';
--   ALTER TABLE public.controladoria_contrato_tratamento DROP CONSTRAINT IF EXISTS controladoria_contrato_tratamento_tratamento_check;
--   ALTER TABLE public.controladoria_contrato_tratamento
--     ADD CONSTRAINT controladoria_contrato_tratamento_tratamento_check CHECK (tratamento IN ('normal', 'fora_das_despesas', 'investimento'));
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
