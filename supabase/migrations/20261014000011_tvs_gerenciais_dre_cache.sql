-- =========================================================================
-- TVs GERENCIAIS: DRE EM CACHE (14/10/2026)
--
-- A mig 20261014000010 lia o DRE gerencial (mz_60, ~48 mil linhas com valor
-- em TEXTO) a cada indicador: ~1,8 s por leitura, e a tendência da
-- Controladoria chamava a "última competência completa" linha a linha — a
-- TV da Controladoria passou de 110 s. O DRE é carga de migração e muda
-- pouco: vira uma visão materializada (~1.400 linhas: contrato × competência),
-- atualizada pelo pg_cron a cada 6 horas.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

DROP MATERIALIZED VIEW IF EXISTS public.tvg_dre_mv;
CREATE MATERIALIZED VIEW public.tvg_dre_mv AS
  SELECT d.periodo_competencia AS competencia, coalesce(nullif(btrim(d.contrato), ''), 'Sem contrato') AS contrato,
         sum(public.tvg_num_ponto(d.valor_dre)) FILTER (WHERE d.linha_dre = 'RECEITA') AS receita,
         -sum(public.tvg_num_ponto(d.valor_dre)) FILTER (WHERE d.linha_dre = 'CUSTO') AS custo,
         -sum(public.tvg_num_ponto(d.valor_dre)) FILTER (WHERE d.linha_dre = 'DESPESA') AS despesa
    FROM public.mz_60_view_dre_gerencial_competencia d
   WHERE d.periodo_competencia ~ '^\d{4}-\d{2}$'
   GROUP BY 1, 2;
CREATE UNIQUE INDEX tvg_dre_mv_pk ON public.tvg_dre_mv (competencia, contrato);
REVOKE ALL ON public.tvg_dre_mv FROM PUBLIC, anon, authenticated;

-- Mesma assinatura de antes: quem chama não muda.
CREATE OR REPLACE FUNCTION public.tvg_dre_contratos()
RETURNS TABLE(competencia text, contrato text, receita numeric, custo numeric, despesa numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT competencia, contrato, receita, custo, despesa FROM public.tvg_dre_mv
$$;

-- Atualiza o cache (pg_cron, e à mão depois de uma carga nova do DRE).
CREATE OR REPLACE FUNCTION public.tvg_dre_atualizar()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.tvg_dre_mv;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_dre_atualizar() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'tvg-dre-atualizar';
    PERFORM cron.schedule('tvg-dre-atualizar', '17 */6 * * *', 'SELECT public.tvg_dre_atualizar()');
  END IF;
END $$;

-- Tendência da Controladoria/Presidência: a competência completa calculada UMA vez.
CREATE OR REPLACE FUNCTION public.tvg_tendencia_dre()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_comp text := public.tvg_dre_competencia(); r jsonb;
BEGIN
  WITH d AS (SELECT competencia, sum(receita) rec, sum(coalesce(custo, 0)) + sum(coalesce(despesa, 0)) cus
               FROM public.tvg_dre_contratos() GROUP BY 1)
  SELECT jsonb_build_object('titulo', 'DRE gerencial por competência: receita × custo + despesa', 'series', jsonb_build_array('Receita', 'Custo + despesa'), 'unidade', 'brl',
    'meses', COALESCE(jsonb_agg(jsonb_build_object('mes', to_char(to_date(competencia, 'YYYY-MM'), 'MM/YY'), 'a', round(coalesce(rec, 0)), 'b', round(coalesce(cus, 0))) ORDER BY competencia), '[]'::jsonb))
    INTO r FROM (SELECT * FROM d WHERE coalesce(rec, 0) > 0 AND competencia <= v_comp ORDER BY competencia DESC LIMIT 12) z;
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_tendencia_dre() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- SELECT cron.unschedule('tvg-dre-atualizar');
-- DROP FUNCTION IF EXISTS public.tvg_tendencia_dre();
-- DROP FUNCTION IF EXISTS public.tvg_dre_atualizar();
-- (tvg_dre_contratos: reaplicar a versão de 20261014000010, que lê mz_60 direto)
-- DROP MATERIALIZED VIEW IF EXISTS public.tvg_dre_mv;
