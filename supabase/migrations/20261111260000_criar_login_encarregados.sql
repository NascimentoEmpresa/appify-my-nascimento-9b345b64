-- =====================================================================
-- Configurações do ERP › "PODE CRIAR LOGIN" (Encarregados) — 11/11/2026.
--
-- Pedido do Pablo: "adiciona em Administração › PODE CRIAR LOGIN
-- ENCARREGADOS — se alguém tiver essa permissão vai poder criar um NOVO
-- USUÁRIO, mas somente do setor ENCARREGADO". O mesmo desenho do "PODE TROCAR
-- A SENHA" (mig 20261020000100):
--
--   1. app_menu 'criar_login_encarregados' no módulo admin, rota própria
--      /app/logins-encarregados (a mesma tela de TrocarSenhaEncarregados: cada
--      rota tem um menu só no RouteGuard): aparece em Acesso por Usuário; o
--      switch "visualizar" é a permissão inteira. Nasce sem ninguém.
--   2. login_pode_criar(quem): a régua da Edge admin-create-user —
--      'tudo' para quem tem Administração/incluir (como antes),
--      'encarregados' para quem tem só a permissão nova, NULL para os demais.
--      Com 'encarregados' a Edge força o setor Encarregados e o perfil
--      básico, e não aceita outro setor: a trava é no servidor, não na tela.
--
-- A Edge admin-create-user passa a chamar login_pode_criar e a gravar o setor
-- ela mesma (deploy automático no merge, cluster_pos_merge.yml). Enquanto
-- esta migration não entrou, a Edge cai na regra antiga (só Administração).
-- =====================================================================

-- ── 1. A opção no gerenciamento de acesso ─────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'criar_login_encarregados', 'PODE CRIAR LOGIN (só usuários do setor Encarregados)', '/app/logins-encarregados', 91, true
  FROM public.app_modulo m WHERE m.codigo = 'admin'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- ── 2. A régua da criação ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.login_pode_criar(_quem uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN _quem IS NULL THEN NULL
    WHEN public.can_access(_quem, 'administracao', 'incluir'::public.app_acao) THEN 'tudo'
    WHEN public.has_screen_access(_quem, 'criar_login_encarregados', 'visualizar'::public.app_acao) THEN 'encarregados'
  END;
$$;
-- Só a Edge (service_role) chama.
REVOKE ALL ON FUNCTION public.login_pode_criar(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_pode_criar(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.login_pode_criar(uuid);
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'criar_login_encarregados';
-- DELETE FROM public.app_menu WHERE codigo = 'criar_login_encarregados';
-- NOTIFY pgrst, 'reload schema';
