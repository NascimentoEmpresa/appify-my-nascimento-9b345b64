-- =====================================================================
-- CHAMADOS DE SISTEMAS — avaliação com NOTA FINAL PONDERADA (6 critérios).
-- Substitui os critérios antigos (atendimento/tempo/solução) pelos novos, com
-- os pesos definidos para a nota final:
--   Qualidade 0,30 · Prazo 0,20 · Comunicação 0,15 · Clareza 0,10 ·
--   Facilidade 0,10 · Satisfação 0,15  (soma = 1,00).
-- Fase de teste: limpa as avaliações antigas (critérios incompatíveis).
-- Idempotente. Aplicar DEPOIS de 20260810000001 e 20260811000001.
-- =====================================================================

DROP FUNCTION IF EXISTS public.chamados_ranking_satisfacao();

-- Limpa as avaliações antigas SÓ na primeira execução (quando o schema antigo
-- ainda existe). Assim re-rodar a migration não apaga avaliações novas.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'CHAMADO_SISTEMA_AVALIACAO'
               AND column_name = 'atendimento') THEN
    TRUNCATE public."CHAMADO_SISTEMA_AVALIACAO";
  END IF;
END $$;

ALTER TABLE public."CHAMADO_SISTEMA_AVALIACAO"
  DROP COLUMN IF EXISTS atendimento,
  DROP COLUMN IF EXISTS tempo,
  DROP COLUMN IF EXISTS solucao,
  ADD COLUMN IF NOT EXISTS qualidade   smallint NOT NULL CHECK (qualidade   BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS prazo       smallint NOT NULL CHECK (prazo       BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS comunicacao smallint NOT NULL CHECK (comunicacao BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS facilidade  smallint NOT NULL CHECK (facilidade  BETWEEN 1 AND 5);
-- clareza e satisfacao permanecem (mesmos nomes de coluna).

-- Ranking: nota final ponderada + média por critério, por responsável.
CREATE FUNCTION public.chamados_ranking_satisfacao()
RETURNS TABLE(
  responsavel_id uuid,
  avaliacoes     bigint,
  media          numeric,
  qualidade      numeric,
  prazo          numeric,
  comunicacao    numeric,
  clareza        numeric,
  facilidade     numeric,
  satisfacao     numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT c.responsavel_id,
         count(*)::bigint,
         avg(a.qualidade * 0.30 + a.prazo * 0.20 + a.comunicacao * 0.15
             + a.clareza * 0.10 + a.facilidade * 0.10 + a.satisfacao * 0.15)::numeric,
         avg(a.qualidade)::numeric,
         avg(a.prazo)::numeric,
         avg(a.comunicacao)::numeric,
         avg(a.clareza)::numeric,
         avg(a.facilidade)::numeric,
         avg(a.satisfacao)::numeric
    FROM public."CHAMADO_SISTEMA_AVALIACAO" a
    JOIN public."CHAMADO_SISTEMA" c ON c.id = a.chamado_id
   WHERE c.responsavel_id IS NOT NULL
   GROUP BY c.responsavel_id
   ORDER BY 3 DESC NULLS LAST, 2 DESC;
$$;
REVOKE ALL ON FUNCTION public.chamados_ranking_satisfacao() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamados_ranking_satisfacao() FROM anon;
GRANT EXECUTE ON FUNCTION public.chamados_ranking_satisfacao() TO authenticated;

NOTIFY pgrst, 'reload schema';
