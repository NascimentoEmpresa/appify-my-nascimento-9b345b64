-- WhatsApp — provedor de IA configurável no chatbot.
--
-- Até aqui o bot só falava com a Anthropic (Claude). Agora WA_BOT_CONFIG.provedor
-- escolhe quem responde, e o webhook chama a API certa:
--   groq       → api.groq.com            (GROQ_API_KEY)        — grátis, rápido
--   gemini     → generativelanguage...   (GEMINI_API_KEY)      — grátis
--   openrouter → openrouter.ai           (OPENROUTER_API_KEY)  — modelos :free
--   anthropic  → api.anthropic.com       (ANTHROPIC_API_KEY)   — pago
--
-- O modelo continua em WA_BOT_CONFIG.modelo; a tela do Chatbot só oferece os
-- modelos do provedor selecionado.
ALTER TABLE public."WA_BOT_CONFIG"
  ADD COLUMN IF NOT EXISTS provedor text NOT NULL DEFAULT 'groq';

ALTER TABLE public."WA_BOT_CONFIG" DROP CONSTRAINT IF EXISTS wa_bot_config_provedor_check;
ALTER TABLE public."WA_BOT_CONFIG"
  ADD CONSTRAINT wa_bot_config_provedor_check
  CHECK (provedor IN ('groq', 'gemini', 'openrouter', 'anthropic'));

-- Novo padrão do modelo acompanha o provedor padrão (Groq).
ALTER TABLE public."WA_BOT_CONFIG" ALTER COLUMN modelo SET DEFAULT 'llama-3.3-70b-versatile';

-- A linha existente ficou com um modelo Claude e provedor 'groq' (default da
-- coluna nova) — alinha os dois para não ficar inconsistente.
UPDATE public."WA_BOT_CONFIG"
   SET modelo = 'llama-3.3-70b-versatile'
 WHERE provedor = 'groq' AND modelo LIKE 'claude%';

NOTIFY pgrst, 'reload schema';
