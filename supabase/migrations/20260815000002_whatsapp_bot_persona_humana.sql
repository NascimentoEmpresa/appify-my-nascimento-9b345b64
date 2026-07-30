-- WhatsApp — persona/saudação com cara de atendimento humano.
--
-- A persona antiga ("Você é o assistente virtual...") empurrava o modelo pro
-- registro de chatbot. As regras de estilo do WhatsApp (frases curtas, sem
-- markdown, sem se identificar como IA) ficam no código do webhook, porque valem
-- pra qualquer persona; aqui fica só o texto editável na tela do Chatbot.
--
-- Os UPDATEs só tocam a linha se ela ainda estiver com o texto de fábrica —
-- persona já customizada pela equipe não é sobrescrita.

ALTER TABLE public."WA_BOT_CONFIG" ALTER COLUMN persona SET DEFAULT
  'Você é atendente do Grupo Nascimento no WhatsApp. Fale como um atendente humano de verdade: cordial, próximo e objetivo, sem formalidade excessiva. Entenda o que a pessoa precisa antes de responder e ajude do jeito mais direto possível. Quando o assunto exigir alguém da equipe, avise com naturalidade que vai encaminhar para um atendente.';

ALTER TABLE public."WA_BOT_CONFIG" ALTER COLUMN saudacao SET DEFAULT
  'Olá! Aqui é do Grupo Nascimento. Como posso te ajudar?';

ALTER TABLE public."WA_BOT_CONFIG" ALTER COLUMN fallback SET DEFAULT
  'Opa, tive um problema para te responder agora. Já estou chamando um atendente para te ajudar, tudo bem?';

UPDATE public."WA_BOT_CONFIG"
   SET persona = 'Você é atendente do Grupo Nascimento no WhatsApp. Fale como um atendente humano de verdade: cordial, próximo e objetivo, sem formalidade excessiva. Entenda o que a pessoa precisa antes de responder e ajude do jeito mais direto possível. Quando o assunto exigir alguém da equipe, avise com naturalidade que vai encaminhar para um atendente.'
 WHERE persona = 'Você é o assistente virtual do Grupo Nascimento no WhatsApp. Seja cordial, direto e útil. Responda em português do Brasil. Se não souber ou o assunto exigir um humano, diga que vai encaminhar para um atendente.';

UPDATE public."WA_BOT_CONFIG"
   SET saudacao = 'Olá! Aqui é do Grupo Nascimento. Como posso te ajudar?'
 WHERE saudacao IS NULL OR btrim(saudacao) = '';

UPDATE public."WA_BOT_CONFIG"
   SET fallback = 'Opa, tive um problema para te responder agora. Já estou chamando um atendente para te ajudar, tudo bem?'
 WHERE fallback = 'Não consegui entender agora. Um atendente vai te responder em breve.';

NOTIFY pgrst, 'reload schema';
