-- SIS-2026-0325: 2 campos que faltaram na primeira migration do módulo
-- Controle de Contratos (20260930000172) — só apareceram no mockup real
-- do "Novo Contrato" (seção 3 e 4), que na época ainda não tínhamos visto
-- em detalhe.
--
-- Os dois são MANUAIS, digitados no formulário — não são a mesma coisa
-- que os agregados calculados ao vivo da Planilha de Custo
-- (somarQuantFuncExecContrato/somarValorExecutadoMensalContrato em
-- usePlanilhaCusto.ts), que continuam existindo em paralelo pra
-- conferência (seção 5/6 da tela, "Valor mão de obra / valor mensal" e
-- afins). Confirmado com o usuário (AskUserQuestion) que são campos
-- distintos, não um erro de posicionamento no mockup.
--
-- Idempotente.

ALTER TABLE public.contratos
  ADD COLUMN IF NOT EXISTS quant_func_exec int,
  ADD COLUMN IF NOT EXISTS valor_executado_mensal numeric;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   ALTER TABLE public.contratos
--     DROP COLUMN IF EXISTS quant_func_exec,
--     DROP COLUMN IF EXISTS valor_executado_mensal;
-- =====================================================================
