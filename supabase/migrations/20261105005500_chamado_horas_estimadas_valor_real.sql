-- =========================================================================
-- CHAMADOS ANTIGOS SEM HORAS: HORAS ESTIMADAS PELA COMPLEXIDADE (05/11/2026)
--
-- Pablo: "atualiza todos valores dos desenvolvimentos pra esses em verde,
-- valor realista atual, pode supor as horas que foram gastas nos
-- desenvolvimentos anteriores. tem alguns valores absurdos ainda antigos".
--
-- O card verde do parecer ("Valor real gasto") é horas_gastas × hora do
-- salário (src/lib/chamados/parecerHorasGastas.ts). Chamado concluído antes
-- da regra das horas (mig 20261029002400) ou pela PR não tem horas_gastas,
-- e aí a tela mostra a estimativa antiga da I.A — de onde vinham os valores
-- absurdos (20 h × R$ 320 numa tela pequena).
--
-- Regra escolhida pelo Pablo (05/11): horas pela COMPLEXIDADE do parecer
--   1 → 2 h · 2 → 4 h · 3 → 6 h · 4 → 12 h · 5 → 24 h
--   sem parecer/complexidade → 6 h (média)
-- e MARCADAS como estimadas (horas_gastas_estimadas = true), para relatório
-- de horas não confundir suposição com hora informada pelo dev. Se o dev
-- informar as horas de verdade depois, a marca cai sozinha (gatilho abaixo).
--
-- Os preços gravados do parecer são refeitos pelas horas, igual à mig
-- 20261030000300 (valor/hora e fator de complexidade de cada perfil
-- continuam; muda só as horas). SEM chamar a I.A: os gatilhos do chamado
-- ficam desligados durante o UPDATE (session_replication_role), senão cada
-- linha enfileiraria um parecer novo, mexeria em updated_at ("última
-- atualização") e passaria pelos guardas de edição.
-- =========================================================================

ALTER TABLE public."CHAMADO_SISTEMA"
  ADD COLUMN IF NOT EXISTS horas_gastas_estimadas boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public."CHAMADO_SISTEMA".horas_gastas_estimadas IS
  'true = horas_gastas SUPOSTAS pela complexidade do parecer da I.A (mig 20261105005500), não informadas pelo desenvolvedor. Cai para false quando alguém informa as horas.';

-- ── 1) Horas estimadas nos concluídos sem horas ──────────────────────────
SET LOCAL session_replication_role = replica;

UPDATE public."CHAMADO_SISTEMA" c
   SET horas_gastas = CASE coalesce((SELECT p.complexidade_nivel FROM public."CHAMADO_SISTEMA_PARECER_IA" p
                                      WHERE p.chamado_id = c.id), 3)
                        WHEN 1 THEN 2 WHEN 2 THEN 4 WHEN 3 THEN 6 WHEN 4 THEN 12 ELSE 24 END,
       horas_gastas_estimadas = true,
       horas_gastas_por = NULL,
       horas_gastas_em  = coalesce(c.concluido_em, now())
 WHERE c.status = 'concluido'
   AND c.horas_gastas IS NULL;

-- ── 2) Preços do parecer pelas horas (mesma conta da mig 20261030000300) ──
WITH base AS (
  SELECT p.chamado_id, round(least(6000, greatest(0.5, c.horas_gastas)), 1) AS horas
    FROM public."CHAMADO_SISTEMA_PARECER_IA" p
    JOIN public."CHAMADO_SISTEMA" c ON c.id = p.chamado_id
   WHERE p.status = 'pronto'
     AND jsonb_typeof(p.precos) = 'array'
     AND c.horas_gastas_estimadas
), novos AS (
  SELECT b.chamado_id, b.horas,
         jsonb_agg(
           x.item || jsonb_build_object(
             'horas', b.horas,
             'valor', round(b.horas * (x.item->>'valor_hora')::numeric
                            * coalesce((x.item->>'fator_complexidade')::numeric, 1), 2))
           ORDER BY x.ord) AS precos
    FROM base b
    JOIN public."CHAMADO_SISTEMA_PARECER_IA" p ON p.chamado_id = b.chamado_id
    CROSS JOIN LATERAL jsonb_array_elements(p.precos) WITH ORDINALITY AS x(item, ord)
   WHERE (x.item->>'valor_hora') ~ '^[0-9]+(\.[0-9]+)?$'
     AND coalesce(x.item->>'fator_complexidade', '1') ~ '^[0-9]+(\.[0-9]+)?$'
   GROUP BY b.chamado_id, b.horas
  HAVING count(*) = 3
)
UPDATE public."CHAMADO_SISTEMA_PARECER_IA" p
   SET precos = n.precos,
       valor_medio = (SELECT round(avg((e->>'valor')::numeric), 2) FROM jsonb_array_elements(n.precos) e),
       horas_estimadas = n.horas,
       updated_at = now()
  FROM novos n
 WHERE n.chamado_id = p.chamado_id;

SET LOCAL session_replication_role = origin;

-- ── 3) Hora informada de verdade derruba a marca de estimada ─────────────
-- Mesmo corpo da mig 20261029002400, + as duas linhas de horas_gastas_estimadas.
CREATE OR REPLACE FUNCTION public.chamado_horas_gastas_exige()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Fora de 'concluido' não há horas (reabrir zera).
  IF NEW.status IS DISTINCT FROM 'concluido' THEN
    NEW.horas_gastas := NULL;
    NEW.horas_gastas_por := NULL;
    NEW.horas_gastas_em := NULL;
    NEW.horas_gastas_estimadas := false;
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM 'concluido' AND NEW.horas_gastas IS NULL AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Informe as horas gastas para concluir o chamado.'
      USING ERRCODE = '23514', HINT = 'Campo "Horas gastas", maior que zero (aceita meia hora, ex.: 12,5).';
  END IF;

  IF NEW.horas_gastas IS NOT NULL AND NEW.horas_gastas IS DISTINCT FROM OLD.horas_gastas THEN
    NEW.horas_gastas_por := auth.uid();
    NEW.horas_gastas_em := now();
    NEW.horas_gastas_estimadas := false;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.chamado_horas_gastas_exige() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   SET LOCAL session_replication_role = replica;
--   UPDATE public."CHAMADO_SISTEMA"
--      SET horas_gastas = NULL, horas_gastas_por = NULL, horas_gastas_em = NULL
--    WHERE horas_gastas_estimadas;
--   SET LOCAL session_replication_role = origin;
--   (os preços dos pareceres não voltam sozinhos: as horas que a I.A tinha
--    estimado foram sobrescritas — mesma situação da mig 20261030000300)
--   CREATE OR REPLACE FUNCTION public.chamado_horas_gastas_exige() ... corpo da mig 20261029002400
--   ALTER TABLE public."CHAMADO_SISTEMA" DROP COLUMN IF EXISTS horas_gastas_estimadas;
--   NOTIFY pgrst, 'reload schema';
-- =========================================================================
