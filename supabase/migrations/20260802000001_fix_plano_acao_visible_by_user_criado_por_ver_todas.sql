-- Bug: usuário consegue ABRIR/VER uma ação de Plano de Ações (pa_select já
-- concede acesso pra criado_por / pode_ver_todas em ações privadas), mas ao
-- salvar (ex.: incluir um Responsável) recebe "new row violates row-level
-- security policy for table plano_acao". Causa: plano_acao_visible_by_user
-- (usada no USING de pa_update, e também em paa_*/pac_*/pah_select de
-- anexo/comentário/histórico) nunca checou criado_por nem pode_ver_todas —
-- só responsável/líder/gestor de setor-área-comitê/pode_administrar/admin.
-- Alinha essa função ao mesmo modelo de acesso já usado em pa_select.

CREATE OR REPLACE FUNCTION public.plano_acao_visible_by_user(
  _user uuid, _plano_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE r record;
BEGIN
  IF _user IS DISTINCT FROM auth.uid()
     AND NOT public.has_role(auth.uid(),'admin'::public.app_role)
     AND current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
  THEN RETURN false; END IF;

  IF _user IS NULL OR _plano_id IS NULL THEN RETURN false; END IF;

  SELECT id, empresa_id, deleted_at, criado_por,
         responsavel_profile_id, lider_setor_profile_id, lider_comite_profile_id,
         setor, area, comite
    INTO r FROM public.plano_acao WHERE id = _plano_id;
  IF NOT FOUND OR r.deleted_at IS NOT NULL THEN RETURN false; END IF;

  IF public.has_role(_user,'admin'::public.app_role) THEN RETURN true; END IF;

  IF r.criado_por = _user THEN RETURN true; END IF;

  IF EXISTS (SELECT 1 FROM public.permissoes_especiais
              WHERE user_id=_user AND permissao='plano_acao:ver_todos') THEN
    RETURN true;
  END IF;

  IF EXISTS (SELECT 1 FROM public.plano_acao_usuario_permissao
              WHERE profile_id=_user AND (pode_administrar = true OR pode_ver_todas = true)) THEN
    RETURN true;
  END IF;

  IF _user IN (r.responsavel_profile_id, r.lider_setor_profile_id, r.lider_comite_profile_id)
    THEN RETURN true; END IF;

  IF r.setor IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.setor s
     WHERE s.empresa_id=r.empresa_id AND s.gestor_profile_id=_user
       AND lower(s.nome)=lower(r.setor)) THEN RETURN true; END IF;

  IF r.area IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.area a
     WHERE a.empresa_id=r.empresa_id AND a.gestor_profile_id=_user
       AND lower(a.nome)=lower(r.area)) THEN RETURN true; END IF;

  IF r.comite IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.comite c
     WHERE c.empresa_id=r.empresa_id AND c.gestor_profile_id=_user
       AND lower(c.nome)=lower(r.comite)) THEN RETURN true; END IF;

  IF r.setor IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.setor s JOIN public.area a ON a.id=s.area_id
     WHERE s.empresa_id=r.empresa_id AND lower(s.nome)=lower(r.setor)
       AND a.gestor_profile_id=_user) THEN RETURN true; END IF;

  IF r.area IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.area a JOIN public.comite c ON c.id=a.comite_id
     WHERE a.empresa_id=r.empresa_id AND lower(a.nome)=lower(r.area)
       AND c.gestor_profile_id=_user) THEN RETURN true; END IF;

  RETURN false;
END; $$;

REVOKE ALL ON FUNCTION public.plano_acao_visible_by_user(uuid,uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.plano_acao_visible_by_user(uuid,uuid) TO authenticated;
