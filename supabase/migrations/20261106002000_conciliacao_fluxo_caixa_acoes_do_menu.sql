-- ============================================================================
-- [SEM-CHAMADO] Conciliação Bancária: registra no catálogo as ações que o menu realmente usa (incluir, alterar, excluir)
-- ============================================================================
-- O menu `conciliacao-fluxo-caixa` não tinha NENHUMA ação em app_menu_acao. A tela de Administração só mostra os switches das ações que estão nessa
-- tabela (fora 'visualizar'), então não havia como liberar 'excluir' para ninguém: a lixeira da exclusão de conciliação (20261105008000) não
-- aparecia para o Financeiro. As ações abaixo são as que o menu de fato checa (RLS, RPCs e telas):
--   incluir  = salvar uma conciliação;  alterar = informar saldo do extrato / saldo anterior;  excluir = excluir a conciliação de uma competência.
-- Não muda nenhuma permissão já concedida (quem tem 'incluir'/'alterar' continua tendo): só faz os switches aparecerem em Administração, onde
-- 'excluir' passa a poder ser ligado por usuário. 'excluir' não entra no pacote do toggle da tela: nasce desligado para todos.
--
-- Migration leve (3 linhas): pode rodar inteira. Idempotente.
--
-- ROLLBACK:
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'conciliacao-fluxo-caixa' AND acao IN ('incluir', 'alterar', 'excluir');

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('conciliacao-fluxo-caixa', 'incluir'),
  ('conciliacao-fluxo-caixa', 'alterar'),
  ('conciliacao-fluxo-caixa', 'excluir')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
