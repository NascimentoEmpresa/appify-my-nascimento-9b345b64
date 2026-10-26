-- =========================================================================
-- TV SUPPLY = A VISÃO GERAL DO DASHBOARD DE COMPRAS, IGUAL (14/10/2026)
--
-- Pablo, com a TV Supply ao lado do Dashboard de Compras: "tá MUITO diferente
-- ainda as informações, só faz um espelho desse dashboard do suprimentos pro
-- da TV". A 0028 usou as regras do dashboard mas com o MÊS corrente; a tela
-- abre de 01/01 até hoje (filtrosIniciais em DashboardComprasEstoque.tsx).
-- Agora: o mesmo período, os mesmos 8 cartões na mesma ordem (Solicitações,
-- Pendentes, Despachadas, Tempo médio, Cotações, Saving, Saving %, Estoque) e
-- os mesmos gráficos (solicitações por contrato, saving por contrato, motivos
-- das pendências, movimentação de estoque entradas × saídas). Conferido em
-- 14/10: 2.438 · 471 · 1.956 · 7,5 d · 279 · R$ 369,66 · 0,2% — iguais à tela.
-- "Itens com estoque baixo" sai da TV: não está na Visão Geral.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.tvg_calc_espelho(p_codigo text, p_param numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
#variable_conflict use_column
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  ini date := date_trunc('year', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
  v_emp uuid; r jsonb;
BEGIN
  -- ── Supply = Suprimentos › Dashboard de Compras, aba Visão Geral ───────
  -- As MESMAS regras de sup_dashboard_compras_estoque com o filtro que a tela
  -- abre: empresa HAGG, de 01/01 até hoje, sem contrato/categoria/comprador.
  IF p_codigo IN ('sup_solicitacoes', 'sup_pendentes', 'sup_despachados', 'sup_tempo_atendimento') THEN
    v_emp := (SELECT id FROM public.empresas WHERE nome_fantasia = 'HAGG' LIMIT 1);
    WITH pedidos AS (SELECT p.* FROM public.sup_pedido p WHERE p.empresa_id = v_emp AND p.data_solicitacao BETWEEN ini AND hoje),
    por_contrato AS (SELECT coalesce(contrato_nome, 'Sem contrato') AS nome, count(*) AS q,
                            count(*) FILTER (WHERE status = 'DESPACHADO') AS d,
                            count(*) FILTER (WHERE status NOT IN ('DESPACHADO', 'CANCELADO')) AS pend,
                            round(avg(extract(epoch FROM (data_despachado - created_at)) / 86400) FILTER (WHERE data_despachado IS NOT NULL)::numeric, 1) AS tm
                       FROM pedidos GROUP BY 1)
    SELECT jsonb_build_object(
      'valor', CASE p_codigo
                 WHEN 'sup_solicitacoes' THEN (SELECT count(*) FROM pedidos)
                 WHEN 'sup_pendentes' THEN (SELECT count(*) FROM pedidos WHERE status NOT IN ('DESPACHADO', 'CANCELADO'))
                 WHEN 'sup_despachados' THEN (SELECT count(*) FROM pedidos WHERE status = 'DESPACHADO')
                 ELSE COALESCE((SELECT round(avg(extract(epoch FROM (data_despachado - created_at)) / 86400)::numeric, 1) FROM pedidos WHERE data_despachado IS NOT NULL), 0) END,
      'afetado', CASE p_codigo
                   WHEN 'sup_despachados' THEN (SELECT CASE WHEN count(*) = 0 THEN '—' ELSE round(100.0 * count(*) FILTER (WHERE status = 'DESPACHADO') / count(*)) || '% das solicitações' END FROM pedidos)
                   WHEN 'sup_pendentes' THEN 'Em preparação, compra ou envio'
                   WHEN 'sup_tempo_atendimento' THEN 'Da solicitação ao despacho'
                   ELSE 'No período (' || to_char(ini, 'DD/MM') || ' a ' || to_char(hoje, 'DD/MM') || ')' END,
      'base', 'Suprimentos › Dashboard de Compras (Visão Geral) · HAGG · ' || to_char(ini, 'DD/MM/YYYY') || ' a ' || to_char(hoje, 'DD/MM/YYYY'),
      'detalhe', CASE p_codigo
        WHEN 'sup_pendentes' THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', q) ORDER BY q DESC)
            FROM (SELECT CASE status WHEN 'AGUARDANDO COMPRA' THEN 'Aguardando compra' WHEN 'AGUARDANDO ENVIO' THEN 'Aguardando envio'
                                     WHEN 'EM PREPARACAO' THEN 'Em preparação' ELSE initcap(lower(status)) END AS nome, count(*) q
                    FROM pedidos WHERE status NOT IN ('DESPACHADO', 'CANCELADO') GROUP BY status) t), '[]'::jsonb)
        WHEN 'sup_tempo_atendimento' THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', tm, 'rotulo', replace(tm::text, '.', ',') || ' d') ORDER BY q DESC)
            FROM (SELECT * FROM por_contrato WHERE tm IS NOT NULL ORDER BY q DESC LIMIT 6) t), '[]'::jsonb)
        WHEN 'sup_despachados' THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', d) ORDER BY q DESC)
            FROM (SELECT * FROM por_contrato ORDER BY q DESC LIMIT 6) t), '[]'::jsonb)
        ELSE COALESCE((
          -- "Solicitações por Contrato" do dashboard: solicitações × despachadas (pendentes no rótulo).
          SELECT jsonb_agg(jsonb_build_object('nome', nome, 'a', q, 'b', d, 'valor', q, 'rotulo', pend || ' pendente(s)') ORDER BY q DESC)
            FROM (SELECT * FROM por_contrato ORDER BY q DESC LIMIT 6) t), '[]'::jsonb) END)
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo IN ('sup_cotacoes', 'sup_saving', 'sup_saving_pct') THEN
    v_emp := (SELECT id FROM public.empresas WHERE nome_fantasia = 'HAGG' LIMIT 1);
    WITH cm AS (SELECT d.*, c.nome AS contrato_nome, GREATEST(COALESCE(d.valor_total, 0) - COALESCE(d.valor_aprovado_cotacao, 0), 0) AS saving
                  FROM public.malote_despesa d LEFT JOIN public.contratos c ON c.id = d.contrato_id
                 WHERE d.empresa_id = v_emp AND d.cotacao_enviada_em IS NOT NULL AND d.deleted_at IS NULL
                   AND d.cotacao_enviada_em >= ini::timestamptz AND d.cotacao_enviada_em < (hoje + 1)::timestamptz),
    cl AS (SELECT 1 FROM public.cotacoes_licitacao q
            WHERE q.empresa_id = v_emp AND q.created_at >= ini::timestamptz AND q.created_at < (hoje + 1)::timestamptz),
    sc AS (SELECT COALESCE(contrato_nome, 'Sem contrato') AS contrato, sum(COALESCE(valor_total, 0))::numeric AS inicial, sum(saving)::numeric AS saving
             FROM cm WHERE valor_aprovado_cotacao IS NOT NULL GROUP BY 1)
    SELECT jsonb_build_object(
      'valor', CASE p_codigo
                 WHEN 'sup_cotacoes' THEN (SELECT count(*) FROM cm) + (SELECT count(*) FROM cl)
                 WHEN 'sup_saving' THEN COALESCE((SELECT sum(saving) FROM sc), 0)
                 ELSE COALESCE((SELECT round(100 * sum(saving) / nullif(sum(inicial), 0), 1) FROM sc), 0) END,
      'afetado', CASE p_codigo
                   WHEN 'sup_cotacoes' THEN (SELECT count(*) FROM cm) || ' de compras (Malote) · ' || (SELECT count(*) FROM cl) || ' para licitação'
                   ELSE 'Valor inicial − valor aprovado nas cotações' END,
      'base', 'Suprimentos › Dashboard de Compras (Visão Geral) · HAGG · ' || to_char(ini, 'DD/MM/YYYY') || ' a ' || to_char(hoje, 'DD/MM/YYYY'),
      'detalhe', CASE WHEN p_codigo = 'sup_cotacoes'
                      THEN jsonb_build_array(jsonb_build_object('nome', 'Compras (Malote)', 'valor', (SELECT count(*) FROM cm)),
                                             jsonb_build_object('nome', 'Licitação', 'valor', (SELECT count(*) FROM cl)))
                      ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato,
                                       'valor', CASE WHEN p_codigo = 'sup_saving' THEN saving ELSE CASE WHEN inicial > 0 THEN round(100 * saving / inicial, 1) ELSE 0 END END) ORDER BY saving DESC)
                                       FROM (SELECT * FROM sc ORDER BY saving DESC LIMIT 6) t), '[]'::jsonb) END)
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'sup_valor_estoque' THEN
    v_emp := (SELECT id FROM public.empresas WHERE nome_fantasia = 'HAGG' LIMIT 1);
    WITH estoque AS (
      SELECT i.tipo AS categoria, COALESCE(sum(s.disponivel), 0)::numeric AS disponivel, COALESCE(sum(s.disponivel), 0) * ei.valor_unitario AS valor_total
        FROM public.sup_estoque_item ei JOIN public.sup_item i ON i.id = ei.sup_item_id
        LEFT JOIN public.sup_estoque_saldo s ON s.item_estoque_id = ei.id
       WHERE ei.empresa_id = v_emp AND ei.arquivado_em IS NULL
       GROUP BY ei.id, i.tipo, ei.valor_unitario)
    SELECT jsonb_build_object(
      'valor', COALESCE((SELECT round(sum(valor_total), 2) FROM estoque), 0),
      'afetado', (SELECT replace(to_char(COALESCE(sum(disponivel), 0), 'FM999G999G990'), ',', '.') || ' itens disponíveis' FROM estoque),
      'base', 'Suprimentos › Dashboard de Compras (Resumo do Estoque) · HAGG: saldo disponível × valor unitário',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', v) ORDER BY v DESC)
                             FROM (SELECT CASE categoria WHEN 'epi' THEN 'EPI' WHEN 'uniforme' THEN 'Uniformes' WHEN 'insumo' THEN 'Insumos'
                                                         WHEN 'equipamento' THEN 'Equipamentos' ELSE initcap(categoria) END AS nome, round(sum(valor_total), 2) v
                                     FROM estoque GROUP BY categoria) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_calc_espelho(text, numeric) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.tvg_tendencia(p_painel text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  ini  date := (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date) - interval '11 months')::date;
  r jsonb;
BEGIN
  BEGIN
    IF p_painel IN ('ger-operacional', 'ger-rh') THEN
      WITH e AS (SELECT public.rh_data(e."Admissão"::text) AS adm,
                        CASE WHEN e."Situação" = 'Demitido' THEN public.rh_data(e."Data Afastamento"::text) END AS dem
                   FROM public."EMPREGADOS" e)
      SELECT jsonb_build_object('titulo', 'Admissões × demissões por mês', 'series', jsonb_build_array('Admissões', 'Demissões'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT count(*) FROM e WHERE adm >= g AND adm < g + interval '1 month'),
                   'b', (SELECT count(*) FROM e WHERE dem >= g AND dem < g + interval '1 month')) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    ELSIF p_painel = 'ger-licitacoes' THEN
      SELECT jsonb_build_object('titulo', 'Sessões de licitação por mês: ganhas × disputadas', 'series', jsonb_build_array('Ganhas', 'Disputadas'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT count(*) FROM public.grade x WHERE x.data >= g AND x.data < g + interval '1 month' AND x.fase::text = 'Finalizada' AND x.posicao = 1),
                   'b', (SELECT count(*) FROM public.grade x WHERE x.data >= g AND x.data < g + interval '1 month' AND x.fase::text NOT IN ('Não Participado', 'Revogado'))) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    ELSIF p_painel = 'ger-supply' THEN
      -- Igual ao Dashboard de Compras, "Movimentação de Estoque (Entradas x Saídas)": HAGG, de janeiro até hoje (mig 20261014000029).
      SELECT jsonb_build_object('titulo', 'Movimentação de estoque: entradas × saídas', 'series', jsonb_build_array('Entradas', 'Saídas'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT COALESCE(sum(m.quantidade), 0) FROM public.sup_estoque_movimento m
                           JOIN public.sup_estoque_item ei ON ei.id = m.item_estoque_id AND ei.arquivado_em IS NULL
                          WHERE m.empresa_id = (SELECT id FROM public.empresas WHERE nome_fantasia = 'HAGG' LIMIT 1)
                            AND m.tipo IN ('entrada', 'devolucao') AND m.created_at >= g AND m.created_at < g + interval '1 month'),
                   'b', (SELECT COALESCE(sum(abs(m.quantidade)), 0) FROM public.sup_estoque_movimento m
                           JOIN public.sup_estoque_item ei ON ei.id = m.item_estoque_id AND ei.arquivado_em IS NULL
                          WHERE m.empresa_id = (SELECT id FROM public.empresas WHERE nome_fantasia = 'HAGG' LIMIT 1)
                            AND m.tipo IN ('saida', 'remocao') AND m.created_at >= g AND m.created_at < g + interval '1 month')) ORDER BY g))
        INTO r FROM generate_series(date_trunc('year', hoje)::date, hoje, interval '1 month') g;
    ELSIF p_painel = 'ger-frota' THEN
      SELECT jsonb_build_object('titulo', 'Uso da frota por mês: viagens × km rodado (÷ 100)', 'series', jsonb_build_array('Viagens', 'Km ÷ 100'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT count(*) FROM public.cs_veiculo_agendamento a WHERE a.data_inicio >= g AND a.data_inicio < g + interval '1 month' AND coalesce(a.status, '') NOT ILIKE '%cancel%'),
                   'b', (SELECT round(coalesce(sum(a.km_final - a.km_inicial), 0) / 100.0) FROM public.cs_veiculo_agendamento a
                          WHERE a.data_inicio >= g AND a.data_inicio < g + interval '1 month' AND a.km_final >= a.km_inicial)) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    ELSIF p_painel = 'ger-recrutamento' THEN
      SELECT jsonb_build_object('titulo', 'Vagas por mês: solicitadas × contratadas', 'series', jsonb_build_array('Solicitadas', 'Contratadas'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT coalesce(sum(greatest(coalesce(s.quantidade_vagas, 1), 1)), 0) FROM public."SISTEMA_RECRUTAMENTO" s WHERE s.created_at >= g AND s.created_at < g + interval '1 month'),
                   'b', (SELECT coalesce(sum(greatest(coalesce(s.quantidade_vagas, 1), 1)), 0) FROM public."SISTEMA_RECRUTAMENTO" s
                          WHERE (s.status IN ('Contratado', 'Concluída') OR s.status LIKE 'Concluído%') AND s.status_changed_at >= g AND s.status_changed_at < g + interval '1 month')) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    ELSIF p_painel = 'ger-sst' THEN
      WITH e AS (SELECT public.rh_data(e."Data Afastamento"::text) AS afa FROM public."EMPREGADOS" e WHERE e."Situação" NOT IN ('Demitido', 'Trabalhando', 'Férias')),
      d AS (SELECT coalesce(s.data_solicitacao, s.criado_em::date) AS dia FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s)
      SELECT jsonb_build_object('titulo', 'Por mês: afastamentos iniciados × demissionais solicitados', 'series', jsonb_build_array('Afastamentos', 'Demissionais'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT count(*) FROM e WHERE afa >= g AND afa < g + interval '1 month'),
                   'b', (SELECT count(*) FROM d WHERE dia >= g AND dia < g + interval '1 month')) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    ELSIF p_painel = 'ger-treinamento' THEN
      SELECT jsonb_build_object('titulo', 'Plataforma por mês: matrículas × certificados', 'series', jsonb_build_array('Matrículas', 'Certificados'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT count(*) FROM public."TRN_MATRICULA" m WHERE m.inscrito_em >= g AND m.inscrito_em < g + interval '1 month'),
                   'b', (SELECT count(*) FROM public."TRN_CERTIFICADO" c WHERE c.emitido_em >= g AND c.emitido_em < g + interval '1 month')) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    ELSIF p_painel = 'ger-financeiro' THEN
      SELECT jsonb_build_object('titulo', 'Por mês: faturado (NF emitida) × recebido', 'series', jsonb_build_array('Faturado', 'Recebido'), 'unidade', 'brl',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT round(coalesce(sum(n.vlr_liquido_total), 0)) FROM public.nf_emissao n WHERE n.deleted_at IS NULL AND n.status::text <> 'cancelada' AND n.data_emissao >= g AND n.data_emissao < g + interval '1 month'),
                   'b', (SELECT round(coalesce(sum(coalesce(n.valor_pago, n.vlr_liquido_total)), 0)) FROM public.nf_emissao n WHERE n.deleted_at IS NULL AND n.data_pagamento >= g AND n.data_pagamento < g + interval '1 month')) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    ELSIF p_painel = 'ger-juridico' THEN
      SELECT jsonb_build_object('titulo', 'Notificações do cliente por mês: recebidas × encerradas', 'series', jsonb_build_array('Recebidas', 'Encerradas'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT count(*) FROM public."JUR_NOTIFICACOES" n WHERE coalesce(n.data_recebimento, n.created_at::date) >= g AND coalesce(n.data_recebimento, n.created_at::date) < g + interval '1 month'),
                   'b', (SELECT count(*) FROM public."JUR_NOTIFICACOES" n WHERE n.encerrada_em >= g AND n.encerrada_em < g + interval '1 month')) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    ELSIF p_painel IN ('ger-controladoria', 'ger-presidencia') THEN
      r := public.tvg_tendencia_dre();  -- mig 20261014000011 (DRE em cache)
    ELSIF p_painel = 'ger-ti' THEN
      SELECT jsonb_build_object('titulo', 'Chamados de sistemas por mês: abertos × concluídos', 'series', jsonb_build_array('Abertos', 'Concluídos'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT count(*) FROM public."CHAMADO_SISTEMA" c WHERE c.created_at >= g AND c.created_at < g + interval '1 month'),
                   'b', (SELECT count(*) FROM public."CHAMADO_SISTEMA" c WHERE c.concluido_em >= g AND c.concluido_em < g + interval '1 month')) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    r := jsonb_build_object('erro', SQLERRM);
  END;
  RETURN r;
END $function$;

-- ── Cadastro: os 8 cartões da Visão Geral, na ordem da tela ─────────────
UPDATE public."TVG_INDICADOR" SET na_tv = false WHERE codigo = 'sup_abaixo_minimo';
UPDATE public."TVG_INDICADOR" SET ordem = 1, nome = 'Solicitações', regra = 'Dashboard de Compras: solicitações de 01/01 até hoje, empresa HAGG.' WHERE codigo = 'sup_solicitacoes';
UPDATE public."TVG_INDICADOR" SET ordem = 2, nome = 'Pendentes', regra = 'Dashboard de Compras: solicitações do período que não estão Despachadas nem Canceladas (em preparação, compra ou envio).' WHERE codigo = 'sup_pendentes';
UPDATE public."TVG_INDICADOR" SET ordem = 3, nome = 'Despachadas', regra = 'Dashboard de Compras: solicitações do período com status Despachado.' WHERE codigo = 'sup_despachados';
UPDATE public."TVG_INDICADOR" SET ordem = 4, nome = 'Tempo médio', regra = 'Dashboard de Compras: média de dias da solicitação ao despacho, nos pedidos do período já despachados.' WHERE codigo = 'sup_tempo_atendimento';
UPDATE public."TVG_INDICADOR" SET ordem = 5, nome = 'Cotações', regra = 'Dashboard de Compras: cotações de compra enviadas (Malote) + cotações para licitação, no período.' WHERE codigo = 'sup_cotacoes';
UPDATE public."TVG_INDICADOR" SET ordem = 8, nome = 'Estoque', regra = 'Dashboard de Compras: saldo disponível × valor unitário dos itens não arquivados.' WHERE codigo = 'sup_valor_estoque';
INSERT INTO public."TVG_INDICADOR"
  (codigo, painel, ordem, nome, identificar, fonte, unidade, sentido, meta, alerta, periodicidade, responsavel, parametro, parametro_rotulo, pai, na_tv, espelho_de, componentes, regra)
VALUES
 ('sup_saving', 'ger-supply', 6, 'Saving', 'Quanto as cotações economizaram.', 'auto', 'brl', 'maior', NULL, NULL, 'diaria', 'Supply', NULL, NULL, NULL, true, NULL, NULL,
  'Dashboard de Compras: valor inicial − valor aprovado nas cotações do Malote aprovadas no período. Detalhe: saving por contrato.'),
 ('sup_saving_pct', 'ger-supply', 7, 'Saving %', 'A economia sobre o valor inicial das cotações.', 'auto', 'pct', 'maior', NULL, NULL, 'diaria', 'Supply', NULL, NULL, NULL, true, NULL, NULL,
  'Dashboard de Compras: saving ÷ valor inicial das cotações aprovadas no período.')
ON CONFLICT (codigo) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- reaplicar a 20261014000028 (mês corrente); DELETE FROM public."TVG_INDICADOR" WHERE codigo IN ('sup_saving', 'sup_saving_pct');
-- UPDATE public."TVG_INDICADOR" SET na_tv = true WHERE codigo = 'sup_abaixo_minimo';
