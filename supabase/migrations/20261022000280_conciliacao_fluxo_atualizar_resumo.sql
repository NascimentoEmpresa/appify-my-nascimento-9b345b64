-- Conciliação Bancária: permite ATUALIZAR a conciliação salva (hoje só existia select/insert/delete). Necessário para "Gerar resumo" das
-- conciliações antigas: o resumo de valores conciliados (migrations 20261022000260/270) é refeito a partir do .OFX guardado e gravado no
-- cabeçalho. Mesma régua do resto do módulo: can_access no menu 'conciliacao-fluxo-caixa', ação 'alterar'.

DROP POLICY IF EXISTS financeiro_conciliacao_fluxo_caixa_update ON public.financeiro_conciliacao_fluxo_caixa;
CREATE POLICY financeiro_conciliacao_fluxo_caixa_update ON public.financeiro_conciliacao_fluxo_caixa
  FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'alterar'));

GRANT UPDATE ON public.financeiro_conciliacao_fluxo_caixa TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP POLICY IF EXISTS financeiro_conciliacao_fluxo_caixa_update ON public.financeiro_conciliacao_fluxo_caixa;
-- =====================================================================
