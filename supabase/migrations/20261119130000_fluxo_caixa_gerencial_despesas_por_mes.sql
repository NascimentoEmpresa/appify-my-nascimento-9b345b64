-- SIS-2026-0893 (Fluxo de Caixa Gerencial) — competência também nos INDICADORES do topo: série mensal na função de análise das despesas
-- ============================================================================
-- Os KPIs de despesas (Despesas Pagas, Malote, composição, evolução mensal e custo operacional da necessidade de caixa) passam a poder ser enquadrados pela
-- COMPETÊNCIA do lançamento, além da data de pagamento. Para isso a tela reaproveita financeiro_fluxo_gerencial_despesas (20261119120000) e esta migration só
-- acrescenta a ela a chave 'por_mes': as despesas dos 12 meses que terminam no mês de p_fim, pela MESMA data de referência escolhida (pagamento ou competência).
-- Mesma assinatura e mesma regra de despesa da versão anterior (CREATE OR REPLACE): quem já a chama continua funcionando. A projeção (30/60/90 dias) segue na
-- função original, que não muda. Idempotente. NOTIFY ao final.
--
-- ROLLBACK: reaplicar 20261119120000_fluxo_caixa_gerencial_analise_despesas.sql (versão sem 'por_mes').
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.financeiro_fluxo_gerencial_despesas(
  p_ini date, p_fim date, p_empresa uuid DEFAULT NULL, p_contrato uuid DEFAULT NULL, p_tipo_data text DEFAULT 'pagamento')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_fora text[] := ARRAY['TRANSFERENCIA ENTRE CONTAS', 'APLICACAO FINANCEIRA', 'CHEQUE ESPECIAL', 'EMPRESTIMOS', 'SALDO ANTERIOR', 'RECEBIMENTO DE NOTA'];
  v_meses integer;
  v_ant_ini date;
  v_ant_fim date;
  v_serie_ini date;
  v_corte date;
  r jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_screen_access(auth.uid(), 'fluxo-caixa-gerencial', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso ao Fluxo de Caixa Gerencial.' USING ERRCODE = '42501';
  END IF;
  IF p_ini IS NULL OR p_fim IS NULL OR p_ini > p_fim THEN
    RAISE EXCEPTION 'Período inválido.' USING ERRCODE = '22023';
  END IF;
  IF p_tipo_data NOT IN ('pagamento', 'competencia') THEN
    RAISE EXCEPTION 'Tipo de data inválido (use pagamento ou competencia).' USING ERRCODE = '22023';
  END IF;

  -- período anterior: N meses inteiros logo antes, ou o mesmo número de dias
  IF p_ini = date_trunc('month', p_ini)::date AND p_fim = (date_trunc('month', p_fim) + interval '1 month - 1 day')::date THEN
    v_meses := (extract(year FROM p_fim)::int - extract(year FROM p_ini)::int) * 12 + (extract(month FROM p_fim)::int - extract(month FROM p_ini)::int) + 1;
    v_ant_ini := (p_ini - make_interval(months => v_meses))::date;
    v_ant_fim := p_ini - 1;
  ELSE
    v_ant_ini := p_ini - (p_fim - p_ini + 1);
    v_ant_fim := p_ini - 1;
  END IF;

  v_serie_ini := (date_trunc('month', p_fim) - interval '11 months')::date;
  v_corte := LEAST(v_ant_ini, v_serie_ini);

  WITH debito_na_fatura AS (
    SELECT despesa_id_origem FROM public.v_malote_pagamento_fluxo_caixa_consolidado
     WHERE fatura_cartao_id IS NOT NULL AND despesa_id_origem IS NOT NULL
  ),
  linhas AS (
    SELECT data_pagamento, competencia, empresa_id, contrato_id, classificacao_nome, valor, tipo::text AS tipo, origem::text AS origem
      FROM public.v_malote_pagamento_fluxo_caixa_consolidado
    UNION ALL
    SELECT data_pagamento, competencia, empresa_id, contrato_id, classificacao_nome, valor, tipo::text, origem::text
      FROM public.v_debito_automatico_fluxo_caixa d
     WHERE NOT EXISTS (SELECT 1 FROM debito_na_fatura f WHERE f.despesa_id_origem = d.despesa_id)
    UNION ALL
    SELECT data_pagamento, competencia, empresa_id, contrato_id, classificacao_nome, valor, tipo::text, origem::text FROM public.v_cartao_fatura_fluxo_caixa
    UNION ALL
    SELECT data_pagamento, competencia, empresa_id, contrato_id, classificacao_nome, valor, tipo::text, origem::text FROM public.v_aplicacao_financeira_fluxo_caixa
    UNION ALL
    SELECT data_pagamento, competencia, empresa_id, contrato_id, classificacao_nome, valor, tipo::text, origem::text FROM public.v_aplicacao_financeira_resgate_fluxo_caixa
    UNION ALL
    SELECT data_pagamento, competencia, empresa_id, contrato_id, classificacao_nome, valor, tipo::text, origem::text FROM public.v_fluxo_caixa_importado_fluxo_caixa
    UNION ALL
    SELECT data_pagamento, competencia, empresa_id, contrato_id, classificacao_nome, valor, tipo::text, origem::text FROM public.v_conta_garantida_fluxo_caixa
  ),
  despesas AS (
    SELECT l.*,
           CASE WHEN p_tipo_data = 'competencia' THEN l.competencia::date ELSE l.data_pagamento::date END AS data_ref
      FROM linhas l
     WHERE l.data_pagamento IS NOT NULL
       AND l.data_pagamento <= v_hoje
       AND l.tipo = 'saida'
       AND NOT (l.origem IN ('aplicacao_financeira', 'conta_garantida')
                OR translate(upper(coalesce(l.classificacao_nome, '')), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC') = ANY (v_fora)
                OR translate(upper(coalesce(l.classificacao_nome, '')), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC') LIKE 'TITULO DE CAPITALIZACAO%')
       AND (p_empresa IS NULL OR l.empresa_id = p_empresa)
       AND (p_contrato IS NULL OR l.contrato_id = p_contrato)
  ),
  base AS (
    SELECT d.*, CASE WHEN d.data_ref BETWEEN p_ini AND p_fim THEN 'atual'
                     WHEN d.data_ref BETWEEN v_ant_ini AND v_ant_fim THEN 'anterior' END AS periodo
      FROM despesas d
     WHERE d.data_ref BETWEEN v_corte AND p_fim
  )
  SELECT jsonb_build_object(
    'tipo_data', p_tipo_data,
    'periodo_anterior', jsonb_build_object('ini', v_ant_ini, 'fim', v_ant_fim),
    'total', coalesce((SELECT sum(valor) FROM base WHERE periodo = 'atual'), 0),
    'total_anterior', coalesce((SELECT sum(valor) FROM base WHERE periodo = 'anterior'), 0),
    'qtd', (SELECT count(*) FROM base WHERE periodo = 'atual'),
    'por_classificacao', coalesce((
      SELECT jsonb_agg(jsonb_build_object('nome', n, 'valor', a, 'valor_anterior', b) ORDER BY a DESC, b DESC)
        FROM (SELECT coalesce(classificacao_nome, 'Sem classificação') AS n,
                     coalesce(sum(valor) FILTER (WHERE periodo = 'atual'), 0) AS a,
                     coalesce(sum(valor) FILTER (WHERE periodo = 'anterior'), 0) AS b
                FROM base WHERE periodo IS NOT NULL GROUP BY 1) q
    ), '[]'::jsonb),
    'por_contrato', coalesce((
      SELECT jsonb_agg(jsonb_build_object('contrato_id', cid, 'nome', n, 'valor', a, 'valor_anterior', b) ORDER BY a DESC, b DESC)
        FROM (SELECT b2.contrato_id AS cid, coalesce(c.nome, 'Sem contrato (administrativo)') AS n,
                     coalesce(sum(b2.valor) FILTER (WHERE b2.periodo = 'atual'), 0) AS a,
                     coalesce(sum(b2.valor) FILTER (WHERE b2.periodo = 'anterior'), 0) AS b
                FROM base b2 LEFT JOIN public.contratos c ON c.id = b2.contrato_id WHERE b2.periodo IS NOT NULL GROUP BY 1, 2) q
    ), '[]'::jsonb),
    'por_mes', coalesce((
      SELECT jsonb_agg(jsonb_build_object('mes', to_char(m.mes, 'YYYY-MM'), 'despesas', coalesce(x.v, 0)) ORDER BY m.mes)
        FROM generate_series(v_serie_ini, date_trunc('month', p_fim)::date, interval '1 month') AS m(mes)
        LEFT JOIN (SELECT date_trunc('month', data_ref)::date AS mes, sum(valor) AS v FROM base WHERE data_ref BETWEEN v_serie_ini AND p_fim GROUP BY 1) x ON x.mes = m.mes::date
    ), '[]'::jsonb),
    'por_origem', coalesce((
      SELECT jsonb_agg(jsonb_build_object('origem', o, 'valor', a, 'valor_anterior', b) ORDER BY a DESC)
        FROM (SELECT origem AS o,
                     coalesce(sum(valor) FILTER (WHERE periodo = 'atual'), 0) AS a,
                     coalesce(sum(valor) FILTER (WHERE periodo = 'anterior'), 0) AS b
                FROM base WHERE periodo IS NOT NULL GROUP BY 1) q
    ), '[]'::jsonb)
  ) INTO r;

  RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.financeiro_fluxo_gerencial_despesas(date, date, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financeiro_fluxo_gerencial_despesas(date, date, uuid, uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
