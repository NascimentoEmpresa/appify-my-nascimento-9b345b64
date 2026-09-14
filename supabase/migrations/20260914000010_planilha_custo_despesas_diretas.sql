-- =====================================================================
-- PLANILHA DE CUSTO — Despesas Diretas (instalação)
--
-- Traz pro ERP 5 rubricas que existiam só no Excel (Base de Contratos
-- Vigentes.xlsm, aba "Banco de Dados", colunas DE–DI) e que o importador
-- ignorava (o mapa parava na coluna DB = Dedução VT):
--   DE ALUGUEL · DF ÁGUA · DG LUZ · DH INTERNET · DI DEMAIS DESPESAS DIRETAS
--
-- Hoje só o contrato CANAA usa essas colunas (16 postos × ORÇADO/EXECUTADO,
-- todos com valores idênticos). São despesas diretas de instalação e, segundo
-- o Iury, entram no custo como as demais rubricas — por isso somam no total
-- da composição na tela. As colunas nascem 0 pra todo mundo, sem impacto nos
-- outros contratos.
-- =====================================================================

-- ── 1. Colunas ───────────────────────────────────────────────────────────────
ALTER TABLE public.planilha_custo
  ADD COLUMN IF NOT EXISTS aluguel                 numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agua                    numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS luz                     numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS internet                numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS demais_despesas_diretas numeric NOT NULL DEFAULT 0;

-- ── 2. Backfill do CANAA ─────────────────────────────────────────────────────
-- As 16 linhas do contrato têm os MESMOS valores no Excel, então é um UPDATE
-- único por contrato_id (04c313f8… = "CANAA"). Idempotente: reexecutar só
-- regrava os mesmos números.
UPDATE public.planilha_custo
   SET aluguel                 = 322.22,
       agua                    = 25.67,
       luz                     = 49.94,
       internet                = 8.33,
       demais_despesas_diretas = 322.69,
       updated_at              = now()
 WHERE contrato_id = '04c313f8-d491-4689-a1fc-3b3c6af88eb0';

-- ── Conferência (esperado: 16 linhas atualizadas) ────────────────────────────
SELECT count(*) AS linhas_canaa_com_despesas
  FROM public.planilha_custo
 WHERE contrato_id = '04c313f8-d491-4689-a1fc-3b3c6af88eb0'
   AND aluguel > 0;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   UPDATE public.planilha_custo
--      SET aluguel = 0, agua = 0, luz = 0, internet = 0, demais_despesas_diretas = 0
--    WHERE contrato_id = '04c313f8-d491-4689-a1fc-3b3c6af88eb0';
--   ALTER TABLE public.planilha_custo
--     DROP COLUMN IF EXISTS aluguel,
--     DROP COLUMN IF EXISTS agua,
--     DROP COLUMN IF EXISTS luz,
--     DROP COLUMN IF EXISTS internet,
--     DROP COLUMN IF EXISTS demais_despesas_diretas;
-- =====================================================================
