-- =========================================================================
-- "CONCEDE TUDO" SÓ PARA AS TELAS QUE JÁ EXISTEM (08/10/2026)
--
-- PEDIDO (Pablo): "quando é desenvolvido um módulo ou sistema novo, esses
-- (Administrador Geral) já têm permissão, mas não pode — todos devem ficar
-- sem permissão e depois colocamos manualmente". Decidido: só daqui pra
-- frente; nenhuma tela que já existe muda.
--
-- O perfil "Administrador Geral" (perfil_acesso.concede_tudo) liberava
-- QUALQUER tela, inclusive as que ainda iam ser criadas — toda tela nova
-- nascia com 7 pessoas dentro, e era preciso tirar uma a uma na mão.
--
-- Agora cada tela diz se o "concede tudo" a alcança
-- (app_menu.concede_tudo_alcanca):
--   · as que existem hoje: SIM (nada muda para ninguém);
--   · as criadas daqui pra frente: NÃO (default da coluna) — nascem sem
--     ninguém e são liberadas em Administração › Acesso por Usuário.
-- Exceção individual continua vencendo tudo (liberar ou negar), e os perfis
-- comuns seguem iguais.
--
-- Código que NÃO é tela cadastrada (capacidades checadas por
-- has_screen_access nas regras do banco) continua alcançado como antes — só
-- sai do "concede tudo" o que está em app_menu marcado com NÃO.
--
-- Funções reescritas a partir da definição viva (pg_get_functiondef de
-- 08/10/2026), trocando só o trecho do "concede tudo": has_screen_access,
-- list_accessible_menus (menu lateral e RouteGuard) e
-- list_users_with_menu_access (lista "Com acesso" da Administração). O front
-- (PermissoesContext) lê a mesma coluna.
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── 1) A marca na tela: as de hoje SIM, as novas NÃO ─────────────────────
-- Cria com DEFAULT true (preenche as que existem) e troca o default para
-- false (as próximas). Dentro do IF: reaplicar não marca as criadas depois.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'app_menu' AND column_name = 'concede_tudo_alcanca') THEN
    ALTER TABLE public.app_menu ADD COLUMN concede_tudo_alcanca boolean NOT NULL DEFAULT true;
    ALTER TABLE public.app_menu ALTER COLUMN concede_tudo_alcanca SET DEFAULT false;
  END IF;
END $$;
COMMENT ON COLUMN public.app_menu.concede_tudo_alcanca IS
  'O perfil "concede tudo" (Administrador Geral) libera esta tela? true nas telas que existiam em 08/10/2026; tela nova nasce false (liberar por pessoa).';

-- ── 2) A regra num lugar só ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.concede_tudo_alcanca(_menu text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.app_menu WHERE codigo = _menu)
      OR EXISTS (SELECT 1 FROM public.app_menu WHERE codigo = _menu AND concede_tudo_alcanca)
$$;
REVOKE ALL ON FUNCTION public.concede_tudo_alcanca(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.concede_tudo_alcanca(text) TO authenticated;

-- ── 3) has_screen_access ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_screen_access(_user uuid, _menu text, _acao app_acao, _empresa uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_allow boolean;
BEGIN
  IF _user IS NULL THEN
    RETURN false;
  END IF;

  -- Login vinculado a colaborador demitido não acessa o ERP (mig 20261006160000).
  IF public.erp_login_bloqueado(_user) THEN
    RETURN false;
  END IF;

  -- 1. Exceção individual (mais recente vence, empresa não é mais fator)
  SELECT allow INTO v_allow
    FROM public.screen_permission_user
   WHERE user_id    = _user
     AND menu_codigo = _menu
     AND acao        = _acao
   ORDER BY updated_at DESC
   LIMIT 1;
  IF FOUND THEN RETURN v_allow; END IF;

  -- 2. Perfil "concede tudo" (substitui o antigo has_role(admin) bypass).
  --    Só nas telas que ele alcança: tela criada a partir de 08/10/2026
  --    nasce fora dele (mig 20261008000006) e é liberada uma a uma.
  IF EXISTS (
    SELECT 1
      FROM public.usuario_perfil_acesso upa
      JOIN public.perfil_acesso pa ON pa.id = upa.perfil_id AND pa.ativo = true AND pa.concede_tudo = true
     WHERE upa.user_id = _user
  ) AND public.concede_tudo_alcanca(_menu) THEN
    RETURN true;
  END IF;

  -- 3. União dos perfis de acesso comuns atribuídos ao usuário
  RETURN EXISTS (
    SELECT 1
      FROM public.usuario_perfil_acesso upa
      JOIN public.perfil_acesso pa ON pa.id = upa.perfil_id AND pa.ativo = true
      JOIN public.perfil_acesso_permissao pap ON pap.perfil_id = pa.id
     WHERE upa.user_id     = _user
       AND pap.menu_codigo = _menu
       AND pap.acao        = _acao
       AND pap.allow       = true
  );
END;
$function$;

-- ── 4) list_accessible_menus (menu lateral e RouteGuard) ─────────────────
CREATE OR REPLACE FUNCTION public.list_accessible_menus(_user uuid, _acao text DEFAULT 'visualizar'::text, _empresa uuid DEFAULT NULL::uuid)
 RETURNS TABLE(menu_codigo text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH
  params AS (
    SELECT
      _user                  AS user_id,
      _acao::public.app_acao AS acao
    WHERE _user = auth.uid()
       OR public.can_access(auth.uid(), 'administracao', 'visualizar')
  ),
  active_menus AS (
    SELECT am.codigo AS menu_codigo, am.concede_tudo_alcanca AS alcanca
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
   WHERE COALESCE(o.allow, (ct.ok AND am.alcanca) OR pr.menu_codigo IS NOT NULL) IS TRUE;
$function$;

-- ── 5) list_users_with_menu_access (lista "Com acesso") ──────────────────
CREATE OR REPLACE FUNCTION public.list_users_with_menu_access(_menu text, _acao text DEFAULT 'visualizar'::text)
 RETURNS TABLE(user_id uuid, allowed boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
     WHERE public.concede_tudo_alcanca(_menu)
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
$function$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Reaplicar has_screen_access / list_accessible_menus / list_users_with_menu_access sem a condição
--   concede_tudo_alcanca (as definições anteriores são estas mesmas sem o "AND public.concede_tudo_alcanca(_menu)",
--   o "AND am.alcanca" e o "WHERE public.concede_tudo_alcanca(_menu)");
-- DROP FUNCTION IF EXISTS public.concede_tudo_alcanca(text);
-- ALTER TABLE public.app_menu DROP COLUMN IF EXISTS concede_tudo_alcanca;
