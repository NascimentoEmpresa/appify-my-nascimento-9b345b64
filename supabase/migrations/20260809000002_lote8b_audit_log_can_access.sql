-- Lote 8b: telas de admin vivas e órfãs migradas para can_access(...,'administracao',...)
-- no frontend (AlcadasTab, SaudeAlcadasPanel, AuditoriaTab, IdentidadeTab,
-- OcorrenciasTab, ParametrosTab, SessoesTab, LogsTab). No banco, a única RLS
-- pendente desse grupo era audit_log (tabela-mãe + 4 partições), definida em
-- 20260429173226 e nunca tocada desde então.
--
-- ROLLBACK: recriar as 5 policies abaixo com
--   USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'controladoria'))

DROP POLICY IF EXISTS "audit_admin_ctrl_select" ON public.audit_log;
CREATE POLICY "audit_admin_ctrl_select" ON public.audit_log FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'visualizar'));

DROP POLICY IF EXISTS "audit_admin_ctrl_select" ON public.audit_log_2026_04;
CREATE POLICY "audit_admin_ctrl_select" ON public.audit_log_2026_04 FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'visualizar'));

DROP POLICY IF EXISTS "audit_admin_ctrl_select" ON public.audit_log_2026_05;
CREATE POLICY "audit_admin_ctrl_select" ON public.audit_log_2026_05 FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'visualizar'));

DROP POLICY IF EXISTS "audit_admin_ctrl_select" ON public.audit_log_2026_06;
CREATE POLICY "audit_admin_ctrl_select" ON public.audit_log_2026_06 FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'visualizar'));

DROP POLICY IF EXISTS "audit_admin_ctrl_select" ON public.audit_log_default;
CREATE POLICY "audit_admin_ctrl_select" ON public.audit_log_default FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'visualizar'));

NOTIFY pgrst, 'reload schema';
