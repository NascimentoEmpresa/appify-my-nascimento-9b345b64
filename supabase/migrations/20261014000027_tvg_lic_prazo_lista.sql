-- =========================================================================
-- TVs GERENCIAIS: "LICITAÇÕES COM PRAZO PRÓXIMO" VIRA LISTA DE ALERTAS (14/10/2026)
--
-- Pablo, mostrando o gráfico de barras do indicador e o slide Alertas da TV
-- de Licitações: "preciso trocar esse gráfico por esse […] seria a mesma
-- informação mas com mais detalhes". O detalhe de lic_prazo passa a trazer,
-- por edital, a data da sessão, "edital · objeto" e "responsável · fase ·
-- cidade · horário" — o front (graficoDo: tipo "lista") desenha as linhas.
-- O responsável é o do edital na grade (o mesmo que a TV de Licitações já
-- mostra). tvg_calc_ajuste recriada: o resto igual à 20261014000026.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.tvg_calc_ajuste(p_codigo text, p_param numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
#variable_conflict use_column
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  ini date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
  ini_ant date := (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')) - interval '1 month')::date;
  r jsonb; v_comp text;
BEGIN
  -- ── TI ────────────────────────────────────────────────────────────────
  IF p_codigo = 'ti_erros' THEN
    WITH c AS (SELECT coalesce(nullif(btrim(c.modulo_sistema), ''), 'Outro') AS modulo, hoje - (c.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dias
                 FROM public."CHAMADO_SISTEMA" c
                WHERE c.status IN ('aberto', 'em_andamento', 'aguardando_retorno') AND c.tipo_solicitacao = 'correcao' AND c.urgencia = 'ate_1h')
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM c),
      'afetado', (SELECT CASE WHEN count(*) = 0 THEN 'Nenhum erro crítico em aberto' ELSE count(DISTINCT modulo) || ' módulo(s) · mais antigo: ' || max(dias) || ' d' END FROM c),
      'causa', (SELECT 'Mais chamados: ' || modulo || ' (' || count(*) || ')' FROM c GROUP BY modulo ORDER BY count(*) DESC LIMIT 1),
      'base', 'Chamados de correção com urgência "até 1 hora" (trabalho parado), ainda abertos',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', modulo, 'valor', n, 'rotulo', n || ' · até ' || d || ' d') ORDER BY n DESC)
                             FROM (SELECT modulo, count(*) n, max(dias) d FROM c GROUP BY 1) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'ti_integracoes' THEN
    WITH f AS (SELECT f.destino FROM public.fila_http f
                WHERE f.erro IS NOT NULL AND f.processado_em IS NULL AND f.destino NOT ILIKE 'novidade-ia%'
                  AND f.criado_em >= now() - make_interval(days => coalesce(p_param, 7)::int))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM f),
      'afetado', (SELECT CASE WHEN count(*) = 0 THEN 'Todas as integrações em dia' ELSE count(DISTINCT destino) || ' integração(ões)' END FROM f),
      'causa', (SELECT destino || ' (' || count(*) || ')' FROM f GROUP BY destino ORDER BY count(*) DESC LIMIT 1),
      'base', 'Fila de integrações com erro e não reprocessada (resumos automáticos da I.A não contam)',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', destino, 'valor', n) ORDER BY n DESC) FROM (SELECT destino, count(*) n FROM f GROUP BY 1) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'ti_concluidos' THEN
    WITH c AS (SELECT coalesce(nullif(btrim(c.modulo_sistema), ''), 'Outro') AS modulo, (c.concluido_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia
                 FROM public."CHAMADO_SISTEMA" c WHERE c.status = 'concluido' AND (c.concluido_em AT TIME ZONE 'America/Sao_Paulo')::date >= ini_ant)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM c WHERE dia >= ini),
      'afetado', (SELECT count(DISTINCT modulo) FILTER (WHERE dia >= ini) || ' módulo(s) atendidos · mês anterior inteiro: ' || count(*) FILTER (WHERE dia < ini) FROM c),
      'base', 'Chamados de Sistemas concluídos desde ' || to_char(ini, 'DD/MM'),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', modulo, 'valor', n) ORDER BY n DESC)
                             FROM (SELECT modulo, count(*) n FROM c WHERE dia >= ini GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'ti_tempo_conclusao' THEN
    WITH c AS (SELECT date_trunc('month', c.concluido_em AT TIME ZONE 'America/Sao_Paulo')::date AS mes, extract(epoch FROM c.concluido_em - c.created_at) / 86400 AS dias
                 FROM public."CHAMADO_SISTEMA" c WHERE c.status = 'concluido' AND c.concluido_em >= (ini - interval '5 months'))
    SELECT jsonb_build_object('valor', (SELECT round(avg(dias), 1) FROM c WHERE mes = ini),
      'afetado', (SELECT count(*) FILTER (WHERE mes = ini) || ' concluído(s) no mês · mês anterior inteiro: ' || coalesce(replace(round(avg(dias) FILTER (WHERE mes = ini_ant), 1)::text, '.', ','), '—') || ' d' FROM c),
      'base', 'Média de dias entre a abertura e a conclusão dos chamados concluídos no mês',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', to_char(mes, 'MM/YY'), 'valor', d, 'rotulo', replace(d::text, '.', ',') || ' d') ORDER BY mes)
                             FROM (SELECT mes, round(avg(dias), 1) d FROM c GROUP BY 1) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Recrutamento ──────────────────────────────────────────────────────
  IF p_codigo = 'rec_risco' THEN
    WITH f AS (SELECT coalesce(nullif(btrim(s.contrato), ''), 'Sem contrato') AS contrato, coalesce(nullif(btrim(s.cidade), ''), '—') AS cidade,
                      greatest(coalesce(s.quantidade_vagas, 1), 1) AS q, s.status, (hoje - (s.created_at AT TIME ZONE 'America/Sao_Paulo')::date) AS dias
                 FROM public."SISTEMA_RECRUTAMENTO" s
                WHERE s.status NOT IN ('Concluído', 'Reprovada', 'Contratado') AND s.grau_urgencia ILIKE 'Alta%'
                  AND hoje - (s.created_at AT TIME ZONE 'America/Sao_Paulo')::date > coalesce(p_param, 15))
    SELECT jsonb_build_object('valor', COALESCE((SELECT sum(q) FROM f), 0),
      'afetado', (SELECT CASE WHEN count(*) = 0 THEN 'Nenhuma vaga urgente atrasada' ELSE count(DISTINCT contrato) || ' contrato(s) · ' || count(DISTINCT cidade) || ' cidade(s)' END FROM f),
      'causa', (SELECT 'Parada em: ' || status || ' (' || sum(q) || ')' FROM f GROUP BY status ORDER BY sum(q) DESC LIMIT 1),
      'base', 'Vagas urgentes abertas há mais de ' || coalesce(p_param, 15)::int || ' dias',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato || ' · ' || cidade, 'valor', n, 'rotulo', n || ' vaga(s) · mais antiga ' || d || ' d') ORDER BY n DESC, d DESC)
                             FROM (SELECT contrato, cidade, sum(q) n, max(dias) d FROM f GROUP BY 1, 2 ORDER BY 3 DESC, 4 DESC LIMIT 15) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'rec_preenchidas' THEN
    WITH f AS (SELECT coalesce(nullif(btrim(s.contrato), ''), 'Sem contrato') AS contrato, greatest(coalesce(s.quantidade_vagas, 1), 1) AS q,
                      (s.status_changed_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia
                 FROM public."SISTEMA_RECRUTAMENTO" s
                WHERE s.status IN ('Contratado', 'Concluído') AND (s.status_changed_at AT TIME ZONE 'America/Sao_Paulo')::date >= ini_ant)
    SELECT jsonb_build_object('valor', COALESCE((SELECT sum(q) FROM f WHERE dia >= ini), 0),
      'afetado', (SELECT count(DISTINCT contrato) FILTER (WHERE dia >= ini) || ' contrato(s) · mês anterior inteiro: ' || coalesce(sum(q) FILTER (WHERE dia < ini), 0) FROM f),
      'base', 'Vagas da Gestão Recrutamento que chegaram a Contratado desde ' || to_char(ini, 'DD/MM'),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', n) ORDER BY n DESC)
                             FROM (SELECT contrato, sum(q) n FROM f WHERE dia >= ini GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── RH / SST: só o que é falta de fato ou passou do prazo ─────────────
  IF p_codigo = 'rh_absenteismo' THEN
    -- Atestado e falta (o mesmo de op_faltas); INSS/licenças ficam em SST › Afastamentos.
    RETURN public.tvg_calc_extra('op_faltas', p_param);
  END IF;

  IF p_codigo = 'rh_ob_rescisoes' THEN
    WITH d AS (SELECT s.status, hoje - coalesce(s.data_solicitacao, s.criado_em::date) AS dias
                 FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s
                WHERE s.status IN ('Pendente Operacional', 'Pendente RH', 'Pendente SST', 'Solicitação de agendamento de DEMISSIONAL recebida')),
    f AS (SELECT * FROM d WHERE dias > coalesce(p_param, 10))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM f),
      'afetado', (SELECT count(*) || ' no fluxo · ' || count(*) FILTER (WHERE dias > coalesce(p_param, 10)) || ' acima de ' || coalesce(p_param, 10)::int || ' dias' FROM d),
      'causa', (SELECT status || ' (' || count(*) || ')' FROM f GROUP BY status ORDER BY count(*) DESC LIMIT 1),
      'base', 'Solicitações de demissão paradas há mais de ' || coalesce(p_param, 10)::int || ' dias',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', status, 'valor', n, 'rotulo', n || ' · até ' || m || ' d') ORDER BY n DESC)
                             FROM (SELECT status, count(*) n, max(dias) m FROM f GROUP BY 1) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo IN ('sst_aso', 'sst_imp_aso') THEN
    WITH a AS (
      SELECT 'Admissional' AS tipo, hoje - coalesce(c.etapa_changed_at, c.created_at)::date AS dias
        FROM public."WA_CURRICULOS" c WHERE c.etapa_processo = 'SST + COMPRAS' AND NOT coalesce(c.desistiu, false)
      UNION ALL
      SELECT 'Demissional', hoje - coalesce(s.data_solicitacao, s.criado_em::date)
        FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s WHERE s.status IN ('Pendente SST', 'Solicitação de agendamento de DEMISSIONAL recebida')),
    f AS (SELECT * FROM a WHERE dias > coalesce(p_param, 5))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM f),
      'afetado', (SELECT count(*) || ' no fluxo · ' || count(*) FILTER (WHERE dias > coalesce(p_param, 5)) || ' há mais de ' || coalesce(p_param, 5)::int || ' dias' FROM a),
      'causa', (SELECT tipo || ' (' || count(*) || ')' FROM f GROUP BY tipo ORDER BY count(*) DESC LIMIT 1),
      'base', 'ASOs aguardando o SST há mais de ' || coalesce(p_param, 5)::int || ' dias',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', tipo, 'valor', q) ORDER BY q DESC) FROM (SELECT tipo, count(*) q FROM f GROUP BY 1) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'sst_demissionais' THEN
    WITH d AS (SELECT coalesce(nullif(btrim(s.contrato), ''), 'Sem contrato') AS contrato, (s.sst_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia
                 FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s WHERE (s.sst_em AT TIME ZONE 'America/Sao_Paulo')::date >= ini_ant)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM d WHERE dia >= ini),
      'afetado', (SELECT count(DISTINCT contrato) FILTER (WHERE dia >= ini) || ' contrato(s) · mês anterior inteiro: ' || count(*) FILTER (WHERE dia < ini) FROM d),
      'base', 'Exames demissionais agendados pelo SST desde ' || to_char(ini, 'DD/MM'),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', n) ORDER BY n DESC)
                             FROM (SELECT contrato, count(*) n FROM d WHERE dia >= ini GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Treinamento ───────────────────────────────────────────────────────
  IF p_codigo = 'trn_integracoes' THEN
    WITH a AS (SELECT coalesce(nullif(btrim(a.contrato), ''), 'Sem contrato') AS contrato
                 FROM public."TRN_ALUNO" a
                WHERE a.status = 'ativo' AND a.created_at >= now() - make_interval(days => coalesce(p_param, 30)::int)
                  AND a.created_at < now() - interval '7 days'
                  AND NOT EXISTS (SELECT 1 FROM public."TRN_PROGRESSO" p WHERE p.aluno_id = a.id AND p.concluida))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM a),
      'afetado', (SELECT count(DISTINCT contrato) || ' contrato(s)' FROM a),
      'causa', CASE WHEN (SELECT count(*) FROM a) > 0 THEN 'Nenhuma aula concluída depois de 7 dias na plataforma' END,
      'base', 'Alunos criados nos últimos ' || coalesce(p_param, 30)::int || ' dias, com mais de 7 dias de casa e nenhuma aula concluída',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', n) ORDER BY n DESC) FROM (SELECT contrato, count(*) n FROM a GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'trn_programados' THEN
    SELECT jsonb_build_object(
      'valor', (SELECT count(*) FROM public."TRN_CERTIFICADO" c WHERE c.emitido_em >= ini),
      'afetado', 'Mês anterior inteiro: ' || (SELECT count(*) FROM public."TRN_CERTIFICADO" c WHERE c.emitido_em >= ini_ant AND c.emitido_em < ini),
      'base', 'Certificados emitidos na plataforma de Treinamentos desde ' || to_char(ini, 'DD/MM'),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', to_char(g, 'MM/YY'), 'valor',
                                   (SELECT count(*) FROM public."TRN_CERTIFICADO" c WHERE c.emitido_em >= g AND c.emitido_em < g + interval '1 month')) ORDER BY g)
                             FROM generate_series(ini - interval '5 months', ini, interval '1 month') g), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Financeiro ────────────────────────────────────────────────────────
  IF p_codigo = 'fin_glosas' THEN
    -- Sem a conta vinculada: depósito retido por lei e devolvido depois, não perda.
    WITH o AS (
      SELECT CASE WHEN n.tipo = 'Glosa' THEN 'Glosas' ELSE 'Multas' END AS origem, coalesce(n.valor_final, n.valor_original, 0) AS v
        FROM public."JUR_NOTIFICACOES" n
       WHERE n.tipo IN ('Glosa', 'Multa') AND coalesce(n.resultado, '') <> 'Revertida'
         AND coalesce(n.data_recebimento, n.created_at::date) >= hoje - coalesce(p_param, 90)::int
      UNION ALL
      SELECT 'Descontos após a emissão', coalesce(n.descontos_pos_emissao_total, 0) FROM public.nf_emissao n
       WHERE n.deleted_at IS NULL AND n.status::text <> 'cancelada' AND n.data_emissao >= hoje - coalesce(p_param, 90)::int)
    SELECT jsonb_build_object('valor', COALESCE((SELECT sum(v) FROM o), 0), 'impacto', COALESCE((SELECT sum(v) FROM o), 0),
      'afetado', 'Últimos ' || coalesce(p_param, 90)::int || ' dias',
      'causa', (SELECT origem FROM o GROUP BY origem HAVING sum(v) > 0 ORDER BY sum(v) DESC LIMIT 1),
      'base', 'Glosas e multas não revertidas + descontos nas NFs depois de emitidas (a conta vinculada é depósito retido por lei, não entra)',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', origem, 'valor', s) ORDER BY s DESC) FROM (SELECT origem, sum(v) s FROM o GROUP BY 1) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'fin_recebido_mes' THEN
    WITH n AS (SELECT c.nome AS contrato, coalesce(nullif(n.valor_pago, 0), n.vlr_liquido_total, 0) AS v, n.data_pagamento AS dia
                 FROM public.nf_emissao n LEFT JOIN public.contratos c ON c.id = n.contrato_id
                WHERE n.deleted_at IS NULL AND n.data_pagamento >= ini_ant)
    SELECT jsonb_build_object('valor', COALESCE((SELECT sum(v) FROM n WHERE dia >= ini), 0),
      'afetado', (SELECT count(*) FILTER (WHERE dia >= ini) || ' NF(s) recebida(s) · mês anterior inteiro: R$ ' || replace(to_char(coalesce(sum(v) FILTER (WHERE dia < ini), 0), 'FM999G999G990'), ',', '.') FROM n),
      'base', 'NFs com pagamento registrado no Faturamento desde ' || to_char(ini, 'DD/MM'),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', coalesce(contrato, 'Sem contrato'), 'valor', s) ORDER BY s DESC)
                             FROM (SELECT contrato, sum(v) s FROM n WHERE dia >= ini GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Licitações, Supply, Controladoria ─────────────────────────────────
  IF p_codigo = 'lic_ganhas' THEN
    WITH g AS (SELECT coalesce(g.edital, 's/ edital') || coalesce(' · ' || g.cidade, '') AS nome, g.posicao, public.tvg_num_br(g.valor_global) AS v
                 FROM public.grade g WHERE g.fase::text = 'Finalizada' AND g.data >= hoje - coalesce(p_param, 90)::int)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM g WHERE posicao = 1), 'impacto', (SELECT sum(v) FROM g WHERE posicao = 1),
      'afetado', (SELECT 'De ' || count(*) || ' finalizada(s) nos últimos ' || coalesce(p_param, 90)::int || ' dias' FROM g),
      'base', 'Licitações finalizadas em 1º lugar (grade de Licitações)',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', v) ORDER BY v DESC NULLS LAST) FROM g WHERE posicao = 1), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'sup_despachados' THEN
    WITH p AS (SELECT coalesce(nullif(btrim(p.contrato_nome), ''), 'Sem contrato') AS contrato, (p.data_despachado AT TIME ZONE 'America/Sao_Paulo')::date AS dia
                 FROM public.sup_pedido p WHERE (p.data_despachado AT TIME ZONE 'America/Sao_Paulo')::date >= ini_ant)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM p WHERE dia >= ini),
      'afetado', (SELECT count(DISTINCT contrato) FILTER (WHERE dia >= ini) || ' contrato(s) atendido(s) · mês anterior inteiro: ' || count(*) FILTER (WHERE dia < ini) FROM p),
      'base', 'Pedidos de material/uniforme despachados desde ' || to_char(ini, 'DD/MM'),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', n) ORDER BY n DESC)
                             FROM (SELECT contrato, count(*) n FROM p WHERE dia >= ini GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'ctl_planos_concluidos' THEN
    WITH p AS (SELECT coalesce(nullif(btrim(p.area), ''), nullif(btrim(p.setor), ''), nullif(btrim(p.comite), ''), 'Sem área') AS area,
                      coalesce(p.data_fim_real, p.updated_at::date) AS dia
                 FROM public.plano_acao p WHERE p.deleted_at IS NULL AND p.status_normalizado LIKE 'concluida%' AND coalesce(p.data_fim_real, p.updated_at::date) >= ini_ant)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM p WHERE dia >= ini),
      'afetado', (SELECT count(DISTINCT area) FILTER (WHERE dia >= ini) || ' área(s) · mês anterior inteiro: ' || count(*) FILTER (WHERE dia < ini) FROM p),
      'base', 'Planos de ação concluídos desde ' || to_char(ini, 'DD/MM'),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', area, 'valor', n) ORDER BY n DESC)
                             FROM (SELECT area, count(*) n FROM p WHERE dia >= ini GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── DRE ───────────────────────────────────────────────────────────────
  IF p_codigo = 'op_contratos_saudaveis' THEN
    v_comp := public.tvg_dre_competencia();
    IF v_comp IS NULL THEN RETURN NULL; END IF;
    WITH d AS (SELECT contrato, round(100 * (receita - coalesce(custo, 0)) / receita, 1) AS margem
                 FROM public.tvg_dre_contratos() WHERE competencia = v_comp AND receita >= 10000)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM d WHERE margem >= coalesce(p_param, 10)),
      'afetado', (SELECT 'De ' || count(*) || ' contratos · competência ' || to_char(to_date(v_comp, 'YYYY-MM'), 'MM/YYYY') FROM d),
      'base', 'Contratos com margem de ' || coalesce(p_param, 10)::int || '% ou mais no DRE gerencial',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', margem, 'rotulo', replace(margem::text, '.', ',') || '%') ORDER BY margem DESC)
                             FROM (SELECT * FROM d WHERE margem >= coalesce(p_param, 10) ORDER BY margem DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo IN ('op_custo_direto', 'ctl_desvio') THEN
    v_comp := public.tvg_dre_competencia();
    IF v_comp IS NULL THEN RETURN NULL; END IF;
    -- Só contrato com custo lançado nos 3 meses anteriores: contrato novo ou mês
    -- incompleto no DRE não é "alta de custo".
    WITH m AS (SELECT competencia FROM public.tvg_dre_contratos() WHERE competencia <= v_comp GROUP BY 1 ORDER BY 1 DESC LIMIT 4),
    d AS (SELECT t.contrato,
                 sum(t.custo) FILTER (WHERE t.competencia = v_comp) AS atual,
                 avg(t.custo) FILTER (WHERE t.competencia < v_comp) AS media,
                 count(DISTINCT t.competencia) FILTER (WHERE t.competencia < v_comp AND t.custo > 0) AS meses
            FROM public.tvg_dre_contratos() t JOIN m ON m.competencia = t.competencia GROUP BY 1),
    x AS (SELECT contrato, atual, media, round(100 * (atual - media) / media, 1) AS pct FROM d
           WHERE media > 1000 AND atual IS NOT NULL AND meses >= (SELECT count(*) - 1 FROM m)),
    f AS (SELECT * FROM x WHERE pct > coalesce(p_param, 10))
    SELECT jsonb_build_object(
      'valor', CASE WHEN p_codigo = 'op_custo_direto'
                    THEN (SELECT round(100 * (sum(atual) - sum(media)) / nullif(sum(media), 0), 1) FROM x)
                    ELSE (SELECT count(*) FROM f) END,
      'impacto', (SELECT sum(atual - media) FROM f),
      'afetado', (SELECT count(*) || ' contrato(s) com custo ' || coalesce(p_param, 10)::int || '%+ acima da média' FROM f),
      'causa', (SELECT 'Maior alta: ' || contrato || ' (+' || replace(pct::text, '.', ',') || '%)' FROM f ORDER BY atual - media DESC LIMIT 1),
      'base', 'Custo da competência ' || to_char(to_date(v_comp, 'YYYY-MM'), 'MM/YYYY') || ' × média dos 3 meses anteriores (DRE) · só contratos com os 3 meses lançados (' || (SELECT count(*) FROM x) || ')',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', pct, 'rotulo', '+' || replace(pct::text, '.', ',') || '%') ORDER BY pct DESC)
                             FROM (SELECT * FROM f ORDER BY pct DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Jurídico: contar PROCESSOS (cada processo tem uma linha por motivo) ─
  IF p_codigo IN ('jur_risco', 'jur_valor_condenacao', 'jur_valor_acordo') THEN
    WITH p AS (SELECT p.numero_processo, max(coalesce(nullif(btrim(p.contrato), ''), p.comarca, 'Sem contrato')) AS contrato,
                      coalesce(sum(p.valor_pedidos), max(p.valor_causa), 0)::numeric AS pedidos,
                      coalesce(sum(p.valor_sentenca), 0)::numeric AS sentenca, coalesce(sum(p.valor_acordo), 0) AS acordo
                 FROM public."JUR_PROCESSOS" p WHERE p.status = 'EM ANDAMENTO' GROUP BY 1),
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

  IF p_codigo = 'jur_reincidentes' THEN
    WITH m AS (SELECT DISTINCT p.numero_processo, btrim(x) AS motivo FROM public."JUR_PROCESSOS" p, regexp_split_to_table(coalesce(p.motivos, ''), '\s*[,;]\s*') x
                WHERE p.status = 'EM ANDAMENTO' AND btrim(x) <> ''),
    c AS (SELECT motivo, count(*) n FROM m GROUP BY 1)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM c WHERE n >= coalesce(p_param, 5)),
      'afetado', (SELECT count(DISTINCT numero_processo) || ' processos em andamento' FROM m),
      'causa', (SELECT motivo || ' (' || n || ' processos)' FROM c ORDER BY n DESC LIMIT 1),
      'base', 'Motivos (pedidos) que aparecem em ' || coalesce(p_param, 5)::int || ' ou mais processos em andamento',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', motivo, 'valor', n) ORDER BY n DESC) FROM (SELECT * FROM c WHERE n >= coalesce(p_param, 5) ORDER BY n DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Turnover: a MESMA conta de Relatórios › Turnover (mig 20261014000026) ─
  -- Ano corrente, ano inteiro até hoje, todas as causas: soma das taxas
  -- mensais (demissões ÷ efetivo no fim do mês), meta 41% no ano. Por
  -- contrato: demissões ÷ efetivo médio do contrato no ano ("próprio").
  -- Antes era a média dos últimos 3 meses (3,3%) — com o mês corrente pela
  -- metade puxando para baixo — e não batia com o relatório (42,66%).
  IF p_codigo = 'op_turnover' THEN
    DECLARE
      d jsonb := public.dir_turnover_painel_dados(extract(year FROM hoje)::int, NULL, NULL, NULL, NULL);
      soma numeric; dem numeric;
    BEGIN
      SELECT round(sum((m->>'taxa')::numeric), 2), sum((m->>'demissoes')::numeric) INTO soma, dem FROM jsonb_array_elements(d->'mensal') m;
      SELECT jsonb_build_object(
        'valor', soma,
        'afetado', coalesce(dem, 0) || ' demissões · efetivo médio ' || round((d->>'efetivo_medio')::numeric)
                   || CASE WHEN (d->>'fator_projecao')::numeric > 1.001 THEN ' · projeção do ano ' || replace(round(soma * (d->>'fator_projecao')::numeric, 1)::text, '.', ',') || '%' ELSE '' END,
        'causa', (SELECT c->>'causa' FROM jsonb_array_elements(d->'causas') c WHERE c->>'causa' NOT ILIKE '%não informado%' ORDER BY (c->>'n')::int DESC LIMIT 1),
        'base', 'Igual a Relatórios › Turnover: soma das taxas mensais de ' || extract(year FROM hoje)::int || ' (demissões ÷ efetivo no fim do mês); meta 41% no ano',
        'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', regexp_replace(contrato, '^\s*\d+\s*-\s*', ''), 'valor', proprio,
                                     'rotulo', replace(proprio::text, '.', ',') || '% · ' || dem_c || ' demissão(ões)') ORDER BY proprio DESC)
                               FROM (SELECT x->>'contrato' AS contrato, (x->>'demissoes')::int AS dem_c,
                                            round((x->>'demissoes')::numeric * 100 / nullif((x->>'efetivo_medio')::numeric, 0), 2) AS proprio
                                       FROM jsonb_array_elements(d->'por_contrato') x
                                      WHERE (x->>'demissoes')::int > 0 AND (x->>'efetivo_medio')::numeric > 0
                                      ORDER BY 3 DESC LIMIT 12) t), '[]'::jsonb))
        INTO r;
      RETURN r;
    END;
  END IF;

  -- ── Licitações com prazo próximo: a lista de alertas (mig 20261014000027) ─
  -- Pablo: trocar o gráfico de barras ("0 d / 1 d / 2 d") pela lista do slide
  -- Alertas da TV de Licitações — data, edital · objeto, responsável · fase.
  -- Mesmo filtro de antes (À Iniciar/Iniciado com sessão em até N dias); o
  -- detalhe ganha os campos da lista.
  IF p_codigo = 'lic_prazo' THEN
    WITH g AS (SELECT g.edital, g.cidade, g.uf, g.objeto, g.responsavel, g.fase::text AS fase, g.data, g.horario, g.data - hoje AS dias,
                      public.tvg_num_br(g.valor_global) AS v
                 FROM public.grade g WHERE g.fase::text IN ('À Iniciar', 'Iniciado') AND g.data BETWEEN hoje AND hoje + coalesce(p_param, 3)::int)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM g), 'impacto', (SELECT sum(v) FROM g),
      'afetado', (SELECT CASE WHEN count(*) = 0 THEN 'Nenhuma sessão próxima sem proposta' ELSE count(*) FILTER (WHERE dias = 0) || ' hoje · ' || count(*) FILTER (WHERE dias = 1) || ' amanhã' END FROM g),
      'causa', CASE WHEN (SELECT count(*) FROM g) > 0 THEN 'Proposta ainda não iniciada/concluída' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                               'nome', coalesce(edital, 's/ edital') || coalesce(' · ' || cidade, ''), 'valor', dias,
                               'rotulo', CASE dias WHEN 0 THEN 'hoje' WHEN 1 THEN 'amanhã' ELSE 'em ' || dias || ' dias' END,
                               'data', data, 'titulo', coalesce(edital, 's/ edital') || ' · ' || coalesce(nullif(btrim(objeto), ''), 'Sem objeto'),
                               'sub', coalesce(nullif(btrim(responsavel), ''), 'Sem responsável') || ' · ' || fase
                                      || coalesce(' · ' || nullif(btrim(cidade), '') || coalesce('/' || uf, ''), '')
                                      || coalesce(' · ' || nullif(btrim(horario), ''), '')) ORDER BY data, horario NULLS LAST)
                             FROM (SELECT * FROM g ORDER BY data, horario NULLS LAST LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_calc_ajuste(text, numeric) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- reaplicar a tvg_calc_ajuste da 20261014000026 (sem o ramo lic_prazo: volta o gráfico de barras da tvg_calc).
