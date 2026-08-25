-- Dedução de Vale Transporte na Planilha de Custo.
--
-- A planilha do José tem a coluna "DEDUÇÃO VT" (coluna DB do arquivo), que
-- nunca foi modelada no ERP: o modelo tinha o benefício `transporte` e um
-- desconto dedicado só para alimentação (`aux_alimentacao_desconto`), mas o
-- par do transporte ficou de fora. Resultado: o importador (mapa de colunas em
-- PlanilhaCusto.tsx) parava no índice 103/CZ e descartava a coluna DB (105),
-- então o Iury não encontrava a dedução de VT no ERP.
--
-- Comporta-se como `aux_alimentacao_desconto`: SOMA no custo (confirmado com o
-- Iury), não subtrai. Default 0 para as linhas já existentes.
--
-- ROLLBACK: ALTER TABLE public.planilha_custo DROP COLUMN IF EXISTS transporte_desconto;

ALTER TABLE public.planilha_custo
  ADD COLUMN IF NOT EXISTS transporte_desconto numeric NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
