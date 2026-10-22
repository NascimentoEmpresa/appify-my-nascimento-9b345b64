-- [SEM-CHAMADO] Gerenciamento de Acesso: o menu "Financeiro — Fluxo de Caixa (Gestão)" não tinha ação nenhuma cadastrada em app_menu_acao,
-- então a tela de acesso mostrava só o interruptor principal (que concede o pacote visualizar/incluir/alterar/aprovar/exportar) e não
-- dava para liberar ou tirar "Alterar" separadamente de um usuário. Quem precisa ratear, editar ou excluir lançamento importado da
-- planilha (Controladoria) ficava no tudo-ou-nada.
--
-- Onde "alterar" é exigido neste menu (can_access(..., 'financeiro-fluxo-caixa-gestao', 'alterar')):
--   • botões Editar, Ratear e Excluir/Restaurar da linha importada, em FluxoCaixaGestao.tsx;
--   • as funções fluxo_caixa_importado_excluir / _restaurar / _ratear (migration 20261015000010);
--   • a policy de escrita de financeiro_fluxo_caixa_ajuste (migration 20260930000212).
-- Mesma lacuna que o Cartão de Crédito teve (20260930000009). A migration só mostra o switch "Alterar" ao lado do interruptor do menu;
-- quem recebe a ação continua sendo decidido em /app/administracao?tab=modulos, usuário a usuário. Não muda a permissão de ninguém.

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('financeiro-fluxo-caixa-gestao', 'alterar')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'financeiro-fluxo-caixa-gestao' AND acao = 'alterar';
-- =====================================================================
