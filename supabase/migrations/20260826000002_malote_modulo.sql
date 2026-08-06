-- SIS-2026-0081: módulo dedicado "Malote" na sidebar, separado de
-- Financeiro/Controladoria — um dos módulos mais importantes da empresa.
--
-- Por enquanto isso cadastra só a estrutura de navegação/permissões
-- (app_modulo + app_menu), seguindo a mesma convenção do módulo WhatsApp
-- (20260807000001_whatsapp_chatbot.sql). As 5 telas (Criar Despesa, Meus
-- Itens, Dashboard, Aprovações do Malote, Configurações) nascem como
-- placeholder "Em construção" no frontend — conteúdo real (tabelas, RLS,
-- RPCs) fica para os próximos chamados desse módulo.

INSERT INTO public.app_modulo (codigo, nome, descricao, icone, ordem)
SELECT 'malote', 'Malote', 'Despesas e aprovações do Malote',
       'Package',
       COALESCE((SELECT max(ordem) FROM public.app_modulo), 200) + 5
WHERE NOT EXISTS (SELECT 1 FROM public.app_modulo WHERE codigo = 'malote');

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem
  FROM (VALUES
    ('malote_aprovacoes',    'Malote — Aprovações',    '/app/malote/aprovacoes',    1),
    ('malote_configuracoes', 'Malote — Configurações', '/app/malote/configuracoes', 2),
    ('malote_criar_despesa', 'Malote — Criar Despesa', '/app/malote/criar-despesa', 3),
    ('malote_dashboard',     'Malote — Dashboard',     '/app/malote/dashboard',     4),
    ('malote_meus_itens',    'Malote — Meus Itens',    '/app/malote/meus-itens',    5)
  ) AS x(codigo, nome, rota, ordem)
  JOIN public.app_modulo m ON m.codigo = 'malote'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

NOTIFY pgrst, 'reload schema';
