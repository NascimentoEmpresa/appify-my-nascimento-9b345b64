-- Auditoria pós-bug: a migration 20260801000001 removeu o gate de empresa
-- (user_pode_atuar_empresa) de plano_acao/pa_select/pa_update/excluir_plano_acao,
-- mas ESQUECEU a tabela plano_acao_visibilidade_usuario ("Pessoas que podem
-- ver esta ação" — visibilidade específica). pav_select/pav_insert/pav_delete
-- ainda exigiam vínculo formal com a empresa, então incluir ou remover uma
-- pessoa específica numa ação de empresa sem vínculo continuava falhando —
-- o mesmo problema que o pedido original queria eliminar, só que numa
-- tabela satélite em vez da plano_acao em si.

DROP POLICY IF EXISTS pav_select ON public.plano_acao_visibilidade_usuario;
CREATE POLICY pav_select ON public.plano_acao_visibilidade_usuario FOR SELECT TO authenticated
  USING (public.plano_acao_visible_by_user(auth.uid(), plano_acao_id));

DROP POLICY IF EXISTS pav_insert ON public.plano_acao_visibilidade_usuario;
CREATE POLICY pav_insert ON public.plano_acao_visibilidade_usuario FOR INSERT TO authenticated
  WITH CHECK (
    public.plano_acao_can_access(auth.uid(), empresa_id, 'editar')
    OR EXISTS (
      SELECT 1 FROM public.plano_acao
      WHERE id = plano_acao_id AND criado_por = auth.uid()
    )
  );

DROP POLICY IF EXISTS pav_delete ON public.plano_acao_visibilidade_usuario;
CREATE POLICY pav_delete ON public.plano_acao_visibilidade_usuario FOR DELETE TO authenticated
  USING (
    public.plano_acao_can_access(auth.uid(), empresa_id, 'editar')
    OR EXISTS (
      SELECT 1 FROM public.plano_acao
      WHERE id = plano_acao_id AND criado_por = auth.uid()
    )
  );
