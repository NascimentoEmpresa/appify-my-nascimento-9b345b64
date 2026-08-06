-- =====================================================================
-- ACESSO — "Chamados de Sistemas" deixa de existir em dois lugares
--
-- A mesma tela estava listada duas vezes, com dois menus e duas rotas:
--   chamados_sistemas         -> /app/sistemas/chamados        (modulo Sistemas)
--   central_servicos_chamados -> /app/central-servicos/chamados (Central de Servicos)
--
-- Duas permissoes para a mesma tela e armadilha: liberar uma e esquecer a
-- outra da a impressao de acesso concedido que nao funciona pelo caminho que
-- a pessoa usa. Fica so a da Central de Servicos, que e por onde o usuario
-- comum entra — junto de chamados_sistemas_abrir, movido para la antes.
--
-- ativo = false em vez de DELETE: apagar a linha levaria junto as liberacoes
-- gravadas por menu_codigo, e o historico de quem teve acesso se perde. Menu
-- inativo some da tela de Acesso por Usuario e do list_accessible_menus.
--
-- As capacidades de quem ATENDE o chamado (painel, dashboard, dev, coordenar,
-- aprovar, excluir) continuam em Sistemas: sao do time de TI, nao do
-- solicitante, e as telas delas seguem em /app/sistemas/chamados/...
--
-- ATENCAO ao mexer nisto: rota sem entrada em app_menu fica SEMPRE ABERTA no
-- RouteGuard (`!menuCode` libera). Por isso as rotas de solicitante que
-- ficariam sem gate viraram redirecionamento para a Central de Servicos, no
-- mesmo commit. As telas do time continuam protegidas pelas capacidades e
-- pela RLS de CHAMADO_SISTEMA.
--
-- Idempotente.
-- ROLLBACK: UPDATE public.app_menu SET ativo = true WHERE codigo = 'chamados_sistemas';
-- =====================================================================

UPDATE public.app_menu
   SET ativo = false, updated_at = now()
 WHERE codigo = 'chamados_sistemas';

-- Trava: a Central precisa continuar tendo a tela, senao ninguem abre chamado.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.app_menu m
      JOIN public.app_modulo mo ON mo.id = m.modulo_id
     WHERE m.codigo = 'central_servicos_chamados'
       AND mo.codigo = 'central_servicos' AND m.ativo)
  THEN
    RAISE EXCEPTION 'central_servicos_chamados sumiu — nao da para desativar o de Sistemas';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
