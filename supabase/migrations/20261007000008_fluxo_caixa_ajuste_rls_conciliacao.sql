-- ============================================================================
-- Fluxo de Caixa — "Ajustar" da Conciliação precisa poder gravar o ajuste
-- ============================================================================
-- O diálogo "Ajustar" da Conciliação Automática (data / tipo / valor) grava em
-- financeiro_fluxo_caixa_ajuste, mas a tela só exige o acesso da própria
-- Conciliação ('conciliacao-fluxo-caixa'). A política da tabela exigia
-- 'alterar' no menu do Fluxo de Caixa ('financeiro-fluxo-caixa-gestao'), então
-- quem concilia sem esse acesso recebia "new row violates row-level security
-- policy for table financeiro_fluxo_caixa_ajuste".
--
-- Em vez de dar 'alterar' no Fluxo inteiro (que liberaria o lápis de toda linha),
-- quem tem 'incluir' na Conciliação — a mesma ação que a tela exige para salvar a
-- conciliação — passa a poder ler, criar e atualizar ajustes. Sem DELETE: reverter
-- ajuste continua sendo do Fluxo. Políticas permissivas somam em OR com as atuais.
--
-- ROLLBACK:
--   DROP POLICY IF EXISTS financeiro_fluxo_caixa_ajuste_conc_select ON public.financeiro_fluxo_caixa_ajuste;
--   DROP POLICY IF EXISTS financeiro_fluxo_caixa_ajuste_conc_insert ON public.financeiro_fluxo_caixa_ajuste;
--   DROP POLICY IF EXISTS financeiro_fluxo_caixa_ajuste_conc_update ON public.financeiro_fluxo_caixa_ajuste;
--   NOTIFY pgrst, 'reload schema';

SET lock_timeout = '5s';

DROP POLICY IF EXISTS financeiro_fluxo_caixa_ajuste_conc_select ON public.financeiro_fluxo_caixa_ajuste;
CREATE POLICY financeiro_fluxo_caixa_ajuste_conc_select ON public.financeiro_fluxo_caixa_ajuste
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'incluir'::public.app_acao));

DROP POLICY IF EXISTS financeiro_fluxo_caixa_ajuste_conc_insert ON public.financeiro_fluxo_caixa_ajuste;
CREATE POLICY financeiro_fluxo_caixa_ajuste_conc_insert ON public.financeiro_fluxo_caixa_ajuste
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'incluir'::public.app_acao));

DROP POLICY IF EXISTS financeiro_fluxo_caixa_ajuste_conc_update ON public.financeiro_fluxo_caixa_ajuste;
CREATE POLICY financeiro_fluxo_caixa_ajuste_conc_update ON public.financeiro_fluxo_caixa_ajuste
  FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'incluir'::public.app_acao))
  WITH CHECK (public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'incluir'::public.app_acao));

NOTIFY pgrst, 'reload schema';
