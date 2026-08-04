-- =====================================================================
-- WHATSAPP — anti-repetição do menu à prova de mensagens simultâneas
--
-- O anti-repetição olhava o histórico ("já mandei o menu nos últimos X
-- minutos?") e só depois decidia. Isso é seguro com uma mensagem por vez, e
-- errado com várias: quem escreve três frases seguidas dispara três execuções
-- concorrentes do webhook, todas leem o histórico ANTES de qualquer menu ser
-- gravado, todas concluem "ainda não mandei" e todas mandam.
--
-- Caso real: 3 mensagens em 36 ms -> o menu saiu 2x.
--
-- A correção é o banco decidir, não a função. `menu_enviado_em` vira um
-- carimbo disputado por um UPDATE condicional: quem consegue atualizar ganhou
-- o direito de enviar; os concorrentes não atualizam nada e ficam quietos.
-- Um UPDATE é atômico, então não existe janela entre "ler" e "decidir".
--
-- Idempotente.
-- ROLLBACK: ALTER TABLE public."WA_CONVERSA" DROP COLUMN IF EXISTS menu_enviado_em;
-- =====================================================================

ALTER TABLE public."WA_CONVERSA"
  ADD COLUMN IF NOT EXISTS menu_enviado_em timestamptz;

COMMENT ON COLUMN public."WA_CONVERSA".menu_enviado_em IS
  'Quando o menu foi apresentado pela última vez. Usado como trava atômica do anti-repeticao (WA_BOT_CONFIG.nao_repetir_menu_min).';

-- Conversas que já receberam o menu antes desta migration não têm carimbo.
-- Semear com a última saída interativa evita o menu sair de novo logo após o
-- deploy, para todo mundo ao mesmo tempo.
UPDATE public."WA_CONVERSA" c
   SET menu_enviado_em = u.ultima
  FROM (
    SELECT conversa_id, max(criada_em) AS ultima
      FROM public."WA_MENSAGEM"
     WHERE direcao = 'saida' AND tipo = 'interactive'
     GROUP BY conversa_id
  ) u
 WHERE u.conversa_id = c.id AND c.menu_enviado_em IS NULL;

NOTIFY pgrst, 'reload schema';
