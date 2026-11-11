-- SIS-2026-0850: Aplicações Financeiras — switch "Excluir" na tela de acesso por usuário.
--
-- O menu "Financeiro — Aplicações Financeiras" não tinha nenhuma ação cadastrada em app_menu_acao,
-- então /app/administracao?tab=modulos mostrava só o interruptor principal (pacote visualizar/incluir/
-- alterar/aprovar/exportar) e não havia como liberar "excluir" para um usuário. O usuário via Editar,
-- mas nunca Excluir, e não conseguia apagar uma aplicação lançada com valor errado para relançar
-- (o Editar não muda o valor aplicado, de propósito).
--
-- Onde "excluir" já é exigido neste menu (can_access(..., 'financeiro-aplicacao-financeira', 'excluir')):
--   • item Excluir do menu ⋯ da aplicação e do resgate, em AplicacoesFinanceiras.tsx (AcessoGate acao="excluir");
--   • policy aplicacao_financeira_delete e a RPC de exclusão (migration 20260930000227);
--   • exclusão de resgate (migration 20261008000002).
-- Mesma lacuna que o Fluxo de Caixa (Gestão) teve (20261021000100). A migration só faz aparecer o switch
-- "Excluir" ao lado do interruptor do menu; quem recebe a ação continua sendo decidido usuário a usuário.
-- Não muda a permissão de ninguém.

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('financeiro-aplicacao-financeira', 'excluir')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'financeiro-aplicacao-financeira' AND acao = 'excluir';
-- =====================================================================
