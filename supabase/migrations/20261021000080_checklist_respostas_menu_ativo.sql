-- ============================================================================
-- Hotfix: RLS do checklist da Implantacao deve aceitar o menu da rota ativa.
--
-- A tela atual e /app/licitacoes/implantacao, cujo codigo de permissao e
-- `licitacoes.implantacao`. As policies criadas em 20260930000275 ficaram
-- somente com o codigo legado `implantacao`. Assim, uma pessoa autorizada na
-- tela atual conseguia abrir o checklist, mas a primeira gravacao (por exemplo
-- o endereco no row_index 3) era recusada com "new row violates row-level
-- security policy for table checklist_respostas".
--
-- O OR preserva a compatibilidade com a rota legada sem ampliar o acesso: a
-- pessoa continua precisando da mesma acao (visualizar/incluir/alterar) em um
-- dos dois menus da mesma funcionalidade.
-- ============================================================================

-- Policy nao aceita CREATE OR REPLACE: derruba e recria para manter a migration
-- idempotente. O SELECT em volta de can_access evita reavaliacao por linha.
DROP POLICY IF EXISTS checklist_respostas_select ON public.checklist_respostas;
CREATE POLICY checklist_respostas_select ON public.checklist_respostas
  FOR SELECT TO authenticated
  USING (
    (
      SELECT public.can_access(auth.uid(), 'licitacoes.implantacao'::text, 'visualizar'::app_acao)
          OR public.can_access(auth.uid(), 'implantacao'::text, 'visualizar'::app_acao)
    )
  );

DROP POLICY IF EXISTS checklist_respostas_insert ON public.checklist_respostas;
CREATE POLICY checklist_respostas_insert ON public.checklist_respostas
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      SELECT public.can_access(auth.uid(), 'licitacoes.implantacao'::text, 'incluir'::app_acao)
          OR public.can_access(auth.uid(), 'implantacao'::text, 'incluir'::app_acao)
    )
  );

DROP POLICY IF EXISTS checklist_respostas_update ON public.checklist_respostas;
CREATE POLICY checklist_respostas_update ON public.checklist_respostas
  FOR UPDATE TO authenticated
  USING (
    (
      SELECT public.can_access(auth.uid(), 'licitacoes.implantacao'::text, 'alterar'::app_acao)
          OR public.can_access(auth.uid(), 'implantacao'::text, 'alterar'::app_acao)
    )
  )
  WITH CHECK (
    (
      SELECT public.can_access(auth.uid(), 'licitacoes.implantacao'::text, 'alterar'::app_acao)
          OR public.can_access(auth.uid(), 'implantacao'::text, 'alterar'::app_acao)
    )
  );

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (recoloca as policies anteriores, somente no menu legado):
--
-- DROP POLICY IF EXISTS checklist_respostas_select ON public.checklist_respostas;
-- CREATE POLICY checklist_respostas_select ON public.checklist_respostas
--   FOR SELECT TO authenticated
--   USING ((SELECT public.can_access(auth.uid(), 'implantacao'::text, 'visualizar'::app_acao)));
--
-- DROP POLICY IF EXISTS checklist_respostas_insert ON public.checklist_respostas;
-- CREATE POLICY checklist_respostas_insert ON public.checklist_respostas
--   FOR INSERT TO authenticated
--   WITH CHECK ((SELECT public.can_access(auth.uid(), 'implantacao'::text, 'incluir'::app_acao)));
--
-- DROP POLICY IF EXISTS checklist_respostas_update ON public.checklist_respostas;
-- CREATE POLICY checklist_respostas_update ON public.checklist_respostas
--   FOR UPDATE TO authenticated
--   USING ((SELECT public.can_access(auth.uid(), 'implantacao'::text, 'alterar'::app_acao)));
-- NOTIFY pgrst, 'reload schema';
-- ============================================================================
