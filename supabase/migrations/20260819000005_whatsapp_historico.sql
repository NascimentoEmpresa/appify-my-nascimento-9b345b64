-- =====================================================================
-- WHATSAPP — histórico de interações da conversa
--
-- Hoje só sobra rastro do que virou mensagem. Mover de pasta, ligar/desligar
-- o bot e reagir não deixam registro nenhum: a conversa muda de fila e não há
-- como saber quem fez, nem quando. Esta migration cria o livro-caixa.
--
-- O que NÃO entra aqui: as mensagens. Elas já estão em WA_MENSAGEM com autor,
-- e duplicá-las como evento criaria duas versões da mesma verdade, que
-- divergem no primeiro apagamento. A tela junta as duas fontes na hora.
--
-- Idempotente.
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_wa_conversa_evento ON public."WA_CONVERSA";
--   DROP FUNCTION IF EXISTS public.wa_registra_evento();
--   DROP TABLE IF EXISTS public."WA_EVENTO";
-- =====================================================================

CREATE TABLE IF NOT EXISTS public."WA_EVENTO" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id uuid NOT NULL REFERENCES public."WA_CONVERSA"(id) ON DELETE CASCADE,
  -- pasta | bot | conclusao | reabertura | reacao | atendente
  tipo        text NOT NULL,
  ator_id     uuid REFERENCES auth.users(id),   -- null = bot/contato/automação
  -- Texto já pronto para leitura. Guardar montado evita a tela ter que
  -- reconstruir frase a partir de códigos que podem deixar de existir (uma
  -- pasta apagada continua legível no histórico).
  descricao   text NOT NULL,
  detalhe     jsonb,
  criada_em   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wa_evento_conversa_idx
  ON public."WA_EVENTO" (conversa_id, criada_em DESC);

ALTER TABLE public."WA_EVENTO" ENABLE ROW LEVEL SECURITY;

-- Mesma regra da conversa: quem enxerga a pasta enxerga o histórico dela.
DROP POLICY IF EXISTS wa_evento_select ON public."WA_EVENTO";
CREATE POLICY wa_evento_select ON public."WA_EVENTO" FOR SELECT TO authenticated
  USING (
    public.tem_acesso_menu('whatsapp')
    AND EXISTS (SELECT 1 FROM public."WA_CONVERSA" c
                 WHERE c.id = conversa_id AND public.wa_pode_ver_pasta(c.pasta_codigo))
  );

-- Escrita só pelo trigger/service_role: histórico que o usuário pode editar
-- não serve como histórico.
DROP POLICY IF EXISTS wa_evento_insert ON public."WA_EVENTO";
CREATE POLICY wa_evento_insert ON public."WA_EVENTO" FOR INSERT TO authenticated
  WITH CHECK (false);

-- Trigger: registra o que mudou na conversa -------------------------------
CREATE OR REPLACE FUNCTION public.wa_registra_evento()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text;
  v_de   text;
  v_para text;
BEGIN
  SELECT nullif(btrim(display_name), '') INTO v_nome FROM public.profiles WHERE id = v_uid;
  v_nome := coalesce(v_nome, 'Sistema');

  IF NEW.pasta_codigo IS DISTINCT FROM OLD.pasta_codigo THEN
    SELECT nome INTO v_de   FROM public."WA_PASTA" WHERE codigo = OLD.pasta_codigo;
    SELECT nome INTO v_para FROM public."WA_PASTA" WHERE codigo = NEW.pasta_codigo;
    v_de   := coalesce(v_de, 'Sem pasta');
    v_para := coalesce(v_para, 'Sem pasta');

    -- Conclusão e reabertura NÃO viram evento: a 20260819000004 já grava uma
    -- mensagem de sistema para elas, que aparece dentro da conversa E no
    -- histórico. Duplicar aqui mostraria a mesma coisa duas vezes, com
    -- palavras diferentes e o mesmo horário.
    IF NEW.pasta_codigo IS DISTINCT FROM 'atendimento_concluido'
       AND OLD.pasta_codigo IS DISTINCT FROM 'atendimento_concluido' THEN
      INSERT INTO public."WA_EVENTO" (conversa_id, tipo, ator_id, descricao, detalhe)
      VALUES (NEW.id, 'pasta', v_uid, v_nome || ' moveu de "' || v_de || '" para "' || v_para || '"',
              jsonb_build_object('de', v_de, 'para', v_para));
    END IF;
  END IF;

  IF NEW.bot_ativo IS DISTINCT FROM OLD.bot_ativo THEN
    INSERT INTO public."WA_EVENTO" (conversa_id, tipo, ator_id, descricao)
    VALUES (NEW.id, 'bot', v_uid,
            v_nome || CASE WHEN NEW.bot_ativo THEN ' religou o bot' ELSE ' assumiu o atendimento (bot desligado)' END);
  END IF;

  RETURN NULL; -- AFTER trigger
END;
$$;

DROP TRIGGER IF EXISTS trg_wa_conversa_evento ON public."WA_CONVERSA";
CREATE TRIGGER trg_wa_conversa_evento
  AFTER UPDATE ON public."WA_CONVERSA"
  FOR EACH ROW EXECUTE FUNCTION public.wa_registra_evento();

NOTIFY pgrst, 'reload schema';
