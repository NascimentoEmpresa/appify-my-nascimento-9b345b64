-- =========================================================================
-- Jurídico › ADVERTÊNCIAS — histórico com a data da solicitação (05/10/2026)
--
-- PEDIDO (Pablo): "sistema de advertência: adicionar histórico da data de
-- solicitação de advertência". A tela só mostrava a data do OCORRIDO; quando
-- a advertência foi pedida, aprovada, reprovada ou concluída não aparecia em
-- lugar nenhum (a tabela só guardava created_at e o status_changed_at da
-- ÚLTIMA mudança).
--
-- AGORA: "SISTEMA_ADVERTENCIA_HISTORICO" — uma linha por evento (solicitada,
-- cada mudança de status), com data/hora e quem fez, gravada por gatilho.
-- Leitura: quem enxerga a advertência enxerga o histórico dela (a policy
-- consulta a própria tabela de advertências, que já tem a RLS certa).
-- Escrita: só o gatilho.
--
-- BACKFILL das 23 que já existiam: o que dá para afirmar — a solicitação
-- (created_at, por solicitante_nome) e o status atual (status_changed_at,
-- por quem aprovou/concluiu). As etapas do meio dessas antigas não foram
-- guardadas na época e ficam de fora (marcado no detalhe).
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."SISTEMA_ADVERTENCIA_HISTORICO" (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  advertencia_id bigint NOT NULL REFERENCES public."SISTEMA_SOLICITACOES_ADVERTENCIA"(id) ON DELETE CASCADE,
  em             timestamptz NOT NULL DEFAULT now(),
  evento         text NOT NULL,
  de_status      text,
  para_status    text,
  usuario_id     uuid,
  usuario_nome   text,
  detalhe        text
);
CREATE INDEX IF NOT EXISTS idx_adv_historico_adv ON public."SISTEMA_ADVERTENCIA_HISTORICO"(advertencia_id, em);

ALTER TABLE public."SISTEMA_ADVERTENCIA_HISTORICO" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."SISTEMA_ADVERTENCIA_HISTORICO" FROM PUBLIC, anon;
GRANT SELECT ON public."SISTEMA_ADVERTENCIA_HISTORICO" TO authenticated;

DROP POLICY IF EXISTS adv_historico_select ON public."SISTEMA_ADVERTENCIA_HISTORICO";
CREATE POLICY adv_historico_select ON public."SISTEMA_ADVERTENCIA_HISTORICO" FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public."SISTEMA_SOLICITACOES_ADVERTENCIA" a WHERE a.id = advertencia_id));

-- ── Gatilho ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.adv_historico_registrar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_nome text;
BEGIN
  SELECT coalesce(nullif(btrim(display_name), ''), email) INTO v_nome FROM public.profiles WHERE id = auth.uid();
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public."SISTEMA_ADVERTENCIA_HISTORICO" (advertencia_id, em, evento, para_status, usuario_id, usuario_nome, detalhe)
    VALUES (NEW.id, coalesce(NEW.created_at, now()),
            CASE WHEN NEW.status = 'Registrada' THEN 'Advertência verbal registrada' ELSE 'Solicitação de advertência enviada' END,
            NEW.status, auth.uid(), coalesce(v_nome, NEW.solicitante_nome),
            concat_ws(' · ', NEW.tipo_advertencia, 'grau ' || NEW.grau, 'ocorrido em ' || to_char(NEW.data_ocorrido::date, 'DD/MM/YYYY')));
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public."SISTEMA_ADVERTENCIA_HISTORICO" (advertencia_id, evento, de_status, para_status, usuario_id, usuario_nome, detalhe)
    VALUES (NEW.id,
            CASE NEW.status
              WHEN 'Aguardando Jurídico' THEN 'Aprovada — enviada ao Jurídico'
              WHEN 'Reprovada'           THEN 'Reprovada'
              WHEN 'Concluída'           THEN 'Concluída pelo Jurídico'
              ELSE 'Status alterado para ' || coalesce(NEW.status, '—') END,
            OLD.status, NEW.status, auth.uid(),
            coalesce(v_nome, CASE WHEN NEW.status = 'Concluída' THEN NEW.concluido_por_nome ELSE NEW.aprovado_por_nome END),
            CASE NEW.status
              WHEN 'Reprovada' THEN nullif(btrim(coalesce(NEW.motivo_reprovacao, '')), '')
              WHEN 'Concluída' THEN nullif(concat_ws(' · ', NEW.resultado, NEW.parecer_juridico), '')
            END);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_adv_historico ON public."SISTEMA_SOLICITACOES_ADVERTENCIA";
CREATE TRIGGER trg_adv_historico AFTER INSERT OR UPDATE OF status ON public."SISTEMA_SOLICITACOES_ADVERTENCIA"
  FOR EACH ROW EXECUTE FUNCTION public.adv_historico_registrar();

-- ── Backfill das que já existiam (só se ainda não têm histórico) ─────────
INSERT INTO public."SISTEMA_ADVERTENCIA_HISTORICO" (advertencia_id, em, evento, para_status, usuario_nome, detalhe)
SELECT a.id, a.created_at,
       CASE WHEN a.tipo_advertencia ILIKE 'verbal%' AND a.status = 'Registrada' THEN 'Advertência verbal registrada' ELSE 'Solicitação de advertência enviada' END,
       CASE WHEN a.status = 'Registrada' THEN 'Registrada' ELSE 'Aguardando Aprovação' END,
       a.solicitante_nome,
       concat_ws(' · ', a.tipo_advertencia, 'grau ' || a.grau, 'ocorrido em ' || to_char(a.data_ocorrido::date, 'DD/MM/YYYY'))
  FROM public."SISTEMA_SOLICITACOES_ADVERTENCIA" a
 WHERE NOT EXISTS (SELECT 1 FROM public."SISTEMA_ADVERTENCIA_HISTORICO" h WHERE h.advertencia_id = a.id);

INSERT INTO public."SISTEMA_ADVERTENCIA_HISTORICO" (advertencia_id, em, evento, para_status, usuario_nome, detalhe)
SELECT a.id, a.status_changed_at,
       CASE a.status WHEN 'Aguardando Jurídico' THEN 'Aprovada — enviada ao Jurídico'
                     WHEN 'Reprovada' THEN 'Reprovada' WHEN 'Concluída' THEN 'Concluída pelo Jurídico' END,
       a.status,
       CASE WHEN a.status = 'Concluída' THEN coalesce(a.concluido_por_nome, a.aprovado_por_nome) ELSE a.aprovado_por_nome END,
       concat_ws(' · ', CASE a.status WHEN 'Reprovada' THEN a.motivo_reprovacao WHEN 'Concluída' THEN a.resultado END,
                 'registro reconstruído — as etapas intermediárias não eram guardadas antes de 05/10/2026')
  FROM public."SISTEMA_SOLICITACOES_ADVERTENCIA" a
 WHERE a.status IN ('Aguardando Jurídico', 'Reprovada', 'Concluída')
   AND a.status_changed_at IS NOT NULL
   AND (SELECT count(*) FROM public."SISTEMA_ADVERTENCIA_HISTORICO" h WHERE h.advertencia_id = a.id) = 1;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS trg_adv_historico ON public."SISTEMA_SOLICITACOES_ADVERTENCIA";
-- DROP FUNCTION IF EXISTS public.adv_historico_registrar();
-- DROP TABLE IF EXISTS public."SISTEMA_ADVERTENCIA_HISTORICO";
