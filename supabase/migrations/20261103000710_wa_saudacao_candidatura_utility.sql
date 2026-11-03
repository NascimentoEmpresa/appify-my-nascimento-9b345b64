-- =========================================================================
-- WHATSAPP: SAUDAÇÃO FORA DA JANELA LIGADA À CANDIDATURA (UTILITY)
-- (03/11/2026)
--
-- PEDIDO (Pablo, print da conversa ADRIEL JOSE S.L RIO GRANDE, recrutadora
-- PAMELA): a saudação "Olá! Somos do Grupo Nascimento, como você está?" com
-- o botão "Pode falar!" voltou com "A Meta limitou a entrega para este
-- contato (mensagem classificada como marketing)" — 10:04, 14:29, 08:12 —
-- e o ASO agendado, o "Bom dia" e o prazo de retorno da vaga ficaram presos
-- como pendentes. O candidato nunca recebeu nada.
--
-- POR QUÊ: o botão aparecia, então saiu pelo saudacao_contato_util, o
-- "UTILITY" de 14/10 (20261014000015). A Meta o RECLASSIFICOU como
-- MARKETING: texto que não cita assunto nenhum ("como você está?",
-- "confirmar que podemos entrar em contato") é abordagem para ela, e
-- marketing tem limite por pessoa (131049/130472). Foi o mesmo caso da
-- abertura do Nova conversa em 27/10 (20261027000110).
--
-- O QUE MUDA
--   · Nova mensagem na biblioteca, saudacao_candidatura (template na Meta:
--     aviso_candidatura_mensagem, UTILITY, botão "Ver mensagem"), com
--     {{1}} = primeiro nome e {{2}} = vaga. Fala de algo que a PESSOA já
--     começou (a candidatura) e avisa que há um recado — é o formato que a
--     Meta aceita como utilidade.
--   · whatsapp-enviar (fora da janela) passa a mandar o primeiro template que
--     a Meta diz ser UTILITY e APROVADO: esta, a abertura_candidatura, a
--     saudação de sempre. Só marketing? Sai a de sempre, mas nunca para quem
--     já levou 131049 nas últimas 24h (_shared/whatsapp-saudacao.ts).
--   · Template aprovado é imutável e a categoria não muda depois de criado:
--     por isso NOME NOVO. Criar na Meta: WhatsApp › Chatbot › Mensagens
--     prontas › "Saudação — candidatura" › Criar na Meta. Enquanto não for
--     aprovado, o envio simplesmente não o escolhe.
--
-- Idempotente.
-- =========================================================================

INSERT INTO public."WA_TEMPLATE" (codigo, titulo, texto, variaveis, template_nome, idioma, categoria, botoes, ordem)
VALUES (
  'saudacao_candidatura',
  'Saudação — candidatura (aviso de recado)',
  E'Olá, {{1}}! O Recrutamento do Grupo Nascimento tem um recado sobre a sua candidatura para a vaga de {{2}}.\nToque em "Ver mensagem" para receber o recado aqui no WhatsApp.',
  ARRAY['Primeiro nome', 'Vaga'],
  'aviso_candidatura_mensagem', 'pt_BR', 'UTILITY',
  ARRAY['Ver mensagem'],
  11
)
ON CONFLICT (codigo) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DELETE FROM public."WA_TEMPLATE" WHERE codigo = 'saudacao_candidatura';
-- NOTIFY pgrst, 'reload schema';
