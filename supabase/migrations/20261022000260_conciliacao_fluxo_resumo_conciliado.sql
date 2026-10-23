-- Conciliação Bancária (Fluxo de Caixa × extrato): a conciliação salva passa a guardar o RESUMO do que foi conciliado. Até aqui só ficavam as
-- linhas de divergência (ajustadas/criadas/ignoradas); quando tudo batia, a lista de "Conciliações Salvas" aparecia toda zerada, sem mostrar
-- o que foi conferido. Colunas anuláveis: conciliações antigas ficam sem resumo (a tela mostra "—").

ALTER TABLE public.financeiro_conciliacao_fluxo_caixa
  ADD COLUMN IF NOT EXISTS fluxo_entradas numeric,
  ADD COLUMN IF NOT EXISTS fluxo_saidas numeric,
  ADD COLUMN IF NOT EXISTS qtd_fluxo integer,
  ADD COLUMN IF NOT EXISTS qtd_extrato integer,
  ADD COLUMN IF NOT EXISTS conciliado_entradas numeric,
  ADD COLUMN IF NOT EXISTS conciliado_saidas numeric,
  ADD COLUMN IF NOT EXISTS qtd_conciliadas integer,
  ADD COLUMN IF NOT EXISTS dias_total integer,
  ADD COLUMN IF NOT EXISTS dias_ok integer;

COMMENT ON COLUMN public.financeiro_conciliacao_fluxo_caixa.conciliado_entradas IS
  'Entradas do Fluxo de Caixa do período que bateram com o extrato (fluxo_entradas menos as linhas do Fluxo ainda divergentes/ignoradas).';

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   ALTER TABLE public.financeiro_conciliacao_fluxo_caixa
--     DROP COLUMN IF EXISTS fluxo_entradas, DROP COLUMN IF EXISTS fluxo_saidas, DROP COLUMN IF EXISTS qtd_fluxo,
--     DROP COLUMN IF EXISTS qtd_extrato, DROP COLUMN IF EXISTS conciliado_entradas, DROP COLUMN IF EXISTS conciliado_saidas,
--     DROP COLUMN IF EXISTS qtd_conciliadas, DROP COLUMN IF EXISTS dias_total, DROP COLUMN IF EXISTS dias_ok;
-- =====================================================================
