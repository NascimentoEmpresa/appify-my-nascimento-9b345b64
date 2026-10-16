-- =========================================================================
-- Recrutamento › SST + COMPRAS: template do WhatsApp "agendamento do ASO"
-- (16/10/2026)
--
-- PEDIDO (Pablo): "adiciona um botão de enviar agendamento com o ícone do
-- whatsapp, pra enviar pro número do candidato no whatsapp, já cria um padrão
-- pra essa mensagem pra meta aprovar."
--
-- Por que TEMPLATE: candidato do portal quase nunca escreveu no nosso número,
-- e texto livre só sai dentro de 24h da última mensagem DELE (131047). O
-- template aprovado pela Meta pode abrir a conversa a qualquer momento.
--
-- Reaproveita a mesma tabela das mensagens por etapa (RECRUTAMENTO_MENSAGENS)
-- com a "etapa" AGENDAMENTO ASO. Assim:
--   · "Mensagens automáticas › Enviar textos para aprovação da Meta" já
--     submete este template junto com os outros (whatsapp-templates lê a
--     tabela inteira);
--   · o envio usa a Edge recrutamento-mensagem, que grava na Caixa de Entrada
--     e no RECRUTAMENTO_MENSAGENS_LOG como as outras.
-- Diferente das etapas, este é MANUAL (o botão no card): `ativo` fica false e
-- a Edge não o exige para esta linha — não há "enviar automaticamente".
--
-- Variáveis novas (resolvidas na Edge a partir de WA_CURRICULOS.sst_*):
--   data_exame  → "19/10/2026 (segunda-feira)"
--   hora_exame  → "11:00"
--   local_exame → o que o SST escreveu
--   mapa_exame  → sst_maps_url, senão busca no Google Maps pelo local
--
-- Só insere se não existir (ON CONFLICT DO NOTHING): se o RH já ajustou o
-- texto, reaplicar não desfaz. Idempotente. Aplicar no banco do app.
-- =========================================================================

INSERT INTO public."RECRUTAMENTO_MENSAGENS" (etapa, ativo, template_nome, template_idioma, parametros, texto_previa, updated_por)
VALUES (
  'AGENDAMENTO ASO', false, 'recrutamento_agendamento_aso', 'pt_BR',
  '["primeiro_nome", "cargo", "data_exame", "hora_exame", "local_exame", "mapa_exame"]'::jsonb,
  E'Olá {{1}}! Seu exame admissional (ASO) para a vaga de {{2}} está agendado.\n\n'
  || E'📅 Data: {{3}}\n⏰ Horário: {{4}}\n📍 Local: {{5}}\n🗺 Mapa: {{6}}\n\n'
  || 'Leve um documento oficial com foto. Qualquer dúvida, é só responder esta mensagem.',
  'mig 20261016000031'
)
ON CONFLICT (etapa) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DELETE FROM public."RECRUTAMENTO_MENSAGENS" WHERE etapa = 'AGENDAMENTO ASO';
-- -- (o template criado na Meta, se já foi enviado, apaga-se no Business Manager)
-- NOTIFY pgrst, 'reload schema';
