-- =========================================================================
-- RECRUTAMENTO: vaga transferida = NOVA DEMANDA para quem recebeu (14/10/2026)
--
-- Pedido do Pablo: "quando as meninas do Recrutamento trocam de colega — ex.:
-- a Pamela fez o processo de seleção, a pessoa passou em todas as etapas, aí
-- ela transfere para a Giovana — preciso que sinalize para a Giovana uma nova
-- demanda, mude a cor. Quando usavam o Excel, elas pintavam a linha de
-- vermelho."
--
-- Transferir já existe: é escolher outra pessoa como responsável pela vaga
-- (rec_responsavel_definir, mig 20261013000003). Faltava avisar quem recebeu.
--
--   • Quando o responsável muda para alguém que NÃO foi quem fez a troca
--     (atualizado_por ≠ responsavel_id — a Pamela colocou a Giovana), a vaga
--     fica marcada: transferida_em / transferida_por_nome, ciente_em = NULL.
--     Quem assume a vaga para si ("Tornar-me responsável") ou vira
--     responsável automático por mover a vaga não gera aviso — ela mesma fez.
--   • A nova responsável recebe a notificação no sininho, com link que abre a
--     vaga (?vaga=ID na Gestão Recrutamento).
--   • A linha fica vermelha na tela até a própria responsável clicar em
--     "Ciente" (rec_responsavel_ciente), que vai para o histórico da vaga.
--
-- Feito no gatilho da tabela (e não dentro de cada função) para valer em
-- qualquer caminho que troque o responsável.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

ALTER TABLE public."SISTEMA_RECRUTAMENTO_RESPONSAVEL"
  ADD COLUMN IF NOT EXISTS transferida_em      timestamptz,
  ADD COLUMN IF NOT EXISTS transferida_por_nome text,
  ADD COLUMN IF NOT EXISTS ciente_em           timestamptz;

-- ── Marca a transferência e avisa quem recebeu ──────────────────────────
CREATE OR REPLACE FUNCTION public.rec_responsavel_marcar_transferencia()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_vaga record;
BEGIN
  -- Só interessa quando a PESSOA responsável muda.
  IF TG_OP = 'UPDATE' AND NEW.responsavel_id IS NOT DISTINCT FROM OLD.responsavel_id THEN
    RETURN NEW;
  END IF;

  IF NEW.responsavel_id IS NOT NULL AND NEW.atualizado_por IS NOT NULL
     AND NEW.responsavel_id <> NEW.atualizado_por THEN
    -- Alguém colocou OUTRA pessoa: é transferência.
    NEW.transferida_em := now();
    NEW.transferida_por_nome := public.rec_nome_usuario(NEW.atualizado_por);
    NEW.ciente_em := NULL;

    BEGIN
      SELECT id, cargo, contrato INTO v_vaga FROM public."SISTEMA_RECRUTAMENTO" WHERE id = NEW.vaga_id;
      INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
      VALUES (NEW.responsavel_id,
              'Nova demanda: vaga #' || NEW.vaga_id || ' transferida para você',
              coalesce(NEW.transferida_por_nome, 'Alguém') || ' passou para você a vaga #' || NEW.vaga_id
                || coalesce(' · ' || v_vaga.cargo, '') || coalesce(' — ' || v_vaga.contrato, '') || '.',
              'recrutamento_vaga_transferida',
              '/app/rh/recrutamento?vaga=' || NEW.vaga_id);
    EXCEPTION WHEN others THEN
      -- Avisar não pode impedir a troca de responsável.
      RAISE WARNING 'rec_responsavel_marcar_transferencia (aviso): %', SQLERRM;
    END;
  ELSE
    -- A própria pessoa assumiu (ou ficou sem ninguém): nada a avisar.
    NEW.transferida_em := NULL;
    NEW.transferida_por_nome := NULL;
    NEW.ciente_em := NULL;
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.rec_responsavel_marcar_transferencia() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_rec_responsavel_marcar_transferencia ON public."SISTEMA_RECRUTAMENTO_RESPONSAVEL";
CREATE TRIGGER trg_rec_responsavel_marcar_transferencia
  BEFORE INSERT OR UPDATE ON public."SISTEMA_RECRUTAMENTO_RESPONSAVEL"
  FOR EACH ROW EXECUTE FUNCTION public.rec_responsavel_marcar_transferencia();

-- ── "Ciente": a responsável tira o vermelho ─────────────────────────────
CREATE OR REPLACE FUNCTION public.rec_responsavel_ciente(p_vaga bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  r       public."SISTEMA_RECRUTAMENTO_RESPONSAVEL"%ROWTYPE;
  v_eu    text;
  v_email text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Faça login.'; END IF;
  SELECT * INTO r FROM public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" WHERE vaga_id = p_vaga FOR UPDATE;
  IF r.vaga_id IS NULL OR r.responsavel_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Só a responsável pela vaga #% marca que está ciente.', p_vaga USING ERRCODE = '42501';
  END IF;
  IF r.transferida_em IS NULL OR (r.ciente_em IS NOT NULL AND r.ciente_em >= r.transferida_em) THEN
    RETURN;   -- nada pendente
  END IF;

  UPDATE public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" SET ciente_em = now() WHERE vaga_id = p_vaga;

  v_eu := public.rec_nome_usuario(v_uid);
  SELECT email INTO v_email FROM public.profiles WHERE id = v_uid;
  INSERT INTO public."RECRUTAMENTO_HISTORICO"(solicitacao_id, evento, papel, usuario_nome, usuario_email, detalhe)
  VALUES (p_vaga, v_eu || ' está ciente da vaga transferida', 'Recrutamento', v_eu, v_email,
          'Transferida por ' || coalesce(r.transferida_por_nome, '—') || ' em '
            || to_char(r.transferida_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'));
END $fn$;
REVOKE ALL ON FUNCTION public.rec_responsavel_ciente(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_responsavel_ciente(bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_rec_responsavel_marcar_transferencia ON public."SISTEMA_RECRUTAMENTO_RESPONSAVEL";
-- DROP FUNCTION IF EXISTS public.rec_responsavel_marcar_transferencia();
-- DROP FUNCTION IF EXISTS public.rec_responsavel_ciente(bigint);
-- ALTER TABLE public."SISTEMA_RECRUTAMENTO_RESPONSAVEL"
--   DROP COLUMN IF EXISTS transferida_em, DROP COLUMN IF EXISTS transferida_por_nome, DROP COLUMN IF EXISTS ciente_em;
-- NOTIFY pgrst, 'reload schema';
