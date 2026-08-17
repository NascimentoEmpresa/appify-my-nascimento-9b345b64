-- O perfil_acesso "Encarregados" (9951bb4f-b052-45ac-81d5-694f4ce0a295) só
-- concedia central_servicos_veiculos e chamados_sistemas_abrir — não cobria
-- as telas de verdade do módulo Encarregados na sidebar (Solicitar Vaga,
-- Solicitar Férias, Advertência, Chamados, Solicitar Materiais, Meus
-- Pedidos). Completa com os menu_codigo achados em app_menu pra essas rotas.
--
-- ROLLBACK:
-- DELETE FROM public.perfil_acesso_permissao
--  WHERE perfil_id = '9951bb4f-b052-45ac-81d5-694f4ce0a295'
--    AND menu_codigo IN ('minhas_solicitações','encarregados_minhas_solicitacoes',
--                         'encarregados_chamados','encarregados_solicitar_materiais',
--                         'encarregados_meus_pedidos');

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT '9951bb4f-b052-45ac-81d5-694f4ce0a295', menu_codigo, acao::app_acao, true
FROM (VALUES
  ('minhas_solicitações', 'visualizar'), ('minhas_solicitações', 'incluir'),
  ('encarregados_minhas_solicitacoes', 'visualizar'), ('encarregados_minhas_solicitacoes', 'incluir'),
  ('encarregados_chamados', 'visualizar'), ('encarregados_chamados', 'incluir'),
  ('encarregados_solicitar_materiais', 'visualizar'), ('encarregados_solicitar_materiais', 'incluir'),
  ('encarregados_meus_pedidos', 'visualizar'), ('encarregados_meus_pedidos', 'incluir')
) AS v(menu_codigo, acao)
ON CONFLICT DO NOTHING;
