-- =========================================================================
-- RELATÓRIOS › COLABORADORES SAI DO SISTEMA (11/11/2026)
--
-- Pablo: "app/relatorios/colaboradores — pode tirar esse relatório/tela do
-- sistema". A tela saiu do front (src/pages/relatorios/sistemas.ts; a rota
-- antiga redireciona para o Relatório Geral). Aqui o menu fica inativo, para
-- sumir de Administração › Acesso por Usuário e do RouteGuard. As permissões
-- já dadas e a RPC dir_rel_colaboradores ficam (nada quebra se o front antigo
-- ainda estiver aberto em alguma aba). Idempotente. ROLLBACK no fim.
-- =========================================================================

UPDATE public.app_menu SET ativo = false WHERE codigo = 'diretoria_rel_colaboradores' AND ativo;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- UPDATE public.app_menu SET ativo = true WHERE codigo = 'diretoria_rel_colaboradores';
-- NOTIFY pgrst, 'reload schema';
