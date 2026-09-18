-- =====================================================================
-- app_acao ganha 'enviar_malote'
--
-- Pedido do usuário (17/09/2026), nos flags das Diárias: "incluir/editar",
-- "excluir", "aprovar" e "enviar para malote". As três primeiras já existem
-- no enum desde a migration #1 (20260429172951); a quarta é nova.
--
-- POR QUE UMA AÇÃO PRÓPRIA, e não 'aprovar' de novo:
--   aprovar uma diária é dizer "a conta está certa". Mandar para o Malote é
--   despachar o PAGAMENTO — cria despesa, rateio e parcela do lado da
--   Controladoria. Quem confere a planilha da UFRGS não é necessariamente
--   quem pode disparar o desembolso, e até aqui não havia como separar os
--   dois: 'aprovar' fazia as duas coisas de uma vez.
--
-- MIGRATION SEPARADA DE PROPÓSITO. Postgres aceita ALTER TYPE ... ADD VALUE
-- dentro de transação (12+), mas NÃO deixa usar o valor novo na mesma
-- transação que o adicionou — e a 20260930000155 usa 'enviar_malote' num
-- INSERT em app_menu_acao. Rodar as duas juntas daria
-- "unsafe use of new value of enum type". Aplique esta primeiro.
-- =====================================================================

ALTER TYPE public.app_acao ADD VALUE IF NOT EXISTS 'enviar_malote';

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- Postgres não remove valor de enum. Desfazer exige recriar o tipo:
--   ALTER TYPE public.app_acao RENAME TO app_acao_old;
--   CREATE TYPE public.app_acao AS ENUM ('visualizar','incluir','alterar',
--     'excluir','aprovar','exportar','executar_ia','alterar_dre');
--   -- e reescrever TODA coluna/função que usa o tipo (app_menu_acao.acao,
--   -- perfil_acesso_permissao.acao, screen_permission_user.acao,
--   -- has_screen_access, can_access, list_accessible_menus, diaria_pode...).
-- Na prática: deixe o valor no enum e apague só as linhas que o usam
--   DELETE FROM public.app_menu_acao WHERE acao = 'enviar_malote';
