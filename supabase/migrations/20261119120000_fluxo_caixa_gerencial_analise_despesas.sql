-- Fluxo de Caixa Gerencial (etapa 3): análise das despesas por classificação, contrato/centro de custo e origem, com o período anterior
-- ============================================================================
-- Função NOVA e separada (financeiro_fluxo_gerencial, da SIS-2026-0871, não muda e continua alimentando os KPIs): devolve, para o período pedido e para o
-- período imediatamente anterior, as despesas pagas por classificação, por contrato (= centro de custo, o Fluxo de Caixa chama o contrato de "Centro de
-- Custo") e por origem. O comparativo (variação em R$ e %) é calculado na tela.
--
--   p_tipo_data = 'pagamento'  → enquadra a despesa pela data do pagamento (padrão, como o KPI "Despesas Pagas");
--                 'competencia' → pela competência do lançamento.
--   Período anterior: se o período é de meses inteiros, os MESMOS N meses logo antes; senão, o mesmo número de dias logo antes.
--   "Despesa" = a mesma regra da função original: saída REALIZADA (data de pagamento <= hoje) que NÃO é movimentação financeira (aplicação, conta garantida,
--   transferência entre contas, cheque especial, empréstimos, saldo anterior, recebimento de nota, título de capitalização), com a MESMA deduplicação de
--   Débito Automático × fatura de cartão. Mexer na lista = editar v_fora (e a mesma lista em financeiro_fluxo_gerencial).
-- SECURITY DEFINER (as views do Fluxo têm RLS própria); a trava é o acesso à tela, conferido na entrada (sem acesso → 42501). Só leitura. Idempotente.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.financeiro_fluxo_gerencial_despesas(date, date, uuid, uuid, text);
--   NOTIFY pgrst, 'reload schema';

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
     WHERE d.data_ref BETWEEN v_ant_ini AND p_fim
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
                FROM base GROUP BY 1) q
    ), '[]'::jsonb),
    'por_contrato', coalesce((
      SELECT jsonb_agg(jsonb_build_object('contrato_id', cid, 'nome', n, 'valor', a, 'valor_anterior', b) ORDER BY a DESC, b DESC)
        FROM (SELECT b2.contrato_id AS cid, coalesce(c.nome, 'Sem contrato (administrativo)') AS n,
                     coalesce(sum(b2.valor) FILTER (WHERE b2.periodo = 'atual'), 0) AS a,
                     coalesce(sum(b2.valor) FILTER (WHERE b2.periodo = 'anterior'), 0) AS b
                FROM base b2 LEFT JOIN public.contratos c ON c.id = b2.contrato_id GROUP BY 1, 2) q
    ), '[]'::jsonb),
    'por_origem', coalesce((
      SELECT jsonb_agg(jsonb_build_object('origem', o, 'valor', a, 'valor_anterior', b) ORDER BY a DESC)
        FROM (SELECT origem AS o,
                     coalesce(sum(valor) FILTER (WHERE periodo = 'atual'), 0) AS a,
                     coalesce(sum(valor) FILTER (WHERE periodo = 'anterior'), 0) AS b
                FROM base GROUP BY 1) q
    ), '[]'::jsonb)
  ) INTO r;

  RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.financeiro_fluxo_gerencial_despesas(date, date, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financeiro_fluxo_gerencial_despesas(date, date, uuid, uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
