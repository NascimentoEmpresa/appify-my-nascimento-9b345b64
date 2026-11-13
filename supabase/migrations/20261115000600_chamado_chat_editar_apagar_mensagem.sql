-- =====================================================================
-- CHAT DO CHAMADO — editar e apagar a própria mensagem (13/11/2026)
--
-- Pedido: no chat do chamado de desenvolvimento (/app/sistemas/chamados/dev),
-- quem escreveu uma mensagem pode EDITAR ou APAGAR a mensagem depois de
-- enviada. Regra do pedido: tudo continua no histórico.
--
--   · Editar não some com o texto antigo: cada versão anterior vai para
--     "CHAMADO_SISTEMA_EVENTO_VERSAO" e o balão mostra "(editada)", com o
--     original a um clique.
--   · Apagar não remove a linha: o balão vira "Mensagem apagada por <nome>
--     em <data/hora>". O texto sai de "CHAMADO_SISTEMA_EVENTO".texto (vira
--     NULL) e fica guardado na tabela de versões, para auditoria.
--
-- Por que o texto apagado vira NULL na própria linha (e não só uma marca):
-- quem lê o chat fora da tela — o monitor de I.A (chamado-monitor-ia), o
-- relatório em PDF, o feed de atualizações — lê `texto`. Com NULL, nenhum
-- deles trata a mensagem apagada como conteúdo atual, mesmo sem redeploy
-- (o monitor já descarta mensagem sem texto).
--
-- Quem pode: SÓ O AUTOR, e só em mensagem de gente (tipo comentario ou
-- observacao_interna, sem meta.canal/meta.origem — o resumo da I.A no merge
-- é gravado como comentario com o autor do dev e não pode virar editável).
-- A gestão NÃO edita nem apaga mensagem dos outros; ela lê o conteúdo
-- apagado (auditoria) pela chamado_sistema_gestor().
--
-- A garantia é no banco: não existe policy de UPDATE/DELETE na tabela, então
-- o único caminho é a RPC; e o gatilho grava a versão anterior em QUALQUER
-- update de texto (até de service_role) e barra DELETE de mensagem fora do
-- cascade de exclusão do chamado inteiro.
-- =====================================================================

-- ── 1. Colunas na mensagem ───────────────────────────────────────────────
ALTER TABLE public."CHAMADO_SISTEMA_EVENTO"
  ADD COLUMN IF NOT EXISTS editado_em  timestamptz,
  ADD COLUMN IF NOT EXISTS apagado_em  timestamptz,
  ADD COLUMN IF NOT EXISTS apagado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public."CHAMADO_SISTEMA_EVENTO".editado_em IS
  'Última edição do texto pelo autor (mig 20261115000600). Versões anteriores em CHAMADO_SISTEMA_EVENTO_VERSAO.';
COMMENT ON COLUMN public."CHAMADO_SISTEMA_EVENTO".apagado_em IS
  'Mensagem apagada pelo autor (mig 20261115000600): texto vira NULL e o conteúdo fica em CHAMADO_SISTEMA_EVENTO_VERSAO (acao = apagada).';

-- ── 2. Histórico das versões ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."CHAMADO_SISTEMA_EVENTO_VERSAO" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id   uuid NOT NULL REFERENCES public."CHAMADO_SISTEMA_EVENTO"(id) ON DELETE CASCADE,
  chamado_id  uuid NOT NULL,
  acao        text NOT NULL CHECK (acao IN ('editada', 'apagada')),
  texto       text,           -- o texto COMO ERA antes da ação
  feito_por   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  feito_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chamado_evento_versao_evento
  ON public."CHAMADO_SISTEMA_EVENTO_VERSAO"(evento_id, feito_em);
-- Guardião de desempenho (M2): FK sem índice faz o DELETE de um usuário
-- varrer a tabela inteira.
CREATE INDEX IF NOT EXISTS chamado_sistema_evento_versao_feito_por_idx
  ON public."CHAMADO_SISTEMA_EVENTO_VERSAO"(feito_por);

ALTER TABLE public."CHAMADO_SISTEMA_EVENTO_VERSAO" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."CHAMADO_SISTEMA_EVENTO_VERSAO" FROM PUBLIC, anon;
GRANT SELECT ON public."CHAMADO_SISTEMA_EVENTO_VERSAO" TO authenticated;

-- Quem enxerga a mensagem enxerga as versões dela (a RLS do _EVENTO vale
-- dentro do EXISTS). Mensagem APAGADA: o conteúdo antigo só para o autor e a
-- gestão — apagar tem que tirar o texto da vista do grupo.
DROP POLICY IF EXISTS chamado_evento_versao_select ON public."CHAMADO_SISTEMA_EVENTO_VERSAO";
CREATE POLICY chamado_evento_versao_select ON public."CHAMADO_SISTEMA_EVENTO_VERSAO" FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public."CHAMADO_SISTEMA_EVENTO" e
     WHERE e.id = "CHAMADO_SISTEMA_EVENTO_VERSAO".evento_id
       AND (e.apagado_em IS NULL OR e.autor_id = auth.uid() OR public.chamado_sistema_gestor())));
-- Sem policy de INSERT/UPDATE/DELETE: só o gatilho (SECURITY DEFINER) escreve.

-- ── 3. Gatilho: guarda a versão anterior e trava o que não pode ──────────
CREATE OR REPLACE FUNCTION public.chamado_evento_historico()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Exclusão do chamado inteiro chega por cascade (profundidade > 1): deixa.
    IF OLD.tipo IN ('comentario', 'observacao_interna') AND pg_trigger_depth() <= 1 THEN
      RAISE EXCEPTION 'Mensagem do chat não é excluída — use Apagar (o histórico fica guardado).'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF OLD.apagado_em IS NOT NULL THEN
    IF NEW.texto IS DISTINCT FROM OLD.texto
       OR NEW.apagado_em IS DISTINCT FROM OLD.apagado_em
       OR NEW.apagado_por IS DISTINCT FROM OLD.apagado_por THEN
      RAISE EXCEPTION 'Mensagem apagada não volta nem é editada.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.apagado_em IS NOT NULL THEN
    -- Apagando agora: guarda o conteúdo e tira o texto da linha.
    INSERT INTO public."CHAMADO_SISTEMA_EVENTO_VERSAO" (evento_id, chamado_id, acao, texto, feito_por, feito_em)
    VALUES (OLD.id, OLD.chamado_id, 'apagada', OLD.texto, COALESCE(NEW.apagado_por, auth.uid()), NEW.apagado_em);
    NEW.texto := NULL;
    NEW.apagado_por := COALESCE(NEW.apagado_por, auth.uid());
    RETURN NEW;
  END IF;

  IF NEW.texto IS DISTINCT FROM OLD.texto THEN
    INSERT INTO public."CHAMADO_SISTEMA_EVENTO_VERSAO" (evento_id, chamado_id, acao, texto, feito_por)
    VALUES (OLD.id, OLD.chamado_id, 'editada', OLD.texto, auth.uid());
    NEW.editado_em := now();
  ELSIF NEW.editado_em IS DISTINCT FROM OLD.editado_em THEN
    NEW.editado_em := OLD.editado_em; -- não se forja "(editada)" sem edição
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_evento_historico() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_chamado_evento_historico ON public."CHAMADO_SISTEMA_EVENTO";
CREATE TRIGGER trg_chamado_evento_historico
  BEFORE UPDATE OR DELETE ON public."CHAMADO_SISTEMA_EVENTO"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_evento_historico();

-- ── 4. Quem pode mexer numa mensagem (usado pelas duas RPCs) ─────────────
-- Autor + mensagem de gente + ainda tem acesso à conversa + não apagada.
-- Conversa fechada (reprovado/cancelado) só aceita mexer na interna, igual
-- ao envio (chamado_enviar_mensagem, mig 20261103001700).
CREATE OR REPLACE FUNCTION public.chamado_mensagem_checar_autor(p_evento_id uuid)
RETURNS public."CHAMADO_SISTEMA_EVENTO"
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  e     public."CHAMADO_SISTEMA_EVENTO";
  c     public."CHAMADO_SISTEMA";
BEGIN
  SELECT * INTO e FROM public."CHAMADO_SISTEMA_EVENTO" WHERE id = p_evento_id;
  IF e.id IS NULL THEN
    RAISE EXCEPTION 'Mensagem não encontrada.' USING ERRCODE = '42704';
  END IF;
  IF v_uid IS NULL OR e.autor_id <> v_uid THEN
    RAISE EXCEPTION 'Só quem escreveu a mensagem pode editar ou apagar.' USING ERRCODE = '42501';
  END IF;
  IF e.tipo NOT IN ('comentario', 'observacao_interna')
     OR COALESCE(e.meta ->> 'canal', e.meta ->> 'origem') IS NOT NULL THEN
    RAISE EXCEPTION 'Esta mensagem é do sistema e não pode ser alterada.' USING ERRCODE = '42501';
  END IF;
  IF e.apagado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Mensagem já apagada.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO c FROM public."CHAMADO_SISTEMA" WHERE id = e.chamado_id;
  IF NOT (c.solicitante_id = v_uid OR c.responsavel_id = v_uid
          OR public.chamado_eh_participante(c.id) OR public.chamado_sistema_gestor()) THEN
    RAISE EXCEPTION 'Sem acesso à conversa deste chamado.' USING ERRCODE = '42501';
  END IF;
  IF c.status IN ('reprovado', 'cancelado') AND e.tipo <> 'observacao_interna' THEN
    RAISE EXCEPTION 'Chamado encerrado — a conversa está fechada.' USING ERRCODE = '22023';
  END IF;
  RETURN e;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_mensagem_checar_autor(uuid) FROM PUBLIC, anon, authenticated;

-- ── 5. RPCs ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_editar_mensagem(p_evento_id uuid, p_texto text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  e       public."CHAMADO_SISTEMA_EVENTO" := public.chamado_mensagem_checar_autor(p_evento_id);
  v_texto text := NULLIF(btrim(COALESCE(p_texto, '')), '');
BEGIN
  IF v_texto IS NULL THEN
    RAISE EXCEPTION 'A mensagem não pode ficar vazia — para tirar o texto, use Apagar.' USING ERRCODE = '22023';
  END IF;
  IF length(v_texto) > 4000 THEN
    RAISE EXCEPTION 'Mensagem acima de 4000 caracteres.' USING ERRCODE = '22023';
  END IF;
  IF v_texto IS NOT DISTINCT FROM e.texto THEN
    RETURN; -- nada mudou: não cria versão nem marca "(editada)"
  END IF;
  -- O gatilho guarda a versão anterior e carimba editado_em.
  UPDATE public."CHAMADO_SISTEMA_EVENTO" SET texto = v_texto WHERE id = e.id;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_editar_mensagem(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_editar_mensagem(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.chamado_apagar_mensagem(p_evento_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  e public."CHAMADO_SISTEMA_EVENTO" := public.chamado_mensagem_checar_autor(p_evento_id);
BEGIN
  -- O gatilho guarda o texto na tabela de versões e zera `texto` na linha.
  UPDATE public."CHAMADO_SISTEMA_EVENTO"
     SET apagado_em = now(), apagado_por = auth.uid()
   WHERE id = e.id;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_apagar_mensagem(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_apagar_mensagem(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
-- DROP FUNCTION IF EXISTS public.chamado_apagar_mensagem(uuid);
-- DROP FUNCTION IF EXISTS public.chamado_editar_mensagem(uuid, text);
-- DROP FUNCTION IF EXISTS public.chamado_mensagem_checar_autor(uuid);
-- DROP TRIGGER IF EXISTS trg_chamado_evento_historico ON public."CHAMADO_SISTEMA_EVENTO";
-- DROP FUNCTION IF EXISTS public.chamado_evento_historico();
-- DROP TABLE IF EXISTS public."CHAMADO_SISTEMA_EVENTO_VERSAO";
-- ALTER TABLE public."CHAMADO_SISTEMA_EVENTO" DROP COLUMN IF EXISTS apagado_por,
--   DROP COLUMN IF EXISTS apagado_em, DROP COLUMN IF EXISTS editado_em;
-- (Antes de derrubar: o texto das mensagens apagadas só existe na tabela de versões.)
