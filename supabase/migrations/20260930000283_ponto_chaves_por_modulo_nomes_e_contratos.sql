-- =========================================================================
-- Conferência de Ponto: chaves no módulo certo, nomes sem "�" e leitura
-- de CONTRATOS para as telas de ponto (01/10/2026)
--
-- RELATO (Pablo):
--   1. Em Administração › Acesso por Usuário, as quatro chaves do ponto
--      aparecem todas no módulo RH — inclusive "marcar como pago", que é do
--      Financeiro, e "aprovar contratos", que é do Operacional.
--   2. Os nomes aparecem com "�" ("Ponto � marcar como pago",
--      "Confer�ncia de Ponto", "Mudan�a de Fun��o � Aprova��o").
--   3. A Calita (Financeiro) tem a tela e a chave de pagar, mas a Conferência
--      de Ponto do Financeiro mostra "Nenhum contrato ativo no cadastro" e as
--      barras ficam 0% (0/0).
--
-- CAUSAS
--   1. As chaves nasceram penduradas no módulo rh (mig da Conferência de
--      Ponto). O acesso não depende do módulo da chave (can_access olha só o
--      código), então mover é só arrumar onde o admin enxerga.
--   2. O texto foi gravado com o acento já perdido — o "�" (U+FFFD) está no
--      banco, não é a tela. Os nomes abaixo vão com escape Unicode (U&'...')
--      justamente para não depender da codificação de quem aplica.
--   3. O painel lê CONTRATOS (cadastro, fonte única) e a policy contratos_gate
--      não tinha nenhuma tela de ponto: quem só tem o ponto (caso do
--      Financeiro) recebia a lista vazia, sem erro.
--
-- O QUE FICA, POR MÓDULO (pedido do Pablo)
--   Operacional: Conferência de Ponto · Dashboard de Pontos · Ponto — aprovar contratos
--   RH:          Conferência de Ponto · Dashboard de Pontos · Ponto — confirmar a aprovação
--                · Ponto — informar valor e enviar ao financeiro
--   Financeiro:  Conferência de Ponto · Dashboard de Pontos · Ponto — marcar como pago
--   (os três Dashboards de Pontos já existiam, um por módulo.)
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

-- ── 1. Nomes ─────────────────────────────────────────────────────────────
UPDATE public.app_menu SET nome = U&'Confer\00EAncia de Ponto', updated_at = now()
 WHERE codigo IN ('rh_conferencia_ponto', 'operacional_conferencia_ponto', 'financeiro_conferencia_ponto');
UPDATE public.app_menu SET nome = U&'Ponto \2014 aprovar contratos', updated_at = now()
 WHERE codigo = 'ponto_aprovar_contrato';
UPDATE public.app_menu SET nome = U&'Ponto \2014 confirmar a aprova\00E7\00E3o', updated_at = now()
 WHERE codigo = 'ponto_confirmar_aprovacao';
UPDATE public.app_menu SET nome = U&'Ponto \2014 informar valor e enviar ao financeiro', updated_at = now()
 WHERE codigo = 'ponto_informar_valor';
UPDATE public.app_menu SET nome = U&'Ponto \2014 marcar como pago', updated_at = now()
 WHERE codigo = 'ponto_marcar_pago';
UPDATE public.app_menu SET nome = U&'Mudan\00E7a de Fun\00E7\00E3o \2014 Aprova\00E7\00E3o', updated_at = now()
 WHERE codigo = 'escritorio_troca_funcao';

-- ── 2. Cada chave no módulo de quem a usa ────────────────────────────────
UPDATE public.app_menu m
   SET modulo_id = mo.id, ordem = 34, updated_at = now()
  FROM public.app_modulo mo
 WHERE mo.codigo = 'operacional' AND m.codigo = 'ponto_aprovar_contrato';

UPDATE public.app_menu m
   SET modulo_id = mo.id, ordem = 173, updated_at = now()
  FROM public.app_modulo mo
 WHERE mo.codigo = 'financeiro' AND m.codigo = 'ponto_marcar_pago';

UPDATE public.app_menu SET ordem = 68, updated_at = now() WHERE codigo = 'ponto_confirmar_aprovacao';
UPDATE public.app_menu SET ordem = 69, updated_at = now() WHERE codigo = 'ponto_informar_valor';

-- ── 3. CONTRATOS: as telas de ponto também leem o cadastro ───────────────
DROP POLICY IF EXISTS contratos_gate ON public."CONTRATOS";
CREATE POLICY contratos_gate ON public."CONTRATOS" FOR SELECT TO authenticated
  USING (
    has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'colaboradores', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'central_servicos_solicitacoes', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'advertencias', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar'::app_acao)
    -- Conferência de Ponto e Dashboard de Pontos, nos três módulos
    OR has_screen_access(auth.uid(), 'rh_conferencia_ponto', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'operacional_conferencia_ponto', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'financeiro_conferencia_ponto', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'rh_conferencia_ponto_painel', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'operacional_dashboard_pontos', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'financeiro_dashboard_pontos', 'visualizar'::app_acao)
  );

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- UPDATE public.app_menu m SET modulo_id = mo.id FROM public.app_modulo mo
--  WHERE mo.codigo = 'rh' AND m.codigo IN ('ponto_aprovar_contrato', 'ponto_marcar_pago');
-- DROP POLICY IF EXISTS contratos_gate ON public."CONTRATOS";
-- CREATE POLICY contratos_gate ON public."CONTRATOS" FOR SELECT TO authenticated
--   USING (has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao)
--       OR has_screen_access(auth.uid(), 'colaboradores', 'visualizar'::app_acao)
--       OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar'::app_acao)
--       OR has_screen_access(auth.uid(), 'central_servicos_solicitacoes', 'visualizar'::app_acao)
--       OR has_screen_access(auth.uid(), 'advertencias', 'visualizar'::app_acao)
--       OR has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar'::app_acao));
-- NOTIFY pgrst, 'reload schema';
