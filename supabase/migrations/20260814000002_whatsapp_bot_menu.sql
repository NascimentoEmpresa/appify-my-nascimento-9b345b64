-- WhatsApp — menu automatico do bot.
-- WA_BOT_CONFIG.menu (jsonb) guarda o menu de opcoes que o bot apresenta na
-- primeira mensagem, no formato:
--   { "ativo": true, "titulo": "Como posso te ajudar?",
--     "opcoes": [ { "id": "...", "titulo": "...", "acao": "texto|ia|humano", "valor": "..." } ] }
ALTER TABLE public."WA_BOT_CONFIG" ADD COLUMN IF NOT EXISTS menu jsonb;

NOTIFY pgrst, 'reload schema';
