-- =========================================================================
-- Recrutamento: quem trata uma ETAPA do candidato (SST, Jurídico, Compras)
-- enxerga a vaga dele — senão a tela da etapa fica vazia
--
-- SINTOMA (17/09/2026, MILENA DA CUNHA CASTRO, SST)
--   Tem `sst_aso` (Exame Médico) liberado, mas a tela não mostra ninguém;
--   no login do Pablo (admin) a KIMBERLLY aparece.
--
-- CAUSA
--   A tela lê VW_RECRUTAMENTO_CANDIDATOS, que é security_invoker e faz
--   JOIN de WA_CURRICULOS com SISTEMA_RECRUTAMENTO. O gate de WA_CURRICULOS
--   conhece `sst_aso`; a policy de SELECT de SISTEMA_RECRUTAMENTO (mig 127)
--   NÃO — só os menus de quem abre/aprova vaga. Pra Milena o JOIN não acha
--   a vaga e o candidato some. (Ela ainda tem recrutamento_gestao negado
--   explicitamente, o que é correto: ela não gere vagas.)
--
-- O QUE MUDA
--   As três telas de etapa do candidato entram na leitura da vaga (e da
--   administrativa também — exame, verificação e EPI valem pra qualquer
--   contratação): sst_aso (SST), candidatos (Jurídico) e sup_epis_admissao
--   (Compras). Compras entra também no gate de WA_CURRICULOS, que não o
--   tinha. Só leitura: decidir sobre a vaga continua com quem já podia.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

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
    -- Etapas do candidato (17/09/2026): SST, Jurídico e Compras leem a vaga do candidato.
    OR has_screen_access(auth.uid(), 'sst_aso', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'candidatos', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'sup_epis_admissao', 'visualizar'::app_acao))
   AND ((NOT administrativa)
        OR has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa', 'visualizar'::app_acao)
        -- Diretoria (16/09/2026): quem aprova a vaga administrativa precisa vê-la.
        OR has_screen_access(auth.uid(), 'diretoria_recrutamento', 'visualizar'::app_acao)
        -- Etapas do candidato valem pra vaga administrativa também.
        OR has_screen_access(auth.uid(), 'sst_aso', 'visualizar'::app_acao)
        OR has_screen_access(auth.uid(), 'candidatos', 'visualizar'::app_acao)
        OR has_screen_access(auth.uid(), 'sup_epis_admissao', 'visualizar'::app_acao))));

DROP POLICY IF EXISTS wa_curriculos_gate ON public."WA_CURRICULOS";
CREATE POLICY wa_curriculos_gate ON public."WA_CURRICULOS"
  FOR ALL TO authenticated
  USING (has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'sst_aso', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'candidatos', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'sup_epis_admissao', 'visualizar'::app_acao))
  WITH CHECK (has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'sst_aso', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'candidatos', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'sup_epis_admissao', 'visualizar'::app_acao));

NOTIFY pgrst, 'reload schema';

-- Conferência (trocar o e-mail): a vaga do candidato em etapa tem que aparecer.
-- SELECT has_screen_access(p.id, 'sst_aso', 'visualizar'::app_acao) FROM public.profiles p WHERE p.email = 'sst2@hagltda.com.br';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reaplicar sistema_recrutamento_select da 20260930000127 e wa_curriculos_gate
-- da migration que a criou (sem sup_epis_admissao); NOTIFY pgrst, 'reload schema';
