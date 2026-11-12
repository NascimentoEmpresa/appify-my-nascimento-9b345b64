-- =========================================================================
-- TV OPERACIONAL — LUCRATIVIDADE IGUAL À DO FATURAMENTO DA EMPRESA
--
-- O QUE O PABLO VIU (12/11/2026)
--   TV da Gerência Operacional: "Lucratividade por contrato 19,5%".
--   Controladoria › Faturamento da Empresa, set/26: Margem Bruta 10,43%
--   (Valor Líquido 8.265.226,90 − Despesas 7.403.207,24).
--
-- POR QUE DAVA DIFERENTE
--   1. O cartão da TV só somava os contratos com receita ≥ R$ 10 mil E custo
--      lançado. Contrato com despesa e pouca (ou nenhuma) nota no mês ficava
--      de fora — justamente os que puxam a margem para baixo.
--   2. O custo da TV (ope_contratos_financeiro, 20261111130000) somava TODA
--      saída com contrato. O Faturamento da Empresa tira:
--        · as classificações que não são custo (sem classificação,
--          TRANSFERÊNCIA, APLICAÇÃO FINANCEIRA, RESGATE, RECEBIMENTO DE NOTA,
--          EMPRÉSTIMO, FINANCIAMENTO, DISTRIBUIÇÃO), com a ligação manual do
--          painel "Rubricas de custo" valendo primeiro (regras.ts:
--          rubricaDaLinha / rubricaDeCusto);
--        · os contratos fora das despesas (tratamento da Controladoria; sem
--          ele, pelo nome — useCustosContratoMes.ts).
--
-- A CORREÇÃO
--   ope_contratos_financeiro passa a aplicar as mesmas duas regras no custo
--   (vale também para a lucratividade de cada contrato e o custo × orçado) e
--   devolve o bloco `empresa` — Valor Líquido − Despesas do mês, a conta da
--   linha do mês no Faturamento da Empresa. O cartão da TV lê esse bloco.
--   tv_ctl_fora_das_despesas passa a tirar também 'obra_administrativa'
--   (saiDasDespesas faz isso; a função da TV tinha esquecido).
--
-- Idempotente (só CREATE OR REPLACE FUNCTION).
-- ROLLBACK: no fim do arquivo.
-- =========================================================================

-- ── 1) Contrato fora das despesas: + obra administrativa ─────────────────
CREATE OR REPLACE FUNCTION public.tv_ctl_fora_das_despesas(p_contrato uuid, p_nome text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(
    (SELECT t.tratamento IN ('fora_das_despesas', 'investimento', 'obra_administrativa')
       FROM public.controladoria_contrato_tratamento t WHERE t.contrato_id = p_contrato),
    upper(translate(coalesce(p_nome, ''), 'ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç', 'AAAAEEIOOOUCaaaaeeiooouc')) ~ '^\s*(MOVIMENTACAO FINANCEIRA|ESTOQUE|INVESTIMENTO|OBRAS ADM|ADMINISTRATIVO)')
$$;
REVOKE ALL ON FUNCTION public.tv_ctl_fora_das_despesas(uuid, text) FROM PUBLIC, anon, authenticated;

-- ── 2) A linha do Fluxo de Caixa é custo? (espelha rubricaDaLinha) ───────
-- Ligação manual primeiro ('nao_custo' tira; qualquer rubrica põe). Sem ela,
-- pelo nome: vazio não é custo; os termos de NAO_CUSTO (regras.ts) também não.
CREATE OR REPLACE FUNCTION public.ope_linha_e_custo(p_classificacao uuid, p_nome text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(
    (SELECT l.rubrica <> 'nao_custo' FROM public.lucratividade_rubrica_classificacao l WHERE l.classificacao_id = p_classificacao),
    CASE
      WHEN btrim(coalesce(p_nome, '')) = '' THEN false
      ELSE upper(translate(p_nome, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'))
           !~ '(TRANSFERENCIA|APLICACAO FINANCEIRA|RESGATE|RECEBIMENTO DE NOTA|EMPRESTIMO|FINANCIAMENTO|DISTRIBUICAO)'
    END)
$$;
REVOKE ALL ON FUNCTION public.ope_linha_e_custo(uuid, text) FROM PUBLIC, anon, authenticated;

-- ── 3) O financeiro da TV (era 20261111130000) ───────────────────────────
CREATE OR REPLACE FUNCTION public.ope_contratos_financeiro(p_competencia text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_ini date := to_date(p_competencia || '-01', 'YYYY-MM-DD');
  v_fim date := (to_date(p_competencia || '-01', 'YYYY-MM-DD') + interval '1 month')::date;
  v_ano date := date_trunc('year', to_date(p_competencia || '-01', 'YYYY-MM-DD'))::date;
  v_sql text := '';
  v text;
  v_receita jsonb; v_custo jsonb;
  v_liq numeric; v_desp numeric;
BEGIN
  -- Receita: Valor Líquido das notas N válidas da competência (como antes).
  SELECT coalesce(jsonb_object_agg(contrato_id, round(r, 2)), '{}'::jsonb), coalesce(sum(r), 0) INTO v_receita, v_liq
    FROM (SELECT n.contrato_id::text, sum(coalesce(n.vlr_liquido_total, 0)) AS r
            FROM public.nf_emissao n
            JOIN public.contratos ct ON ct.id = n.contrato_id
           WHERE n.deleted_at IS NULL AND n.tipo_nota = 'N' AND n.contrato_id IS NOT NULL
             AND n.status::text NOT IN ('rascunho', 'enviada', 'cancelada')
             AND upper(coalesce(n.situacao_site_pmt, '') || ' ' || coalesce(n.situacao_dominio, '')) !~ '(CANCEL|SUBSTITU)'
             AND n.competencia >= v_ini AND n.competencia < v_fim
           GROUP BY 1) x;

  -- Custo: SAÍDAS com contrato das 6 fontes, só o que é custo (classificação)
  -- e só de contrato que entra nas despesas — as regras do Faturamento da Empresa.
  FOREACH v IN ARRAY ARRAY['v_malote_pagamento_fluxo_caixa', 'v_debito_automatico_fluxo_caixa', 'v_cartao_fatura_fluxo_caixa',
                           'v_aplicacao_financeira_fluxo_caixa', 'v_aplicacao_financeira_resgate_fluxo_caixa',
                           'v_fluxo_caixa_importado_fluxo_caixa'] LOOP
    IF to_regclass('public.' || v) IS NOT NULL THEN
      v_sql := v_sql || CASE WHEN v_sql = '' THEN '' ELSE ' UNION ALL ' END
        || format('SELECT contrato_id, to_char(coalesce(competencia, data_pagamento), ''YYYY-MM'') AS m, valor::numeric AS v, '
                  || 'classificacao_id::uuid AS cid, classificacao_nome::text AS cnome FROM public.%I '
                  || 'WHERE tipo = ''saida'' AND contrato_id IS NOT NULL AND coalesce(competencia, data_pagamento) >= %L AND coalesce(competencia, data_pagamento) < %L',
                  v, v_ano, v_fim);
    END IF;
  END LOOP;
  IF v_sql = '' THEN
    v_custo := '{}'::jsonb;
  ELSE
    EXECUTE 'SELECT coalesce(jsonb_object_agg(c || ''|'' || m, round(t, 2)), ''{}''::jsonb) FROM ('
            || 'SELECT u.contrato_id::text AS c, u.m, sum(u.v) AS t FROM (' || v_sql || ') u '
            || 'JOIN public.contratos ct ON ct.id = u.contrato_id '
            || 'WHERE NOT public.tv_ctl_fora_das_despesas(ct.id, ct.nome) AND public.ope_linha_e_custo(u.cid, u.cnome) '
            || 'GROUP BY 1, 2 HAVING sum(u.v) > 0) z' INTO v_custo;
  END IF;

  -- A linha do mês no Faturamento da Empresa: Valor Líquido − Despesas.
  SELECT coalesce(sum(value::numeric), 0) INTO v_desp
    FROM jsonb_each_text(v_custo) WHERE key LIKE '%|' || p_competencia;

  RETURN jsonb_build_object('competencia', p_competencia, 'receita', v_receita, 'custo_por_mes', v_custo,
    'empresa', jsonb_build_object(
      'liquido', round(v_liq, 2), 'despesas', round(v_desp, 2), 'lucro', round(v_liq - v_desp, 2),
      'margem', CASE WHEN v_liq > 0 THEN round(100 * (v_liq - v_desp) / v_liq, 2) END));
END $fn$;
REVOKE ALL ON FUNCTION public.ope_contratos_financeiro(text) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   Recriar ope_contratos_financeiro como em 20261111130000 e
--   tv_ctl_fora_das_despesas como em 20261111230000;
--   DROP FUNCTION IF EXISTS public.ope_linha_e_custo(uuid, text);
-- =========================================================================
