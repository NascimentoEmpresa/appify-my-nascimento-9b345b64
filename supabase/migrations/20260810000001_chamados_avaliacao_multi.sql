-- =====================================================================
-- CHAMADOS DE SISTEMAS — avaliação MULTI-CRITÉRIO (redesenho).
-- Substitui a avaliação de nota única por 5 critérios (1..5) + comentário.
-- Self-contained e idempotente: recria a tabela, RLS, a RPC de pendentes e o
-- trigger que bloqueia abrir novo chamado com avaliação pendente.
-- (Como ainda é fase de teste, recriar a tabela não perde dado relevante.)
-- =====================================================================

DROP TABLE IF EXISTS public."CHAMADO_SISTEMA_AVALIACAO" CASCADE;

CREATE TABLE public."CHAMADO_SISTEMA_AVALIACAO" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chamado_id     uuid NOT NULL UNIQUE REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE CASCADE,
  solicitante_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  atendimento    smallint NOT NULL CHECK (atendimento BETWEEN 1 AND 5),
  tempo          smallint NOT NULL CHECK (tempo       BETWEEN 1 AND 5),
  solucao        smallint NOT NULL CHECK (solucao     BETWEEN 1 AND 5),
  clareza        smallint NOT NULL CHECK (clareza     BETWEEN 1 AND 5),
  satisfacao     smallint NOT NULL CHECK (satisfacao  BETWEEN 1 AND 5),
  comentario     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public."CHAMADO_SISTEMA_AVALIACAO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chamado_avaliacao_select ON public."CHAMADO_SISTEMA_AVALIACAO";
CREATE POLICY chamado_avaliacao_select ON public."CHAMADO_SISTEMA_AVALIACAO"
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id
                 AND (c.solicitante_id = auth.uid() OR c.responsavel_id = auth.uid()
                      OR public.chamado_sistema_gestor())));

DROP POLICY IF EXISTS chamado_avaliacao_insert ON public."CHAMADO_SISTEMA_AVALIACAO";
CREATE POLICY chamado_avaliacao_insert ON public."CHAMADO_SISTEMA_AVALIACAO"
  FOR INSERT TO authenticated
  WITH CHECK (solicitante_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id
      AND c.solicitante_id = auth.uid() AND c.status = 'concluido'));

-- Pendentes do solicitante atual (concluídos sem avaliação).
CREATE OR REPLACE FUNCTION public.chamados_meus_avaliacoes_pendentes()
RETURNS TABLE(id uuid, numero text, assunto text, concluido_em timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT c.id, c.numero, c.assunto, c.concluido_em
    FROM public."CHAMADO_SISTEMA" c
   WHERE c.solicitante_id = auth.uid()
     AND c.status = 'concluido'
     AND NOT EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_AVALIACAO" a WHERE a.chamado_id = c.id)
   ORDER BY c.concluido_em NULLS LAST;
$$;
REVOKE ALL ON FUNCTION public.chamados_meus_avaliacoes_pendentes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamados_meus_avaliacoes_pendentes() FROM anon;
GRANT EXECUTE ON FUNCTION public.chamados_meus_avaliacoes_pendentes() TO authenticated;

-- Bloqueia abrir novo chamado com avaliação pendente.
CREATE OR REPLACE FUNCTION public.chamado_sistema_bloqueia_avaliacao_pendente()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public."CHAMADO_SISTEMA" c
     WHERE c.solicitante_id = NEW.solicitante_id
       AND c.status = 'concluido'
       AND NOT EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_AVALIACAO" a WHERE a.chamado_id = c.id)
  ) THEN
    RAISE EXCEPTION 'Você tem chamados concluídos aguardando avaliação. Avalie-os antes de abrir um novo.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chamado_bloqueia_avaliacao ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_bloqueia_avaliacao
  BEFORE INSERT ON public."CHAMADO_SISTEMA"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_sistema_bloqueia_avaliacao_pendente();

NOTIFY pgrst, 'reload schema';
