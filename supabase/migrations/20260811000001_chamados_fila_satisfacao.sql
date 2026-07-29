-- =====================================================================
-- CHAMADOS DE SISTEMAS — Posição na fila (FIFO) + Ranking de satisfação.
--
-- 1) chamados_posicao_fila(): posição do chamado na fila global de ATIVOS,
--    por ordem de abertura (o mais antigo aberto é o nº 1). Retorna só as
--    posições dos chamados do próprio usuário (como solicitante) ou atribuídos
--    a ele (como responsável) — SECURITY DEFINER para calcular a posição no
--    total sem expor o conteúdo dos chamados dos outros.
--
-- 2) chamados_ranking_satisfacao(): média por responsável dos 5 critérios da
--    avaliação (depende da migração 20260810000001 — avaliação multi-critério).
--    Usada no ranking de satisfação e nas médias por item.
--
-- Idempotente. Aplicar DEPOIS de 20260810000001_chamados_avaliacao_multi.sql.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.chamados_posicao_fila()
RETURNS TABLE(chamado_id uuid, posicao int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH fila AS (
    SELECT id, solicitante_id, responsavel_id,
           row_number() OVER (ORDER BY created_at ASC, id ASC) AS pos
      FROM public."CHAMADO_SISTEMA"
     WHERE status NOT IN ('concluido', 'reprovado')
  )
  SELECT id, pos::int
    FROM fila
   WHERE solicitante_id = auth.uid() OR responsavel_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.chamados_posicao_fila() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamados_posicao_fila() FROM anon;
GRANT EXECUTE ON FUNCTION public.chamados_posicao_fila() TO authenticated;

CREATE OR REPLACE FUNCTION public.chamados_ranking_satisfacao()
RETURNS TABLE(
  responsavel_id uuid,
  avaliacoes     bigint,
  media          numeric,
  atendimento    numeric,
  tempo          numeric,
  solucao        numeric,
  clareza        numeric,
  satisfacao     numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT c.responsavel_id,
         count(*)::bigint,
         avg((a.atendimento + a.tempo + a.solucao + a.clareza + a.satisfacao) / 5.0)::numeric,
         avg(a.atendimento)::numeric,
         avg(a.tempo)::numeric,
         avg(a.solucao)::numeric,
         avg(a.clareza)::numeric,
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
