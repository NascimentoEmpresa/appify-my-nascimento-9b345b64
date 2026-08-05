-- =====================================================================
-- WHATSAPP — quem concluiu o atendimento fica no histórico da conversa
--
-- "Concluído" hoje é só a conversa mudar de pasta: some da fila e ninguém
-- sabe quem encerrou nem quando. Passa a existir um registro no meio da
-- própria thread, que é onde a pergunta aparece ("por que isso foi fechado?").
--
-- Duas origens possíveis, e a distinção importa:
--   - ATENDENTE: alguém moveu a conversa para a pasta pela Caixa de Entrada;
--   - CONTATO: a própria pessoa clicou numa opção "concluir" no menu do bot.
--
-- Como o trigger sabe qual é qual: pela Caixa de Entrada existe auth.uid()
-- (sessão do atendente); pelo webhook não existe (roda com service_role), e
-- por isso o webhook marca `concluida_por_contato` explicitamente em vez de
-- deixar o trigger adivinhar pela ausência de sessão — ausência de sessão
-- também aconteceria num UPDATE manual pelo SQL Editor.
--
-- Idempotente.
-- ROLLBACK:
--   ALTER TABLE public."WA_CONVERSA" DROP COLUMN IF EXISTS concluida_por,
--     DROP COLUMN IF EXISTS concluida_por_contato;
--   (recriar wa_marca_conclusao da 20260819000003)
-- =====================================================================

-- 1) Mensagem de sistema no histórico ------------------------------------
-- A thread só aceitava contato/bot/atendente. O registro de conclusão não é
-- nenhum dos três: não foi enviado a ninguém, é um evento da conversa.
ALTER TABLE public."WA_MENSAGEM" DROP CONSTRAINT IF EXISTS "WA_MENSAGEM_origem_check";
ALTER TABLE public."WA_MENSAGEM"
  ADD CONSTRAINT "WA_MENSAGEM_origem_check"
  CHECK (origem IN ('contato','bot','atendente','sistema'));

-- 2) Quem concluiu --------------------------------------------------------
ALTER TABLE public."WA_CONVERSA"
  ADD COLUMN IF NOT EXISTS concluida_por uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS concluida_por_contato boolean NOT NULL DEFAULT false;

-- 3) Trigger: carimba o marco e escreve a linha no histórico ---------------
CREATE OR REPLACE FUNCTION public.wa_marca_conclusao()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_nome  text;
  v_texto text;
BEGIN
  IF NEW.pasta_codigo IS NOT DISTINCT FROM OLD.pasta_codigo THEN
    RETURN NEW;
  END IF;

  IF NEW.pasta_codigo = 'atendimento_concluido' THEN
    NEW.concluida_em := coalesce(NEW.concluida_em, now());
    NEW.concluida_por := CASE WHEN NEW.concluida_por_contato THEN NULL ELSE v_uid END;

    IF NEW.concluida_por_contato THEN
      v_texto := 'Atendimento concluído pelo próprio contato.';
    ELSIF v_uid IS NOT NULL THEN
      SELECT display_name INTO v_nome FROM public.profiles WHERE id = v_uid;
      v_texto := 'Atendimento concluído por ' || coalesce(nullif(btrim(v_nome), ''), 'um atendente') || '.';
    ELSE
      v_texto := 'Atendimento concluído.';
    END IF;
  ELSE
    -- Saiu dos concluídos: voltou a ser atendimento aberto.
    IF OLD.pasta_codigo = 'atendimento_concluido' THEN
      SELECT display_name INTO v_nome FROM public.profiles WHERE id = v_uid;
      v_texto := 'Atendimento reaberto'
                 || coalesce(' por ' || nullif(btrim(v_nome), ''), '') || '.';
    END IF;
    NEW.concluida_em := NULL;
    NEW.concluida_por := NULL;
    NEW.concluida_por_contato := false;
  END IF;

  IF v_texto IS NOT NULL THEN
    -- direcao 'saida' porque a coluna não aceita neutro; o que define o
    -- desenho na tela é origem='sistema', que a Caixa de Entrada centraliza.
    INSERT INTO public."WA_MENSAGEM"
      (conversa_id, contato_id, direcao, tipo, texto, status, origem, autor_id)
    VALUES
      (NEW.id, NEW.contato_id, 'saida', 'sistema', v_texto, 'enviada', 'sistema', v_uid);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wa_conversa_concluida ON public."WA_CONVERSA";
CREATE TRIGGER trg_wa_conversa_concluida
  BEFORE UPDATE ON public."WA_CONVERSA"
  FOR EACH ROW EXECUTE FUNCTION public.wa_marca_conclusao();

NOTIFY pgrst, 'reload schema';
