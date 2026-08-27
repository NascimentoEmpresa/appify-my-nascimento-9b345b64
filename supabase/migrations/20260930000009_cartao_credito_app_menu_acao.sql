-- Fix apontado pelo validador de PR na SIS-2026-0224 (achado real, não
-- falso-positivo): a policy malote_cartao_credito_delete exige
-- can_access(..., 'financeiro-cartao-credito', 'excluir'), mas o toggle
-- padrão da tela de Gerenciamento de Acesso NUNCA concede 'excluir'
-- (ACOES_DO_TOGGLE_PADRAO em ModulosMenusTab.tsx = visualizar/incluir/
-- alterar/aprovar/exportar, de propósito — "liberar a tela não é
-- autorizar apagar registro", mesmo texto em 20260930000005_acesso_
-- residuo_visualizar.sql). Isso é esperado e igual em todo o sistema.
--
-- O problema de verdade: a tela "Acesso por Usuário" só mostra o switch
-- extra de uma ação (pra um admin conceder individualmente, fora do
-- toggle) se existir uma linha em app_menu_acao pra aquele
-- menu_codigo+acao (20260910000002_app_menu_acao_relevante.sql — "fonte
-- da verdade para quais switches a tela deve mostrar"). Não cadastrei
-- 'financeiro-cartao-credito' lá, então o switch "Excluir" nem aparecia
-- pra ninguém conceder — o único jeito de excluir cartão era o perfil
-- concede_tudo. Mesma lacuna pra incluir/alterar, que também são ações
-- reais checadas pela RLS (malote_cartao_credito_insert/update).

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('financeiro-cartao-credito', 'incluir'),
  ('financeiro-cartao-credito', 'alterar'),
  ('financeiro-cartao-credito', 'excluir')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'financeiro-cartao-credito';
-- =====================================================================
