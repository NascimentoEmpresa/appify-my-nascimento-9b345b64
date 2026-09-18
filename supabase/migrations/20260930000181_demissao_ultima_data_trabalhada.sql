-- =========================================================================
-- Demissão: o RH informa a ÚLTIMA DATA TRABALHADA antes de liberar pro SST
--
-- PEDIDO (17/09/2026, Pablo): "quando o RH for liberar e enviar pro SST,
-- antes tem que informar qual foi a última data trabalhada do colaborador
-- (confirma?). Essa informação tem que ir pro SST."
--
-- Coluna rh_ultima_data_trabalhada (date). A tela do RH exige a data e pede
-- confirmação; o SST vê em destaque no card (é a data que baliza o ASO
-- demissional). Devolver à etapa 1 limpa junto com o resto do carimbo do
-- RH (patchDevolucao).
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================
ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO"
  ADD COLUMN IF NOT EXISTS rh_ultima_data_trabalhada date;

COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_DEMISSAO".rh_ultima_data_trabalhada IS
  'Última data trabalhada do colaborador, informada e confirmada pelo RH ao liberar para o SST (17/09/2026).';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO" DROP COLUMN IF EXISTS rh_ultima_data_trabalhada;
-- NOTIFY pgrst, 'reload schema';
