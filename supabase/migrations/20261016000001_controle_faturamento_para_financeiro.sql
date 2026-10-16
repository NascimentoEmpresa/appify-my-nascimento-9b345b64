-- SIS-2026-0652: o Controle de Faturamento passa a ser do módulo Financeiro (Ferramentas).
-- Muda o módulo e a rota do menu `controle-faturamento` no catálogo (app_menu): a rota nova é
-- /app/financeiro/controle-faturamento (a antiga continua existindo no front e redireciona).
--
-- IMPORTANTE: o RouteGuard casa a URL com app_menu.rota e NEGA rota que não está no catálogo. Por isso esta
-- migration e o deploy do front precisam sair juntos: rode esta migration logo antes de mergear a PR
-- (até o deploy, a rota antiga deixa de casar e só admin/concede_tudo entra; depois do deploy tudo normaliza).
-- As permissões não mudam: elas são por menu_codigo ('controle-faturamento'), não por módulo.
--
-- O item de checklist de treinamento da tela (SIS_CHECKLIST) acompanha o módulo, senão some do checklist do
-- módulo Financeiro e fica pendurado na Controladoria.
--
-- Migration leve (UPDATE de 1 menu e 1 linha de checklist): pode rodar inteira no SQL Editor. Idempotente.
--
-- ROLLBACK:
--   UPDATE public.app_menu SET modulo_id = (SELECT id FROM public.app_modulo WHERE codigo = 'controladoria'),
--          rota = '/app/controladoria/controle-faturamento' WHERE codigo = 'controle-faturamento';
--   UPDATE public."SIS_CHECKLIST" SET modulo_id = (SELECT id FROM public.app_modulo WHERE codigo = 'controladoria')
--    WHERE menu_id IN (SELECT id FROM public.app_menu WHERE codigo = 'controle-faturamento');
--   NOTIFY pgrst, 'reload schema';

UPDATE public.app_menu
   SET modulo_id = (SELECT id FROM public.app_modulo WHERE codigo = 'financeiro'),
       rota = '/app/financeiro/controle-faturamento'
 WHERE codigo = 'controle-faturamento'
   AND rota IS DISTINCT FROM '/app/financeiro/controle-faturamento';

UPDATE public."SIS_CHECKLIST"
   SET modulo_id = (SELECT id FROM public.app_modulo WHERE codigo = 'financeiro')
 WHERE menu_id IN (SELECT id FROM public.app_menu WHERE codigo = 'controle-faturamento')
   AND modulo_id IS DISTINCT FROM (SELECT id FROM public.app_modulo WHERE codigo = 'financeiro');

NOTIFY pgrst, 'reload schema';
