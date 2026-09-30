-- =========================================================================
-- CHAMADOS DE SISTEMAS — Treinamento: cada um confirma o seu, e só depois
-- vem a avaliação (ajuste da mig 266)
--
-- PEDIDO (30/09/2026, Pablo, testando o #SIS-2026-0567):
--   "confirmei o treinamento lá no painel do desenvolvedor, confirmei por mim
--    e pelo solicitante, mas cada um tem que confirmar o seu."
--   "o confirmar treinamento do solicitante tem que ficar ali onde envia a
--    avaliação ... tem primeiro que confirmar o treinamento, e depois avaliar.
--    pra abrir outro chamado primeiro tem que confirmar o treinamento e avaliar."
--   "todos treinamentos pendentes do desenvolvedor vão ficar no painel de
--    distribuição ... o dev pode aprovar, o gerente do dev pode também."
--
-- CAUSA DO "CONFIRMEI PELOS DOIS"
--   chamado_treinamento_confirmar (mig 266) marcava os DOIS lados quando a
--   mesma pessoa era dev e solicitante — foi o caso do teste (Pablo abriu e
--   atendeu o próprio chamado). Agora a RPC recebe o PAPEL e marca só ele:
--     p_papel = 'desenvolvedor' — o dev que concluiu OU a gestão de chamados
--               (chamado_sistema_gestor: Painel/Coordenar/Aprovar — é quem
--               enxerga o Painel de Distribuição; é o "gerente do dev"),
--               confirmando por ele. Fica registrado quem confirmou.
--     p_papel = 'solicitante'   — só o próprio solicitante. Ninguém confirma
--               por ele.
--   Sem p_papel, a RPC deduz; se a pessoa for as duas partes, recusa e pede
--   o papel (a tela sempre manda).
--
-- AVALIAÇÃO DEPOIS DO TREINAMENTO
--   Num chamado que passa pela Presidência, o 'concluido' chega ANTES da
--   Presidência validar. Até aqui o solicitante já era cobrado a avaliar
--   (e bloqueado de abrir outro chamado) com o desenvolvimento ainda em
--   validação. Agora:
--     · validação/treinamento em aberto → não dá para avaliar ainda
--       (trigger em CHAMADO_SISTEMA_AVALIACAO);
--     · o solicitante confirmou o treinamento (ou o chamado é do fluxo
--       normal) → avalia.
--   A pendência que trava "abrir novo chamado" passa a ser:
--     · treinamento a confirmar pelo solicitante, OU
--     · avaliação a fazer (no fluxo normal, ou depois de confirmar).
--   Enquanto a Presidência ainda valida, o solicitante não tem o que fazer —
--   não trava (seria punir por uma espera que não é dele).
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

-- ── 1. Confirmar treinamento, por papel ───────────────────────────────────
DROP FUNCTION IF EXISTS public.chamado_treinamento_confirmar(uuid, text);

CREATE OR REPLACE FUNCTION public.chamado_treinamento_confirmar(
  p_chamado_id uuid, p_observacao text DEFAULT NULL, p_papel text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_obs      text := NULLIF(btrim(COALESCE(p_observacao, '')), '');
  v          public."CHAMADO_SISTEMA_VALIDACAO"%ROWTYPE;
  v_solic    uuid;
  v_resp     uuid;
  v_dev      uuid;
  v_eh_dev   boolean;
  v_eh_solic boolean;
  v_gestao   boolean;
  v_papel    text := NULLIF(lower(btrim(COALESCE(p_papel, ''))), '');
  v_nome     text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessão expirada — entre de novo.';
  END IF;
  IF v_papel IS NOT NULL AND v_papel NOT IN ('desenvolvedor', 'solicitante') THEN
    RAISE EXCEPTION 'Papel inválido: %', p_papel;
  END IF;

  SELECT * INTO v FROM public."CHAMADO_SISTEMA_VALIDACAO"
   WHERE chamado_id = p_chamado_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Este chamado não passa pela validação da Presidência.';
  END IF;
  IF v.etapa <> 'treinamento' THEN
    RAISE EXCEPTION 'O treinamento só é confirmado depois que a Presidência aprova o desenvolvimento.';
  END IF;

  SELECT solicitante_id, responsavel_id INTO v_solic, v_resp
    FROM public."CHAMADO_SISTEMA" WHERE id = p_chamado_id;

  v_dev      := COALESCE(v.desenvolvedor_id, v_resp);
  v_eh_dev   := COALESCE(v_uid = v_dev, false);
  v_eh_solic := COALESCE(v_uid = v_solic, false);
  v_gestao   := public.chamado_sistema_gestor();

  -- Sem papel: deduz. Quem é as duas partes precisa dizer qual está confirmando.
  IF v_papel IS NULL THEN
    IF v_eh_dev AND v_eh_solic THEN
      RAISE EXCEPTION 'Você é o desenvolvedor e o solicitante deste chamado — cada confirmação é feita no seu lugar (a do solicitante, no acompanhamento do chamado).';
    ELSIF v_eh_solic THEN
      v_papel := 'solicitante';
    ELSE
      v_papel := 'desenvolvedor';
    END IF;
  END IF;

  IF v_papel = 'solicitante' THEN
    IF NOT v_eh_solic THEN
      RAISE EXCEPTION 'Só o próprio solicitante confirma que recebeu o treinamento.';
    END IF;
    IF v.treinamento_solic_em IS NOT NULL THEN
      RAISE EXCEPTION 'O solicitante já confirmou o treinamento.';
    END IF;
    UPDATE public."CHAMADO_SISTEMA_VALIDACAO"
       SET treinamento_solic_por = v_uid, treinamento_solic_em = now(), treinamento_solic_obs = v_obs
     WHERE chamado_id = p_chamado_id;
  ELSE
    IF NOT (v_eh_dev OR v_gestao) THEN
      RAISE EXCEPTION 'Só o desenvolvedor que concluiu (ou a gestão de chamados) confirma o treinamento dado.';
    END IF;
    IF v.treinamento_dev_em IS NOT NULL THEN
      RAISE EXCEPTION 'O desenvolvedor já confirmou o treinamento.';
    END IF;
    UPDATE public."CHAMADO_SISTEMA_VALIDACAO"
       SET treinamento_dev_por = v_uid, treinamento_dev_em = now(), treinamento_dev_obs = v_obs
     WHERE chamado_id = p_chamado_id;
  END IF;

  SELECT display_name INTO v_nome FROM public.profiles WHERE id = v_uid;
  PERFORM public.chamado_validacao_registrar_evento(p_chamado_id,
    CASE
      WHEN v_papel = 'solicitante' THEN
        format('Solicitante confirmou que recebeu o treinamento (%s)', COALESCE(v_nome, 'usuário'))
      WHEN v_eh_dev THEN
        format('Desenvolvedor confirmou que deu o treinamento (%s)', COALESCE(v_nome, 'usuário'))
      ELSE
        format('Gestão confirmou o treinamento pelo desenvolvedor %s (%s)',
               COALESCE((SELECT display_name FROM public.profiles WHERE id = v_dev), '—'), COALESCE(v_nome, 'usuário'))
    END || COALESCE(': ' || v_obs, ''));

  -- Os dois confirmaram → finaliza.
  UPDATE public."CHAMADO_SISTEMA_VALIDACAO"
     SET etapa = 'finalizado', finalizado_em = now()
   WHERE chamado_id = p_chamado_id
     AND treinamento_dev_em IS NOT NULL
     AND treinamento_solic_em IS NOT NULL
     AND etapa = 'treinamento';
  IF FOUND THEN
    PERFORM public.chamado_validacao_registrar_evento(p_chamado_id,
      'Treinamento confirmado pelo desenvolvedor e pelo solicitante — solicitação finalizada');
    RETURN 'finalizado';
  END IF;
  RETURN 'treinamento';
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_treinamento_confirmar(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_treinamento_confirmar(uuid, text, text) TO authenticated;

-- ── 2. Pendências do solicitante (treinamento → avaliação) ────────────────
-- Uma fonte só para a tela "Abrir chamado" e para o trigger que trava.
CREATE OR REPLACE FUNCTION public.chamado_pendencias_solicitante(p_uid uuid)
RETURNS TABLE(id uuid, numero text, assunto text, concluido_em timestamptz, pendencia text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT c.id, c.numero, c.assunto, c.concluido_em,
         CASE WHEN v.chamado_id IS NOT NULL AND v.etapa = 'treinamento' AND v.treinamento_solic_em IS NULL
              THEN 'treinamento' ELSE 'avaliacao' END
    FROM public."CHAMADO_SISTEMA" c
    LEFT JOIN public."CHAMADO_SISTEMA_VALIDACAO" v ON v.chamado_id = c.id
   WHERE c.solicitante_id = p_uid
     AND c.status = 'concluido'
     AND NOT EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_AVALIACAO" a WHERE a.chamado_id = c.id)
     -- Presidência ainda validando (ou devolvido ao dev): nada a fazer pelo solicitante.
     AND (v.chamado_id IS NULL OR v.etapa IN ('treinamento', 'finalizado'))
   ORDER BY c.concluido_em NULLS LAST;
$$;
REVOKE ALL ON FUNCTION public.chamado_pendencias_solicitante(uuid) FROM PUBLIC, anon;

-- A RPC da tela ganha a coluna `pendencia` — mudar o retorno exige DROP.
DROP FUNCTION IF EXISTS public.chamados_meus_avaliacoes_pendentes();
CREATE OR REPLACE FUNCTION public.chamados_meus_avaliacoes_pendentes()
RETURNS TABLE(id uuid, numero text, assunto text, concluido_em timestamptz, pendencia text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT * FROM public.chamado_pendencias_solicitante(auth.uid());
$$;
REVOKE ALL ON FUNCTION public.chamados_meus_avaliacoes_pendentes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamados_meus_avaliacoes_pendentes() TO authenticated;

-- ── 3. Trava ao abrir novo chamado (mesma regra da tela) ──────────────────
CREATE OR REPLACE FUNCTION public.chamado_sistema_bloqueia_avaliacao_pendente()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_pend text;
BEGIN
  SELECT pendencia INTO v_pend FROM public.chamado_pendencias_solicitante(NEW.solicitante_id) LIMIT 1;
  IF v_pend = 'treinamento' THEN
    RAISE EXCEPTION 'Você tem chamado concluído com treinamento a confirmar. Confirme o treinamento e avalie antes de abrir um novo.';
  ELSIF v_pend = 'avaliacao' THEN
    RAISE EXCEPTION 'Você tem chamados concluídos aguardando avaliação. Avalie-os antes de abrir um novo.';
  END IF;
  RETURN NEW;
END;
$$;
-- (o trigger trg_chamado_bloqueia_avaliacao, da mig 20260810000001, já
--  aponta para esta função — só o corpo muda.)

-- ── 4. Avaliar só depois do treinamento ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_avaliacao_exige_treinamento()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v public."CHAMADO_SISTEMA_VALIDACAO"%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public."CHAMADO_SISTEMA_VALIDACAO" WHERE chamado_id = NEW.chamado_id;
  IF NOT FOUND OR v.etapa = 'finalizado' THEN RETURN NEW; END IF;
  IF v.etapa IN ('desenvolvimento', 'validacao_presidencia') THEN
    RAISE EXCEPTION 'Este chamado ainda está na validação da Presidência. A avaliação abre depois do treinamento.';
  END IF;
  IF v.treinamento_solic_em IS NULL THEN
    RAISE EXCEPTION 'Confirme primeiro que recebeu o treinamento; depois avalie o atendimento.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_avaliacao_exige_treinamento() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_chamado_avaliacao_exige_treinamento ON public."CHAMADO_SISTEMA_AVALIACAO";
CREATE TRIGGER trg_chamado_avaliacao_exige_treinamento
  BEFORE INSERT ON public."CHAMADO_SISTEMA_AVALIACAO"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_avaliacao_exige_treinamento();

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_chamado_avaliacao_exige_treinamento ON public."CHAMADO_SISTEMA_AVALIACAO";
-- DROP FUNCTION IF EXISTS public.chamado_avaliacao_exige_treinamento();
-- -- Voltar a trava e a RPC de pendentes ao corpo da mig 20260810000001:
-- CREATE OR REPLACE FUNCTION public.chamado_sistema_bloqueia_avaliacao_pendente() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
-- BEGIN
--   IF EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.solicitante_id = NEW.solicitante_id AND c.status = 'concluido'
--              AND NOT EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_AVALIACAO" a WHERE a.chamado_id = c.id)) THEN
--     RAISE EXCEPTION 'Você tem chamados concluídos aguardando avaliação. Avalie-os antes de abrir um novo.';
--   END IF;
--   RETURN NEW;
-- END; $$;
-- DROP FUNCTION IF EXISTS public.chamados_meus_avaliacoes_pendentes();
-- CREATE OR REPLACE FUNCTION public.chamados_meus_avaliacoes_pendentes() RETURNS TABLE(id uuid, numero text, assunto text, concluido_em timestamptz)
-- LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
--   SELECT c.id, c.numero, c.assunto, c.concluido_em FROM public."CHAMADO_SISTEMA" c
--    WHERE c.solicitante_id = auth.uid() AND c.status = 'concluido'
--      AND NOT EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_AVALIACAO" a WHERE a.chamado_id = c.id)
--    ORDER BY c.concluido_em NULLS LAST; $$;
-- GRANT EXECUTE ON FUNCTION public.chamados_meus_avaliacoes_pendentes() TO authenticated;
-- DROP FUNCTION IF EXISTS public.chamado_pendencias_solicitante(uuid);
-- -- chamado_treinamento_confirmar: recriar a versão (uuid, text) da mig 266.
-- DROP FUNCTION IF EXISTS public.chamado_treinamento_confirmar(uuid, text, text);
-- NOTIFY pgrst, 'reload schema';
