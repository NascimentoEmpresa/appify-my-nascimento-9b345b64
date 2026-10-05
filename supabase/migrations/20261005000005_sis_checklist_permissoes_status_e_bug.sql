-- =========================================================================
-- Sistemas › CHECKLIST DE MÓDULOS — duas permissões separadas (05/10/2026)
--
-- PEDIDO (Pablo): "tem que ter duas permissões diferentes, quem pode editar
-- os status e quem pode adicionar um bug, adiciona no gerenciamento de acesso
-- por usuário. Deixa padrão ninguém conseguir editar os status, só com a
-- liberação pelo gerenciamento de acesso por usuário."
--
-- ANTES (mig 20260930000291): tudo pela tela sistemas_checklist_modulos —
-- "incluir" registrava bug e "alterar" preenchia o checklist (os status).
-- Quem é Gerente de Sistemas ganhou as duas na semeadura.
--
-- AGORA: dois menus fantasma (rota NULL) no módulo Sistemas, que aparecem
-- sozinhos em Administração › Acesso por Usuário:
--   · sistemas_checklist_editar_status — "Checklist de Módulos · Editar status"
--     preencher/alterar o checklist de módulos e telas ("SIS_CHECKLIST").
--     NASCE FECHADO PARA TODO MUNDO — inclusive admin: a checagem é a
--     liberação EXPLÍCITA em screen_permission_user (sis_ck_liberado), sem o
--     atalho do perfil "concede tudo" do has_screen_access. Mesmo critério
--     das capacidades dos Formulários.
--   · sistemas_checklist_adicionar_bug — "Checklist de Módulos · Adicionar bug"
--     registrar bug ("SIS_BUG" INSERT). Semeado para quem já registrava bug
--     hoje (incluir ou alterar na tela), para ninguém perder o que tinha.
--
-- Fica como estava: ver (visualizar), triagem/encaminhamento de bug e
-- treinamentos (alterar), apagar (excluir), exportar — na tela do checklist.
--
-- Idempotente. Aplicar no banco do app (SQL Editor) — não se auto-aplica.
-- =========================================================================

-- ── 1) Os dois menus fantasma ────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, x.codigo, x.nome, NULL, x.ordem, true
  FROM (VALUES
    ('sistemas_checklist_editar_status', 'Checklist de Módulos · Editar status', 6),
    ('sistemas_checklist_adicionar_bug', 'Checklist de Módulos · Adicionar bug', 7)
  ) AS x(codigo, nome, ordem)
  JOIN public.app_modulo m ON m.codigo = 'sistemas'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- ── 2) Quem já registrava bug continua registrando ───────────────────────
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT DISTINCT s.user_id, 'sistemas_checklist_adicionar_bug', 'visualizar'::public.app_acao, true,
       'Migração 20261005000005: já registrava bug no Checklist de Módulos'
  FROM public.screen_permission_user s
 WHERE s.menu_codigo = 'sistemas_checklist_modulos' AND s.allow
   AND s.acao IN ('incluir'::public.app_acao, 'alterar'::public.app_acao)
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id AND x.menu_codigo = 'sistemas_checklist_adicionar_bug'
                      AND x.acao = 'visualizar'::public.app_acao);

-- ── 3) Liberação explícita (sem o atalho de admin) ───────────────────────
CREATE OR REPLACE FUNCTION public.sis_ck_liberado(_menu text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND coalesce((
    SELECT s.allow FROM public.screen_permission_user s
     WHERE s.user_id = auth.uid() AND s.menu_codigo = _menu AND s.acao = 'visualizar'::public.app_acao
     ORDER BY s.updated_at DESC LIMIT 1), false);
$f$;
REVOKE ALL ON FUNCTION public.sis_ck_liberado(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sis_ck_liberado(text) TO authenticated;

-- O que a tela precisa saber de uma vez.
CREATE OR REPLACE FUNCTION public.sis_ck_minhas_capacidades()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT jsonb_build_object(
    'editar_status', public.sis_ck_pode('visualizar') AND public.sis_ck_liberado('sistemas_checklist_editar_status'),
    'adicionar_bug', public.sis_ck_pode('visualizar') AND public.sis_ck_liberado('sistemas_checklist_adicionar_bug'));
$f$;
REVOKE ALL ON FUNCTION public.sis_ck_minhas_capacidades() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sis_ck_minhas_capacidades() TO authenticated;

-- ── 4) As policies passam a cobrar as permissões novas ───────────────────
DROP POLICY IF EXISTS sis_checklist_escrever ON public."SIS_CHECKLIST";
CREATE POLICY sis_checklist_escrever ON public."SIS_CHECKLIST" FOR ALL TO authenticated
  USING (public.sis_ck_pode('visualizar') AND public.sis_ck_liberado('sistemas_checklist_editar_status'))
  WITH CHECK (public.sis_ck_pode('visualizar') AND public.sis_ck_liberado('sistemas_checklist_editar_status'));

DROP POLICY IF EXISTS sis_bug_incluir ON public."SIS_BUG";
CREATE POLICY sis_bug_incluir ON public."SIS_BUG" FOR INSERT TO authenticated
  WITH CHECK (public.sis_ck_pode('visualizar') AND public.sis_ck_liberado('sistemas_checklist_adicionar_bug')
              AND status = 'aberto' AND chamado_id IS NULL);

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP POLICY IF EXISTS sis_checklist_escrever ON public."SIS_CHECKLIST";
-- CREATE POLICY sis_checklist_escrever ON public."SIS_CHECKLIST" FOR ALL TO authenticated
--   USING (public.sis_ck_pode('alterar')) WITH CHECK (public.sis_ck_pode('alterar'));
-- DROP POLICY IF EXISTS sis_bug_incluir ON public."SIS_BUG";
-- CREATE POLICY sis_bug_incluir ON public."SIS_BUG" FOR INSERT TO authenticated
--   WITH CHECK (public.sis_ck_pode('incluir') AND status = 'aberto' AND chamado_id IS NULL);
-- DROP FUNCTION IF EXISTS public.sis_ck_minhas_capacidades();
-- DROP FUNCTION IF EXISTS public.sis_ck_liberado(text);
-- DELETE FROM public.screen_permission_user WHERE menu_codigo IN ('sistemas_checklist_editar_status','sistemas_checklist_adicionar_bug');
-- DELETE FROM public.app_menu WHERE codigo IN ('sistemas_checklist_editar_status','sistemas_checklist_adicionar_bug');
