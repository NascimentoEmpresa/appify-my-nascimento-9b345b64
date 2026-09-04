-- Fix apontado pelo validador de PR na SIS-2026-0256 — mesmo achado real já
-- corrigido pra Cartão de Crédito em 20260930000009_cartao_credito_app_menu_
-- acao.sql (menu irmão, mesmo módulo Financeiro > Gestão Financeira):
--
-- 1. [J1.A / J2] `debito_automatico_delete` exige 'excluir', mas o toggle
--    padrão de "Acesso por Usuário" NUNCA concede 'excluir' (ACOES_DO_
--    TOGGLE_PADRAO em ModulosMenusTab.tsx = visualizar/incluir/alterar/
--    aprovar/exportar, de propósito — "liberar a tela não é autorizar
--    apagar registro"). Sem semear em perfil_acesso_permissao, o único
--    jeito de excluir seria o Administrador Geral (concede_tudo) usado como
--    gambiarra — e o app_menu novo nasce sem NENHUMA regra semeada, o que
--    deixa a tela inteira aberta pra qualquer autenticado até alguém
--    configurar (J2). Semeando aqui pros perfis concede_tudo, a tela deixa
--    de nascer aberta E 'excluir' passa a ter concessão explícita (mesmo
--    padrão de 20260930000005_malote_cartao_credito.sql).
--
-- 2. A tela "Acesso por Usuário" só mostra o switch extra de uma ação (pra
--    um admin conceder individualmente, fora do toggle) se existir linha
--    em app_menu_acao pro menu_codigo+acao (20260910000002). Sem isso, nem
--    o switch "Excluir" aparece pra alguém conceder manualmente.

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('financeiro-debito-automatico', 'incluir'),
  ('financeiro-debito-automatico', 'alterar'),
  ('financeiro-debito-automatico', 'excluir')
ON CONFLICT DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'financeiro-debito-automatico', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
    ('visualizar'::public.app_acao),
    ('incluir'::public.app_acao),
    ('alterar'::public.app_acao),
    ('excluir'::public.app_acao)
 ) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'financeiro-debito-automatico';
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'financeiro-debito-automatico';
-- =====================================================================
