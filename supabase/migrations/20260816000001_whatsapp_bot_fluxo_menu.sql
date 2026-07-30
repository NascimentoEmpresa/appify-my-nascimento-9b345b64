-- WhatsApp — fluxo único guiado por menu.
--
-- O bot passou a ter UM fluxo só: toda conversa começa pelo menu de atendimento
-- e a IA só entra quando a pessoa escolhe a opção de atendimento por IA. Com
-- isso, dois restos de configuração deixaram de fazer sentido:
--
-- 1) saudacao: era a "1ª resposta a um contato novo", mas o bot não a usava mais
--    (quem abre a conversa é a mensagem do menu). Campo removido para não confundir.
--
-- 2) menu.ativo: o menu não é mais opcional (é o próprio fluxo), então a flag
--    "ativo" dentro do JSON não tem efeito. Limpamos das linhas existentes.
--
-- Idempotente.

ALTER TABLE public."WA_BOT_CONFIG" DROP COLUMN IF EXISTS saudacao;

UPDATE public."WA_BOT_CONFIG"
   SET menu = menu - 'ativo'
 WHERE menu ? 'ativo';

NOTIFY pgrst, 'reload schema';
