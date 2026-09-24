-- =========================================================================
-- Agendamento de Veículos: permissão própria para o Dashboard.
--
-- Pedido do Pablo (24/09/2026): "tem que ter nas permissões por usuário ali
-- no agendamento de veículos quem pode acessar o dashboard".
--
-- Até aqui a aba Dashboard (e Toda a Frota) aparecia para quem tinha
-- Suprimentos › Patrimônio (sup_patrimonio). O Dashboard ganha um menu
-- fantasma (rota NULL) no módulo Central de Serviços, logo abaixo do
-- Agendamento de Veículos — aparece em Administração › Acesso por Usuário.
--
-- Para ninguém perder o que já via: quem tem visualizar em sup_patrimonio
-- hoje recebe visualizar no menu novo. Daí em diante é marcar/desmarcar
-- por usuário.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'central_servicos_veiculos_dashboard', 'Agendamento de Veículos · Dashboard', NULL, 41, true
  FROM public.app_modulo m
 WHERE m.codigo = 'central_servicos'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu x WHERE x.codigo = 'central_servicos_veiculos_dashboard');

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT p.id, 'central_servicos_veiculos_dashboard', 'visualizar'::app_acao, true,
       'Semeado na criação (mig 20260930000233): já via o Dashboard por Patrimônio'
  FROM public.profiles p
 WHERE public.has_screen_access(p.id, 'sup_patrimonio', 'visualizar'::app_acao)
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = p.id AND x.menu_codigo = 'central_servicos_veiculos_dashboard'
                      AND x.acao = 'visualizar'::app_acao);

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'central_servicos_veiculos_dashboard';
-- DELETE FROM public.app_menu WHERE codigo = 'central_servicos_veiculos_dashboard';
-- NOTIFY pgrst, 'reload schema';
