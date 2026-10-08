-- =========================================================================
-- RECRUTAMENTO — STATUS DETALHADO PELA ETAPA DO KANBAN (08/10/2026)
--
-- PEDIDO (Pablo): "preciso que apareça os status em detalhe: tá Pendente
-- Recrutamento, mas quando o recrutamento move o kanban deve ficar
-- Recrutamento: TRIAGEM, e por assim vai, de acordo com os status do
-- kanban, e vai mudando de cor, e deve aparecer pra todos que estão
-- envolvidos na vaga".
--
-- O status da vaga (SISTEMA_RECRUTAMENTO.status) é grosso de propósito: o
-- sr_sync_status_solicitacao junta ENTRADA e TRIAGEM em "Vaga aberta -
-- Seleção de Currículos", e com a vaga ainda em Pendente Recrutamento ele
-- nem mexe. A etapa fina mora no candidato (WA_CURRICULOS.etapa_processo) —
-- e a RLS do candidato (wa_curriculos_gate) só deixa ver quem é do
-- Recrutamento/SST/Suprimentos: o solicitante e o Operacional não leem.
--
-- Por isso esta tabela à parte, uma linha por vaga, com a etapa do
-- candidato MAIS ADIANTADO (a mesma régua do sr_sync_status_solicitacao:
-- sr_rank_etapa, sem Reprovado/desistente), quantos estão no processo e
-- quantos em cada etapa. Quem mantém é um gatilho no candidato.
--
-- QUEM VÊ: quem vê a vaga. A política só pergunta "a vaga é visível para
-- você?" (EXISTS na SISTEMA_RECRUTAMENTO, que aplica a RLS da própria vaga)
-- — solicitante, Operacional, Recrutamento, Diretoria: cada um enxerga a
-- etapa das vagas que já enxerga, nem uma a mais.
--
-- Por que NÃO uma coluna na SISTEMA_RECRUTAMENTO: todo UPDATE na vaga passa
-- pelo sistema_recrutamento_guard (quem não é gestor só muda a data de
-- início) e pelo rec_historico_automatico (registra "Solicitação editada").
-- Uma coluna nova atualizada pelo gatilho do candidato faria o SST/Compras
-- aprovarem o candidato e a vaga recusar a atualização — o kanban travaria.
-- Aqui nenhum gatilho da vaga roda, e o recálculo nunca derruba a
-- movimentação do candidato (erro vira WARNING).
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── 1) A etapa de cada vaga ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SISTEMA_RECRUTAMENTO_ETAPA" (
  vaga_id       bigint PRIMARY KEY REFERENCES public."SISTEMA_RECRUTAMENTO"(id) ON DELETE CASCADE,
  -- Etapa do candidato mais adiantado, já com os nomes antigos convertidos
  -- (APROVADOS → APROVADO; EXAME SST / COMPRAS → SST + COMPRAS).
  etapa         text NOT NULL,
  -- Candidatos no processo (sem reprovado/desistente) e quantos por etapa.
  candidatos    integer NOT NULL DEFAULT 0,
  por_etapa     jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Desde quando a vaga está NESTA etapa: quando o primeiro candidato que
  -- está nela chegou (etapa_changed_at); só muda quando a etapa muda.
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public."SISTEMA_RECRUTAMENTO_ETAPA" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."SISTEMA_RECRUTAMENTO_ETAPA" FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public."SISTEMA_RECRUTAMENTO_ETAPA" TO authenticated;

DROP POLICY IF EXISTS sistema_recrutamento_etapa_select ON public."SISTEMA_RECRUTAMENTO_ETAPA";
CREATE POLICY sistema_recrutamento_etapa_select ON public."SISTEMA_RECRUTAMENTO_ETAPA" FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public."SISTEMA_RECRUTAMENTO" r WHERE r.id = vaga_id));

-- ── 2) Nome da etapa sem as grafias antigas ─────────────────────────────
CREATE OR REPLACE FUNCTION public.rec_etapa_normalizada(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p
    WHEN 'APROVADOS' THEN 'APROVADO'
    WHEN 'EXAME SST' THEN 'SST + COMPRAS'
    WHEN 'COMPRAS'   THEN 'SST + COMPRAS'
    ELSE p END
$$;

-- ── 3) Recalcula a etapa de uma vaga ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rec_etapa_vaga_recalcular(p_vaga bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_etapa text; v_n integer; v_por jsonb; v_desde timestamptz;
BEGIN
  IF p_vaga IS NULL THEN RETURN; END IF;
  -- Candidato apontando para vaga que não existe (legado): nada a guardar.
  IF NOT EXISTS (SELECT 1 FROM public."SISTEMA_RECRUTAMENTO" WHERE id = p_vaga) THEN RETURN; END IF;

  WITH c AS (
    SELECT public.rec_etapa_normalizada(etapa_processo) AS e, public.sr_rank_etapa(etapa_processo) AS r, etapa_changed_at AS em
      FROM public."WA_CURRICULOS"
     WHERE vaga_id = p_vaga
       AND etapa_processo IS NOT NULL
       AND etapa_processo <> 'Reprovado'
       AND public.sr_rank_etapa(etapa_processo) > 0
  ), g AS (
    SELECT e, max(r) AS r, count(*)::int AS n, min(em) AS desde FROM c GROUP BY e
  )
  -- "Desde": quando o primeiro candidato que está nessa etapa chegou nela.
  SELECT (SELECT e FROM g ORDER BY r DESC LIMIT 1),
         (SELECT sum(n)::int FROM g),
         (SELECT jsonb_object_agg(e, n) FROM g),
         (SELECT desde FROM g ORDER BY r DESC LIMIT 1)
    INTO v_etapa, v_n, v_por, v_desde;

  IF v_etapa IS NULL THEN
    DELETE FROM public."SISTEMA_RECRUTAMENTO_ETAPA" WHERE vaga_id = p_vaga;
    RETURN;
  END IF;

  INSERT INTO public."SISTEMA_RECRUTAMENTO_ETAPA" AS t (vaga_id, etapa, candidatos, por_etapa, atualizado_em)
  VALUES (p_vaga, v_etapa, coalesce(v_n, 0), coalesce(v_por, '{}'::jsonb), coalesce(v_desde, now()))
  ON CONFLICT (vaga_id) DO UPDATE
     SET etapa         = EXCLUDED.etapa,
         candidatos    = EXCLUDED.candidatos,
         por_etapa     = EXCLUDED.por_etapa,
         atualizado_em = CASE WHEN t.etapa IS DISTINCT FROM EXCLUDED.etapa THEN EXCLUDED.atualizado_em ELSE t.atualizado_em END;
END $$;
REVOKE ALL ON FUNCTION public.rec_etapa_vaga_recalcular(bigint) FROM PUBLIC, anon, authenticated;

-- ── 4) Gatilho no candidato ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rec_etapa_vaga_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- O painel nunca pode travar o kanban: qualquer erro aqui vira aviso no
  -- log e a movimentação do candidato segue.
  BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      PERFORM public.rec_etapa_vaga_recalcular(OLD.vaga_id);
    END IF;
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.vaga_id IS DISTINCT FROM OLD.vaga_id) THEN
      PERFORM public.rec_etapa_vaga_recalcular(NEW.vaga_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'rec_etapa_vaga_sync: %', SQLERRM;
  END;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.rec_etapa_vaga_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_rec_etapa_vaga_sync ON public."WA_CURRICULOS";
CREATE TRIGGER trg_rec_etapa_vaga_sync
  AFTER INSERT OR DELETE OR UPDATE OF etapa_processo, vaga_id ON public."WA_CURRICULOS"
  FOR EACH ROW EXECUTE FUNCTION public.rec_etapa_vaga_sync();

-- ── 5) Carga inicial ────────────────────────────────────────────────────
-- Recomeça do zero (reexecutar a migration refaz o "desde" pelos candidatos).
DELETE FROM public."SISTEMA_RECRUTAMENTO_ETAPA";
SELECT public.rec_etapa_vaga_recalcular(v.vaga_id)
  FROM (SELECT DISTINCT vaga_id FROM public."WA_CURRICULOS" WHERE vaga_id IS NOT NULL) v;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS trg_rec_etapa_vaga_sync ON public."WA_CURRICULOS";
-- DROP FUNCTION IF EXISTS public.rec_etapa_vaga_sync();
-- DROP FUNCTION IF EXISTS public.rec_etapa_vaga_recalcular(bigint);
-- DROP FUNCTION IF EXISTS public.rec_etapa_normalizada(text);
-- DROP TABLE IF EXISTS public."SISTEMA_RECRUTAMENTO_ETAPA";
