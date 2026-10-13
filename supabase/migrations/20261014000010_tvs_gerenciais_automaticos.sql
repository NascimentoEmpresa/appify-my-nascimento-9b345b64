-- =========================================================================
-- TVs GERENCIAIS: TUDO CALCULADO DO ERP + TENDÊNCIA DE 12 MESES (14/10/2026)
--
-- PEDIDO (Pablo): "por que tá tudo zerado? eu preciso que os indicadores
-- gerenciais puxem AUTOMATICAMENTE, nada a preencher. E seja um dashboard
-- pra TV, não cada um no seu quadrado — dashboard completo com gráficos e
-- números reais."
--
-- POR QUE ESTAVA ZERADO: 43 dos 98 indicadores (mig 20261012000001) eram
-- fonte 'manual' — esperavam alguém lançar o número em TVG_LANCAMENTO, e
-- ninguém lançou. Na TV: "Aguardando lançamento".
--
-- O QUE MUDA
--   1) tvg_calc_extra(): o cálculo de cada indicador que era manual, a partir
--      do que o ERP já tem. tvg_resultado tenta tvg_calc e, sem resposta,
--      tvg_calc_extra — o tvg_calc de 12/10 fica intacto.
--        · Controladoria/lucratividade/custo: DRE gerencial por contrato
--          (mz_60, última competência com receita);
--        · faltas/absenteísmo/acidentes: situação na folha (EMPREGADOS);
--        · salários: folha-base (EMPREGADOS."Valor Salário") × faturamento
--          mensal do contrato (contratos.valor_mensal_contratado);
--        · fluxo de caixa: NF a receber − despesas do Malote a pagar (30 d);
--        · ASO: admissões na etapa SST + demissionais aguardando SST;
--        · treinamento: matrículas × certificados da plataforma (TRN_*);
--        · frota: anexos do patrimônio, km das viagens, atualização do cadastro;
--        · jurídico: valores e medidas preventivas dos processos/notificações;
--        · TI: TVs sem sinal e atraso do espelho da Senior.
--      Indicador sem NENHUMA fonte no ERP ganhou um substituto que mede o
--      mesmo risco com dado real (nome e regra novos, ver o UPDATE abaixo).
--      Os subindicadores sem fonte (eSocial, banco de horas, restrição
--      médica…) saem de cena (ativo = false) — não ficam "sem dado" na TV.
--   2) Nenhum indicador fica 'manual': fonte = 'auto' em todos os ativos.
--   3) tvg_tendencia(painel): uma série de 12 meses com dado real para o
--      gráfico grande do dashboard de cada TV, devolvida em tvg_painel_dados.
--
-- PRIVACIDADE: igual ao resto — nenhum cálculo devolve nome de pessoa.
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

-- ── 0) Ajudante: texto numérico com ponto decimal (o DRE da migração) ────
CREATE OR REPLACE FUNCTION public.tvg_num_ponto(p text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN btrim(coalesce(p, '')) ~ '^-?[0-9]+(\.[0-9]+)?$' THEN btrim(p)::numeric END
$$;

-- DRE por contrato e competência: receita, custo, despesa (valores positivos).
CREATE OR REPLACE FUNCTION public.tvg_dre_contratos()
RETURNS TABLE(competencia text, contrato text, receita numeric, custo numeric, despesa numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT d.periodo_competencia, coalesce(nullif(btrim(d.contrato), ''), 'Sem contrato'),
         sum(public.tvg_num_ponto(d.valor_dre)) FILTER (WHERE d.linha_dre = 'RECEITA'),
         -sum(public.tvg_num_ponto(d.valor_dre)) FILTER (WHERE d.linha_dre = 'CUSTO'),
         -sum(public.tvg_num_ponto(d.valor_dre)) FILTER (WHERE d.linha_dre = 'DESPESA')
    FROM public.mz_60_view_dre_gerencial_competencia d
   WHERE d.periodo_competencia ~ '^\d{4}-\d{2}$'
   GROUP BY 1, 2
$$;
REVOKE ALL ON FUNCTION public.tvg_dre_contratos() FROM PUBLIC, anon, authenticated;

-- Última competência COMPLETA do DRE: a mais recente com receita de pelo menos
-- metade da média das 6 anteriores (a carga traz o mês corrente pela metade —
-- 05/2026 tinha R$ 730 mil contra ~R$ 6 mi dos meses fechados).
CREATE OR REPLACE FUNCTION public.tvg_dre_competencia()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH t AS (SELECT competencia, sum(receita) AS rec FROM public.tvg_dre_contratos() GROUP BY 1 HAVING sum(receita) > 0),
  m AS (SELECT competencia, rec, avg(rec) OVER (ORDER BY competencia ROWS BETWEEN 6 PRECEDING AND 1 PRECEDING) AS media FROM t)
  SELECT competencia FROM m WHERE media IS NULL OR rec >= media * 0.5 ORDER BY competencia DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.tvg_dre_competencia() FROM PUBLIC, anon, authenticated;

-- ── 1) Os cálculos que eram lançamento manual ────────────────────────────
CREATE OR REPLACE FUNCTION public.tvg_calc_extra(p_codigo text, p_param numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
#variable_conflict use_column
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  r jsonb;
  v_comp text;
BEGIN
  -- ── DRE: lucratividade, margem, contratos vermelhos, desvio de custo ──
  IF p_codigo IN ('op_lucratividade', 'ctl_margem', 'ctl_vermelhos', 'op_custo_direto', 'ctl_desvio', 'ctl_reincidentes') THEN
    v_comp := public.tvg_dre_competencia();
    IF v_comp IS NULL THEN RETURN jsonb_build_object('valor', NULL, 'observacao', 'DRE gerencial ainda sem competência com receita'); END IF;

    IF p_codigo IN ('op_lucratividade', 'ctl_margem', 'ctl_vermelhos') THEN
      WITH d AS (SELECT contrato, receita, coalesce(custo, 0) AS custo,
                        round(100 * (receita - coalesce(custo, 0)) / receita, 1) AS margem
                   FROM public.tvg_dre_contratos() WHERE competencia = v_comp AND receita >= 10000),  -- receita residual distorce a margem
      f AS (SELECT * FROM d WHERE (p_codigo = 'op_lucratividade')
                               OR (p_codigo = 'ctl_margem' AND margem < coalesce(p_param, 10))
                               OR (p_codigo = 'ctl_vermelhos' AND margem < 0))
      SELECT jsonb_build_object(
        'valor', CASE WHEN p_codigo = 'op_lucratividade'
                      THEN (SELECT round(100 * (sum(receita) - sum(custo)) / nullif(sum(receita), 0), 1) FROM d)
                      ELSE (SELECT count(*) FROM f) END,
        'impacto', (SELECT sum(least(receita - custo, 0)) FROM f),
        'afetado', (SELECT count(*) FILTER (WHERE margem < 0) || ' no prejuízo · ' || count(*) FILTER (WHERE margem < coalesce(p_param, 10)) || ' abaixo de '
                           || coalesce(p_param, 10)::int || '% de margem' FROM d),
        'causa', (SELECT 'Pior margem: ' || contrato || ' (' || replace(margem::text, '.', ',') || '%)' FROM d ORDER BY margem LIMIT 1),
        'base', 'DRE gerencial · competência ' || to_char(to_date(v_comp, 'YYYY-MM'), 'MM/YYYY') || ' · ' || (SELECT count(*) FROM d) || ' contratos',
        'referencia', v_comp,
        'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', margem,
                                     'rotulo', replace(margem::text, '.', ',') || '% · receita R$ ' || replace(to_char(receita, 'FM999G999G990'), ',', '.')) ORDER BY margem)
                               FROM (SELECT * FROM f ORDER BY margem LIMIT 12) t), '[]'::jsonb))
        INTO r;
      RETURN r;
    END IF;

    IF p_codigo IN ('op_custo_direto', 'ctl_desvio') THEN
      -- Custo da competência × a média das 3 anteriores, por contrato.
      WITH m AS (SELECT competencia FROM public.tvg_dre_contratos() WHERE competencia <= v_comp GROUP BY 1 ORDER BY 1 DESC LIMIT 4),
      d AS (SELECT t.contrato,
                   sum(t.custo) FILTER (WHERE t.competencia = v_comp) AS atual,
                   avg(t.custo) FILTER (WHERE t.competencia < v_comp) AS media
              FROM public.tvg_dre_contratos() t JOIN m ON m.competencia = t.competencia GROUP BY 1),
      x AS (SELECT contrato, atual, media, round(100 * (atual - media) / media, 1) AS pct FROM d WHERE media > 1000 AND atual IS NOT NULL),
      f AS (SELECT * FROM x WHERE pct > coalesce(p_param, 10))
      SELECT jsonb_build_object(
        'valor', CASE WHEN p_codigo = 'op_custo_direto'
                      THEN (SELECT round(100 * (sum(atual) - sum(media)) / nullif(sum(media), 0), 1) FROM x)
                      ELSE (SELECT count(*) FROM f) END,
        'impacto', (SELECT sum(atual - media) FROM f),
        'afetado', (SELECT count(*) || ' contrato(s) com custo ' || coalesce(p_param, 10)::int || '%+ acima da média' FROM f),
        'causa', (SELECT 'Maior alta: ' || contrato || ' (+' || replace(pct::text, '.', ',') || '%)' FROM f ORDER BY atual - media DESC LIMIT 1),
        'base', 'Custo da competência ' || to_char(to_date(v_comp, 'YYYY-MM'), 'MM/YYYY') || ' × média dos 3 meses anteriores (DRE)',
        'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', pct, 'rotulo', '+' || replace(pct::text, '.', ',') || '%') ORDER BY pct DESC)
                               FROM (SELECT * FROM f ORDER BY pct DESC LIMIT 12) t), '[]'::jsonb))
        INTO r;
      RETURN r;
    END IF;

    -- ctl_reincidentes: abaixo da margem mínima nas 3 últimas competências.
    WITH m AS (SELECT competencia FROM public.tvg_dre_contratos() WHERE competencia <= v_comp AND coalesce(receita, 0) > 0 GROUP BY 1 ORDER BY 1 DESC LIMIT 3),
    d AS (SELECT t.contrato, count(*) FILTER (WHERE 100 * (t.receita - coalesce(t.custo, 0)) / t.receita < coalesce(p_param, 10)) AS ruins,
                 round(avg(100 * (t.receita - coalesce(t.custo, 0)) / t.receita), 1) AS media
            FROM public.tvg_dre_contratos() t JOIN m ON m.competencia = t.competencia WHERE t.receita > 0 GROUP BY 1),
    f AS (SELECT * FROM d WHERE ruins >= 3)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM f),
      'afetado', (SELECT count(*) || ' contrato(s) · 3 competências seguidas abaixo de ' || coalesce(p_param, 10)::int || '%' FROM f),
      'causa', (SELECT 'Mais crítico: ' || contrato || ' (média ' || replace(media::text, '.', ',') || '%)' FROM f ORDER BY media LIMIT 1),
      'base', 'DRE gerencial · 3 últimas competências até ' || to_char(to_date(v_comp, 'YYYY-MM'), 'MM/YYYY'),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', media, 'rotulo', 'margem média ' || replace(media::text, '.', ',') || '%') ORDER BY media)
                             FROM (SELECT * FROM f ORDER BY media LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Faltas / absenteísmo (situação na folha, hoje) ────────────────────
  IF p_codigo IN ('op_faltas', 'rh_absenteismo') THEN
    WITH e AS (SELECT public.rh_norm_contrato(e."Nome Filial") AS nn, e."Situação" AS sit
                 FROM public."EMPREGADOS" e WHERE e."Situação" <> 'Demitido' AND e."Nome Filial" IS NOT NULL),
    c AS (SELECT c.nome, public.dir_rel_contrato_nn(c.id) AS nn FROM public.contratos c WHERE c.status = 'ativo'),
    j AS (SELECT c.nome, count(*) AS ativos,
                 count(*) FILTER (WHERE (p_codigo = 'op_faltas' AND (e.sit ILIKE 'Atestado%' OR e.sit ILIKE 'Falta%'))
                                     OR (p_codigo = 'rh_absenteismo' AND e.sit NOT IN ('Trabalhando', 'Férias'))) AS fora
            FROM c JOIN e ON e.nn = c.nn GROUP BY 1),
    t AS (SELECT nome, ativos, fora, round(100.0 * fora / ativos, 1) AS pct FROM j WHERE ativos >= 5)
    SELECT jsonb_build_object(
      'valor', (SELECT round(100.0 * sum(fora) / nullif(sum(ativos), 0), 1) FROM t),
      'afetado', (SELECT count(*) FILTER (WHERE pct > coalesce(p_param, 3)) || ' contrato(s) acima de ' || coalesce(p_param, 3)::int || '%' FROM t),
      'causa', (SELECT "Situação" || ' (' || count(*) || ')' FROM public."EMPREGADOS"
                 WHERE "Situação" <> 'Demitido' AND ((p_codigo = 'op_faltas' AND ("Situação" ILIKE 'Atestado%' OR "Situação" ILIKE 'Falta%'))
                                                     OR (p_codigo = 'rh_absenteismo' AND "Situação" NOT IN ('Trabalhando', 'Férias')))
                 GROUP BY "Situação" ORDER BY count(*) DESC LIMIT 1),
      'base', (SELECT sum(fora) || ' de ' || sum(ativos) || ' colaboradores ativos, hoje' FROM t),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', pct, 'rotulo', fora || ' de ' || ativos) ORDER BY pct DESC)
                             FROM (SELECT * FROM t WHERE fora > 0 ORDER BY pct DESC LIMIT 12) z), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Reclamações do cliente (notificações que não são glosa/multa) ─────
  IF p_codigo = 'op_reclamacoes' THEN
    WITH n AS (SELECT coalesce(nullif(btrim(n.contrato), ''), n.orgao, 'Sem contrato') AS contrato,
                      coalesce(nullif(btrim(n.causa_raiz), ''), nullif(btrim(n.assunto), ''), n.tipo, 'Sem causa registrada') AS causa
                 FROM public."JUR_NOTIFICACOES" n
                WHERE coalesce(n.tipo, '') NOT IN ('Glosa', 'Multa')
                  AND coalesce(n.data_recebimento, n.created_at::date) >= hoje - coalesce(p_param, 90)::int)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM n),
      'afetado', (SELECT count(DISTINCT contrato) || ' contrato(s) · últimos ' || coalesce(p_param, 90)::int || ' dias' FROM n),
      'causa', (SELECT left(causa, 80) || ' (' || count(*) || ')' FROM n GROUP BY causa ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', q) ORDER BY q DESC)
                             FROM (SELECT contrato, count(*) q FROM n GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Salários: folha-base sobre o faturamento do contrato ──────────────
  IF p_codigo = 'rh_salarios' THEN
    WITH e AS (SELECT public.rh_norm_contrato(e."Nome Filial") AS nn, public.tvg_num_br(e."Valor Salário"::text) AS sal
                 FROM public."EMPREGADOS" e WHERE e."Situação" <> 'Demitido' AND e."Nome Filial" IS NOT NULL),
    c AS (SELECT c.nome, c.valor_mensal_contratado AS fat, public.dir_rel_contrato_nn(c.id) AS nn
            FROM public.contratos c WHERE c.status = 'ativo' AND coalesce(c.valor_mensal_contratado, 0) > 0),
    t AS (SELECT c.nome, c.fat, sum(e.sal) AS folha, round(100 * sum(e.sal) / c.fat, 1) AS pct
            FROM c JOIN e ON e.nn = c.nn GROUP BY c.nome, c.fat HAVING sum(e.sal) > 0),
    f AS (SELECT * FROM t WHERE pct > coalesce(p_param, 60))
    SELECT jsonb_build_object(
      'valor', (SELECT round(100 * sum(folha) / nullif(sum(fat), 0), 1) FROM t),
      'impacto', (SELECT sum(folha - fat * coalesce(p_param, 60) / 100) FROM f),
      'afetado', (SELECT count(*) || ' contrato(s) com folha acima de ' || coalesce(p_param, 60)::int || '% do faturamento' FROM f),
      'causa', (SELECT 'Maior peso: ' || nome || ' (' || replace(pct::text, '.', ',') || '%)' FROM t ORDER BY pct DESC LIMIT 1),
      'base', 'Salário-base dos ativos (folha Senior) ÷ valor mensal contratado',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', pct, 'rotulo', replace(pct::text, '.', ',') || '% do faturamento') ORDER BY pct DESC)
                             FROM (SELECT * FROM t ORDER BY pct DESC LIMIT 12) z), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Contratos de experiência vencendo ─────────────────────────────────
  IF p_codigo = 'rh_ob_experiencia' THEN
    WITH e AS (SELECT coalesce(nullif(btrim(e."Nome Filial"), ''), 'Sem contrato') AS contrato, hoje - public.rh_data(e."Admissão"::text) AS dias
                 FROM public."EMPREGADOS" e WHERE e."Situação" <> 'Demitido'),
    f AS (SELECT contrato, CASE WHEN dias BETWEEN 45 - coalesce(p_param, 15)::int AND 45 THEN '1º período (45 d)' ELSE '2º período (90 d)' END AS marco
            FROM e WHERE dias BETWEEN 45 - coalesce(p_param, 15)::int AND 45 OR dias BETWEEN 90 - coalesce(p_param, 15)::int AND 90)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM f),
      'afetado', (SELECT count(DISTINCT contrato) || ' contrato(s)' FROM f),
      'causa', (SELECT marco || ' (' || count(*) || ')' FROM f GROUP BY marco ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', q) ORDER BY q DESC)
                             FROM (SELECT contrato, count(*) q FROM f GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Fluxo de caixa: NF a receber − Malote a pagar, próximos N dias ────
  IF p_codigo = 'fin_fluxo' THEN
    WITH ent AS (SELECT n.data_emissao + 30 AS dia, coalesce(n.vlr_liquido_total, 0) AS v
                   FROM public.nf_emissao n
                  WHERE n.deleted_at IS NULL AND n.status::text = 'concluida' AND n.data_pagamento IS NULL
                    AND n.data_emissao + 30 BETWEEN hoje AND hoje + coalesce(p_param, 30)::int),
    sai AS (SELECT d.data_pagamento AS dia, coalesce(d.valor_aprovado, d.valor_total, 0) AS v
              FROM public.malote_despesa d
             WHERE d.deleted_at IS NULL AND d.pago_em IS NULL AND coalesce(d.status, '') NOT ILIKE ANY (ARRAY['%cancel%', '%reprov%', '%pag%'])
               AND d.data_pagamento BETWEEN hoje AND hoje + coalesce(p_param, 30)::int),
    sem AS (SELECT gs::date AS ini FROM generate_series(date_trunc('week', hoje)::date, hoje + coalesce(p_param, 30)::int, interval '7 days') gs)
    SELECT jsonb_build_object(
      'valor', COALESCE((SELECT sum(v) FROM ent), 0) - COALESCE((SELECT sum(v) FROM sai), 0),
      'impacto', COALESCE((SELECT sum(v) FROM sai), 0),
      'afetado', 'Entra R$ ' || replace(to_char(COALESCE((SELECT sum(v) FROM ent), 0), 'FM999G999G990'), ',', '.')
                 || ' · sai R$ ' || replace(to_char(COALESCE((SELECT sum(v) FROM sai), 0), 'FM999G999G990'), ',', '.'),
      'causa', (SELECT CASE WHEN COALESCE((SELECT sum(v) FROM ent), 0) < COALESCE((SELECT sum(v) FROM sai), 0) THEN 'Saídas previstas maiores que as entradas' END),
      'base', 'Próximos ' || coalesce(p_param, 30)::int || ' dias: NFs emitidas sem baixa (vencimento em 30 d) − despesas do Malote a pagar',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', 'Semana de ' || to_char(s.ini, 'DD/MM'),
                                   'a', COALESCE((SELECT sum(v) FROM ent WHERE dia >= s.ini AND dia < s.ini + 7), 0),
                                   'b', COALESCE((SELECT sum(v) FROM sai WHERE dia >= s.ini AND dia < s.ini + 7), 0),
                                   'valor', COALESCE((SELECT sum(v) FROM ent WHERE dia >= s.ini AND dia < s.ini + 7), 0)
                                            - COALESCE((SELECT sum(v) FROM sai WHERE dia >= s.ini AND dia < s.ini + 7), 0)) ORDER BY s.ini)
                             FROM sem s), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── SST ───────────────────────────────────────────────────────────────
  IF p_codigo IN ('sst_aso', 'sst_imp_aso') THEN
    WITH a AS (
      SELECT 'Admissional' AS tipo, coalesce(nullif(btrim(v.contrato), ''), 'Sem contrato') AS contrato,
             hoje - coalesce(c.etapa_changed_at, c.created_at)::date AS dias
        FROM public."WA_CURRICULOS" c LEFT JOIN public."SISTEMA_RECRUTAMENTO" v ON v.id = c.vaga_id
       WHERE c.etapa_processo = 'SST + COMPRAS' AND NOT coalesce(c.desistiu, false)
      UNION ALL
      SELECT 'Demissional', coalesce(nullif(btrim(s.contrato), ''), 'Sem contrato'), hoje - coalesce(s.data_solicitacao, s.criado_em::date)
        FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s
       WHERE s.status IN ('Pendente SST', 'Solicitação de agendamento de DEMISSIONAL recebida'))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM a),
      'afetado', (SELECT count(*) FILTER (WHERE dias > coalesce(p_param, 5)) || ' há mais de ' || coalesce(p_param, 5)::int || ' dias' FROM a),
      'causa', (SELECT tipo || ' (' || count(*) || ')' FROM a GROUP BY tipo ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', tipo, 'valor', q) ORDER BY q DESC) FROM (SELECT tipo, count(*) q FROM a GROUP BY 1) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo IN ('sst_epi', 'sst_imp_epi') THEN
    -- Pedidos de uniforme/EPI parados além do prazo (o EPI que não chegou ao posto).
    WITH p AS (SELECT coalesce(nullif(btrim(p.contrato_nome), ''), 'Sem contrato') AS contrato, p.status, hoje - p.data_solicitacao AS dias
                 FROM public.sup_pedido p
                WHERE p.tipo_pedido IN ('uniforme', 'ambos')
                  AND p.status IN ('AGUARDANDO COMPRA', 'AGUARDANDO ENVIO', 'EM PREPARACAO', 'EM SEPARACAO')
                  AND p.data_solicitacao < hoje - coalesce(p_param, 10)::int)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM p),
      'afetado', (SELECT count(DISTINCT contrato) || ' contrato(s)' || COALESCE(' · mais antigo: ' || max(dias) || ' d', '') FROM p),
      'causa', (SELECT initcap(lower(status)) || ' (' || count(*) || ')' FROM p GROUP BY status ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', initcap(lower(status)), 'valor', q) ORDER BY q DESC) FROM (SELECT status, count(*) q FROM p GROUP BY 1) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'sst_acidentes' THEN
    WITH e AS (SELECT coalesce(nullif(btrim(e."Nome Filial"), ''), 'Sem contrato') AS contrato, e."Situação" AS sit
                 FROM public."EMPREGADOS" e
                WHERE e."Situação" ILIKE '%acident%' OR e."Descrição (Causa)" ILIKE '%acident%' AND e."Situação" <> 'Demitido')
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM e),
      'afetado', (SELECT count(DISTINCT contrato) || ' contrato(s)' FROM e),
      'causa', (SELECT sit || ' (' || count(*) || ')' FROM e GROUP BY sit ORDER BY count(*) DESC LIMIT 1),
      'base', 'Afastados por acidente na folha, hoje',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', q) ORDER BY q DESC) FROM (SELECT contrato, count(*) q FROM e GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Treinamento (plataforma) ──────────────────────────────────────────
  IF p_codigo IN ('trn_contratuais', 'trn_vencidos', 'sst_imp_treinamento') THEN
    WITH m AS (SELECT coalesce(nullif(btrim(a.contrato), ''), 'Sem contrato') AS contrato, c.nome AS curso, hoje - m.inscrito_em AS dias, a.expira_em
                 FROM public."TRN_MATRICULA" m
                 JOIN public."TRN_ALUNO" a ON a.id = m.aluno_id AND a.status = 'ativo'
                 JOIN public."TRN_CURSO" c ON c.id = m.curso_id
                WHERE NOT EXISTS (SELECT 1 FROM public."TRN_CERTIFICADO" ce WHERE ce.aluno_id = m.aluno_id AND ce.curso_id = m.curso_id)),
    f AS (SELECT * FROM m WHERE (p_codigo = 'trn_contratuais' AND dias > coalesce(p_param, 30))
                             OR (p_codigo IN ('trn_vencidos', 'sst_imp_treinamento') AND expira_em IS NOT NULL AND expira_em <= hoje + coalesce(p_param, 15)::int))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM f),
      'afetado', (SELECT count(DISTINCT contrato) || ' contrato(s) · ' || count(DISTINCT curso) || ' curso(s)' FROM f),
      'causa', (SELECT 'Mais pendente: ' || curso || ' (' || count(*) || ')' FROM f GROUP BY curso ORDER BY count(*) DESC LIMIT 1),
      'base', CASE WHEN p_codigo = 'trn_contratuais' THEN 'Matrículas sem certificado há mais de ' || coalesce(p_param, 30)::int || ' dias'
                   ELSE 'Acesso vencido ou vencendo em ' || coalesce(p_param, 15)::int || ' dias, sem certificado' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', q) ORDER BY q DESC) FROM (SELECT contrato, count(*) q FROM f GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo IN ('trn_programados', 'trn_sem_comprovacao') THEN
    WITH mes AS (SELECT date_trunc('month', hoje)::date AS ini),
    mat AS (SELECT count(*) n FROM public."TRN_MATRICULA" m, mes WHERE m.inscrito_em >= mes.ini),
    cer AS (SELECT count(*) n FROM public."TRN_CERTIFICADO" c, mes WHERE c.emitido_em >= mes.ini),
    serie AS (SELECT to_char(g, 'MM/YY') AS nome, g AS ini,
                     (SELECT count(*) FROM public."TRN_MATRICULA" m WHERE m.inscrito_em >= g AND m.inscrito_em < g + interval '1 month') AS a,
                     (SELECT count(*) FROM public."TRN_CERTIFICADO" c WHERE c.emitido_em >= g AND c.emitido_em < g + interval '1 month') AS b
                FROM generate_series(date_trunc('month', hoje) - interval '5 months', date_trunc('month', hoje), interval '1 month') g)
    SELECT jsonb_build_object(
      'valor', CASE WHEN p_codigo = 'trn_programados'
                    THEN (SELECT CASE WHEN mat.n = 0 THEN 100 ELSE round(100.0 * cer.n / mat.n) END FROM mat, cer)
                    ELSE (SELECT count(*) FROM public."TRN_MATRICULA" m
                           WHERE m.inscrito_em < hoje - coalesce(p_param, 60)::int
                             AND NOT EXISTS (SELECT 1 FROM public."TRN_CERTIFICADO" c WHERE c.aluno_id = m.aluno_id AND c.curso_id = m.curso_id)) END,
      'afetado', (SELECT cer.n || ' certificado(s) para ' || mat.n || ' matrícula(s) no mês' FROM mat, cer),
      'base', CASE WHEN p_codigo = 'trn_programados' THEN 'Certificados emitidos ÷ matrículas do mês'
                   ELSE 'Matrículas com mais de ' || coalesce(p_param, 60)::int || ' dias sem certificado' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'a', a, 'b', b, 'valor', b) ORDER BY ini) FROM serie), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Frota e patrimônio ────────────────────────────────────────────────
  IF p_codigo = 'fro_documentos' THEN
    WITH v AS (SELECT p.nome || coalesce(' · ' || p.identificador, '') AS nome, coalesce(nullif(btrim(p.lotacao), ''), 'Sem lotação') AS lot
                 FROM public.sup_patrimonio p
                WHERE p.categoria = 'veiculo' AND p.ativo
                  AND NOT EXISTS (SELECT 1 FROM public.sup_patrimonio_arquivo a WHERE a.patrimonio_id = p.id))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM v),
      'afetado', (SELECT count(DISTINCT lot) || ' lotação(ões)' FROM v),
      'causa', CASE WHEN (SELECT count(*) FROM v) > 0 THEN 'Veículo sem CRLV/documento anexado no cadastro' END,
      'base', (SELECT count(*) || ' veículos ativos' FROM public.sup_patrimonio WHERE categoria = 'veiculo' AND ativo),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', lot, 'valor', q) ORDER BY q DESC) FROM (SELECT lot, count(*) q FROM v GROUP BY 1) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'fro_combustivel' THEN
    -- Sem lançamento de combustível no ERP: o controle de km das viagens é o que existe.
    WITH a AS (SELECT coalesce(a.veiculo_nome, 'Veículo') || coalesce(' · ' || a.veiculo_identificador, '') AS veiculo,
                      a.km_inicial, a.km_final, a.data_fim
                 FROM public.cs_veiculo_agendamento a
                WHERE a.controle_km AND coalesce(a.status, '') NOT ILIKE '%cancel%'
                  AND a.data_fim BETWEEN hoje - coalesce(p_param, 60)::int AND hoje - 1),
    f AS (SELECT * FROM a WHERE km_inicial IS NULL OR km_final IS NULL)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM f),
      'afetado', (SELECT count(DISTINCT veiculo) || ' veículo(s) · ' || (SELECT count(*) FROM a) || ' viagens no período' FROM f),
      'causa', CASE WHEN (SELECT count(*) FROM f) > 0 THEN 'Viagem encerrada sem km inicial/final registrado' END,
      'base', 'Últimos ' || coalesce(p_param, 60)::int || ' dias · km rodado: ' ||
              (SELECT replace(to_char(coalesce(sum(km_final - km_inicial) FILTER (WHERE km_final >= km_inicial), 0), 'FM999G999G990'), ',', '.') FROM a) || ' km',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', veiculo, 'valor', km, 'rotulo', km || ' km') ORDER BY km DESC)
                             FROM (SELECT veiculo, sum(km_final - km_inicial) km FROM a WHERE km_final >= km_inicial GROUP BY 1 ORDER BY 2 DESC LIMIT 10) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'fro_nao_localizados' THEN
    -- Patrimônio sem nenhuma movimentação/atualização há N dias = inventário a conferir.
    WITH p AS (SELECT initcap(p.categoria) AS cat, hoje - greatest(p.updated_at, (SELECT max(l.created_at) FROM public.sup_patrimonio_log l WHERE l.patrimonio_id = p.id))::date AS dias
                 FROM public.sup_patrimonio p WHERE p.ativo),
    f AS (SELECT * FROM p WHERE dias > coalesce(p_param, 180))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM f),
      'afetado', (SELECT count(*) || ' de ' || (SELECT count(*) FROM p) || ' patrimônios ativos' FROM f),
      'causa', CASE WHEN (SELECT count(*) FROM f) > 0 THEN 'Sem conferência/movimentação há mais de ' || coalesce(p_param, 180)::int || ' dias' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', cat, 'valor', q) ORDER BY q DESC) FROM (SELECT cat, count(*) q FROM f GROUP BY 1) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Jurídico ──────────────────────────────────────────────────────────
  IF p_codigo = 'jur_contratos_analise' THEN
    WITH n AS (SELECT coalesce(nullif(btrim(n.contrato), ''), n.orgao, 'Sem contrato') AS contrato, hoje - n.medida_prazo AS atraso
                 FROM public."JUR_NOTIFICACOES" n
                WHERE nullif(btrim(n.medida_preventiva), '') IS NOT NULL AND NOT coalesce(n.medida_concluida, false) AND n.medida_prazo < hoje)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM n),
      'afetado', (SELECT count(DISTINCT contrato) || ' contrato(s)' || COALESCE(' · mais atrasada: ' || max(atraso) || ' d', '') FROM n),
      'causa', CASE WHEN (SELECT count(*) FROM n) > 0 THEN 'Medida preventiva vencida, não concluída' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', q, 'rotulo', q || ' · até ' || m || ' d') ORDER BY q DESC)
                             FROM (SELECT contrato, count(*) q, max(atraso) m FROM n GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo IN ('jur_risco', 'jur_valor_condenacao', 'jur_valor_acordo') THEN
    WITH p AS (SELECT coalesce(nullif(btrim(p.contrato), ''), p.comarca, 'Sem contrato') AS contrato,
                      coalesce(p.valor_pedidos, p.valor_causa, 0)::numeric AS pedidos,
                      coalesce(p.valor_sentenca, 0)::numeric AS sentenca, coalesce(p.valor_acordo, 0) AS acordo
                 FROM public."JUR_PROCESSOS" p WHERE p.status = 'EM ANDAMENTO'),
    f AS (SELECT *, CASE WHEN pedidos >= 200000 THEN 'R$ 200 mil ou mais' WHEN pedidos >= 100000 THEN 'R$ 100 a 200 mil'
                         WHEN pedidos >= 50000 THEN 'R$ 50 a 100 mil' ELSE 'Até R$ 50 mil' END AS faixa FROM p)
    SELECT jsonb_build_object(
      'valor', CASE p_codigo WHEN 'jur_risco' THEN (SELECT count(*) FROM f WHERE pedidos >= coalesce(p_param, 100000))
                             WHEN 'jur_valor_condenacao' THEN (SELECT sum(sentenca) FROM f)
                             ELSE (SELECT sum(acordo) FROM f) END,
      'impacto', (SELECT sum(pedidos) FILTER (WHERE pedidos >= coalesce(p_param, 100000)) FROM f),
      'afetado', (SELECT count(*) || ' processos em andamento · R$ ' || replace(to_char(sum(pedidos), 'FM999G999G990'), ',', '.') || ' em pedidos' FROM f),
      'causa', (SELECT 'Maior exposição: ' || contrato FROM f GROUP BY contrato ORDER BY sum(pedidos) DESC LIMIT 1),
      'detalhe', CASE WHEN p_codigo = 'jur_risco'
                      THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', faixa, 'valor', q) ORDER BY q DESC) FROM (SELECT faixa, count(*) q FROM f GROUP BY 1) t), '[]'::jsonb)
                      ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', s) ORDER BY s DESC)
                                       FROM (SELECT contrato, sum(CASE WHEN p_codigo = 'jur_valor_condenacao' THEN sentenca ELSE acordo END) s
                                               FROM f GROUP BY 1 HAVING sum(CASE WHEN p_codigo = 'jur_valor_condenacao' THEN sentenca ELSE acordo END) > 0
                                              ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb) END)
      INTO r;
    RETURN r;
  END IF;

  -- ── Licitações ────────────────────────────────────────────────────────
  IF p_codigo = 'lic_documentos' THEN
    WITH g AS (SELECT coalesce(g.edital, 's/ edital') || coalesce(' · ' || g.cidade, '') AS nome, g.data - hoje AS dias
                 FROM public.grade g
                WHERE g.fase::text IN ('À Iniciar', 'Iniciado', 'Em Andamento') AND g.capa_id IS NULL
                  AND g.data BETWEEN hoje AND hoje + coalesce(p_param, 15)::int)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM g),
      'afetado', (SELECT count(*) FILTER (WHERE dias <= 3) || ' com sessão em até 3 dias' FROM g),
      'causa', CASE WHEN (SELECT count(*) FROM g) > 0 THEN 'Capa do edital (documentação/requisitos) não preenchida' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', dias, 'rotulo', CASE dias WHEN 0 THEN 'hoje' WHEN 1 THEN 'amanhã' ELSE 'em ' || dias || ' d' END) ORDER BY dias)
                             FROM (SELECT * FROM g ORDER BY dias LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'lic_risco' THEN
    WITH g AS (SELECT g.fase::text AS fase, coalesce(nullif(btrim(g.status_obs), ''), 'Sem observação') AS motivo, public.tvg_num_br(g.valor_global) AS v
                 FROM public.grade g WHERE g.fase::text IN ('Suspenso', 'Revogado')
                  AND coalesce(g.updated_at, g.created_at) >= now() - make_interval(days => coalesce(p_param, 180)::int))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM g), 'impacto', (SELECT sum(v) FROM g),
      'afetado', (SELECT count(*) FILTER (WHERE fase = 'Suspenso') || ' suspensa(s) · ' || count(*) FILTER (WHERE fase = 'Revogado') || ' revogada(s)' FROM g),
      'causa', (SELECT left(motivo, 70) || ' (' || count(*) || ')' FROM g GROUP BY motivo ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', fase, 'valor', q) ORDER BY q DESC) FROM (SELECT fase, count(*) q FROM g GROUP BY 1) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Supply: pedidos em atraso por tipo ────────────────────────────────
  IF p_codigo = 'sup_fornecedor' THEN
    WITH p AS (SELECT initcap(coalesce(p.tipo_pedido, 'outros')) AS tipo, hoje - p.data_solicitacao AS dias
                 FROM public.sup_pedido p
                WHERE p.status IN ('AGUARDANDO COMPRA', 'AGUARDANDO ENVIO', 'EM PREPARACAO', 'EM SEPARACAO')
                  AND p.data_solicitacao < hoje - coalesce(p_param, 15)::int)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM p),
      'afetado', (SELECT 'Mais antigo: ' || max(dias) || ' dias' FROM p),
      'causa', (SELECT 'Mais atrasos: ' || tipo || ' (' || count(*) || ')' FROM p GROUP BY tipo ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', tipo, 'valor', q) ORDER BY q DESC) FROM (SELECT tipo, count(*) q FROM p GROUP BY 1) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── TI ────────────────────────────────────────────────────────────────
  IF p_codigo = 'ti_indisponiveis' THEN
    WITH d AS (SELECT coalesce(d.nome, d.codigo) AS nome, coalesce(d.local, '—') AS local,
                      round(extract(epoch FROM now() - d.ultimo_ping) / 60) AS min
                 FROM public."TV_DISPOSITIVO" d WHERE d.ativo AND d.pareado_em IS NOT NULL)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM d WHERE min IS NULL OR min > 3),
      'afetado', (SELECT count(*) || ' telas pareadas' FROM d),
      'causa', CASE WHEN (SELECT count(*) FROM d WHERE min IS NULL OR min > 3) > 0 THEN 'TV sem sinal com o ERP há mais de 3 minutos' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', coalesce(min, 0),
                                   'rotulo', CASE WHEN min IS NULL THEN 'nunca conectou' WHEN min > 1440 THEN 'há ' || round(min / 1440) || ' d' ELSE 'há ' || min || ' min' END) ORDER BY min DESC NULLS FIRST)
                             FROM d WHERE min IS NULL OR min > 3), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'ti_backups' THEN
    -- O espelho da Senior (ponto) é a integração crítica: quantos dias atrás está.
    SELECT jsonb_build_object(
      'valor', greatest(0, hoje - 1 - coalesce(public.diaria_ponto_sincronizado_ate(), hoje - 99)),
      'afetado', 'Ponto sincronizado até ' || coalesce(to_char(public.diaria_ponto_sincronizado_ate(), 'DD/MM/YYYY'), '—'),
      'causa', CASE WHEN coalesce(public.diaria_ponto_sincronizado_ate(), hoje - 99) < hoje - 1 THEN 'Espelho do relógio de ponto (Senior) parado' END,
      'base', 'O espelho chega até ontem quando está em dia')
      INTO r;
    RETURN r;
  END IF;

  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_calc_extra(text, numeric) FROM PUBLIC, anon, authenticated;

-- ── 2) tvg_resultado: tvg_calc, e sem resposta, tvg_calc_extra ───────────
CREATE OR REPLACE FUNCTION public.tvg_resultado(p_codigo text, p_nivel integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  i public."TVG_INDICADOR"; l public."TVG_LANCAMENTO"; r jsonb; c text; s numeric := 0; tem boolean := false; sub jsonb;
  partes jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO i FROM public."TVG_INDICADOR" WHERE codigo = p_codigo;
  IF NOT FOUND OR p_nivel > 3 THEN RETURN NULL; END IF;

  IF i.fonte = 'auto' THEN
    BEGIN
      r := coalesce(public.tvg_calc(i.codigo, i.parametro), public.tvg_calc_extra(i.codigo, i.parametro));
      r := coalesce(r, jsonb_build_object('valor', NULL)) || jsonb_build_object('atualizado_em', now(), 'origem', 'ERP');
    EXCEPTION WHEN OTHERS THEN
      r := jsonb_build_object('valor', NULL, 'erro', SQLERRM);
    END;
  ELSIF i.fonte = 'manual' THEN
    SELECT * INTO l FROM public."TVG_LANCAMENTO" WHERE indicador = i.codigo ORDER BY referencia DESC, created_at DESC LIMIT 1;
    IF FOUND THEN
      r := jsonb_build_object('valor', l.valor, 'afetado', l.afetado, 'causa', l.causa, 'impacto', l.impacto, 'detalhe', l.detalhe,
                              'responsavel', nullif(btrim(l.responsavel), ''), 'referencia', l.referencia, 'atualizado_em', l.created_at,
                              'origem', 'Lançamento', 'observacao', l.observacao);
    ELSE
      r := jsonb_build_object('valor', NULL, 'origem', 'Lançamento');
    END IF;
  ELSIF i.fonte = 'espelho' THEN
    r := (public.tvg_resultado(i.espelho_de, p_nivel + 1)->'resultado') || jsonb_build_object('origem', 'Espelho');
  ELSE
    FOREACH c IN ARRAY coalesce(i.componentes, ARRAY[]::text[]) LOOP
      sub := public.tvg_resultado(c, p_nivel + 1);
      IF sub IS NOT NULL THEN
        partes := partes || jsonb_build_array(jsonb_build_object('nome', sub->>'nome', 'valor', (sub->'resultado'->>'valor')::numeric,
                                                                  'rotulo', CASE WHEN sub->'resultado'->>'valor' IS NULL THEN 'sem dado' END));
        IF (sub->'resultado'->>'valor') IS NOT NULL THEN s := s + (sub->'resultado'->>'valor')::numeric; tem := true; END IF;
      END IF;
    END LOOP;
    r := jsonb_build_object('valor', CASE WHEN tem THEN s END, 'detalhe', partes, 'origem', 'Soma',
                            'afetado', (SELECT count(*) || ' de ' || jsonb_array_length(partes) || ' com pendência' FROM jsonb_array_elements(partes) x WHERE (x->>'valor')::numeric > 0),
                            'causa', (SELECT 'Maior: ' || (x->>'nome') || ' (' || (x->>'valor') || ')' FROM jsonb_array_elements(partes) x
                                       WHERE (x->>'valor')::numeric > 0 ORDER BY (x->>'valor')::numeric DESC LIMIT 1));
  END IF;

  RETURN jsonb_build_object(
    'codigo', i.codigo, 'nome', i.nome, 'identificar', i.identificar, 'regra', i.regra, 'fonte', i.fonte, 'unidade', i.unidade,
    'sentido', i.sentido, 'meta', i.meta, 'alerta', i.alerta, 'periodicidade', i.periodicidade,
    'responsavel', coalesce(r->>'responsavel', i.responsavel), 'pai', i.pai, 'na_tv', i.na_tv, 'ordem', i.ordem,
    'parametro', i.parametro, 'parametro_rotulo', i.parametro_rotulo, 'espelho_de', i.espelho_de,
    'resultado', coalesce(r, '{}'::jsonb) - 'responsavel');
END $fn$;

-- ── 3) Tendência de 12 meses (o gráfico grande do dashboard de cada TV) ──
-- Duas séries por mês (a × b) com dado real; os nomes vão em 'series'.
CREATE OR REPLACE FUNCTION public.tvg_tendencia(p_painel text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
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
      SELECT jsonb_build_object('titulo', 'Pedidos de materiais por mês: solicitados × despachados', 'series', jsonb_build_array('Solicitados', 'Despachados'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT count(*) FROM public.sup_pedido p WHERE p.data_solicitacao >= g AND p.data_solicitacao < g + interval '1 month'),
                   'b', (SELECT count(*) FROM public.sup_pedido p WHERE p.data_despachado >= g AND p.data_despachado < g + interval '1 month')) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
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
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_tendencia(text) FROM PUBLIC, anon, authenticated;

-- tvg_painel_dados devolve a tendência junto.
CREATE OR REPLACE FUNCTION public.tvg_painel_dados(p_painel text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'painel', (SELECT jsonb_build_object('slug', p.slug, 'titulo', p.titulo, 'diretoria', p.diretoria, 'pergunta', p.pergunta)
                 FROM public."TVG_PAINEL" p WHERE p.slug = p_painel),
    'indicadores', COALESCE((SELECT jsonb_agg(public.tvg_resultado(i.codigo) ORDER BY i.na_tv DESC, i.ordem)
                               FROM public."TVG_INDICADOR" i WHERE i.painel = p_painel AND i.ativo), '[]'::jsonb),
    'tendencia', public.tvg_tendencia(p_painel),
    'gerado_em', now())
$$;

-- ── 4) Catálogo: nada manual; substitutos com nome e regra do que medem ──
UPDATE public."TVG_INDICADOR" SET fonte = 'auto' WHERE fonte = 'manual';

UPDATE public."TVG_INDICADOR" t SET nome = v.nome, regra = v.regra,
       unidade = coalesce(v.unidade, t.unidade), meta = coalesce(v.meta, t.meta), alerta = coalesce(v.alerta, t.alerta),
       parametro_rotulo = coalesce(v.prot, t.parametro_rotulo)
  FROM (VALUES
    ('op_lucratividade', 'Lucratividade por contrato (%)', 'DRE gerencial, última competência com receita: (receita − custo) ÷ receita. O gráfico mostra os contratos de menor margem.', NULL, NULL::numeric, NULL::numeric, NULL),
    ('op_custo_direto', 'Variação do custo direto (%)', 'Custo dos contratos na última competência do DRE × a média das 3 anteriores.', NULL, NULL, NULL, 'Alta considerada (%)'),
    ('op_faltas', 'Atestados e faltas por contrato (%)', 'Colaboradores ativos hoje em atestado/falta (situação na folha Senior) ÷ ativos do contrato.', NULL, NULL, NULL, 'Limite por contrato (%)'),
    ('op_reclamacoes', 'Reclamações e notificações do cliente', 'Notificações do cliente que não são glosa/multa (Jurídico › Notificações), na janela de dias do parâmetro.', NULL, NULL, NULL, 'Janela (dias)'),
    ('rh_salarios', 'Folha sobre o faturamento do contrato (%)', 'Salário-base dos ativos (folha Senior) ÷ valor mensal contratado. Acima do limite do parâmetro, o contrato entra como afetado.', 'pct', 60, 70, 'Limite (% do faturamento)'),
    ('rh_absenteismo', 'Absenteísmo por contrato (%)', 'Ativos fora do posto hoje (afastamento, atestado, licença — menos férias) ÷ ativos, pela situação na folha Senior.', NULL, NULL, NULL, 'Limite por contrato (%)'),
    ('rh_ob_experiencia', 'Contratos de experiência vencendo', 'Admitidos que completam 45 ou 90 dias nos próximos dias do parâmetro (folha Senior).', NULL, NULL, NULL, 'Antecedência (dias)'),
    ('op_experiencia', 'Contratos de experiência vencendo', 'Espelho de RH › Contratos de experiência vencendo.', NULL, NULL, NULL, NULL),
    ('fin_fluxo', 'Fluxo de caixa projetado (30 dias)', 'NFs emitidas sem baixa com vencimento (emissão + 30 d) na janela − despesas do Malote a pagar na janela. Negativo = falta caixa.', NULL, NULL, NULL, 'Janela (dias)'),
    ('sst_aso', 'ASOs pendentes (admissional e demissional)', 'Candidatos na etapa SST + Compras do Recrutamento + demissões aguardando o SST.', NULL, NULL, NULL, 'Atraso considerado (dias)'),
    ('sst_imp_aso', 'ASO pendente', 'Igual a SST › ASOs pendentes.', NULL, NULL, NULL, NULL),
    ('sst_epi', 'Uniformes e EPIs parados no Supply', 'Pedidos de uniforme/EPI ainda não despachados além do prazo do parâmetro.', NULL, NULL, NULL, 'Prazo (dias)'),
    ('sst_imp_epi', 'EPI não entregue no prazo', 'Igual a SST › Uniformes e EPIs parados.', NULL, NULL, NULL, NULL),
    ('sst_acidentes', 'Afastados por acidente', 'Colaboradores com situação/causa de acidente na folha Senior, hoje.', NULL, NULL, NULL, NULL),
    ('sst_imp_treinamento', 'Treinamento com acesso vencendo', 'Igual a Treinamento › Acessos vencendo sem certificado.', NULL, NULL, NULL, NULL),
    ('trn_contratuais', 'Treinamentos pendentes (30+ dias)', 'Matrículas da plataforma sem certificado há mais de N dias.', NULL, NULL, NULL, 'Dias desde a matrícula'),
    ('trn_vencidos', 'Acessos vencendo sem certificado', 'Alunos ativos com acesso vencido ou vencendo em N dias e o curso sem certificado.', NULL, NULL, NULL, 'Antecedência (dias)'),
    ('trn_programados', 'Certificados × matrículas no mês (%)', 'Certificados emitidos no mês ÷ matrículas do mês. O gráfico traz os 6 meses.', NULL, 80, 60, NULL),
    ('trn_sem_comprovacao', 'Matrículas antigas sem certificado', 'Matrículas com mais de N dias sem certificado emitido.', NULL, NULL, NULL, 'Dias desde a matrícula'),
    ('fro_documentos', 'Veículos sem documento anexado', 'Veículos ativos do patrimônio sem nenhum arquivo (CRLV, apólice…) no cadastro.', NULL, NULL, NULL, NULL),
    ('fro_combustivel', 'Viagens sem km registrado', 'Sem lançamento de combustível no ERP: viagens com controle de km encerradas sem km inicial/final. O gráfico traz o km por veículo.', NULL, NULL, NULL, 'Janela (dias)'),
    ('fro_nao_localizados', 'Patrimônios sem conferência (180+ dias)', 'Patrimônios ativos sem atualização nem movimentação há mais de N dias — inventário a conferir.', NULL, NULL, NULL, 'Dias sem conferência'),
    ('jur_contratos_analise', 'Medidas preventivas vencidas', 'Notificações com medida preventiva definida, prazo vencido e não concluída.', NULL, NULL, NULL, NULL),
    ('jur_risco', 'Processos de alto valor', 'Processos em andamento com valor dos pedidos (ou da causa) a partir do parâmetro.', NULL, NULL, NULL, 'Valor mínimo (R$)'),
    ('jur_valor_condenacao', 'Valor de sentenças em andamento', 'Soma do valor de sentença dos processos em andamento.', NULL, NULL, NULL, NULL),
    ('jur_valor_acordo', 'Valor de acordos', 'Soma do valor de acordo dos processos em andamento.', NULL, NULL, NULL, NULL),
    ('lic_documentos', 'Editais sem capa preenchida', 'Licitações com sessão nos próximos N dias e sem a capa do edital (documentação e requisitos) no ERP.', NULL, NULL, NULL, 'Janela (dias)'),
    ('lic_risco', 'Licitações suspensas ou revogadas', 'Grade de licitações: suspensas/revogadas na janela do parâmetro.', NULL, NULL, NULL, 'Janela (dias)'),
    ('sup_fornecedor', 'Pedidos em atraso por tipo', 'Pedidos de materiais não despachados além do prazo, por tipo (uniforme, insumos).', NULL, NULL, NULL, 'Prazo (dias)'),
    ('ti_indisponiveis', 'TVs sem sinal', 'TVs pareadas sem falar com o ERP há mais de 3 minutos.', NULL, NULL, NULL, NULL),
    ('ti_backups', 'Atraso do espelho Senior (dias)', 'Dias de atraso do espelho do relógio de ponto (Senior) — em dia, chega até ontem.', 'dias', 0, 2, NULL),
    ('ctl_margem', 'Contratos abaixo da margem mínima', 'DRE gerencial, última competência: contratos com margem (receita − custo) abaixo do parâmetro.', NULL, NULL, NULL, 'Margem mínima (%)'),
    ('ctl_vermelhos', 'Contratos vermelhos (no prejuízo)', 'DRE gerencial, última competência: contratos com custo maior que a receita.', NULL, NULL, NULL, NULL),
    ('ctl_desvio', 'Contratos com custo acima da média', 'DRE gerencial: contratos com custo da última competência acima da média dos 3 meses anteriores além do parâmetro.', 'qtd', 0, 3, 'Alta considerada (%)'),
    ('ctl_reincidentes', 'Margem baixa 3 meses seguidos', 'DRE gerencial: contratos abaixo da margem mínima nas 3 últimas competências.', NULL, NULL, NULL, 'Margem mínima (%)'),
    ('pre_salarios', 'Folha sobre o faturamento (%)', 'Espelho de RH › Folha sobre o faturamento do contrato.', 'pct', 60, 70, NULL),
    ('pre_clientes', 'Reclamações do cliente', 'Espelho de Operação › Reclamações e notificações do cliente.', NULL, NULL, NULL, NULL)
  ) AS v(codigo, nome, regra, unidade, meta, alerta, prot)
 WHERE t.codigo = v.codigo;

-- Sem fonte nenhuma no ERP (e fora da TV): saem de cena em vez de ficar "sem dado".
UPDATE public."TVG_INDICADOR" SET ativo = false, na_tv = false
 WHERE codigo IN ('op_satisfacao_colab', 'op_feedbacks', 'rh_ob_folhas', 'rh_ob_ferias_vencidas', 'rh_ob_ferias_vencer',
                  'rh_ob_banco_horas', 'rh_ob_esocial', 'sst_imp_exame', 'sst_imp_retorno', 'sst_imp_restricao',
                  'ctl_nao_atualizados');
UPDATE public."TVG_INDICADOR" SET componentes = ARRAY['rh_ob_rescisoes', 'rh_ob_experiencia'] WHERE codigo = 'rh_obrigacoes';
UPDATE public."TVG_INDICADOR" SET componentes = ARRAY['sst_imp_aso', 'sst_imp_treinamento', 'sst_imp_epi'] WHERE codigo = 'sst_impedidos';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- (catálogo) UPDATE "TVG_INDICADOR" SET fonte = 'manual' WHERE codigo IN (<os 43 que eram manual em 20261012000001>);
--            UPDATE "TVG_INDICADOR" SET ativo = true WHERE codigo IN (<os 11 desativados acima>);
-- tvg_resultado / tvg_painel_dados: reaplicar a versão de 20261012000001.
-- DROP FUNCTION IF EXISTS public.tvg_tendencia(text);
-- DROP FUNCTION IF EXISTS public.tvg_calc_extra(text, numeric);
-- DROP FUNCTION IF EXISTS public.tvg_dre_contratos();
-- DROP FUNCTION IF EXISTS public.tvg_num_ponto(text);
