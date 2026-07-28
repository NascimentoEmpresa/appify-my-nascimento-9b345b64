-- Pedido da gestão: empresa não deve interferir em NADA dentro do Plano de
-- Ações — nem na checagem de vínculo real (user_pode_atuar_empresa, que
-- confirma se o usuário pertence àquela empresa via user_empresa /
-- acessa_todas_empresas / admin). Escopo: só dentro deste módulo — a
-- função user_pode_atuar_empresa em si, e seu uso em outros módulos do
-- ERP, não são tocados.
--
-- Efeito: qualquer usuário autenticado com alguma permissão de Plano de
-- Ações (por tela ou por linha explícita em plano_acao_usuario_permissao,
-- em QUALQUER empresa) passa a poder ver/criar/editar/excluir/anexar em
-- ações de qualquer empresa do grupo, independente de vínculo.

-- 1) plano_acao_can_access — remove as duas checagens de vínculo; a busca
--    da linha explícita passa a agregar entre todas as empresas do usuário.
CREATE OR REPLACE FUNCTION public.plano_acao_can_access(
  p_user_id    uuid,
  p_empresa_id uuid,
  p_permission text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $f$
DECLARE
  v_flag  boolean;
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;

  -- Bypass admin global
  IF public.has_role(p_user_id, 'admin'::public.app_role) THEN RETURN true; END IF;

  -- Bypass acessa_todas_empresas
  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user_id AND p.acessa_todas_empresas = true
  ) THEN RETURN true; END IF;

  -- Permissões básicas via screen access — não depende mais de vínculo com empresa.
  IF p_permission IN ('visualizar', 'dashboard', 'editar') THEN
    IF public.has_screen_access(p_user_id, 'plano_acoes_lista', 'visualizar'::public.app_acao)
    THEN RETURN true; END IF;
  END IF;

  -- Verifica entrada explícita em plano_acao_usuario_permissao, agregando
  -- (bool_or) entre todas as linhas do usuário — não filtra mais por empresa.
  EXECUTE format(
    'SELECT bool_or(%I) FROM public.plano_acao_usuario_permissao WHERE profile_id = $1',
    'pode_' || p_permission
  ) INTO v_flag USING p_user_id;

  IF v_flag IS NOT NULL THEN RETURN v_flag; END IF;

  -- "excluir" nunca cai no fallback genérico de acesso à tela — sem linha
  -- explícita com pode_excluir=true, nega por padrão.
  IF p_permission = 'excluir' THEN RETURN false; END IF;

  -- Sem entrada explícita: fallback por acesso à tela do módulo.
  IF public.has_screen_access(p_user_id, 'plano_acoes_lista', 'visualizar'::public.app_acao)
  THEN RETURN true; END IF;

  RETURN false;
EXCEPTION WHEN undefined_column THEN RETURN false;
END;
$f$;

-- 2) minha_permissao_plano_acao — mesmo tratamento (assinatura mantém
--    _empresa_id pro hook do frontend continuar chamando igual, só que o
--    parâmetro deixa de ser usado pra filtrar).
CREATE OR REPLACE FUNCTION public.minha_permissao_plano_acao(_empresa_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_all  json := '{"pode_visualizar":true,"pode_dashboard":true,"pode_criar":true,"pode_editar":true,"pode_excluir":true,"pode_importar":true,"pode_aprovar":true,"pode_administrar":true,"pode_ver_todas":true}'::json;
  v_all_sem_excluir json := '{"pode_visualizar":true,"pode_dashboard":true,"pode_criar":true,"pode_editar":true,"pode_excluir":false,"pode_importar":true,"pode_aprovar":true,"pode_administrar":true,"pode_ver_todas":true}'::json;
  v_none json := '{"pode_visualizar":false,"pode_dashboard":false,"pode_criar":false,"pode_editar":false,"pode_excluir":false,"pode_importar":false,"pode_aprovar":false,"pode_administrar":false,"pode_ver_todas":false}'::json;
  v_tem_linha boolean;
  v_visualizar boolean; v_dashboard boolean; v_criar boolean; v_editar boolean;
  v_excluir boolean; v_importar boolean; v_aprovar boolean; v_administrar boolean; v_ver_todas boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN v_none; END IF;

  IF public.has_role(v_uid, 'admin'::public.app_role) THEN RETURN v_all; END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles WHERE id = v_uid AND acessa_todas_empresas = true
  ) THEN RETURN v_all; END IF;

  -- Agrega entre todas as empresas do usuário (uma linha por empresa hoje,
  -- sempre com os mesmos valores, já que a tela de configuração propaga
  -- igual pra todas) — não filtra mais por _empresa_id.
  SELECT EXISTS(SELECT 1 FROM public.plano_acao_usuario_permissao WHERE profile_id = v_uid) INTO v_tem_linha;

  IF v_tem_linha THEN
    SELECT
      COALESCE(bool_or(pode_visualizar), false), COALESCE(bool_or(pode_dashboard), false),
      COALESCE(bool_or(pode_criar), false),      COALESCE(bool_or(pode_editar), false),
      COALESCE(bool_or(pode_excluir), false),    COALESCE(bool_or(pode_importar), false),
      COALESCE(bool_or(pode_aprovar), false),    COALESCE(bool_or(pode_administrar), false),
      COALESCE(bool_or(pode_ver_todas), false)
      INTO v_visualizar, v_dashboard, v_criar, v_editar, v_excluir, v_importar, v_aprovar, v_administrar, v_ver_todas
    FROM public.plano_acao_usuario_permissao
    WHERE profile_id = v_uid;

    RETURN json_build_object(
      'pode_visualizar',  v_visualizar,
      'pode_dashboard',   v_dashboard,
      'pode_criar',       v_criar,
      'pode_editar',      v_editar,
      'pode_excluir',     v_excluir,
      'pode_importar',    v_importar,
      'pode_aprovar',     v_aprovar,
      'pode_administrar', v_administrar,
      'pode_ver_todas',   v_ver_todas
    );
  END IF;

  -- Sem nenhuma linha: fallback por acesso à tela (sem excluir).
  IF public.has_screen_access(v_uid, 'plano_acoes_lista', 'visualizar'::public.app_acao)
  THEN RETURN v_all_sem_excluir; END IF;

  RETURN v_none;
END;
$$;

-- 3) plano_acao_visible_by_user — remove o gate de vínculo com empresa.
--    Chamada direta por pa_select (antiga), pa_update, paa_select,
--    paa_delete, pac_select, pac_update, pac_delete, pah_select — corrigir
--    aqui cobre todas essas policies de uma vez. Resto da lógica (hierarquia
--    de setor/área/comitê) fica igual.
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

  SELECT id, empresa_id, deleted_at,
         responsavel_profile_id, lider_setor_profile_id, lider_comite_profile_id,
         setor, area, comite
    INTO r FROM public.plano_acao WHERE id = _plano_id;
  IF NOT FOUND OR r.deleted_at IS NOT NULL THEN RETURN false; END IF;

  IF public.has_role(_user,'admin'::public.app_role) THEN RETURN true; END IF;

  IF EXISTS (SELECT 1 FROM public.permissoes_especiais
              WHERE user_id=_user AND permissao='plano_acao:ver_todos') THEN
    RETURN true;
  END IF;

  IF EXISTS (SELECT 1 FROM public.plano_acao_usuario_permissao
              WHERE profile_id=_user AND pode_administrar = true) THEN
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

-- 4) excluir_plano_acao — remove o gate de vínculo com empresa.
CREATE OR REPLACE FUNCTION public.excluir_plano_acao(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_empresa_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT empresa_id INTO v_empresa_id
    FROM public.plano_acao
   WHERE id = _id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'plano_acao_nao_encontrado' USING ERRCODE = '42501';
  END IF;

  IF NOT (
        public.plano_acao_can_access(v_uid, v_empresa_id, 'excluir')
    AND public.plano_acao_visible_by_user(v_uid, _id)
  ) THEN
    RAISE EXCEPTION 'sem_permissao_excluir_plano_acao' USING ERRCODE = '42501';
  END IF;

  UPDATE public.plano_acao
     SET deleted_at = now(), atualizado_por = v_uid
   WHERE id = _id;
END;
$$;

REVOKE ALL ON FUNCTION public.excluir_plano_acao(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.excluir_plano_acao(uuid) TO authenticated;

-- 5) Policy pa_select — remove o gate de vínculo com empresa do USING,
--    mantendo toda a lógica de visibilidade estrita (privado/público/específico).
DROP POLICY IF EXISTS pa_select ON public.plano_acao;

CREATE POLICY pa_select ON public.plano_acao
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      visibilidade = 'publico'

      OR (
        (visibilidade = 'privado' OR visibilidade IS NULL)
        AND (
          criado_por = auth.uid()
          OR responsavel_profile_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.plano_acao_usuario_permissao pap
             WHERE pap.profile_id = auth.uid()
               AND (pap.pode_ver_todas = true OR pap.pode_administrar = true)
          )
        )
      )

      OR (
        visibilidade = 'especifico'
        AND EXISTS (
          SELECT 1 FROM public.plano_acao_visibilidade_usuario pav
           WHERE pav.plano_acao_id = plano_acao.id
             AND pav.profile_id    = auth.uid()
        )
      )
    )
  );

-- 6) Policy pa_update — remove o gate de vínculo com empresa do USING e do WITH CHECK.
DROP POLICY IF EXISTS pa_update ON public.plano_acao;

CREATE POLICY pa_update ON public.plano_acao FOR UPDATE TO authenticated
  USING (
        public.plano_acao_can_access(auth.uid(), empresa_id, 'editar')
    AND public.plano_acao_visible_by_user(auth.uid(), id))
  WITH CHECK (
        public.plano_acao_can_access(auth.uid(), empresa_id, 'editar'));
