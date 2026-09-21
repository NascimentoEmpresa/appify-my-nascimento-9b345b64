-- =====================================================================
-- SIS-2026-0463 — GRADE: empresa opcional nos primeiros status
--
-- Ao lançar a inicial de um edital na Grade, ainda não se sabe por qual
-- empresa do grupo vamos participar — isso só se define quando o edital
-- avança para "Em Andamento". Hoje `grade.empresa_id` é NOT NULL, então o
-- cadastro neutro é impossível. Tornamos a coluna nullable; a obrigatoriedade
-- a partir de "Em Andamento" é validada no frontend (GradeSheet) e a promoção
-- para Capa continua exigindo empresa (a Capa é NOT NULL).
--
-- RLS de insert/update da grade é can_access('pipeline', ...) — não filtra por
-- empresa —, então empresa nula passa sem problema.
-- =====================================================================

ALTER TABLE public.grade ALTER COLUMN empresa_id DROP NOT NULL;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK (só é seguro se não houver linhas com empresa_id nulo):
--   ALTER TABLE public.grade ALTER COLUMN empresa_id SET NOT NULL;
-- =====================================================================
