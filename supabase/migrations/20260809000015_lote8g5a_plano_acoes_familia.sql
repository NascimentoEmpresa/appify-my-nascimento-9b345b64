-- Lote 8g, bloco 5a: família de funções do Plano de Ações que ainda tinham
-- bypass "IF has_role(admin) THEN RETURN true" na frente da lógica real.
-- Corpo copiado verbatim da última definição viva de cada função (confirmado
-- lendo os arquivos, não resumo de agente) — só a(s) linha(s) de has_role
-- muda(m), pro menu 'plano_acoes_lista' que essas mesmas funções já usam
-- internamente via has_screen_access (nenhum menu novo necessário).
--
-- Pré-requisito: rodar antes 20260802000005_unifica_pa_select_com_visible_by_user.sql
-- (correção sua pendente, sem relação com cargo) — depois dela, pa_select só
-- chama plano_acao_visible_by_user, então corrigir a função aqui já cobre a
-- policy também, sem precisar mexer nela separadamente.
--
-- ROLLBACK: recriar cada função com has_role(<uid>,'admin'::app_role) nas
-- linhas indicadas (ver 20260801000001, 20260802000003, 20260603020636).

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

  -- Bypass admin global (agora via perfil_acesso, não cargo)
  IF public.can_access(p_user_id, 'plano_acoes_lista', 'excluir') THEN RETURN true; END IF;

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

  IF public.can_access(v_uid, 'plano_acoes_lista', 'excluir') THEN RETURN v_all; END IF;

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

CREATE OR REPLACE FUNCTION public.plano_acao_visible_by_user(
  _user uuid, _plano_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE r record;
BEGIN
  IF _user IS DISTINCT FROM auth.uid()
     AND NOT public.can_access(auth.uid(), 'plano_acoes_lista', 'excluir')
     AND current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
  THEN RETURN false; END IF;

  IF _user IS NULL OR _plano_id IS NULL THEN RETURN false; END IF;

  SELECT id, empresa_id, deleted_at, criado_por, visibilidade,
         responsavel_profile_id, lider_setor_profile_id, lider_comite_profile_id,
         setor, area, comite
    INTO r FROM public.plano_acao WHERE id = _plano_id;
  IF NOT FOUND OR r.deleted_at IS NOT NULL THEN RETURN false; END IF;

  IF public.can_access(_user, 'plano_acoes_lista', 'excluir') THEN RETURN true; END IF;

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

CREATE OR REPLACE FUNCTION public.list_usuarios_empresa(_empresa_id uuid)
RETURNS TABLE (id uuid, display_name text, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_admin boolean;
BEGIN
  IF auth.uid() IS NULL
     OR _empresa_id IS NULL
     OR NOT public.user_pode_atuar_empresa(auth.uid(), _empresa_id)
     OR NOT (
          public.can_access(auth.uid(), 'plano_acoes_lista', 'excluir')
          OR public.plano_acao_can_access(auth.uid(), _empresa_id, 'criar')
          OR public.plano_acao_can_access(auth.uid(), _empresa_id, 'editar')
        )
  THEN
    RAISE EXCEPTION 'sem_permissao_para_listar_usuarios_empresa'
      USING ERRCODE = '42501';
  END IF;

  v_is_admin := public.can_access(auth.uid(), 'plano_acoes_lista', 'excluir');

  RETURN QUERY
  WITH elegiveis AS (
    SELECT DISTINCT p.id, p.display_name, p.email
      FROM public.profiles p
     WHERE p.ativo = true
       AND (
         p.empresa_id = _empresa_id
         OR p.acessa_todas_empresas = true
         OR EXISTS (
           SELECT 1 FROM public.user_empresa ue
            WHERE ue.user_id = p.id AND ue.empresa_id = _empresa_id
         )
       )
  )
  SELECT e.id,
         e.display_name,
         CASE WHEN v_is_admin THEN e.email ELSE NULL END
    FROM elegiveis e
   ORDER BY e.display_name NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.list_usuarios_empresa(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_usuarios_empresa(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
