-- FASE 3 (fechamento do bootstrap) — as tabelas que administram o PRÓPRIO
-- sistema de acesso (user_roles, app_menu, app_modulo, perfil_acesso,
-- perfil_acesso_permissao, usuario_perfil_acesso, screen_permission_user,
-- screen_permission_profile) ainda exigiam has_role(admin)/has_role(
-- diretor_adm) pra escrever — um "bootstrap" que eu tinha mantido por
-- precaução (documentado no comentário de 20260717200001), nunca
-- confirmado explicitamente. Por instrução direta: TUDO passa a ser por
-- módulo/menu -> Acesso por Usuário, sem exceção, inclusive a
-- administração do próprio mecanismo.
--
-- Isso não cria um paradoxo de bootstrap na prática: quem já tem o perfil
-- "Administrador Geral" (concede_tudo=true, atribuído a todo admin no
-- backfill original) já satisfaz can_access(...) pra qualquer menu,
-- incluindo 'administracao' — então o acesso de configuração continua
-- funcionando pra quem já é gestor do sistema hoje, só que agora 100%
-- resolvido via perfil, não mais via cargo direto.
--
-- Menu 'administracao' (mesmo usado pelas outras telas de configuração do
-- painel, ex: alcada_aprovacao/parametro_geral no lote 7a).

-- ── user_roles ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "user_roles_self_or_admin_select" ON public.user_roles;
CREATE POLICY user_roles_self_or_admin_select ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.can_access(auth.uid(), 'administracao', 'visualizar'::app_acao));
DROP POLICY IF EXISTS "user_roles_admin_ins" ON public.user_roles;
CREATE POLICY user_roles_admin_ins ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'incluir'::app_acao));
DROP POLICY IF EXISTS "user_roles_admin_upd" ON public.user_roles;
CREATE POLICY user_roles_admin_upd ON public.user_roles FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar'::app_acao));
DROP POLICY IF EXISTS "user_roles_admin_del" ON public.user_roles;
CREATE POLICY user_roles_admin_del ON public.user_roles FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'excluir'::app_acao));

-- ── app_modulo (SELECT já é USING(true), não mexido) ─────────────────────
DROP POLICY IF EXISTS app_modulo_admin_ins ON public.app_modulo;
CREATE POLICY app_modulo_admin_ins ON public.app_modulo FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'incluir'::app_acao));
DROP POLICY IF EXISTS app_modulo_admin_upd ON public.app_modulo;
CREATE POLICY app_modulo_admin_upd ON public.app_modulo FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar'::app_acao))
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'::app_acao));
DROP POLICY IF EXISTS app_modulo_admin_del ON public.app_modulo;
CREATE POLICY app_modulo_admin_del ON public.app_modulo FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'excluir'::app_acao));

-- ── app_menu (SELECT já é USING(true), não mexido) ───────────────────────
DROP POLICY IF EXISTS app_menu_admin_ins ON public.app_menu;
CREATE POLICY app_menu_admin_ins ON public.app_menu FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'incluir'::app_acao));
DROP POLICY IF EXISTS app_menu_admin_upd ON public.app_menu;
CREATE POLICY app_menu_admin_upd ON public.app_menu FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar'::app_acao))
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'::app_acao));
DROP POLICY IF EXISTS app_menu_admin_del ON public.app_menu;
CREATE POLICY app_menu_admin_del ON public.app_menu FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'excluir'::app_acao));

-- ── perfil_acesso (SELECT já é USING(true), não mexido) ──────────────────
DROP POLICY IF EXISTS perfil_acesso_write ON public.perfil_acesso;
CREATE POLICY perfil_acesso_write ON public.perfil_acesso FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar'::app_acao))
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'::app_acao));

-- ── perfil_acesso_permissao (SELECT já é USING(true), não mexido) ────────
DROP POLICY IF EXISTS pap_write ON public.perfil_acesso_permissao;
CREATE POLICY pap_write ON public.perfil_acesso_permissao FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar'::app_acao))
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'::app_acao));

-- ── usuario_perfil_acesso ─────────────────────────────────────────────────
DROP POLICY IF EXISTS upa_select ON public.usuario_perfil_acesso;
CREATE POLICY upa_select ON public.usuario_perfil_acesso FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.can_access(auth.uid(), 'administracao', 'visualizar'::app_acao));
DROP POLICY IF EXISTS upa_write ON public.usuario_perfil_acesso;
CREATE POLICY upa_write ON public.usuario_perfil_acesso FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar'::app_acao))
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'::app_acao));

-- ── screen_permission_user (exceção individual por usuário/menu) ────────
DROP POLICY IF EXISTS spu_select ON public.screen_permission_user;
CREATE POLICY spu_select ON public.screen_permission_user FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.can_access(auth.uid(), 'administracao', 'visualizar'::app_acao));
DROP POLICY IF EXISTS spu_write ON public.screen_permission_user;
CREATE POLICY spu_write ON public.screen_permission_user FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar'::app_acao))
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'::app_acao));

-- ── screen_permission_profile (legado, congelado, mas ainda "gerenciamento
--    de acesso" — SELECT já é USING(true), não mexido) ──────────────────
DROP POLICY IF EXISTS spp_write ON public.screen_permission_profile;
CREATE POLICY spp_write ON public.screen_permission_profile FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar'::app_acao))
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'::app_acao));

NOTIFY pgrst, 'reload schema';
