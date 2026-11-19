-- [SEM-CHAMADO] TV do Financeiro (Controle de Faturamento): competência = SEMPRE
-- o mês anterior (20/11/2026, pedido do Pablo).
--
-- Antes (mig 20261111230000) a TV pegava "a competência mais recente do ano
-- com nota Código N" — na prática o mês corrente assim que a primeira nota do
-- mês caía, e o mês corrente nunca está completo: a TV mostrava faturamento
-- pela metade e "não emitido" inflado. Agora a competência é fixa: o mês
-- anterior ao de hoje (fuso de São Paulo). Em janeiro, dezembro do ano
-- anterior (o filtro antigo "do ano" deixava janeiro sem passado).
-- Mesma regra em src/lib/tv/gestaoTv.ts (competenciaFinanceiroTv) e testada em
-- src/test/tv-gestao.test.ts.
--
-- Vale também para o bloco Financeiro da TV da Presidência, que chama esta
-- mesma função (tv_presidencia_dados) — é o espelho da TV do Financeiro e tem
-- que mostrar o mesmo número. Só a competência muda; o resto da conta é a da
-- mig 20261111230000, copiada sem alteração.

CREATE OR REPLACE FUNCTION public.tv_financeiro_dados()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_comp date;
  v_meses date[];
  v_out jsonb;
BEGIN
  -- Competência = SEMPRE o mês anterior (o corrente nunca está completo).
  v_comp := (date_trunc('month', hoje) - interval '1 month')::date;
  v_meses := ARRAY(SELECT g::date FROM generate_series(v_comp - interval '11 months', v_comp, interval '1 month') g);

  WITH nf AS (
    SELECT n.contrato_id, n.competencia AS mes,
           sum(coalesce(n.valor_contrato_exec_total, 0)) AS exec_rel, sum(coalesce(n.vlr_bruto_total, 0)) AS bruto,
           sum(coalesce(n.vlr_liquido_total, 0)) AS liquido, sum(coalesce(n.valor_pago, 0)) AS recebido,
           sum(coalesce(n.desconto_conta_vinculada, 0)) AS cv, count(*) AS qtd
      FROM public.nf_emissao n
     WHERE n.deleted_at IS NULL AND n.tipo_nota = 'N' AND n.contrato_id IS NOT NULL AND n.competencia = ANY (v_meses)
       AND public.tv_fin_nota_valida(n.status::text, n.situacao_site_pmt, n.situacao_dominio)
     GROUP BY 1, 2),
  com_dado AS (SELECT DISTINCT competencia AS mes FROM public.nf_emissao WHERE deleted_at IS NULL AND tipo_nota = 'N' AND competencia = ANY (v_meses)),
  ctr AS (SELECT c.id, c.nome, nullif(btrim(c.cliente), '') AS cliente,
                 greatest(nullif(btrim(c.data_fim_vigencia::text), '')::date, nullif(btrim(c.vigencia_final::text), '')::date) AS fim
            FROM public.contratos c),
  -- Executável de todos os contratos, UMA conta por mês.
  pe AS (SELECT m.mes, x.contrato_id, x.executavel, x.executavel_enc
           FROM unnest(v_meses) AS m(mes), LATERAL public.tv_fin_planilha_executavel(m.mes) x),
  cel AS (
    SELECT c.id, c.nome, c.cliente, m.mes,
           coalesce(CASE WHEN coalesce(nf.qtd, 0) > 0 AND coalesce(pe.executavel, 0) = 0 THEN pe.executavel_enc ELSE pe.executavel END, 0) AS executavel,
           coalesce(nf.exec_rel, 0) AS exec_rel, coalesce(nf.bruto, 0) AS bruto, coalesce(nf.liquido, 0) AS liquido,
           coalesce(nf.recebido, 0) AS recebido, coalesce(nf.cv, 0) AS cv, coalesce(nf.qtd, 0) AS qtd,
           (c.fim IS NOT NULL AND m.mes > c.fim) AS encerrado, EXISTS (SELECT 1 FROM com_dado d WHERE d.mes = m.mes) AS tem_dado
      FROM ctr c
     CROSS JOIN unnest(v_meses) AS m(mes)
      LEFT JOIN pe ON pe.contrato_id = c.id AND pe.mes = m.mes
      LEFT JOIN nf ON nf.contrato_id = c.id AND nf.mes = m.mes),
  st AS (
    SELECT cel.*,
           CASE WHEN qtd = 0 AND encerrado THEN 'SEM_VIGENCIA'
                WHEN executavel > 0 AND qtd > 0 THEN CASE WHEN executavel - bruto > 1 THEN 'FATURADO_PARCIAL' ELSE 'NOTAS_LANCADAS' END
                WHEN executavel > 0 AND NOT tem_dado THEN 'COMPETENCIA_SEM_DADOS'
                WHEN executavel > 0 THEN 'NENHUM_LANCAMENTO'
                ELSE 'SEM_VIGENCIA' END AS status,
           CASE WHEN qtd = 0 AND encerrado THEN 0 WHEN executavel - bruto > 1 THEN executavel - bruto ELSE 0 END AS nao_emitido,
           CASE WHEN bruto - executavel > 1 THEN bruto - executavel ELSE 0 END AS excesso
      FROM cel),
  vig AS (SELECT * FROM st WHERE status <> 'SEM_VIGENCIA'),
  atual AS (SELECT * FROM vig WHERE mes = v_comp)
  SELECT jsonb_build_object(
    'competencia', to_char(v_comp, 'YYYY-MM'),
    'kpis', (SELECT jsonb_build_object(
        'vigentes', count(*),
        'executavel', round(sum(executavel), 2), 'executado', round(sum(exec_rel), 2), 'faturado', round(sum(bruto), 2),
        'liquido', round(sum(liquido), 2), 'recebido', round(sum(recebido), 2), 'conta_vinculada', round(sum(cv), 2),
        'nao_emitido', round(sum(nao_emitido), 2), 'excesso', round(sum(excesso), 2),
        'lancadas', count(*) FILTER (WHERE status = 'NOTAS_LANCADAS'), 'parciais', count(*) FILTER (WHERE status = 'FATURADO_PARCIAL'),
        'pendentes', count(*) FILTER (WHERE status = 'NENHUM_LANCAMENTO'), 'sem_dados', count(*) FILTER (WHERE status = 'COMPETENCIA_SEM_DADOS'))
      FROM atual),
    'evolucao', coalesce((SELECT jsonb_agg(jsonb_build_object('mes', to_char(mes, 'YYYY-MM'), 'executavel', round(e, 2), 'faturado', round(b, 2), 'recebido', round(r, 2)) ORDER BY mes)
                            FROM (SELECT mes, sum(executavel) e, sum(bruto) b, sum(recebido) r FROM vig GROUP BY 1) t), '[]'::jsonb),
    'pendentes', coalesce((SELECT jsonb_agg(jsonb_build_object('contrato', nome, 'cliente', cliente, 'status', status, 'executavel', round(executavel, 2),
                                   'faturado', round(bruto, 2), 'nao_emitido', round(nao_emitido, 2)) ORDER BY nao_emitido DESC)
                             FROM (SELECT * FROM atual WHERE status IN ('NENHUM_LANCAMENTO', 'FATURADO_PARCIAL') ORDER BY nao_emitido DESC LIMIT 12) t), '[]'::jsonb),
    -- Inadimplência: notas Código N válidas emitidas, sem pagamento, vencidas (emissão + 30 dias, a mesma estimativa do Painel Executivo).
    'inadimplencia', (SELECT jsonb_build_object('valor', round(coalesce(sum(n.vlr_liquido_total), 0), 2), 'notas', count(*),
                               'mais_de_90', round(coalesce(sum(n.vlr_liquido_total) FILTER (WHERE hoje - (n.data_emissao + 30) > 90), 0), 2))
                        FROM public.nf_emissao n
                       WHERE n.deleted_at IS NULL AND n.tipo_nota = 'N' AND n.status::text = 'concluida' AND n.data_emissao IS NOT NULL
                         AND n.data_pagamento IS NULL AND coalesce(n.valor_pago, 0) = 0 AND n.data_emissao + 30 < hoje
                         AND public.tv_fin_nota_valida(n.status::text, n.situacao_site_pmt, n.situacao_dominio)),
    'gerado_em', now()
  ) INTO v_out;
  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.tv_financeiro_dados() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (volta à "competência mais recente do ano com nota Código N"):
-- trocar, no corpo de public.tv_financeiro_dados(), a linha
--   v_comp := (date_trunc('month', hoje) - interval '1 month')::date;
-- por
--   SELECT max(competencia) INTO v_comp FROM public.nf_emissao
--    WHERE deleted_at IS NULL AND tipo_nota = 'N' AND competencia >= date_trunc('year', hoje)::date AND competencia <= hoje;
--   v_comp := coalesce(v_comp, date_trunc('month', hoje)::date);
-- (ou reexecutar o bloco "2) FINANCEIRO" da mig 20261111230000) e NOTIFY pgrst, 'reload schema';
