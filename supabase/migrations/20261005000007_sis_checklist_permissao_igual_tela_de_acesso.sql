-- =========================================================================
-- Sistemas › CHECKLIST DE MÓDULOS — "Editar status" segue a tela de acesso
-- (05/10/2026, hotfix da mig 20261005000005)
--
-- INCIDENTE (Pablo, 05/10/2026): "mesmo tendo permissão pra editar o status
-- não tá deixando editar o status no checklist de sistemas".
--
-- CAUSA: a mig 20261005000005 cobrava a liberação EXPLÍCITA em
-- screen_permission_user (sis_ck_liberado), ignorando o perfil "concede
-- tudo" (Administrador Geral). Só que a tela Administração › Acesso por
-- Usuário mostra o toggle LIGADO para quem tem esse perfil — então a tela
-- dizia "liberado" e o banco dizia "não". Em 05/10 não havia NENHUMA linha
-- em screen_permission_user para sistemas_checklist_editar_status.
--
-- AGORA: sis_ck_liberado usa has_screen_access — a mesma regra que a tela
-- de acesso desenha. Continua fechado para todo mundo que não é
-- Administrador Geral nem foi liberado no toggle.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.sis_ck_liberado(_menu text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL
     AND public.has_screen_access(auth.uid(), _menu, 'visualizar'::public.app_acao);
$f$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (volta à liberação só explícita, mig 20261005000005)
-- CREATE OR REPLACE FUNCTION public.sis_ck_liberado(_menu text)
-- RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
--   SELECT auth.uid() IS NOT NULL AND coalesce((
--     SELECT s.allow FROM public.screen_permission_user s
--      WHERE s.user_id = auth.uid() AND s.menu_codigo = _menu AND s.acao = 'visualizar'::public.app_acao
--      ORDER BY s.updated_at DESC LIMIT 1), false);
-- $f$;
