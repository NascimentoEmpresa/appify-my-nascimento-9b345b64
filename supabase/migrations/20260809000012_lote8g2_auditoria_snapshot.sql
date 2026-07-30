-- Lote 8g, bloco 2: tabelas de auditoria/snapshot — sem tela dedicada
-- (confirmado: zero consumidor em src/, só aparecem no types.ts). Todas
-- mapeadas pro menu 'administracao' já existente; onde havia checagem de
-- empresa (tenant scoping, não cargo), o check fica intocado.
--
-- ROLLBACK: recriar cada policy com has_role() nas combinações originais
-- (ver migrations 20260608001414, 20260608015521, 20260607194429,
-- 20260603170846, 20260508025947).

DROP POLICY IF EXISTS "aud_alias_bancario_admin_select" ON public.aud_alias_bancario_snapshot;
CREATE POLICY aud_alias_bancario_admin_select ON public.aud_alias_bancario_snapshot FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'visualizar'));

DROP POLICY IF EXISTS "aud_alias_bancario_admin_insert" ON public.aud_alias_bancario_snapshot;
CREATE POLICY aud_alias_bancario_admin_insert ON public.aud_alias_bancario_snapshot FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'visualizar'));

DROP POLICY IF EXISTS "aud_empresas_cnpj_snapshot_select_admin" ON public.aud_empresas_cnpj_snapshot;
CREATE POLICY aud_empresas_cnpj_snapshot_select_admin ON public.aud_empresas_cnpj_snapshot FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'administracao', 'visualizar')
    OR (public.can_access(auth.uid(), 'administracao', 'aprovar') AND public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  );

DROP POLICY IF EXISTS "aud_p3h0_select_escopo" ON public.aud_p3h0_conta_bancaria_snapshot;
CREATE POLICY aud_p3h0_select_escopo ON public.aud_p3h0_conta_bancaria_snapshot FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'administracao', 'visualizar')
    OR (public.can_access(auth.uid(), 'administracao', 'aprovar') AND empresa_id IS NOT NULL AND public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  );

DROP POLICY IF EXISTS "audit_admin_read" ON public.plano_acao_backfill_responsavel_audit;
CREATE POLICY audit_admin_read ON public.plano_acao_backfill_responsavel_audit FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'visualizar'));

DROP POLICY IF EXISTS "stg_bancos_contas_detectadas_admin_all" ON public.stg_bancos_contas_detectadas;
CREATE POLICY "stg_bancos_contas_detectadas_admin_all" ON public.stg_bancos_contas_detectadas FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'));

NOTIFY pgrst, 'reload schema';
