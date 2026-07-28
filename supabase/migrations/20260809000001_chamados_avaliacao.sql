-- =====================================================================
-- CHAMADOS DE SISTEMAS — avaliação do solicitante ao concluir.
--
-- Quando o chamado é concluído, o solicitante avalia de 1 a 5 estrelas
-- (descrição opcional). Uma avaliação por chamado. Enquanto houver chamado
-- concluído SEM avaliação, o solicitante NÃO pode abrir novo chamado — regra
-- enforçada por trigger (além do bloqueio na UI).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public."CHAMADO_SISTEMA_AVALIACAO" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chamado_id     uuid NOT NULL UNIQUE REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE CASCADE,
  solicitante_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  estrelas       smallint NOT NULL CHECK (estrelas BETWEEN 1 AND 5),
  comentario     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public."CHAMADO_SISTEMA_AVALIACAO" ENABLE ROW LEVEL SECURITY;

-- Ver: solicitante do chamado, responsável ou gestão.
DROP POLICY IF EXISTS chamado_avaliacao_select ON public."CHAMADO_SISTEMA_AVALIACAO";
CREATE POLICY chamado_avaliacao_select ON public."CHAMADO_SISTEMA_AVALIACAO"
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id
                 AND (c.solicitante_id = auth.uid() OR c.responsavel_id = auth.uid()
                      OR public.chamado_sistema_gestor())));

-- Inserir: só o solicitante, e só de chamado próprio já concluído.
DROP POLICY IF EXISTS chamado_avaliacao_insert ON public."CHAMADO_SISTEMA_AVALIACAO";
CREATE POLICY chamado_avaliacao_insert ON public."CHAMADO_SISTEMA_AVALIACAO"
  FOR INSERT TO authenticated
  WITH CHECK (solicitante_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id
      AND c.solicitante_id = auth.uid() AND c.status = 'concluido'));

-- Lista de avaliações pendentes do solicitante atual (chamados concluídos sem avaliação).
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

-- Bloqueia abertura de novo chamado enquanto o solicitante tiver avaliação pendente.
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
