-- =========================================================================
-- PAINEL EXECUTIVO: QUAIS SÃO OS CONTRATOS DE CADA SITUAÇÃO (09/11/2026)
--
-- Pablo: "quando colocar o mouse em cima do crítico e atenção ali tem que
-- mostrar os contratos desse status" e "por que 37 contratos? se temos 64".
-- A rosca só classifica quem tem receita de R$ 10 mil ou mais no DRE da
-- competência (receita residual distorce a margem). Agora a RPC devolve a
-- lista por situação, quantos ficaram abaixo do piso e quantos contratos não
-- encerrados existem, para a tela dizer o que ficou de fora. Regra da rosca
-- e demais números: sem mudança.
-- É a função da mig 20261109002000 + situacao_detalhe.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.ope_painel_executivo(_competencia text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_ultima text;
  v_comp text;
  v_ant text;
  v_ini date;
  v_ini_ant date;
  v_ref date;
  v_ref_ant date;
  v_competencias jsonb;
  v_dre jsonb;
  v_dre_ant jsonb;
  v_nf jsonb;
  v_serie jsonb;
  v_situacao jsonb;
  v_crit_ant integer;
  v_detalhe jsonb;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'ope_indicadores_painel_executivo', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso ao Painel Executivo' USING ERRCODE = '42501';
  END IF;

  v_ultima := public.tvg_dre_competencia();
  v_comp := CASE WHEN _competencia ~ '^\d{4}-(0[1-9]|1[0-2])$' AND _competencia <= to_char(hoje, 'YYYY-MM') THEN _competencia
                 ELSE coalesce(v_ultima, to_char(hoje, 'YYYY-MM')) END;
  v_ini := to_date(v_comp || '-01', 'YYYY-MM-DD');
  v_ini_ant := (v_ini - interval '1 month')::date;
  v_ant := to_char(v_ini_ant, 'YYYY-MM');
  v_ref := least((v_ini + interval '1 month' - interval '1 day')::date, hoje);
  v_ref_ant := v_ini - 1;

  SELECT jsonb_agg(c ORDER BY c DESC) INTO v_competencias
    FROM (SELECT to_char(g, 'YYYY-MM') AS c
            FROM generate_series(date_trunc('month', hoje) - interval '23 months', date_trunc('month', hoje), interval '1 month') g
          UNION
          SELECT v_ultima WHERE v_ultima IS NOT NULL
          UNION
          SELECT v_comp) z;

  IF v_ultima IS NOT NULL AND v_comp <= v_ultima THEN
    SELECT CASE WHEN sum(receita) > 0 THEN jsonb_build_object(
             'receita', round(sum(receita), 2),
             'custo', round(sum(coalesce(custo, 0)), 2),
             'lucro', round(sum(receita) - sum(coalesce(custo, 0)), 2),
             'margem', round(100 * (sum(receita) - sum(coalesce(custo, 0))) / sum(receita), 2)) END
      INTO v_dre FROM public.tvg_dre_mv WHERE competencia = v_comp;

    SELECT CASE WHEN sum(receita) > 0 THEN jsonb_build_object(
             'receita', round(sum(receita), 2),
             'custo', round(sum(coalesce(custo, 0)), 2),
             'lucro', round(sum(receita) - sum(coalesce(custo, 0)), 2),
             'margem', round(100 * (sum(receita) - sum(coalesce(custo, 0))) / sum(receita), 2)) END
      INTO v_dre_ant FROM public.tvg_dre_mv WHERE competencia = v_ant;

    IF v_dre IS NOT NULL THEN
      WITH d AS (
        SELECT 100 * (receita - coalesce(custo, 0)) / receita AS margem
          FROM public.tvg_dre_mv
         WHERE competencia = v_comp AND contrato <> 'Sem contrato' AND receita >= 10000)
      SELECT jsonb_build_object(
               'saudavel', count(*) FILTER (WHERE margem >= 10),
               'atencao', count(*) FILTER (WHERE margem >= 0 AND margem < 10),
               'critico', count(*) FILTER (WHERE margem < 0))
        INTO v_situacao FROM d;

      WITH d AS (
        SELECT contrato AS nome, round(receita, 2) AS receita, round(100 * (receita - coalesce(custo, 0)) / receita, 2) AS margem
          FROM public.tvg_dre_mv
         WHERE competencia = v_comp AND contrato <> 'Sem contrato' AND receita >= 10000),
      c AS (
        SELECT nome, receita, margem, CASE WHEN margem >= 10 THEN 'saudavel' WHEN margem >= 0 THEN 'atencao' ELSE 'critico' END AS chave FROM d)
      SELECT jsonb_build_object(
               'contratos', coalesce(jsonb_object_agg(g.chave, g.lista), '{}'::jsonb),
               'abaixo_piso', (SELECT count(*) FROM public.tvg_dre_mv
                                WHERE competencia = v_comp AND contrato <> 'Sem contrato' AND receita > 0 AND receita < 10000),
               'ativos', (SELECT count(*) FROM public.contratos ct WHERE coalesce(ct.status, 'ativo') <> 'encerrado'))
        INTO v_detalhe
        FROM (SELECT chave, jsonb_agg(jsonb_build_object('nome', nome, 'receita', receita, 'margem', margem) ORDER BY margem) AS lista
                FROM c GROUP BY chave) g;
    END IF;

    IF v_dre_ant IS NOT NULL THEN
      SELECT count(*) INTO v_crit_ant
        FROM public.tvg_dre_mv
       WHERE competencia = v_ant AND contrato <> 'Sem contrato' AND receita >= 10000 AND receita - coalesce(custo, 0) < 0;
    END IF;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('competencia', competencia, 'receita', rec, 'lucro', luc) ORDER BY competencia), '[]'::jsonb)
    INTO v_serie
    FROM (SELECT competencia, round(sum(receita), 2) AS rec, round(sum(receita) - sum(coalesce(custo, 0)), 2) AS luc
            FROM public.tvg_dre_mv
           WHERE v_ultima IS NOT NULL AND competencia <= v_ultima
           GROUP BY competencia
          HAVING sum(receita) > 0
           ORDER BY competencia DESC
           LIMIT 12) s;

  WITH n AS (
    SELECT coalesce(vlr_liquido_total, 0) AS v,
           coalesce(valor_pago, vlr_liquido_total, 0) AS p,
           data_emissao AS e,
           data_pagamento AS d
      FROM public.nf_emissao
     WHERE deleted_at IS NULL AND status::text = 'concluida' AND data_emissao IS NOT NULL)
  SELECT jsonb_build_object(
           'qtd', count(*) FILTER (WHERE e <= v_ref),
           'recebido', round(coalesce(sum(p) FILTER (WHERE d BETWEEN v_ini AND v_ref), 0), 2),
           'recebido_ant', round(coalesce(sum(p) FILTER (WHERE d BETWEEN v_ini_ant AND v_ref_ant), 0), 2),
           'saldo', round(coalesce(sum(v) FILTER (WHERE e <= v_ref AND (d IS NULL OR d > v_ref)), 0), 2),
           'saldo_ant', round(coalesce(sum(v) FILTER (WHERE e <= v_ref_ant AND (d IS NULL OR d > v_ref_ant)), 0), 2),
           'vencido_90', round(coalesce(sum(v) FILTER (WHERE e <= v_ref AND (d IS NULL OR d > v_ref) AND v_ref - (e + 30) > 90), 0), 2),
           'vencido_90_ant', round(coalesce(sum(v) FILTER (WHERE e <= v_ref_ant AND (d IS NULL OR d > v_ref_ant) AND v_ref_ant - (e + 30) > 90), 0), 2))
    INTO v_nf FROM n;

  RETURN jsonb_build_object(
    'competencia', v_comp,
    'ultima_dre', v_ultima,
    'competencias', v_competencias,
    'dre', v_dre,
    'dre_anterior', v_dre_ant,
    'nf', v_nf,
    'serie', v_serie,
    'situacao', v_situacao,
    'situacao_detalhe', v_detalhe,
    'critico_anterior', v_crit_ant);
END $fn$;

REVOKE ALL ON FUNCTION public.ope_painel_executivo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ope_painel_executivo(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK: reaplicar a função da mig 20261109002000 (a tela funciona sem situacao_detalhe).
