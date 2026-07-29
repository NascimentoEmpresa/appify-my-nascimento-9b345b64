-- Log de produção (usuário 97260632-2f1a-44e3-9f93-58b2b1f3702c, ação
-- eb853af2-55e3-4c23-9089-990d7f237684): GET na ação retorna 200 (visível
-- via pa_select), mas PATCH continua 403 "new row violates row-level
-- security policy for table plano_acao" mesmo após a correção anterior
-- (20260802000001), que só adicionou criado_por/pode_ver_todas.
--
-- Causa: plano_acao_visible_by_user — usada no USING de pa_update e nas
-- policies de anexo/comentário/histórico/visibilidade_usuario — nunca
-- verificou visibilidade='publico' nem visibilidade='especifico' (lista em
-- plano_acao_visibilidade_usuario), que são exatamente os dois critérios
-- que pa_select já usa pra CONCEDER leitura. Um usuário que só enxerga a
-- ação por ser pública ou por estar na lista específica consegue abrir a
-- tela, mas qualquer ação de escrita (salvar, anexar, comentar, mexer na
-- própria lista de visibilidade) é barrada pela RLS.
--
-- Fecha a lacuna de vez: agora plano_acao_visible_by_user cobre os MESMOS
-- critérios de pa_select (público / privado-por-criador-responsável-
-- pode_ver_todas-pode_administrar / específico-por-lista), mantendo também
-- a hierarquia de líder/gestor de setor-área-comitê que já existia aqui e
-- não faz parte de pa_select.

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

  SELECT id, empresa_id, deleted_at, criado_por, visibilidade,
         responsavel_profile_id, lider_setor_profile_id, lider_comite_profile_id,
         setor, area, comite
    INTO r FROM public.plano_acao WHERE id = _plano_id;
  IF NOT FOUND OR r.deleted_at IS NOT NULL THEN RETURN false; END IF;

  IF public.has_role(_user,'admin'::public.app_role) THEN RETURN true; END IF;

  IF r.visibilidade = 'publico' THEN RETURN true; END IF;

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

  IF r.visibilidade = 'especifico' AND EXISTS (
    SELECT 1 FROM public.plano_acao_visibilidade_usuario pav
     WHERE pav.plano_acao_id = r.id AND pav.profile_id = _user
  ) THEN RETURN true; END IF;

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
