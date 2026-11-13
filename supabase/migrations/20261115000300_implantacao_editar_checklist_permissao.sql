-- =====================================================================
-- [SEM-CHAMADO] — Implantação de Contratos: "Pode editar o checklist"
--
-- PEDIDO (Pablo, 13/11/2026): quem vê a Implantação não pode, só por isso,
-- editar o checklist. Editar vira switch próprio na linha da tela, em
-- Administração › Acesso por Usuário › Licitação › Implantação de Contratos
-- (mesmo padrão do Fluxo de Caixa e do Fechamento dos Sócios: ação do menu
-- da tela em ACOES_FORA_DO_TOGGLE, src/lib/acoesDoToggleAcesso.ts).
--
-- A ação é 'alterar' do menu da tela ('licitacoes.implantacao'). Ligar a tela
-- não liga mais o 'alterar' junto; desligar a tela tira tudo.
--
-- BANCO: gravar resposta do checklist e renomear o contrato exigem 'alterar'.
-- O INSERT de checklist_respostas aceitava também 'incluir' (o upsert da
-- primeira resposta passa pelo INSERT — 20261028000003); agora é só 'alterar',
-- senão quem tem só a tela gravaria a primeira resposta pela API.
-- O código legado 'implantacao' continua aceito, como nas policies de antes.
--
-- Quem já tem 'alterar' hoje continua editando — nada a semear.
-- Leve (1 linha em app_menu_acao + 3 policies). Idempotente. ROLLBACK no fim.
-- =====================================================================
SET lock_timeout = '5s';

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('licitacoes.implantacao', 'alterar')
ON CONFLICT DO NOTHING;

DROP POLICY IF EXISTS checklist_respostas_insert ON public.checklist_respostas;
CREATE POLICY checklist_respostas_insert ON public.checklist_respostas FOR INSERT TO authenticated
  WITH CHECK ((
    SELECT public.can_access(auth.uid(), 'licitacoes.implantacao'::text, 'alterar'::app_acao)
        OR public.can_access(auth.uid(), 'implantacao'::text, 'alterar'::app_acao)
  ));

DROP POLICY IF EXISTS checklist_respostas_update ON public.checklist_respostas;
CREATE POLICY checklist_respostas_update ON public.checklist_respostas FOR UPDATE TO authenticated
  USING ((
    SELECT public.can_access(auth.uid(), 'licitacoes.implantacao'::text, 'alterar'::app_acao)
        OR public.can_access(auth.uid(), 'implantacao'::text, 'alterar'::app_acao)
  ))
  WITH CHECK ((
    SELECT public.can_access(auth.uid(), 'licitacoes.implantacao'::text, 'alterar'::app_acao)
        OR public.can_access(auth.uid(), 'implantacao'::text, 'alterar'::app_acao)
  ));

DROP POLICY IF EXISTS implantacao_update ON public.implantacao_contrato;
CREATE POLICY implantacao_update ON public.implantacao_contrato FOR UPDATE TO authenticated
  USING ((
    SELECT public.can_access(auth.uid(), 'licitacoes.implantacao'::text, 'alterar'::app_acao)
        OR public.can_access(auth.uid(), 'implantacao'::text, 'alterar'::app_acao)
  ));

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK (volta o INSERT a aceitar 'incluir'; UPDATEs já eram 'alterar')
--
-- DROP POLICY IF EXISTS checklist_respostas_insert ON public.checklist_respostas;
-- CREATE POLICY checklist_respostas_insert ON public.checklist_respostas FOR INSERT TO authenticated
--   WITH CHECK ((
--     SELECT public.can_access(auth.uid(), 'licitacoes.implantacao'::text, 'incluir'::app_acao)
--         OR public.can_access(auth.uid(), 'licitacoes.implantacao'::text, 'alterar'::app_acao)
--         OR public.can_access(auth.uid(), 'implantacao'::text, 'incluir'::app_acao)
--         OR public.can_access(auth.uid(), 'implantacao'::text, 'alterar'::app_acao)
--   ));
-- NOTIFY pgrst, 'reload schema';
-- =====================================================================
