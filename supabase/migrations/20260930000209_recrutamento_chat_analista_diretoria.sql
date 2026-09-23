-- =========================================================================
-- Recrutamento › chat da vaga: Analista e Diretoria também escrevem
--
-- Incidente de 22/09/2026 (print do Pablo): "Erro ao enviar mensagem: new row
-- violates row-level security policy for table WA_MENSAGENS_RECRUTAMENTO" no
-- drawer da vaga, na fila "Vagas aguardando" do Analista.
--
-- A tela do Recrutamento é UMA só com quatro escopos, e cada escopo decide
-- pelo seu menu (Recrutamento.tsx, `menuAcesso`): rh → recrutamento_gestao,
-- operacional → operacional_recrutamento, analista →
-- licitacoes_analistas_recrutamento, diretoria → diretoria_recrutamento. A
-- policy do chat só conhecia os dois primeiros: quem trabalha só pela fila
-- do Analista (Anabelle, Anne Victoria e Hellen em 22/09 — com alterar e
-- aprovar no menu delas) via o chat e não conseguia mandar mensagem. Diretoria
-- teria o mesmo problema.
--
-- Agora: lê quem VÊ qualquer um dos quatro menus (ou é o solicitante);
-- escreve quem tem alterar/aprovar em qualquer um deles (gestão também com
-- incluir, como antes) ou é o solicitante.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

DROP POLICY IF EXISTS wa_mensagens_recrutamento_gate ON public."WA_MENSAGENS_RECRUTAMENTO";
CREATE POLICY wa_mensagens_recrutamento_gate ON public."WA_MENSAGENS_RECRUTAMENTO"
  FOR ALL TO authenticated
  USING (
       has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'operacional_recrutamento', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'visualizar'::app_acao)
    OR has_screen_access(auth.uid(), 'diretoria_recrutamento', 'visualizar'::app_acao)
    OR EXISTS (SELECT 1 FROM public."SISTEMA_RECRUTAMENTO" s
                WHERE s.id = "WA_MENSAGENS_RECRUTAMENTO".solicitacao_id
                  AND s.solicitante_cpf = (SELECT p.email FROM public.profiles p WHERE p.id = auth.uid())))
  WITH CHECK (
       has_screen_access(auth.uid(), 'recrutamento_gestao', 'incluir'::app_acao)
    OR has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar'::app_acao)
    OR has_screen_access(auth.uid(), 'operacional_recrutamento', 'alterar'::app_acao)
    OR has_screen_access(auth.uid(), 'operacional_recrutamento', 'aprovar'::app_acao)
    OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'alterar'::app_acao)
    OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'aprovar'::app_acao)
    OR has_screen_access(auth.uid(), 'diretoria_recrutamento', 'alterar'::app_acao)
    OR has_screen_access(auth.uid(), 'diretoria_recrutamento', 'aprovar'::app_acao)
    OR EXISTS (SELECT 1 FROM public."SISTEMA_RECRUTAMENTO" s
                WHERE s.id = "WA_MENSAGENS_RECRUTAMENTO".solicitacao_id
                  AND s.solicitante_cpf = (SELECT p.email FROM public.profiles p WHERE p.id = auth.uid())));

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (volta a policy anterior — só gestão/operacional/solicitante)
-- DROP POLICY IF EXISTS wa_mensagens_recrutamento_gate ON public."WA_MENSAGENS_RECRUTAMENTO";
-- CREATE POLICY wa_mensagens_recrutamento_gate ON public."WA_MENSAGENS_RECRUTAMENTO" FOR ALL TO authenticated
--   USING (has_screen_access(auth.uid(),'recrutamento_gestao','visualizar'::app_acao) OR has_screen_access(auth.uid(),'operacional_recrutamento','visualizar'::app_acao)
--          OR EXISTS (SELECT 1 FROM public."SISTEMA_RECRUTAMENTO" s WHERE s.id = "WA_MENSAGENS_RECRUTAMENTO".solicitacao_id AND s.solicitante_cpf = (SELECT p.email FROM public.profiles p WHERE p.id = auth.uid())))
--   WITH CHECK (has_screen_access(auth.uid(),'recrutamento_gestao','incluir'::app_acao) OR has_screen_access(auth.uid(),'recrutamento_gestao','alterar'::app_acao)
--          OR has_screen_access(auth.uid(),'operacional_recrutamento','alterar'::app_acao) OR has_screen_access(auth.uid(),'operacional_recrutamento','aprovar'::app_acao)
--          OR EXISTS (SELECT 1 FROM public."SISTEMA_RECRUTAMENTO" s WHERE s.id = "WA_MENSAGENS_RECRUTAMENTO".solicitacao_id AND s.solicitante_cpf = (SELECT p.email FROM public.profiles p WHERE p.id = auth.uid())));
