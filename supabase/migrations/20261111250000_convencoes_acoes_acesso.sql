-- =========================================================================
-- LICITAÇÃO › CONVENÇÕES COLETIVAS — AÇÕES NA TELA DE ACESSO (11/11/2026)
--
-- O José Carlos não via o botão de excluir nas Convenções Coletivas e não
-- dava para liberar: a tela Acesso por Usuário mostra os switches de ação que
-- estão em app_menu_acao (mig 20260910000002), e o menu licitacoes_convencoes
-- não tinha nenhum — o liga/desliga gravava só as ações básicas, sem
-- "excluir". Os botões da tela usam incluir, alterar e excluir
-- (ConvencoesColetivas.tsx, AcessoGate), e as policies também (mig
-- 20261109004500). app_menu_acao é só o catálogo da tela de acesso: ninguém
-- ganha nem perde permissão com esta migration — depois dela, é marcar o
-- "Excluir" para quem deve ter em Administração › Acesso por Usuário.
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

INSERT INTO public.app_menu_acao (menu_codigo, acao)
SELECT 'licitacoes_convencoes', a::public.app_acao
  FROM unnest(ARRAY['incluir', 'alterar', 'excluir']) a
ON CONFLICT (menu_codigo, acao) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'licitacoes_convencoes' AND acao IN ('incluir', 'alterar', 'excluir');
-- NOTIFY pgrst, 'reload schema';
