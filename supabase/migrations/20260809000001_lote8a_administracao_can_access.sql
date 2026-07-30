-- Lote 8a: fecha a circularidade do próprio gerenciamento de acesso.
--
-- As tabelas que sustentam a administração de acesso (role_permissions,
-- screen_permission_profile, perfil_metadata, permission_migration_snapshot,
-- profiles) e a função list_accessible_menus ainda dependiam de has_role(admin)
-- (ou de uma checagem direta em user_roles) em vez de can_access(...,'administracao',...).
-- Isso fechava um ciclo estranho: o próprio sistema que decide "quem pode ver
-- o quê" ainda era, ele mesmo, governado pelo cargo antigo.
--
-- Pré-requisito, já confirmado antes de aplicar esta migration: todo usuário
-- com cargo 'admin' hoje já retorna can_access(user_id,'administracao','alterar')
-- = true (via perfil "Legado: admin" ou concede_tudo, herdados do backfill da
-- Fase 1) — ver bloco de diagnóstico enviado junto com esta migration.
--
-- ROLLBACK: recriar as policies abaixo trocando can_access(auth.uid(),'administracao', X)
-- de volta por has_role(auth.uid(),'admin') — e, especificamente em
-- rp_select_scoped e spp_select_scoped, voltar a incluir "OR has_role(auth.uid(), role)".
-- Em list_accessible_menus, a condição anterior do CTE "params" era:
--   _user = auth.uid() OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'::public.app_role)

-- 1) role_permissions
DROP POLICY IF EXISTS "rp_select_scoped" ON public.role_permissions;
CREATE POLICY "rp_select_scoped" ON public.role_permissions FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'visualizar'));

DROP POLICY IF EXISTS "rp_admin_ins" ON public.role_permissions;
CREATE POLICY "rp_admin_ins" ON public.role_permissions FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'));

DROP POLICY IF EXISTS "rp_admin_upd" ON public.role_permissions;
CREATE POLICY "rp_admin_upd" ON public.role_permissions FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar'));

DROP POLICY IF EXISTS "rp_admin_del" ON public.role_permissions;
CREATE POLICY "rp_admin_del" ON public.role_permissions FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar'));

-- 2) screen_permission_profile (spp_write já tinha sido migrada em 20260718130001)
DROP POLICY IF EXISTS "spp_select_scoped" ON public.screen_permission_profile;
CREATE POLICY "spp_select_scoped" ON public.screen_permission_profile FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'visualizar'));

-- 3) perfil_metadata (select segue irrestrito — catálogo de nomes de cargo, sem dado sensível)
DROP POLICY IF EXISTS "perfil_metadata_admin_ins" ON public.perfil_metadata;
CREATE POLICY "perfil_metadata_admin_ins" ON public.perfil_metadata FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'));

DROP POLICY IF EXISTS "perfil_metadata_admin_upd" ON public.perfil_metadata;
CREATE POLICY "perfil_metadata_admin_upd" ON public.perfil_metadata FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'));

DROP POLICY IF EXISTS "perfil_metadata_admin_del" ON public.perfil_metadata;
CREATE POLICY "perfil_metadata_admin_del" ON public.perfil_metadata FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar'));

-- 4) permission_migration_snapshot
DROP POLICY IF EXISTS "pms_select_admin" ON public.permission_migration_snapshot;
CREATE POLICY "pms_select_admin" ON public.permission_migration_snapshot FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'visualizar'));

-- 5) profiles — acesso à própria linha preservado; só o "OR admin vê/edita
-- qualquer perfil" muda de autoridade (cargo → perfil de acesso).
DROP POLICY IF EXISTS "profiles_self_select" ON public.profiles;
CREATE POLICY "profiles_self_select" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.can_access(auth.uid(), 'administracao', 'visualizar'));

DROP POLICY IF EXISTS "profiles_self_update" ON public.profiles;
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated
  USING ((id = auth.uid()) OR public.can_access(auth.uid(), 'administracao', 'alterar'))
  WITH CHECK ((id = auth.uid()) OR public.can_access(auth.uid(), 'administracao', 'alterar'));

DROP POLICY IF EXISTS "profiles_admin_insert" ON public.profiles;
CREATE POLICY "profiles_admin_insert" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar') OR id = auth.uid());

-- 6) list_accessible_menus — o bypass "admin vê o efetivo de qualquer usuário"
-- (usado pelo painel Acesso por Usuário pra inspecionar outra pessoa) também
-- vira can_access, não mais uma leitura direta de user_roles.
CREATE OR REPLACE FUNCTION public.list_accessible_menus(
  _user    uuid,
  _acao    text DEFAULT 'visualizar',
  _empresa uuid DEFAULT NULL
)
RETURNS TABLE(menu_codigo text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH
  params AS (
    SELECT
      _user                  AS user_id,
      _acao::public.app_acao AS acao
    WHERE _user = auth.uid()
       OR public.can_access(auth.uid(), 'administracao', 'visualizar')
  ),
  active_menus AS (
    SELECT am.codigo AS menu_codigo
      FROM public.app_menu   am
      JOIN public.app_modulo mo ON mo.id = am.modulo_id
     WHERE am.ativo = true
  ),
  override_resolved AS (
    SELECT DISTINCT ON (spu.menu_codigo)
           spu.menu_codigo, spu.allow
      FROM public.screen_permission_user spu
      CROSS JOIN params p
     WHERE spu.user_id = p.user_id
       AND spu.acao    = p.acao
     ORDER BY spu.menu_codigo, spu.updated_at DESC
  ),
  concede_tudo AS (
    SELECT EXISTS (
      SELECT 1
        FROM public.usuario_perfil_acesso upa
        JOIN public.perfil_acesso pa ON pa.id = upa.perfil_id AND pa.ativo = true AND pa.concede_tudo = true
        CROSS JOIN params p
       WHERE upa.user_id = p.user_id
    ) AS ok
  ),
  profile_resolved AS (
    SELECT DISTINCT pap.menu_codigo
      FROM public.usuario_perfil_acesso upa
      JOIN public.perfil_acesso pa ON pa.id = upa.perfil_id AND pa.ativo = true
      JOIN public.perfil_acesso_permissao pap ON pap.perfil_id = pa.id AND pap.allow = true
      CROSS JOIN params p
     WHERE upa.user_id = p.user_id
       AND pap.acao    = p.acao
  )
  SELECT DISTINCT am.menu_codigo
    FROM active_menus am
    LEFT JOIN override_resolved o  ON o.menu_codigo = am.menu_codigo
    LEFT JOIN profile_resolved  pr ON pr.menu_codigo = am.menu_codigo
    CROSS JOIN concede_tudo ct
   WHERE COALESCE(o.allow, ct.ok OR pr.menu_codigo IS NOT NULL) IS TRUE;
$$;

NOTIFY pgrst, 'reload schema';
