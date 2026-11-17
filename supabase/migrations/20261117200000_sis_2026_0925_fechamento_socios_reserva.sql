-- SIS-2026-0925 — Fechamento dos Sócios: Reserva de Investimento (%) por competência, antes da distribuição do lucro
-- ============================================================================
-- O Total a Distribuir passa a partir do Resultado do Período: Resultado − Reserva de Investimento = Total a Distribuir, dividido pelos percentuais dos sócios.
-- A conta é feita na tela; aqui ficam só os DADOS:
--   fechamento_socio_reserva                 : percentual de reserva de UMA competência ainda ABERTA (sem linha = 0%). Quem altera: 'fechamento-socios-percentual'.
--   fechamento_socio_competencia.reserva_*   : na competência FECHADA o percentual e o valor reservado ficam gravados na foto do fechamento (histórico da decisão).
-- Reabrir o mês devolve o percentual gravado à tabela de competências abertas (a decisão não se perde); isso é feito pela tela.
-- Acesso: o mesmo do percentual dos sócios (deny-by-default, nada novo no app_menu). (SELECT ...) em volta de auth.uid()/has_screen_access (guardião de desempenho).
-- Idempotente. NOTIFY ao final.
--
-- ROLLBACK:
--   ALTER TABLE public.fechamento_socio_competencia DROP COLUMN IF EXISTS reserva_percentual, DROP COLUMN IF EXISTS reserva_valor;
--   DROP TABLE IF EXISTS public.fechamento_socio_reserva;
--   NOTIFY pgrst, 'reload schema';

CREATE TABLE IF NOT EXISTS public.fechamento_socio_reserva (
  competencia date PRIMARY KEY CHECK (extract(day FROM competencia) = 1),
  percentual numeric(7,4) NOT NULL CHECK (percentual >= 0 AND percentual <= 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.fechamento_socio_reserva ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fechamento_socio_reserva_select ON public.fechamento_socio_reserva;
CREATE POLICY fechamento_socio_reserva_select ON public.fechamento_socio_reserva FOR SELECT TO authenticated
  USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-socios', 'visualizar'::public.app_acao)));
DROP POLICY IF EXISTS fechamento_socio_reserva_escrita ON public.fechamento_socio_reserva;
CREATE POLICY fechamento_socio_reserva_escrita ON public.fechamento_socio_reserva FOR ALL TO authenticated
  USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-socios-percentual', 'alterar'::public.app_acao)))
  WITH CHECK ((SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-socios-percentual', 'alterar'::public.app_acao)));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fechamento_socio_reserva TO authenticated;

ALTER TABLE public.fechamento_socio_competencia
  ADD COLUMN IF NOT EXISTS reserva_percentual numeric(7,4) NOT NULL DEFAULT 0 CHECK (reserva_percentual >= 0 AND reserva_percentual <= 100),
  ADD COLUMN IF NOT EXISTS reserva_valor numeric(16,2) NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
