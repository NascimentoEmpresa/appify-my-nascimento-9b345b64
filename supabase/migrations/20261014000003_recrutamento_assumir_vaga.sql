-- =========================================================================
-- RECRUTAMENTO: "TORNAR-ME RESPONSÁVEL" E FILTRO POR RESPONSÁVEL (14/10/2026)
--
-- PEDIDO (Pablo, Gestão Recrutamento): "mais um filtro — Responsável da
-- vaga; um botão em cada vaga 'Tornar-me responsável'; se torna responsável
-- automaticamente ao passar uma etapa; se já tiver alguém responsável,
-- pergunta 'tem certeza que deseja assumir a vaga?'. Só conta para vagas
-- que estão no Recrutamento ou na Seleção — Operacional não aparece."
--
-- O QUE MUDA em relação à mig 20261013000003 (responsável pela vaga):
--   · AUTOMÁTICO só preenche vaga SEM responsável. Antes, quem movesse a vaga
--     tomava o lugar de quem já cuidava dela; agora a troca é decisão de quem
--     move: a tela pergunta "tem certeza que deseja assumir a vaga?" e, se
--     sim, chama rec_responsavel_assumir. Se não, a etapa anda e o
--     responsável continua o mesmo;
--   · rec_responsavel_assumir(vaga): o próprio usuário assume (origem
--     'assumido'), só em vaga de Recrutamento/Seleção (rec_vaga_tem_responsavel)
--     e só quem conduz o Recrutamento (recrutamento_gestao › alterar, a mesma
--     regra do rec_responsavel_definir). Vai para o histórico da vaga;
--   · a escolha manual de outra pessoa (rec_responsavel_definir) continua.
--
-- Status de Recrutamento/Seleção = "Pendente Recrutamento" + os status
-- dirigidos pelo candidato (STATUS_PROCESSO de src/pages/rh/Recrutamento.tsx).
-- Pendente Operacional/Analista/Diretoria e as encerradas ficam de fora.
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

-- ── 1) Quais vagas têm responsável (a mesma lista do front) ─────────────
CREATE OR REPLACE FUNCTION public.rec_vaga_tem_responsavel(p_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(p_status, '') IN (
    'Pendente Recrutamento',
    'Vaga aberta - Seleção de Currículos', 'Em análise jurídica', 'Entrevista e Avaliação', 'Entrevista com Gestor',
    'Aprovado - Aguardando SST', 'Compras Confirmou - Aguardando Documentação', 'Aguardando SST e Compras',
    'Encaminhado para SST (ASO)', 'ASO Aprovado - Aguardando Informe de EPIs', 'Aguardando Confirmação Compras')
$$;

-- ── 2) Nova origem: 'assumido' ───────────────────────────────────────────
ALTER TABLE public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" DROP CONSTRAINT IF EXISTS "SISTEMA_RECRUTAMENTO_RESPONSAVEL_origem_check";
ALTER TABLE public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" ADD CONSTRAINT "SISTEMA_RECRUTAMENTO_RESPONSAVEL_origem_check"
  CHECK (origem IN ('automatico', 'manual', 'assumido'));

-- ── 3) Automático só preenche vaga sem responsável ──────────────────────
CREATE OR REPLACE FUNCTION public.rec_responsavel_pelo_historico()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_nome  text;
  v_atual public."SISTEMA_RECRUTAMENTO_RESPONSAVEL"%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NEW.solicitacao_id IS NULL OR NEW.papel IS DISTINCT FROM 'Recrutamento'
     OR (NEW.de_status IS NULL AND NEW.para_status IS NULL AND NEW.candidato_id IS NULL) THEN
    RETURN NULL;
  END IF;
  BEGIN
    SELECT * INTO v_atual FROM public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" WHERE vaga_id = NEW.solicitacao_id FOR UPDATE;
    -- 14/10/2026: já tem alguém → não troca sozinho (a tela pergunta e, se for
    -- o caso, chama rec_responsavel_assumir).
    IF v_atual.vaga_id IS NOT NULL AND v_atual.responsavel_id IS NOT NULL THEN
      RETURN NULL;
    END IF;
    v_nome := public.rec_nome_usuario(v_uid);
    INSERT INTO public."SISTEMA_RECRUTAMENTO_RESPONSAVEL"(vaga_id, responsavel_id, responsavel_nome, origem, atualizado_em, atualizado_por)
    VALUES (NEW.solicitacao_id, v_uid, v_nome, 'automatico', now(), v_uid)
    ON CONFLICT (vaga_id) DO UPDATE
       SET responsavel_id = EXCLUDED.responsavel_id, responsavel_nome = EXCLUDED.responsavel_nome,
           origem = 'automatico', atualizado_em = now(), atualizado_por = v_uid;
    -- Sem de/para/candidato: este evento não dispara o próprio gatilho de novo.
    INSERT INTO public."RECRUTAMENTO_HISTORICO"(solicitacao_id, evento, papel, usuario_nome, usuario_email, detalhe)
    VALUES (NEW.solicitacao_id, 'Responsável pela vaga: ' || v_nome || ' (automático)', 'Recrutamento',
            NEW.usuario_nome, NEW.usuario_email, 'Motivo: ' || NEW.evento);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'rec_responsavel_pelo_historico: %', SQLERRM;
  END;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.rec_responsavel_pelo_historico() FROM PUBLIC, anon, authenticated;

-- ── 4) "Tornar-me responsável" ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rec_responsavel_assumir(p_vaga bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_eu     text;
  v_email  text;
  v_status text;
  v_antes  public."SISTEMA_RECRUTAMENTO_RESPONSAVEL"%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.has_screen_access(v_uid, 'recrutamento_gestao', 'alterar'::public.app_acao) THEN
    RAISE EXCEPTION 'Só quem conduz o Recrutamento assume uma vaga.' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO v_status FROM public."SISTEMA_RECRUTAMENTO" WHERE id = p_vaga;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vaga #% não encontrada.', p_vaga; END IF;
  IF NOT public.rec_vaga_tem_responsavel(v_status) THEN
    RAISE EXCEPTION 'A vaga #% está em "%": só vagas no Recrutamento ou na Seleção têm responsável.', p_vaga, v_status USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_antes FROM public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" WHERE vaga_id = p_vaga FOR UPDATE;
  IF v_antes.responsavel_id = v_uid THEN
    RETURN to_jsonb(v_antes);   -- já é a pessoa
  END IF;
  v_eu := public.rec_nome_usuario(v_uid);
  SELECT email INTO v_email FROM public.profiles WHERE id = v_uid;

  INSERT INTO public."SISTEMA_RECRUTAMENTO_RESPONSAVEL"(vaga_id, responsavel_id, responsavel_nome, origem, atualizado_em, atualizado_por)
  VALUES (p_vaga, v_uid, v_eu, 'assumido', now(), v_uid)
  ON CONFLICT (vaga_id) DO UPDATE
     SET responsavel_id = EXCLUDED.responsavel_id, responsavel_nome = EXCLUDED.responsavel_nome,
         origem = 'assumido', atualizado_em = now(), atualizado_por = v_uid;
  INSERT INTO public."RECRUTAMENTO_HISTORICO"(solicitacao_id, evento, papel, usuario_nome, usuario_email, detalhe)
  VALUES (p_vaga, v_eu || ' assumiu a vaga', 'Recrutamento', v_eu, v_email,
          CASE WHEN v_antes.responsavel_nome IS NOT NULL THEN 'Antes: ' || v_antes.responsavel_nome END);

  RETURN (SELECT to_jsonb(r) FROM public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" r WHERE r.vaga_id = p_vaga);
END $fn$;
REVOKE ALL ON FUNCTION public.rec_responsavel_assumir(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_responsavel_assumir(bigint) TO authenticated;

-- ── 5) Contagem do filtro "Responsável da vaga" ─────────────────────────
-- Quantas vagas de Recrutamento/Seleção cada pessoa cuida (e quantas estão
-- sem ninguém), só das vagas que quem pergunta já enxerga (RLS da vaga).
CREATE OR REPLACE FUNCTION public.rec_responsaveis_contagem()
RETURNS TABLE(responsavel_id uuid, responsavel_nome text, vagas bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT r.responsavel_id, coalesce(r.responsavel_nome, 'Sem responsável'), count(*)
    FROM public."SISTEMA_RECRUTAMENTO" s
    LEFT JOIN public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" r ON r.vaga_id = s.id
   WHERE public.rec_vaga_tem_responsavel(s.status)
   GROUP BY 1, 2
   ORDER BY 3 DESC, 2
$$;
REVOKE ALL ON FUNCTION public.rec_responsaveis_contagem() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_responsaveis_contagem() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- rec_responsavel_pelo_historico: reaplicar a da mig 20261013000003 (troca o automático).
-- DROP FUNCTION IF EXISTS public.rec_responsaveis_contagem(), public.rec_responsavel_assumir(bigint), public.rec_vaga_tem_responsavel(text);
-- UPDATE "SISTEMA_RECRUTAMENTO_RESPONSAVEL" SET origem = 'manual' WHERE origem = 'assumido';
-- ALTER TABLE "SISTEMA_RECRUTAMENTO_RESPONSAVEL" DROP CONSTRAINT "SISTEMA_RECRUTAMENTO_RESPONSAVEL_origem_check";
-- ALTER TABLE "SISTEMA_RECRUTAMENTO_RESPONSAVEL" ADD CONSTRAINT "SISTEMA_RECRUTAMENTO_RESPONSAVEL_origem_check" CHECK (origem IN ('automatico', 'manual'));
