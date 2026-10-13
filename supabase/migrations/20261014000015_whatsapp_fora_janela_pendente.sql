-- =========================================================================
-- WHATSAPP: MENSAGEM COM BOTÕES FORA DA JANELA + SAUDAÇÃO UTILITY (14/10/2026)
--
-- PEDIDO (Pablo, prints da Caixa de Entrada): "não consigo enviar as
-- mensagens prontas, e ao enviar algumas os botões não estão aparecendo —
-- essas mensagens eu tenho que conseguir enviar".
--
-- O QUE A META DEVOLVEU (WA_MENSAGEM.payload.erro):
--   · 131047 "Re-engagement message" — mensagem com BOTÕES (interativa) para
--     quem não escreve há mais de 24h. Fora da janela a Meta só aceita
--     TEMPLATE aprovado; botão interativo e texto livre são recusados.
--   · 131049 "healthy ecosystem engagement" — a Saudação (saudacao_contato)
--     é template MARKETING: a Meta corta marketing para quem já recebe muito
--     (24 bloqueios em 30 dias). E ela não tinha botão.
--
-- O QUE MUDA
--   1) Mensagem do atendente fora da janela (texto ou com botões) NÃO falha
--      mais: whatsapp-enviar manda a Saudação (template) e grava a mensagem
--      com status 'pendente'; o whatsapp-webhook envia as pendentes assim que
--      o contato responder (abre a janela). Na Caixa ela aparece como
--      "aguardando o contato responder". Pendente com mais de 7 dias expira
--      ('cancelada') — a conversa já esfriou.
--   2) Biblioteca de templates (WA_TEMPLATE) ganha BOTÕES de resposta rápida
--      e o template ANTERIOR: enquanto o novo não for aprovado na Meta, o
--      envio cai no anterior (não fica sem saudação).
--   3) Saudação → UTILITY com o botão "Pode falar!" (novo nome na Meta:
--      saudacao_contato_util; a categoria de um template não muda depois de
--      criado). Criar na Meta: Chatbot › Mensagens prontas › Criar na Meta.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

ALTER TABLE public."WA_MENSAGEM" DROP CONSTRAINT IF EXISTS "WA_MENSAGEM_status_check";
ALTER TABLE public."WA_MENSAGEM" ADD CONSTRAINT "WA_MENSAGEM_status_check"
  CHECK (status = ANY (ARRAY['recebida', 'enviada', 'entregue', 'lida', 'erro', 'pendente', 'cancelada']));

CREATE INDEX IF NOT EXISTS wa_mensagem_pendente_idx ON public."WA_MENSAGEM" (conversa_id, criada_em) WHERE status = 'pendente';

ALTER TABLE public."WA_TEMPLATE" ADD COLUMN IF NOT EXISTS botoes text[] NOT NULL DEFAULT '{}';
ALTER TABLE public."WA_TEMPLATE" ADD COLUMN IF NOT EXISTS template_nome_anterior text;

UPDATE public."WA_TEMPLATE"
   SET categoria = 'UTILITY',
       template_nome_anterior = coalesce(template_nome_anterior, 'saudacao_contato'),
       template_nome = 'saudacao_contato_util',
       botoes = ARRAY['Pode falar!']
 WHERE codigo = 'saudacao' AND template_nome = 'saudacao_contato';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- UPDATE public."WA_TEMPLATE" SET categoria = 'MARKETING', template_nome = 'saudacao_contato', template_nome_anterior = NULL, botoes = '{}' WHERE codigo = 'saudacao';
-- UPDATE public."WA_MENSAGEM" SET status = 'erro' WHERE status IN ('pendente', 'cancelada');
-- ALTER TABLE public."WA_MENSAGEM" DROP CONSTRAINT IF EXISTS "WA_MENSAGEM_status_check";
-- ALTER TABLE public."WA_MENSAGEM" ADD CONSTRAINT "WA_MENSAGEM_status_check" CHECK (status = ANY (ARRAY['recebida','enviada','entregue','lida','erro']));
-- ALTER TABLE public."WA_TEMPLATE" DROP COLUMN IF EXISTS botoes, DROP COLUMN IF EXISTS template_nome_anterior;
