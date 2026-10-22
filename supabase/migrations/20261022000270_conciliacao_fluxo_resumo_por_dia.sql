-- Conciliação Bancária: além do resumo do período (20261022000260), a conciliação salva guarda o resumo DIA A DIA do que foi conciliado
-- (Fluxo × extrato, entradas e saídas, conciliado, lançamentos e status do dia), para o "Ver" da lista de Conciliações Salvas mostrar os
-- valores conciliados por dia mesmo quando não há divergência. jsonb anulável: conciliações antigas ficam sem o dia a dia.

ALTER TABLE public.financeiro_conciliacao_fluxo_caixa
  ADD COLUMN IF NOT EXISTS resumo_dias jsonb;

COMMENT ON COLUMN public.financeiro_conciliacao_fluxo_caixa.resumo_dias IS
  'Lista por dia: {dia, fluxoEntradas, fluxoSaidas, extratoEntradas, extratoSaidas, conciliadoEntradas, conciliadoSaidas, qtdFluxo, qtdConciliadas, qtdExtrato, ok}.';

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   ALTER TABLE public.financeiro_conciliacao_fluxo_caixa DROP COLUMN IF EXISTS resumo_dias;
-- =====================================================================
