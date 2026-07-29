-- WhatsApp — mensagens interativas (botoes/lista).
-- Guarda em WA_MENSAGEM.payload:
--   * saida: os botoes enviados -> { "tipo": "button", "botoes": [{ "id": "...", "titulo": "..." }] }
--   * entrada: o clique do contato -> { "reply_id": "..." }
-- Serve para renderizar os botoes na Caixa de Entrada e, depois, rotear fluxos.
ALTER TABLE public."WA_MENSAGEM" ADD COLUMN IF NOT EXISTS payload jsonb;

-- PostgREST precisa recarregar o schema para enxergar a coluna nova.
NOTIFY pgrst, 'reload schema';
