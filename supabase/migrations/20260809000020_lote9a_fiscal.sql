-- Lote 9a: módulo Fiscal — tabelas que ficaram de fora da Fase 3 (lote7c só
-- cobriu nota_fiscal_item/nfse + as RPCs de emissão; estas 8 tabelas nunca
-- foram migradas, confirmado via auditoria ao vivo em pg_policies, não por
-- arquivo). Reaproveita o menu 'fiscal-principal' já usado pelas tabelas
-- irmãs (nota_fiscal_item, nfse, nota_fiscal_emitir/autorizar/cancelar,
-- apurar_impostos_competencia — Fase 3, 20260718110006/20260718100003).
--
-- Texto USING/WITH CHECK copiado verbatim do estado AO VIVO (pg_policies),
-- não de arquivo — só troca has_role(...) por can_access(...,'fiscal-
-- principal',...); resto da expressão (user_pode_atuar_empresa, EXISTS)
-- fica idêntico.
--
-- Convenção: has_role(admin) sozinho (bypass total, ignora tenant) ->
-- 'excluir' (nunca usado nesse menu ainda, mas cobre só concede_tudo, sem
-- backfill necessário — mesmo padrão já usado em outras lotes). has_role
-- (fiscal/controladoria/financeiro/diretor_adm) combinado com tenant scope
-- -> 'alterar' (escrita) ou 'visualizar' (leitura mais ampla do
-- param_fiscal_select).
--
-- ROLLBACK: recriar cada policy com has_role() nas combinações originais
-- (ver resultado da auditoria ao vivo desta sessão, ou migrations
-- 20260430021948/20260430023651/20260430030039 + arquivo de origem de
-- apuracao_imposto/nota_fiscal).

-- ── apuracao_imposto ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS apur_manage ON public.apuracao_imposto;
CREATE POLICY apur_manage ON public.apuracao_imposto FOR ALL TO authenticated
  USING (
    public.can_access(auth.uid(), 'fiscal-principal', 'excluir')
    OR (public.can_access(auth.uid(), 'fiscal-principal', 'alterar') AND public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  )
  WITH CHECK (
    public.can_access(auth.uid(), 'fiscal-principal', 'excluir')
    OR (public.can_access(auth.uid(), 'fiscal-principal', 'alterar') AND public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  );

DROP POLICY IF EXISTS apur_select ON public.apuracao_imposto;
CREATE POLICY apur_select ON public.apuracao_imposto FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'fiscal-principal', 'excluir')
    OR public.user_pode_atuar_empresa(auth.uid(), empresa_id)
  );

-- ── apuracao_imposto_item ────────────────────────────────────────────────
DROP POLICY IF EXISTS apur_item_manage ON public.apuracao_imposto_item;
CREATE POLICY apur_item_manage ON public.apuracao_imposto_item FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.apuracao_imposto a
    WHERE a.id = apuracao_imposto_item.apuracao_id
      AND (
        public.can_access(auth.uid(), 'fiscal-principal', 'excluir')
        OR (public.can_access(auth.uid(), 'fiscal-principal', 'alterar') AND public.user_pode_atuar_empresa(auth.uid(), a.empresa_id))
      )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.apuracao_imposto a
    WHERE a.id = apuracao_imposto_item.apuracao_id
      AND (
        public.can_access(auth.uid(), 'fiscal-principal', 'excluir')
        OR (public.can_access(auth.uid(), 'fiscal-principal', 'alterar') AND public.user_pode_atuar_empresa(auth.uid(), a.empresa_id))
      )
  ));

DROP POLICY IF EXISTS apur_item_select ON public.apuracao_imposto_item;
CREATE POLICY apur_item_select ON public.apuracao_imposto_item FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.apuracao_imposto a
    WHERE a.id = apuracao_imposto_item.apuracao_id
      AND (
        public.can_access(auth.uid(), 'fiscal-principal', 'excluir')
        OR public.user_pode_atuar_empresa(auth.uid(), a.empresa_id)
      )
  ));

-- ── empresa_fiscal_config ────────────────────────────────────────────────
DROP POLICY IF EXISTS fiscal_config_manage ON public.empresa_fiscal_config;
CREATE POLICY fiscal_config_manage ON public.empresa_fiscal_config FOR ALL TO authenticated
  USING (
    public.can_access(auth.uid(), 'fiscal-principal', 'excluir')
    OR (public.can_access(auth.uid(), 'fiscal-principal', 'alterar') AND public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  )
  WITH CHECK (
    public.can_access(auth.uid(), 'fiscal-principal', 'excluir')
    OR (public.can_access(auth.uid(), 'fiscal-principal', 'alterar') AND public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  );

DROP POLICY IF EXISTS fiscal_config_select ON public.empresa_fiscal_config;
CREATE POLICY fiscal_config_select ON public.empresa_fiscal_config FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'fiscal-principal', 'excluir')
    OR public.user_pode_atuar_empresa(auth.uid(), empresa_id)
  );

-- ── servico_municipal ────────────────────────────────────────────────────
DROP POLICY IF EXISTS servico_manage ON public.servico_municipal;
CREATE POLICY servico_manage ON public.servico_municipal FOR ALL TO authenticated
  USING (
    public.can_access(auth.uid(), 'fiscal-principal', 'excluir')
    OR (public.can_access(auth.uid(), 'fiscal-principal', 'alterar') AND public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  )
  WITH CHECK (
    public.can_access(auth.uid(), 'fiscal-principal', 'excluir')
    OR (public.can_access(auth.uid(), 'fiscal-principal', 'alterar') AND public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  );

DROP POLICY IF EXISTS servico_select ON public.servico_municipal;
CREATE POLICY servico_select ON public.servico_municipal FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'fiscal-principal', 'excluir')
    OR public.user_pode_atuar_empresa(auth.uid(), empresa_id)
  );

-- ── parametro_fiscal ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS param_fiscal_delete ON public.parametro_fiscal;
CREATE POLICY param_fiscal_delete ON public.parametro_fiscal FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'fiscal-principal', 'excluir'));

DROP POLICY IF EXISTS param_fiscal_insert ON public.parametro_fiscal;
CREATE POLICY param_fiscal_insert ON public.parametro_fiscal FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access(auth.uid(), 'fiscal-principal', 'excluir')
    OR (public.user_pode_atuar_empresa(auth.uid(), empresa_id) AND public.can_access(auth.uid(), 'fiscal-principal', 'alterar'))
  );

DROP POLICY IF EXISTS param_fiscal_select ON public.parametro_fiscal;
CREATE POLICY param_fiscal_select ON public.parametro_fiscal FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'fiscal-principal', 'excluir')
    OR (public.user_pode_atuar_empresa(auth.uid(), empresa_id) AND public.can_access(auth.uid(), 'fiscal-principal', 'visualizar'))
  );

DROP POLICY IF EXISTS param_fiscal_update ON public.parametro_fiscal;
CREATE POLICY param_fiscal_update ON public.parametro_fiscal FOR UPDATE TO authenticated
  USING (
    public.can_access(auth.uid(), 'fiscal-principal', 'excluir')
    OR (public.user_pode_atuar_empresa(auth.uid(), empresa_id) AND public.can_access(auth.uid(), 'fiscal-principal', 'alterar'))
  );

-- ── nota_fiscal ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS nf_manage ON public.nota_fiscal;
CREATE POLICY nf_manage ON public.nota_fiscal FOR ALL TO authenticated
  USING (
    public.can_access(auth.uid(), 'fiscal-principal', 'excluir')
    OR (public.can_access(auth.uid(), 'fiscal-principal', 'alterar') AND public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  )
  WITH CHECK (
    public.can_access(auth.uid(), 'fiscal-principal', 'excluir')
    OR (public.can_access(auth.uid(), 'fiscal-principal', 'alterar') AND public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  );

DROP POLICY IF EXISTS nf_select ON public.nota_fiscal;
CREATE POLICY nf_select ON public.nota_fiscal FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'fiscal-principal', 'excluir')
    OR public.user_pode_atuar_empresa(auth.uid(), empresa_id)
  );

-- ── nota_fiscal_evento ───────────────────────────────────────────────────
DROP POLICY IF EXISTS nfev_insert ON public.nota_fiscal_evento;
CREATE POLICY nfev_insert ON public.nota_fiscal_evento FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.nota_fiscal n
    WHERE n.id = nota_fiscal_evento.nota_fiscal_id
      AND (
        public.can_access(auth.uid(), 'fiscal-principal', 'excluir')
        OR (public.can_access(auth.uid(), 'fiscal-principal', 'alterar') AND public.user_pode_atuar_empresa(auth.uid(), n.empresa_id))
      )
  ));

DROP POLICY IF EXISTS nfev_select ON public.nota_fiscal_evento;
CREATE POLICY nfev_select ON public.nota_fiscal_evento FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.nota_fiscal n
    WHERE n.id = nota_fiscal_evento.nota_fiscal_id
      AND (
        public.can_access(auth.uid(), 'fiscal-principal', 'excluir')
        OR public.user_pode_atuar_empresa(auth.uid(), n.empresa_id)
      )
  ));

-- ── aud_plano_contas_origem_diagnostico (auditoria/diagnóstico — mesmo
--    padrão dos aud_* já migrados no Lote 8g-2) ────────────────────────────
DROP POLICY IF EXISTS aud_pc_select_admin_contr_pres ON public.aud_plano_contas_origem_diagnostico;
CREATE POLICY aud_pc_select_admin_contr_pres ON public.aud_plano_contas_origem_diagnostico FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'visualizar'));

NOTIFY pgrst, 'reload schema';
