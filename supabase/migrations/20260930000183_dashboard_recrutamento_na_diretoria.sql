-- =========================================================================
-- Dashboard de Recrutamento também na Diretoria — e os dois dashboards
-- enxergando os dados
--
-- PEDIDO (17/09/2026, Pablo): "duplica a rota desse dashboard de
-- recrutamento pra DIRETORIA, ela pode ver tudo lá" — junto com o dashboard
-- ganhando vagas em aberto por contrato e mais filtros (front).
--
-- O QUE MUDA
--   1. Menu `diretoria_recrutamento_dashboard` (/app/diretoria/
--      recrutamento-dashboard) no módulo Diretoria, ativo, semeado no perfil
--      "Diretoria" (J2). Mesma tela React do RH (RecrutamentoDashboard).
--   2. RLS: os DOIS menus de dashboard (rh_recrutamento_dashboard, que já
--      existia, e o novo) entram na leitura de SISTEMA_RECRUTAMENTO
--      (inclusive administrativa — dashboard é visão geral), no gate de
--      WA_CURRICULOS e no log de status. Até aqui quem só tinha o dashboard
--      do RH via a tela vazia, porque a policy só conhecia recrutamento_gestao.
--      Só leitura: os dashboards não gravam.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Menu + perfil ─────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'diretoria_recrutamento_dashboard', 'Diretoria — Dashboard de Recrutamento', '/app/diretoria/recrutamento-dashboard',
       COALESCE((SELECT max(y.ordem) FROM public.app_menu y WHERE y.modulo_id = m.id), 0) + 1, true
  FROM public.app_modulo m
 WHERE m.codigo = 'diretoria'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu z WHERE z.codigo = 'diretoria_recrutamento_dashboard');

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'diretoria_recrutamento_dashboard', 'visualizar'::public.app_acao, true
  FROM public.perfil_acesso pa
 WHERE pa.nome = 'Diretoria' AND pa.ativo
   AND NOT EXISTS (
     SELECT 1 FROM public.perfil_acesso_permissao pp
      WHERE pp.perfil_id = pa.id AND pp.menu_codigo = 'diretoria_recrutamento_dashboard' AND pp.acao = 'visualizar'::public.app_acao);

-- ── 2) RLS: dashboards leem ──────────────────────────────────────────────
DROP POLICY IF EXISTS sistema_recrutamento_select ON public."SISTEMA_RECRUTAMENTO";
CREATE POLICY sistema_recrutamento_select ON public."SISTEMA_RECRUTAMENTO"
  FOR SELECT TO authenticated
  USING (((has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'central_servicos_solicitacoes', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'operacional_recrutamento', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'diretoria_recrutamento', 'visualizar'::app_acao)
    -- Etapas do candidato (mig 179).
    OR has_screen_access(auth.uid(), 'sst_aso', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'candidatos', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'sup_epis_admissao', 'visualizar'::app_acao)
    -- Dashboards (mig 183): visão geral, só leitura.
    OR has_screen_access(auth.uid(), 'rh_recrutamento_dashboard', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'diretoria_recrutamento_dashboard', 'visualizar'::app_acao))
   AND ((NOT administrativa)
        OR has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa', 'visualizar'::app_acao)
        OR has_screen_access(auth.uid(), 'diretoria_recrutamento', 'visualizar'::app_acao)
        OR has_screen_access(auth.uid(), 'sst_aso', 'visualizar'::app_acao)
        OR has_screen_access(auth.uid(), 'candidatos', 'visualizar'::app_acao)
        OR has_screen_access(auth.uid(), 'sup_epis_admissao', 'visualizar'::app_acao)
        OR has_screen_access(auth.uid(), 'rh_recrutamento_dashboard', 'visualizar'::app_acao)
        OR has_screen_access(auth.uid(), 'diretoria_recrutamento_dashboard', 'visualizar'::app_acao))));

DROP POLICY IF EXISTS wa_curriculos_gate ON public."WA_CURRICULOS";
CREATE POLICY wa_curriculos_gate ON public."WA_CURRICULOS"
  FOR ALL TO authenticated
  USING (has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'sst_aso', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'candidatos', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'sup_epis_admissao', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'rh_recrutamento_dashboard', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'diretoria_recrutamento_dashboard', 'visualizar'::app_acao))
  WITH CHECK (has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'sst_aso', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'candidatos', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'sup_epis_admissao', 'visualizar'::app_acao));

DROP POLICY IF EXISTS sistema_recrutamento_status_log_dashboards ON public."SISTEMA_RECRUTAMENTO_STATUS_LOG";
CREATE POLICY sistema_recrutamento_status_log_dashboards ON public."SISTEMA_RECRUTAMENTO_STATUS_LOG"
  FOR SELECT TO authenticated
  USING (has_screen_access(auth.uid(), 'rh_recrutamento_dashboard', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'diretoria_recrutamento_dashboard', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'diretoria_recrutamento', 'visualizar'::app_acao));

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP POLICY IF EXISTS sistema_recrutamento_status_log_dashboards ON public."SISTEMA_RECRUTAMENTO_STATUS_LOG";
-- Reaplicar sistema_recrutamento_select e wa_curriculos_gate da 20260930000179;
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'diretoria_recrutamento_dashboard';
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'diretoria_recrutamento_dashboard';
-- DELETE FROM public.app_menu WHERE codigo = 'diretoria_recrutamento_dashboard';
-- NOTIFY pgrst, 'reload schema';
