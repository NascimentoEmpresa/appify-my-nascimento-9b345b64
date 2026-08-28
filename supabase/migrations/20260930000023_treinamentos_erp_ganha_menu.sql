-- =====================================================================
-- TREINAMENTOS ERP finalmente ganha entrada em app_menu — sob Encarregados.
--
-- O QUE APARECEU AO MOVER O MÓDULO (20260930000022)
--
--   O módulo `treinamentos` estava VAZIO: existia em app_modulo, aparecia
--   na tela de Módulos & Menus, e não tinha uma única linha em app_menu.
--   A tela /app/treinamentos/erp nunca foi cadastrada — foi criada no
--   código e o passo do catálogo ficou para trás.
--
--   Consequência silenciosa: com o deny-by-default (RouteGuard e canSee),
--   rota sem entrada em app_menu é NEGADA. O item não aparecia na sidebar
--   de ninguém, e quem digitasse a URL tomava "Acesso negado". O módulo
--   parecia existir e não servia a ninguém.
--
-- O QUE ESTA MIGRATION FAZ
--
--   Cadastra a tela como um menu de Encarregados, que é onde ela passou a
--   morar. Nada de regra nova: é a linha em app_menu que toda tela tem, e
--   nasce SEM NENHUMA PERMISSÃO — ninguém enxerga até alguém marcar o
--   toggle em Acesso por Usuário. Enquanto não houver conteúdo de
--   treinamento, fica exatamente onde está: cadastrada e fechada.
--
--   A rota registrada é /app/treinamentos (sem o /erp) DE PROPÓSITO:
--   matchMenuCode casa por prefixo, então uma linha cobre tanto
--   /app/treinamentos (que só redireciona) quanto /app/treinamentos/erp.
--   Cadastrar só a segunda deixaria a primeira negada, e o redirect
--   morreria com "Acesso negado" antes de redirecionar.
-- =====================================================================

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'encarregados_treinamentos', 'Treinamentos ERP', '/app/treinamentos', 50, true
  FROM public.app_modulo m
 WHERE m.codigo = 'encarregados'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- Conferência: cadastrado sob encarregados e com ZERO permissão.
SELECT mo.codigo AS modulo, m.codigo, m.rota,
       (SELECT count(*) FROM public.perfil_acesso_permissao p WHERE p.menu_codigo = m.codigo)
     + (SELECT count(*) FROM public.screen_permission_user s WHERE s.menu_codigo = m.codigo) AS permissoes
  FROM public.app_menu m
  JOIN public.app_modulo mo ON mo.id = m.modulo_id
 WHERE m.codigo = 'encarregados_treinamentos';

-- =====================================================================
-- ROLLBACK
--   DELETE FROM public.app_menu WHERE codigo = 'encarregados_treinamentos';
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
