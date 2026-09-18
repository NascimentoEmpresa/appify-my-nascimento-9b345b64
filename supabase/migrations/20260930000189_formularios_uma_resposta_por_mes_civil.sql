-- =========================================================================
-- Formulários: limite "1 resposta por MÊS" (calendário), não "a cada 30 dias"
--
-- PEDIDO (18/09/2026, Pablo)
--   O formulário estava com "1 resposta a cada 30 dias" (intervalo_horas =
--   720). Precisa ser 1 por mês civil: respondeu dia 30, dia 1 pode de novo.
--
-- O QUE MUDA
--   1. CS_FORMULARIOS.intervalo_mensal boolean: ligado, a régua é o mês
--      civil em America/Sao_Paulo (intervalo_horas fica NULL).
--   2. cs_form_pode_responder / cs_form_prazo entendem os dois modos. Mensal:
--      bloqueia se já há envio no mesmo ano-mês; "proxima_em" = dia 1 do mês
--      seguinte, 00:00 de Brasília.
--   3. O formulário de avaliação (0420161a…) passa de 720 h pra mensal.
--   A policy de INSERT de CS_FORM_RESPOSTAS chama cs_form_pode_responder —
--   não muda.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

ALTER TABLE public."CS_FORMULARIOS"
  ADD COLUMN IF NOT EXISTS intervalo_mensal boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public."CS_FORMULARIOS".intervalo_mensal IS
  '1 resposta por mês civil (Brasília). Exclusivo com intervalo_horas. 18/09/2026.';

CREATE OR REPLACE FUNCTION public.cs_form_pode_responder(_form_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1
      FROM public."CS_FORMULARIOS" f
      JOIN public."CS_FORM_ENVIOS" e
        ON e.formulario_id = f.id AND e.user_id = auth.uid()
     WHERE f.id = _form_id
       AND auth.uid() IS NOT NULL
       AND (
         (f.intervalo_mensal
            AND date_trunc('month', e.enviado_em AT TIME ZONE 'America/Sao_Paulo')
              = date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo'))
         OR (NOT f.intervalo_mensal AND f.intervalo_horas IS NOT NULL
            AND e.enviado_em > now() - make_interval(hours => f.intervalo_horas))
       ));
$$;

CREATE OR REPLACE FUNCTION public.cs_form_prazo(_form_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
           'pode', public.cs_form_pode_responder(_form_id),
           'intervalo_horas', f.intervalo_horas,
           'intervalo_mensal', f.intervalo_mensal,
           'ultima_em', u.ultima,
           'proxima_em', CASE
             WHEN u.ultima IS NULL THEN NULL
             WHEN f.intervalo_mensal THEN
               -- Dia 1 do mês seguinte ao do último envio, 00:00 de Brasília.
               ((date_trunc('month', u.ultima AT TIME ZONE 'America/Sao_Paulo') + interval '1 month') AT TIME ZONE 'America/Sao_Paulo')
             WHEN f.intervalo_horas IS NULL THEN NULL
             ELSE u.ultima + make_interval(hours => f.intervalo_horas) END)
    FROM public."CS_FORMULARIOS" f
    LEFT JOIN LATERAL (
      SELECT max(e.enviado_em) AS ultima
        FROM public."CS_FORM_ENVIOS" e
       WHERE e.formulario_id = f.id AND e.user_id = auth.uid()
    ) u ON true
   WHERE f.id = _form_id;
$$;

-- O formulário de avaliação: mensal.
UPDATE public."CS_FORMULARIOS"
   SET intervalo_mensal = true, intervalo_horas = NULL
 WHERE id = '0420161a-665e-42a4-9af6-c853a107f614' AND intervalo_horas = 720;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- UPDATE public."CS_FORMULARIOS" SET intervalo_horas = 720, intervalo_mensal = false WHERE id = '0420161a-665e-42a4-9af6-c853a107f614';
-- Reaplicar cs_form_pode_responder e cs_form_prazo da 20260902000001;
-- ALTER TABLE public."CS_FORMULARIOS" DROP COLUMN IF EXISTS intervalo_mensal;
-- NOTIFY pgrst, 'reload schema';
