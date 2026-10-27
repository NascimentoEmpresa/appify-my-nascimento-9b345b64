-- =========================================================================
-- WHATSAPP: ABERTURA DO "NOVA CONVERSA" LIGADA À CANDIDATURA (UTILITY)
-- (27/10/2026)
--
-- PEDIDO (Pablo, print da Caixa de Entrada): a abertura "Olá, Somos do Grupo
-- Nascimento! Precisamos entrar em contato com você..." voltou com
-- "A Meta limitou a entrega para este contato" — erro 131049, que a Meta só
-- aplica a template de MARKETING.
--
-- POR QUÊ: o abertura_contato foi CRIADO como UTILITY (whatsapp-abertura),
-- mas a Meta reclassifica na revisão. Um texto que não cita assunto nenhum
-- ("precisamos falar com você, responda") é, para ela, abordagem — marketing.
-- UTILITY é o que se refere a algo que a PESSOA já começou: aqui, a
-- candidatura dela a uma vaga. Foi o mesmo caso da Saudação em 14/10
-- (20261014000015).
--
-- O QUE MUDA
--   · A abertura principal passa a ser o template abertura_candidatura, com
--     {{1}} = primeiro nome e {{2}} = vaga (cargo). A tela do Nova conversa
--     já traz a vaga do candidato daquele telefone (wa_candidato_do_contato).
--   · A abertura antiga continua, como GENÉRICA: sai quando o atendente não
--     informa vaga (fornecedor, colaborador...) e, enquanto o novo template
--     não é aprovado na Meta, como reserva. Ela segue sujeita ao 131049 — a
--     tela avisa com a categoria que a Meta deu.
--   · Template aprovado é imutável e a categoria não muda depois de criado:
--     por isso NOME NOVO. Criar na Meta pelo próprio Nova conversa (botão
--     "Criar template na Meta", quem tem o menu do Chatbot).
--
-- Idempotente (só move o texto antigo para a genérica uma vez).
-- =========================================================================

ALTER TABLE public."WA_BOT_CONFIG"
  ADD COLUMN IF NOT EXISTS abertura_texto_generico    text,
  ADD COLUMN IF NOT EXISTS abertura_template_generico text;

COMMENT ON COLUMN public."WA_BOT_CONFIG".abertura_texto IS
  'Abertura do Nova conversa ligada à candidatura: {{1}} = primeiro nome, {{2}} = vaga. Mesmo texto do template abertura_template (UTILITY).';
COMMENT ON COLUMN public."WA_BOT_CONFIG".abertura_texto_generico IS
  'Abertura sem vaga (fornecedor, colaborador) e reserva enquanto a da candidatura não é aprovada. A Meta a classifica como MARKETING (131049).';

UPDATE public."WA_BOT_CONFIG"
   SET abertura_texto_generico    = abertura_texto,
       abertura_template_generico = abertura_template,
       abertura_texto = E'Olá, {{1}}! Aqui é o Recrutamento do Grupo Nascimento, sobre a sua candidatura para a vaga de {{2}}.\nPrecisamos falar com você para dar andamento ao processo seletivo. Toque no botão abaixo para continuarmos por aqui.',
       abertura_template = 'abertura_candidatura',
       abertura_botao = 'Pode falar!'
 WHERE abertura_template_generico IS NULL
   AND abertura_template <> 'abertura_candidatura';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- UPDATE public."WA_BOT_CONFIG"
--    SET abertura_texto = abertura_texto_generico, abertura_template = abertura_template_generico, abertura_botao = 'Olá, Bom dia!'
--  WHERE abertura_template_generico IS NOT NULL;
-- ALTER TABLE public."WA_BOT_CONFIG" DROP COLUMN IF EXISTS abertura_texto_generico, DROP COLUMN IF EXISTS abertura_template_generico;
-- NOTIFY pgrst, 'reload schema';
