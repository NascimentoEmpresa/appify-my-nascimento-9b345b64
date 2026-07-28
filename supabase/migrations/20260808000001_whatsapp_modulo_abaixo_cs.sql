-- =====================================================================
-- WHATSAPP — módulo próprio, posicionado logo ABAIXO de "Central de Serviços".
-- Corrige instalações onde os menus whatsapp/whatsapp_chatbot ficaram DENTRO do
-- módulo central_servicos. Idempotente: cria o módulo se faltar, reposiciona e
-- move os menus para ele (removendo cópias em outros módulos).
-- =====================================================================

-- 1) Garante o módulo "WhatsApp" (posição = logo abaixo de Central de Serviços)
INSERT INTO public.app_modulo (codigo, nome, descricao, icone, ordem)
SELECT 'whatsapp', 'WhatsApp', 'Atendimento e chatbot',
       COALESCE((SELECT ordem FROM public.app_modulo WHERE codigo = 'central_servicos'), 200) + 1,
       'MessageCircle'
WHERE NOT EXISTS (SELECT 1 FROM public.app_modulo WHERE codigo = 'whatsapp');

-- 2) Reposiciona logo abaixo de Central de Serviços (mesmo se o módulo já existia)
UPDATE public.app_modulo
   SET ordem = COALESCE((SELECT ordem FROM public.app_modulo WHERE codigo = 'central_servicos'), 200) + 1
 WHERE codigo = 'whatsapp';

-- 3) Remove os menus whatsapp de qualquer módulo que NÃO seja o "whatsapp"
--    (tira a versão antiga que ficava dentro de central_servicos e duplicados).
--    As permissões (screen_permission_*) são por menu_codigo (string), então
--    mover o menu entre módulos não perde os acessos já concedidos.
DELETE FROM public.app_menu
 WHERE codigo IN ('whatsapp', 'whatsapp_chatbot')
   AND modulo_id <> (SELECT id FROM public.app_modulo WHERE codigo = 'whatsapp');

-- 4) Garante os menus sob o módulo "whatsapp"
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem
  FROM (VALUES
    ('whatsapp',         'WhatsApp — Caixa de Entrada', '/app/whatsapp',         1),
    ('whatsapp_chatbot', 'WhatsApp — Chatbot',          '/app/whatsapp/chatbot', 2)
  ) AS x(codigo, nome, rota, ordem)
  JOIN public.app_modulo m ON m.codigo = 'whatsapp'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

NOTIFY pgrst, 'reload schema';
