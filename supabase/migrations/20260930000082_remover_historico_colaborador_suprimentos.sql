-- Remove a tela duplicada de histórico de materiais de Suprimentos.
-- DELETE é seguro: não há referências ao código fora da criação original e
-- perfil_acesso_permissao é removida antes da linha correspondente em app_menu.
DELETE FROM public.perfil_acesso_permissao
 WHERE menu_codigo = 'sup_colaborador_historico';

DELETE FROM public.app_menu
 WHERE codigo = 'sup_colaborador_historico'
   AND rota = '/app/suprimentos/colaborador'
   AND modulo_id = (
     SELECT id FROM public.app_modulo WHERE codigo = 'suprimentos'
   );

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
--   SELECT m.id, 'sup_colaborador_historico', 'Histórico do Colaborador',
--          '/app/suprimentos/colaborador', 65, true
--     FROM public.app_modulo m
--    WHERE m.codigo = 'suprimentos'
--   ON CONFLICT (modulo_id, codigo) DO UPDATE
--      SET nome = EXCLUDED.nome, rota = EXCLUDED.rota,
--          ordem = EXCLUDED.ordem, ativo = true;
--
--   INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
--   SELECT pa.id, 'sup_colaborador_historico', a.acao, true
--     FROM public.perfil_acesso pa
--    CROSS JOIN (VALUES
--      ('visualizar'::public.app_acao), ('incluir'::public.app_acao),
--      ('alterar'::public.app_acao), ('excluir'::public.app_acao)
--    ) AS a(acao)
--    WHERE pa.concede_tudo AND pa.ativo
--   ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;
--
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
