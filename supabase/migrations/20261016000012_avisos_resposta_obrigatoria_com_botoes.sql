-- =========================================================================
-- Quadro de Avisos: aviso com botões próprios não aceita ciência sem botão
--
-- Incidente de 16/10/2026: o aviso "3 Anos de Empresa" (id 20) tinha um
-- botão só, "Parabéns!!", e ainda assim 5 pessoas apareceram como "Ciente".
-- As 5 linhas têm escolha CIENTE e resposta NULL — o que só o gate ANTIGO
-- grava: aba aberta antes do deploy dos botões (PR #899, 11:53) continua com
-- o JavaScript velho, que não conhece `botoes` e mostra "Estou ciente". O
-- front atual sempre manda o rótulo; quem não manda é o navegador que não
-- recarregou. Pergunta do Pablo: "como que o pessoal conseguiu dar CIENTE se
-- só tem o botão de parabéns nesse aviso?"
--
-- A regra passa a morar no banco, onde bundle velho nenhum contorna:
--   · aviso com botões e resposta NULL:
--       1 botão  → a resposta vira esse botão (era a única opção que havia);
--       2 ou mais → recusa, pedindo para recarregar (não dá para adivinhar);
--   · resposta que não é um dos botões do aviso → recusa.
-- Aviso sem botões (CONCORDO/DISCORDO/"Estou ciente") não muda.
--
-- E acerta o que já entrou assim: nos avisos de um botão só, resposta NULL
-- vira o rótulo do botão (pedido: "troca esses que colocaram ciente pra
-- parabéns").
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.sistema_notif_ciencia_resposta_botao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _botoes jsonb;
  _rotulos text[];
BEGIN
  SELECT botoes INTO _botoes FROM public."SISTEMA_NOTIFICACOES" WHERE id = NEW.notificacao_id;
  IF _botoes IS NULL OR jsonb_typeof(_botoes) <> 'array' OR jsonb_array_length(_botoes) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(btrim(b->>'rotulo')) INTO _rotulos FROM jsonb_array_elements(_botoes) b;

  IF NEW.resposta IS NULL OR btrim(NEW.resposta) = '' THEN
    IF array_length(_rotulos, 1) = 1 THEN
      NEW.resposta := _rotulos[1];
    ELSE
      RAISE EXCEPTION 'Este aviso mudou: recarregue a página (F5) para ver os botões de resposta.'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NOT (btrim(NEW.resposta) = ANY (_rotulos)) THEN
    RAISE EXCEPTION 'Resposta "%" não é um dos botões deste aviso: recarregue a página (F5).', NEW.resposta
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.escolha := 'CIENTE';
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sistema_notif_ciencia_resposta_botao() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS sistema_notif_ciencia_resposta_botao ON public."SISTEMA_NOTIFICACAO_CIENCIA";
CREATE TRIGGER sistema_notif_ciencia_resposta_botao
  BEFORE INSERT ON public."SISTEMA_NOTIFICACAO_CIENCIA"
  FOR EACH ROW EXECUTE FUNCTION public.sistema_notif_ciencia_resposta_botao();

-- O que já entrou sem botão, nos avisos de um botão só.
UPDATE public."SISTEMA_NOTIFICACAO_CIENCIA" c
   SET resposta = btrim(n.botoes->0->>'rotulo')
  FROM public."SISTEMA_NOTIFICACOES" n
 WHERE n.id = c.notificacao_id
   AND jsonb_typeof(n.botoes) = 'array' AND jsonb_array_length(n.botoes) = 1
   AND (c.resposta IS NULL OR btrim(c.resposta) = '');

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS sistema_notif_ciencia_resposta_botao ON public."SISTEMA_NOTIFICACAO_CIENCIA";
-- DROP FUNCTION IF EXISTS public.sistema_notif_ciencia_resposta_botao();
-- (o UPDATE das respostas não tem volta automática: eram NULL nos avisos de 1 botão)
