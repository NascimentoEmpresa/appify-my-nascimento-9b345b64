-- =====================================================================
-- WHATSAPP — anti-repetição do CLIQUE em opção do menu
--
-- A trava atômica de `menu_enviado_em` (20260819000006) só cobre o menu vindo
-- de texto solto. Clique em botão passava direto, de propósito: "clique é
-- pedido explícito e sempre responde". Só que dois toques no mesmo botão são
-- duas mensagens distintas da Meta (wa_message_id diferente), então o dedupe
-- por id não pega — e o bot responde duas vezes.
--
-- Caso real: mesma opção clicada com 0,79 s de diferença -> a resposta
-- "Vagas Disponíveis" saiu 2x.
--
-- Mesma estratégia do menu: o banco decide. Um UPDATE condicional carimba
-- qual opção foi atendida e quando; quem não consegue atualizar fica quieto.
-- Só colapsa a MESMA opção dentro da janela — clicar outra opção, ou a mesma
-- depois da janela, responde normalmente.
--
-- Idempotente.
-- ROLLBACK:
--   ALTER TABLE public."WA_CONVERSA" DROP COLUMN IF EXISTS ultima_opcao_id;
--   ALTER TABLE public."WA_CONVERSA" DROP COLUMN IF EXISTS ultima_opcao_em;
-- =====================================================================

ALTER TABLE public."WA_CONVERSA"
  ADD COLUMN IF NOT EXISTS ultima_opcao_id text,
  ADD COLUMN IF NOT EXISTS ultima_opcao_em timestamptz;

COMMENT ON COLUMN public."WA_CONVERSA".ultima_opcao_id IS
  'Última opção do menu (MenuOpcao.id) atendida nesta conversa. Trava atômica contra clique repetido.';
COMMENT ON COLUMN public."WA_CONVERSA".ultima_opcao_em IS
  'Quando a última opção foi atendida. Junto com ultima_opcao_id forma a janela do anti-repetição de clique.';

NOTIFY pgrst, 'reload schema';
