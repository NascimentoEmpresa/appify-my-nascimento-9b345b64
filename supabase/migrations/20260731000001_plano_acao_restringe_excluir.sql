-- Pedido da gestão: restringir quem pode excluir uma ação. Hoje, qualquer
-- usuário com acesso ao módulo via tela nova de acesso (Módulos & Menus /
-- screen_permission_user) ganha "excluir" de brinde, pelo fallback
-- introduzido em 20260617000008. Passa a exigir sempre uma linha explícita
-- em plano_acao_usuario_permissao com pode_excluir=true — quem já tem essa
-- flag hoje (seed original do módulo) continua podendo excluir; quem só
-- tem acesso pela tela nova, não. Não mexe em nenhuma outra permissão
-- (visualizar/criar/editar/importar/aprovar/administrar/ver_todas
-- continuam com o mesmo fallback de sempre), nem no bypass de admin
-- global / acessa_todas_empresas (mecanismos separados, fora deste pedido).

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
  BASIC_PERMS CONSTANT text[] := ARRAY['visualizar','dashboard','editar'];
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;

  -- Bypass admin global
  IF public.has_role(p_user_id, 'admin'::public.app_role) THEN RETURN true; END IF;

  -- Bypass acessa_todas_empresas
  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user_id AND p.acessa_todas_empresas = true
  ) THEN RETURN true; END IF;

  -- Permissões básicas via screen access (sempre incluídas quando há acesso à tela)
  -- "excluir" foi removido de BASIC_PERMS de propósito (ver bloco abaixo).
  IF p_permission = ANY(BASIC_PERMS) THEN
    IF public.has_screen_access(p_user_id, 'plano_acoes_lista', 'visualizar'::public.app_acao)
       AND public.user_pode_atuar_empresa(p_user_id, p_empresa_id)
    THEN RETURN true; END IF;
  END IF;

  IF NOT public.user_pode_atuar_empresa(p_user_id, p_empresa_id) THEN RETURN false; END IF;

  -- Verifica entrada explícita em plano_acao_usuario_permissao
  EXECUTE format(
    'SELECT %I FROM public.plano_acao_usuario_permissao WHERE empresa_id = $1 AND profile_id = $2',
    'pode_' || p_permission
  ) INTO v_flag USING p_empresa_id, p_user_id;

  -- Se existe entrada explícita (true ou false), respeitá-la
  IF v_flag IS NOT NULL THEN RETURN v_flag; END IF;

  -- "excluir" nunca cai no fallback genérico de acesso à tela — sem linha
  -- explícita com pode_excluir=true, nega por padrão.
  IF p_permission = 'excluir' THEN RETURN false; END IF;

  -- Sem entrada explícita: fallback por acesso à tela do módulo
  -- (acesso concedido via administracao?tab=modulos = acesso completo ao módulo)
  IF public.has_screen_access(p_user_id, 'plano_acoes_lista', 'visualizar'::public.app_acao)
  THEN RETURN true; END IF;

  RETURN false;
EXCEPTION WHEN undefined_column THEN RETURN false;
END;
$f$;

-- Mesmo ajuste no retorno usado pelo hook usePlanoAcaoPermissao (frontend)
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
  -- Fallback por acesso de tela: igual a v_all, mas sem excluir — exige
  -- entrada explícita em plano_acao_usuario_permissao (ver plano_acao_can_access).
  v_all_sem_excluir json := '{"pode_visualizar":true,"pode_dashboard":true,"pode_criar":true,"pode_editar":true,"pode_excluir":false,"pode_importar":true,"pode_aprovar":true,"pode_administrar":true,"pode_ver_todas":true}'::json;
  v_none json := '{"pode_visualizar":false,"pode_dashboard":false,"pode_criar":false,"pode_editar":false,"pode_excluir":false,"pode_importar":false,"pode_aprovar":false,"pode_administrar":false,"pode_ver_todas":false}'::json;
  v_row  public.plano_acao_usuario_permissao%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN v_none; END IF;

  -- Bypass: admin global
  IF public.has_role(v_uid, 'admin'::public.app_role) THEN RETURN v_all; END IF;

  -- Bypass: acessa_todas_empresas
  IF EXISTS (
    SELECT 1 FROM public.profiles WHERE id = v_uid AND acessa_todas_empresas = true
  ) THEN RETURN v_all; END IF;

  -- Entrada explícita em plano_acao_usuario_permissao (controle fino)
  SELECT * INTO v_row
  FROM public.plano_acao_usuario_permissao
  WHERE empresa_id = _empresa_id AND profile_id = v_uid;

  IF FOUND THEN
    RETURN json_build_object(
      'pode_visualizar',  COALESCE(v_row.pode_visualizar,  false),
      'pode_dashboard',   COALESCE(v_row.pode_dashboard,   false),
      'pode_criar',       COALESCE(v_row.pode_criar,       false),
      'pode_editar',      COALESCE(v_row.pode_editar,      false),
      'pode_excluir',     COALESCE(v_row.pode_excluir,     false),
      'pode_importar',    COALESCE(v_row.pode_importar,    false),
      'pode_aprovar',     COALESCE(v_row.pode_aprovar,     false),
      'pode_administrar', COALESCE(v_row.pode_administrar, false),
      'pode_ver_todas',   COALESCE(v_row.pode_ver_todas,   false)
    );
  END IF;

  -- Sem entrada explícita: fallback por acesso à tela — não inclui mais
  -- "excluir", que agora exige linha explícita.
  IF public.has_screen_access(v_uid, 'plano_acoes_lista', 'visualizar'::public.app_acao)
     AND public.user_pode_atuar_empresa(v_uid, _empresa_id)
  THEN RETURN v_all_sem_excluir; END IF;

  RETURN v_none;
END;
$$;

-- BUG separado achado ao mexer nisso: excluir_plano_acao (20260623000002)
-- checava plano_acao_can_access(..., 'editar') em vez de 'excluir' — ou
-- seja, a flag pode_excluir nunca controlou de fato quem consegue excluir.
-- Corrige pra checar a permissão certa; sem isso a restrição acima não
-- teria efeito nenhum na exclusão real.
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
        public.user_pode_atuar_empresa(v_uid, v_empresa_id)
    AND public.plano_acao_can_access(v_uid, v_empresa_id, 'excluir')
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
