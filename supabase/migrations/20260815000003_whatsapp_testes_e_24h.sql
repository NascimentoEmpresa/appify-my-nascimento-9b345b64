-- WhatsApp — atendimento 24h e submódulo de Testes.
--
-- 1) atende_24h: quando ligado, o bot responde sempre, ignorando dias da semana
--    e faixa de horário. Antes só dava para chegar perto disso marcando os 7
--    dias e 00:00–23:59, o que ainda deixava uma janela morta e era confuso.
--
-- 2) Menu 'whatsapp_testes': simulador que roda a mesma lógica do atendimento
--    real sem enviar nada pelo WhatsApp e sem gravar na Caixa de Entrada.
--    Fechado por padrão, como o resto do módulo.

-- 1) Atendimento 24 horas -------------------------------------------------
ALTER TABLE public."WA_BOT_CONFIG"
  ADD COLUMN IF NOT EXISTS atende_24h boolean NOT NULL DEFAULT false;

-- 2) Menu do submódulo de Testes ------------------------------------------
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'whatsapp_testes', 'WhatsApp — Testes', '/app/whatsapp/testes', 3
  FROM public.app_modulo m
 WHERE m.codigo = 'whatsapp'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- 3) RLS: quem tem 'whatsapp_testes' precisa ler a config e a base de
--    conhecimento para o simulador funcionar (somente leitura).
DROP POLICY IF EXISTS wa_bot_config_select ON public."WA_BOT_CONFIG";
CREATE POLICY wa_bot_config_select ON public."WA_BOT_CONFIG" FOR SELECT TO authenticated
  USING (
    public.tem_acesso_menu('whatsapp')
    OR public.tem_acesso_menu('whatsapp_chatbot')
    OR public.tem_acesso_menu('whatsapp_testes')
  );

DROP POLICY IF EXISTS wa_bot_conh_select ON public."WA_BOT_CONHECIMENTO";
CREATE POLICY wa_bot_conh_select ON public."WA_BOT_CONHECIMENTO" FOR SELECT TO authenticated
  USING (
    public.tem_acesso_menu('whatsapp')
    OR public.tem_acesso_menu('whatsapp_chatbot')
    OR public.tem_acesso_menu('whatsapp_testes')
  );

NOTIFY pgrst, 'reload schema';
