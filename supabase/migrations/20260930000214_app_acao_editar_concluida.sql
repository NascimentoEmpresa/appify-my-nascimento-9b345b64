-- =====================================================================
-- app_acao ganha 'editar_concluida'
--
-- Pedido do Eduardo (22/09/2026), em /app/sistemas/hora-extra/liberacao:
-- depois que a HE é CONCLUÍDA, ninguém mais consegue mexer no horário de
-- ponto — nem quem validou. Quando o cartão de ponto chega e mostra que a
-- batida real foi outra, hoje o único caminho é corrigir por fora do
-- sistema, e o total de HE do mês fica diferente do que foi pago.
--
-- POR QUE UMA AÇÃO PRÓPRIA, e não reaproveitar 'alterar':
--   'alterar' está em ACOES_DO_TOGGLE_PADRAO (src/lib/acoesDoToggleAcesso.ts):
--   ligar a tela de Hora Extra para alguém já concede 'alterar' junto. Se a
--   reescrita de HE fechada morasse nessa ação, todo mundo que enxerga a tela
--   passaria a poder mudar hora já validada — que é hora já paga. Mesma razão
--   pela qual 'enviar_malote' (mig 154) e 'responder' (mig 172) viraram ações
--   separadas: a ação É a decisão, então ela precisa de switch próprio.
--
-- ⚠ ARQUIVO SEPARADO DE PROPÓSITO. O Postgres aceita ALTER TYPE ... ADD VALUE
-- dentro de transação (12+), mas NÃO deixa usar o valor novo na mesma
-- transação que o adicionou — e a 20260930000215 usa 'editar_concluida' num
-- INSERT em app_menu_acao. Rodar as duas juntas dá "unsafe use of new value
-- of enum type". Aplique esta PRIMEIRO, sozinha, e só depois a 215.
--
-- Idempotente. Aplicar no banco do app.
-- =====================================================================

ALTER TYPE public.app_acao ADD VALUE IF NOT EXISTS 'editar_concluida';

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- Postgres não remove valor de enum. Desfazer exigiria recriar o tipo e
-- reescrever toda coluna/função que o usa (app_menu_acao.acao,
-- perfil_acesso_permissao.acao, screen_permission_user.acao,
-- has_screen_access, can_access, list_accessible_menus...).
-- Na prática: deixe o valor no enum e apague só as linhas que o usam —
-- o DDL inverso está no rodapé da 20260930000215.
