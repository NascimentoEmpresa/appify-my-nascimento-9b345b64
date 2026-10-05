-- Conciliação do Fluxo de Caixa: confere o SALDO ANTERIOR (abertura da conta).
--
-- O OFX só traz movimentos e o saldo final; o saldo anterior fica no extrato
-- impresso/PDF. A tela ganhou um campo opcional pra digitar o do extrato e
-- compara com o "SALDO ANTERIOR" que já está no Fluxo (importação
-- histórica, 01/01). O histórico guarda os dois valores pra mostrar depois se
-- a conciliação fechou com o saldo de abertura conferido.
--
-- Anteriores a esta migration: ficam NULL (não conferido).

ALTER TABLE public.financeiro_conciliacao_fluxo_caixa
  ADD COLUMN IF NOT EXISTS saldo_anterior_fluxo numeric,
  ADD COLUMN IF NOT EXISTS saldo_anterior_extrato numeric;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public.financeiro_conciliacao_fluxo_caixa
--   DROP COLUMN IF EXISTS saldo_anterior_fluxo, DROP COLUMN IF EXISTS saldo_anterior_extrato;
