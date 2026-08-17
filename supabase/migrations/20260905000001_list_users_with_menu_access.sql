-- Irmã pivotada de list_accessible_menus: em vez de "dado um usuário, quais
-- menus ele vê", responde "dado um menu, quem o vê" — pra tela nova de
-- Administração > Módulos & Menus > "Por Módulo" (escolher módulo/submódulo
-- e marcar as pessoas, o inverso da já existente "Acesso por Usuário").
-- Mesma precedência de sempre: exceção individual (screen_permission_user) >
-- perfil concede_tudo > perfil comum com a permissão marcada.
--
-- ROLLBACK:
-- DROP FUNCTION IF EXISTS public.list_users_with_menu_access(text, text);

CREATE OR REPLACE FUNCTION public.list_users_with_menu_access(_menu text, _acao text DEFAULT 'visualizar')
RETURNS TABLE(user_id uuid, allowed boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH params AS (
    SELECT _acao::public.app_acao AS acao
     WHERE public.can_access(auth.uid(), 'administracao', 'visualizar')
  ),
  override AS (
    SELECT DISTINCT ON (spu.user_id) spu.user_id, spu.allow
      FROM public.screen_permission_user spu, params p
     WHERE spu.menu_codigo = _menu AND spu.acao = p.acao
     ORDER BY spu.user_id, spu.updated_at DESC
  ),
  concede_tudo AS (
    SELECT DISTINCT upa.user_id
      FROM public.usuario_perfil_acesso upa
      JOIN public.perfil_acesso pa ON pa.id = upa.perfil_id AND pa.ativo = true AND pa.concede_tudo = true
  ),
  profile_grant AS (
    SELECT DISTINCT upa.user_id
      FROM public.usuario_perfil_acesso upa
      JOIN public.perfil_acesso pa ON pa.id = upa.perfil_id AND pa.ativo = true
      JOIN public.perfil_acesso_permissao pap ON pap.perfil_id = pa.id AND pap.allow = true
      CROSS JOIN params p
     WHERE pap.menu_codigo = _menu AND pap.acao = p.acao
  )
  SELECT pr.id,
         COALESCE(o.allow, pr.id IN (SELECT user_id FROM concede_tudo) OR pr.id IN (SELECT user_id FROM profile_grant))
    FROM public.profiles pr
    CROSS JOIN params
    LEFT JOIN override o ON o.user_id = pr.id;
$$;

REVOKE ALL ON FUNCTION public.list_users_with_menu_access(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_users_with_menu_access(text, text) TO authenticated;
