-- =========================================================================
-- TV OPERACIONAL › INDICADORES POR CONTRATO: sem "statement timeout" (17/11/2026)
--
-- RELATO (Pablo, foto da TV às 16:14 de 16/11): "Não foi possível carregar o
-- relatório — canceling statement due to statement timeout".
--
-- POR QUÊ: a TV calcula tudo na hora (tv_relatorio → tv_ope_contratos_dados):
-- os 7 indicadores de cada contrato (EMPREGADOS inteira, demissões, postos,
-- turnover — este ficou mais pesado nas migs 20261114085400 e
-- 20261116130000) MAIS o financeiro das 6 fontes do Fluxo de Caixa. A TV
-- entra sem login (papel anon), que tem o tempo de consulta mais curto do
-- banco; a conta passou dele.
--
-- O QUE MUDA: a conta sai da hora da TV.
--   · TV_OPE_CONTRATOS_CACHE guarda o último resultado (uma linha).
--   · tv_ope_contratos_atualizar() refaz a conta e grava — roda no pg_cron
--     de 10 em 10 minutos (o cron não tem o limite de tempo do anon).
--   · tv_ope_contratos_dados() devolve o que está guardado; só calcula na
--     hora se ainda não houver nada guardado (primeira vez).
--   · A prévia da Gestão das TV's (tv_ope_contratos_previa) usa a mesma.
-- Os números continuam os da tela Operacional › Indicadores por Contrato,
-- com no máximo 10 minutos de atraso (a TV já mostra a competência fechada).
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."TV_OPE_CONTRATOS_CACHE" (
  id            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  dados         jsonb NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public."TV_OPE_CONTRATOS_CACHE" ENABLE ROW LEVEL SECURITY;
-- Só as funções SECURITY DEFINER abaixo leem e gravam.
REVOKE ALL ON public."TV_OPE_CONTRATOS_CACHE" FROM PUBLIC, anon, authenticated;

-- A conta de verdade (corpo da mig 20261111130000), com outro nome.
CREATE OR REPLACE FUNCTION public.tv_ope_contratos_calcular()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_comp text := public.ope_competencia_fechada();
BEGIN
  RETURN public.ope_contratos_ind_dados(v_comp)
         || jsonb_build_object('financeiro', public.ope_contratos_financeiro(v_comp));
END $fn$;
REVOKE ALL ON FUNCTION public.tv_ope_contratos_calcular() FROM PUBLIC, anon, authenticated;

-- Refaz e guarda (cron).
CREATE OR REPLACE FUNCTION public.tv_ope_contratos_atualizar()
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  INSERT INTO public."TV_OPE_CONTRATOS_CACHE" (id, dados, atualizado_em)
  VALUES (1, public.tv_ope_contratos_calcular(), now())
  ON CONFLICT (id) DO UPDATE SET dados = EXCLUDED.dados, atualizado_em = EXCLUDED.atualizado_em;
END $fn$;
REVOKE ALL ON FUNCTION public.tv_ope_contratos_atualizar() FROM PUBLIC, anon, authenticated;

-- O que a TV (e a prévia) recebem: o guardado; na falta, a conta na hora.
CREATE OR REPLACE FUNCTION public.tv_ope_contratos_dados()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v jsonb; v_em timestamptz;
BEGIN
  SELECT dados, atualizado_em INTO v, v_em FROM public."TV_OPE_CONTRATOS_CACHE" WHERE id = 1;
  IF v IS NULL THEN RETURN public.tv_ope_contratos_calcular(); END IF;
  RETURN v || jsonb_build_object('atualizado_em', v_em);
END $fn$;
REVOKE ALL ON FUNCTION public.tv_ope_contratos_dados() FROM PUBLIC, anon, authenticated;

-- Agenda: de 10 em 10 minutos.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron ausente: tv-ope-contratos-cache não agendado.';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tv-ope-contratos-cache') THEN
    PERFORM cron.unschedule('tv-ope-contratos-cache');
  END IF;
  PERFORM cron.schedule('tv-ope-contratos-cache', '*/10 * * * *', 'SELECT public.tv_ope_contratos_atualizar()');
END $$;

-- Primeira carga já na aplicação (a TV sai do erro sem esperar o cron).
-- Se a conta falhar aqui, a migration NÃO trava: o cron tenta de novo.
DO $$
BEGIN
  PERFORM public.tv_ope_contratos_atualizar();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Primeira carga da TV ficou para o cron: %', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- SELECT cron.unschedule('tv-ope-contratos-cache');
-- Reaplicar tv_ope_contratos_dados da 20261111130000. Depois:
-- DROP FUNCTION IF EXISTS public.tv_ope_contratos_atualizar();
-- DROP FUNCTION IF EXISTS public.tv_ope_contratos_calcular();
-- DROP TABLE IF EXISTS public."TV_OPE_CONTRATOS_CACHE";
-- NOTIFY pgrst, 'reload schema';
