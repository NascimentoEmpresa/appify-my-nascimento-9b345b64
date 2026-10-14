-- =========================================================================
-- TVs GERENCIAIS: TURNOVER IGUAL AO RELATÓRIO + DETALHE DA I.A ALINHADO (14/10/2026)
--
-- Pablo, na TV Gerência Operacional: "essa porcentagem de 3,3 do turnover,
-- refatora isso, tem que ser precisa igual o relatório […] do turnover"
-- (Relatórios › Turnover, /app/relatorios/turnover).
--
-- O relatório: ano corrente inteiro até hoje, todas as causas, turnover do ano
-- = SOMA das taxas mensais (demissões ÷ efetivo no fim do mês) — 42,66% em
-- 14/10/2026 —, meta 41% no ano, projeção = soma × fator (dias do ano ÷ dias
-- decorridos). A TV fazia a MÉDIA dos últimos 3 meses (ago, set e out pela
-- metade: 3,3%), meta 3%. Agora op_turnover (e o espelho rh_turnover) usa a
-- mesma RPC (dir_turnover_painel_dados) com os mesmos filtros do relatório e
-- a mesma conta; por contrato, demissões ÷ efetivo médio do contrato (a
-- coluna "próprio" do relatório), sem o código da filial no nome.
--
-- tvg_calc_ajuste: recriada com o ramo op_turnover (o resto igual à 0025).
-- tvg_ia_detalhe_dados: recriada alinhada com as regras da 0025 (erro crítico
-- = urgência até 1 h; integrações sem novidade-ia; vaga em risco = urgente e
-- 15+ dias; absenteísmo = atestado/falta; rescisões e ASO acima do prazo;
-- integração de treinamento com 7 d de carência; glosas sem conta vinculada;
-- processo de alto valor pela soma do processo) e com o turnover do ano.
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

  RETURN NULL;
END $fn$;
CREATE OR REPLACE FUNCTION public.tvg_ia_detalhe_dados(p_alvo text, p_param numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
#variable_conflict use_column
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  nomes text[]; v_comp text; comps text[]; v_ano int; v_meses int[]; n int; v_painel jsonb; v_mes date; r jsonb;
BEGIN
  -- Os nomes que o gráfico mostra (detalhe do resultado), na mesma ordem.
  nomes := ARRAY(SELECT x->>'nome' FROM jsonb_array_elements(coalesce(public.tvg_indicador_dados(p_alvo)#>'{indicador,resultado,detalhe}', '[]'::jsonb)) x
                  WHERE x->>'nome' IS NOT NULL LIMIT 15);

  -- ── DRE: custo de cada contrato do gráfico aberto por conta ───────────
  IF p_alvo IN ('op_lucratividade', 'ctl_margem', 'ctl_vermelhos', 'op_custo_direto', 'ctl_desvio', 'ctl_reincidentes') THEN
    v_comp := public.tvg_dre_competencia();
    IF v_comp IS NULL OR cardinality(nomes) = 0 THEN RETURN NULL; END IF;
    comps := ARRAY(SELECT competencia FROM public.tvg_dre_contratos() WHERE competencia <= v_comp GROUP BY 1 ORDER BY 1 DESC LIMIT 4);
    nomes := nomes[1:12];
    WITH l AS (
      SELECT COALESCE(NULLIF(btrim(d.contrato), ''), 'Sem contrato') AS contrato, d.periodo_competencia AS comp, d.linha_dre,
             coalesce(NULLIF(btrim(d.conta_debito_nome), ''), '(sem conta)') AS conta, public.tvg_num_ponto(d.valor_dre) AS v
        FROM public.mz_60_view_dre_gerencial_competencia d
       WHERE d.periodo_competencia = ANY (comps)
         AND COALESCE(NULLIF(btrim(d.contrato), ''), 'Sem contrato') = ANY (nomes)
         AND d.linha_dre IN ('CUSTO', 'RECEITA')),
    contas AS (SELECT contrato, conta, comp, round(-sum(v), 2) AS valor, count(*) AS lanc FROM l WHERE linha_dre = 'CUSTO' GROUP BY 1, 2, 3),
    por_conta AS (
      SELECT contrato, conta, jsonb_object_agg(comp, jsonb_build_object('valor', valor, 'lancamentos', lanc)) AS por_competencia,
             coalesce(sum(valor) FILTER (WHERE comp = v_comp), 0) AS atual
        FROM contas GROUP BY 1, 2),
    totais AS (
      SELECT contrato, comp, round(-sum(v) FILTER (WHERE linha_dre = 'CUSTO'), 2) AS custo,
             round(sum(v) FILTER (WHERE linha_dre = 'RECEITA'), 2) AS receita, count(*) FILTER (WHERE linha_dre = 'CUSTO') AS lanc_custo
        FROM l GROUP BY 1, 2)
    SELECT jsonb_build_object(
      'competencia_atual', v_comp, 'competencias_janela', to_jsonb(comps),
      'observacao', 'Valores em R$ do DRE gerencial (mz_60_view_dre_gerencial_competencia), custo por conta de débito. Competência sem linha = nenhum lançamento naquele mês (contrato novo, encerrado ou carga incompleta).',
      'contratos', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'contrato', n.nome,
                 'totais_por_competencia', (SELECT jsonb_object_agg(t.comp, jsonb_build_object('custo', t.custo, 'receita', t.receita, 'lancamentos_custo', t.lanc_custo))
                                              FROM totais t WHERE t.contrato = n.nome),
                 'custo_por_conta', (SELECT jsonb_agg(jsonb_build_object('conta', p.conta, 'por_competencia', p.por_competencia) ORDER BY abs(p.atual) DESC)
                                       FROM (SELECT * FROM por_conta p WHERE p.contrato = n.nome ORDER BY abs(p.atual) DESC LIMIT 12) p))
               ORDER BY n.ord)
          FROM unnest(nomes) WITH ORDINALITY AS n(nome, ord)), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Quadro / postos / afastamentos: folha do contrato por situação e cargo ──
  IF p_alvo IN ('op_postos', 'rh_quadro', 'sst_afastamentos') THEN
    WITH q AS (SELECT q.*, public.dir_rel_contrato_nn(q.contrato_id) AS nn FROM public.tvg_quadro_contratos() q WHERE q.contrato = ANY (nomes)),
    e AS (SELECT q.contrato, e."Situação" AS sit, coalesce(nullif(btrim(e."Título do Cargo"), ''), nullif(btrim(e."Nome do Cargo"), ''), 'Sem cargo') AS cargo
            FROM public."EMPREGADOS" e JOIN q ON q.nn = public.rh_norm_contrato(e."Nome Filial")
           WHERE e."Situação" <> 'Demitido' AND e."Nome Filial" IS NOT NULL)
    SELECT jsonb_build_object(
      'observacao', 'Por contrato do gráfico: quadro (necessários = estipulado no cadastro do contrato; ativos/trabalhando/férias/afastados = folha Senior hoje), situações da folha, cargos e vagas abertas na Gestão Recrutamento.',
      'contratos', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'contrato', q.contrato, 'cidade', q.cidade, 'necessarios', q.necessarios, 'ativos', q.ativos, 'trabalhando', q.trabalhando,
          'ferias', q.ferias, 'afastados', q.afastados,
          'situacoes', (SELECT jsonb_object_agg(sit, c) FROM (SELECT sit, count(*) c FROM e WHERE e.contrato = q.contrato GROUP BY 1) s),
          'cargos', (SELECT jsonb_agg(jsonb_build_object('cargo', cargo, 'ativos', c, 'trabalhando', t) ORDER BY c DESC)
                       FROM (SELECT cargo, count(*) c, count(*) FILTER (WHERE sit = 'Trabalhando') t FROM e WHERE e.contrato = q.contrato GROUP BY 1 ORDER BY 2 DESC LIMIT 10) z),
          'vagas_abertas', (SELECT jsonb_agg(jsonb_build_object('vaga', v.id, 'cargo', v.cargo, 'qtd', coalesce(v.quantidade_vagas, 1), 'status', v.status,
                                     'aberta_ha_dias', hoje - (v.created_at AT TIME ZONE 'America/Sao_Paulo')::date, 'motivo', v.motivo_vaga))
                              FROM (SELECT * FROM public."SISTEMA_RECRUTAMENTO" v WHERE v.contrato_id = q.contrato_id
                                       AND v.status NOT IN ('Concluído', 'Reprovada', 'Contratado') ORDER BY v.created_at LIMIT 10) v))
        ORDER BY array_position(nomes, q.contrato)) FROM q), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Faltas / absenteísmo / salários: folha do contrato ────────────────
  IF p_alvo IN ('op_faltas', 'rh_absenteismo', 'rh_salarios') THEN
    WITH c AS (SELECT c.nome, c.cliente, c.valor_mensal_contratado AS fat, c.quant_func_estipulado AS estipulado, public.dir_rel_contrato_nn(c.id) AS nn
                 FROM public.contratos c WHERE c.status = 'ativo' AND c.nome = ANY (nomes)),
    e AS (SELECT c.nome, e."Situação" AS sit, coalesce(nullif(btrim(e."Título do Cargo"), ''), nullif(btrim(e."Nome do Cargo"), ''), 'Sem cargo') AS cargo,
                 public.tvg_num_br(e."Valor Salário"::text) AS sal, e."Data Afastamento" AS dt_af,
                 CASE WHEN p_alvo IN ('op_faltas', 'rh_absenteismo') THEN (e."Situação" ILIKE 'Atestado%' OR e."Situação" ILIKE 'Falta%')
                      ELSE e."Situação" NOT IN ('Trabalhando', 'Férias') END AS fora
            FROM public."EMPREGADOS" e JOIN c ON c.nn = public.rh_norm_contrato(e."Nome Filial")
           WHERE e."Situação" <> 'Demitido' AND e."Nome Filial" IS NOT NULL)
    SELECT jsonb_build_object(
      'observacao', CASE WHEN p_alvo = 'rh_salarios' THEN 'Por contrato: faturamento = valor mensal contratado (cadastro do contrato); folha = soma do salário-base dos ativos na Senior, aberta por cargo.'
                         ELSE 'Por contrato: situação de cada colaborador ativo na folha Senior hoje; "fora" = os que entram na conta do indicador, abertos por situação e cargo.' END,
      'contratos', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'contrato', c.nome, 'cliente', c.cliente, 'faturamento_mensal', c.fat, 'quadro_estipulado', c.estipulado,
          'ativos', (SELECT count(*) FROM e WHERE e.nome = c.nome),
          'situacoes', (SELECT jsonb_object_agg(sit, q) FROM (SELECT sit, count(*) q FROM e WHERE e.nome = c.nome GROUP BY 1) s),
          'fora_por_cargo', CASE WHEN p_alvo <> 'rh_salarios' THEN (SELECT jsonb_agg(jsonb_build_object('cargo', cargo, 'situacao', sit, 'qtd', q) ORDER BY q DESC)
                              FROM (SELECT cargo, sit, count(*) q FROM e WHERE e.nome = c.nome AND fora GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12) z) END,
          'folha_total', CASE WHEN p_alvo = 'rh_salarios' THEN (SELECT round(sum(sal), 2) FROM e WHERE e.nome = c.nome) END,
          'folha_por_cargo', CASE WHEN p_alvo = 'rh_salarios' THEN (SELECT jsonb_agg(jsonb_build_object('cargo', cargo, 'qtd', q, 'soma_salarios', s, 'salario_medio', round(s / q, 2)) ORDER BY s DESC)
                               FROM (SELECT cargo, count(*) q, round(sum(sal), 2) s FROM e WHERE e.nome = c.nome AND sal > 0 GROUP BY 1 ORDER BY 3 DESC LIMIT 12) z) END)
        ORDER BY array_position(nomes, c.nome)) FROM c), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Experiência vencendo / acidentes: os colaboradores (sem nome) ─────
  IF p_alvo = 'rh_ob_experiencia' THEN
    WITH e AS (SELECT coalesce(nullif(btrim(e."Nome Filial"), ''), 'Sem contrato') AS contrato,
                      coalesce(nullif(btrim(e."Título do Cargo"), ''), e."Nome do Cargo") AS cargo, public.rh_data(e."Admissão"::text) AS adm
                 FROM public."EMPREGADOS" e WHERE e."Situação" <> 'Demitido'),
    f AS (SELECT *, hoje - adm AS dias FROM e WHERE hoje - adm BETWEEN 45 - coalesce(p_param, 15)::int AND 45 OR hoje - adm BETWEEN 90 - coalesce(p_param, 15)::int AND 90)
    SELECT jsonb_build_object('observacao', 'Colaboradores ativos chegando ao fim do 1º (45 d) ou 2º (90 d) período de experiência, pela data de admissão na Senior.',
      'registros', coalesce((SELECT jsonb_agg(jsonb_build_object('contrato', contrato, 'cargo', cargo, 'admissao', adm, 'dias_de_casa', dias,
                                                                'vence_em', CASE WHEN dias <= 45 THEN adm + 45 ELSE adm + 90 END) ORDER BY contrato, dias DESC)
                               FROM (SELECT * FROM f ORDER BY dias DESC LIMIT 50) z), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_alvo = 'sst_acidentes' THEN
    SELECT jsonb_build_object('observacao', 'Colaboradores com situação ou causa de acidente na folha Senior, hoje.',
      'registros', coalesce(jsonb_agg(jsonb_build_object('contrato', coalesce(nullif(btrim(e."Nome Filial"), ''), 'Sem contrato'),
                     'cargo', coalesce(nullif(btrim(e."Título do Cargo"), ''), e."Nome do Cargo"), 'situacao', e."Situação",
                     'causa', e."Descrição (Causa)", 'data_afastamento', e."Data Afastamento")), '[]'::jsonb))
      INTO r
      FROM (SELECT * FROM public."EMPREGADOS" e
             WHERE e."Situação" ILIKE '%acident%' OR e."Descrição (Causa)" ILIKE '%acident%' AND e."Situação" <> 'Demitido' LIMIT 50) e;
    RETURN r;
  END IF;

  -- ── Turnover: o painel de turnover da Diretoria, recortado ────────────
  IF p_alvo = 'op_turnover' THEN
    v_ano := extract(year FROM hoje)::int;
    -- Ano inteiro até hoje, todas as causas: igual a Relatórios › Turnover (mig 20261014000026).
    v_meses := NULL;
    v_painel := public.dir_turnover_painel_dados(v_ano, NULL, NULL, NULL, v_meses);
    SELECT jsonb_build_object(
      'observacao', 'Os mesmos dados de Relatórios › Turnover, ano ' || v_ano || ' inteiro até hoje, todas as causas. Turnover do ano = SOMA das taxas mensais (demissões ÷ efetivo no fim do mês); meta 41% no ano e 3,42% no mês; projeção = soma × fator_projecao. Contrato: demissões ÷ efetivo médio do contrato no ano.',
      'fator_projecao', v_painel->'fator_projecao', 'efetivo_medio_grupo', v_painel->'efetivo_medio',
      'mensal', v_painel->'mensal', 'causas_de_demissao', v_painel->'causas',
      'contratos', (SELECT jsonb_agg(x) FROM jsonb_array_elements(v_painel->'por_contrato') x
                     WHERE regexp_replace(x->>'contrato', '^\s*\d+\s*-\s*', '') = ANY (nomes)))
      INTO r;
    RETURN r;
  END IF;

  -- ── Notificações do Jurídico (glosas, multas, reclamações, prazos) ────
  IF p_alvo IN ('op_glosas', 'fin_glosas', 'op_reclamacoes', 'jur_prazos', 'jur_sem_resposta', 'jur_multas_revertidas', 'jur_contratos_analise') THEN
    WITH f AS (
      SELECT n.*, coalesce(nullif(btrim(n.contrato), ''), n.orgao, 'Sem contrato') AS contrato_ou_orgao
        FROM public."JUR_NOTIFICACOES" n
       WHERE CASE p_alvo
               WHEN 'op_glosas' THEN n.tipo = 'Glosa' AND coalesce(n.resultado, '') <> 'Revertida' AND coalesce(n.data_recebimento, n.created_at::date) >= hoje - coalesce(p_param, 90)::int
               WHEN 'fin_glosas' THEN n.tipo IN ('Glosa', 'Multa') AND coalesce(n.resultado, '') <> 'Revertida' AND coalesce(n.data_recebimento, n.created_at::date) >= hoje - coalesce(p_param, 90)::int
               WHEN 'op_reclamacoes' THEN coalesce(n.tipo, '') NOT IN ('Glosa', 'Multa') AND coalesce(n.data_recebimento, n.created_at::date) >= hoje - coalesce(p_param, 90)::int
               WHEN 'jur_prazos' THEN n.encerrada_em IS NULL AND coalesce(n.etapa, '') <> 'Encerrada' AND n.prazo_defesa - hoje <= coalesce(p_param, 5)
               WHEN 'jur_sem_resposta' THEN n.encerrada_em IS NULL AND coalesce(n.etapa, '') <> 'Encerrada' AND n.etapa IN ('Recebida', 'Em análise')
               WHEN 'jur_multas_revertidas' THEN n.resultado ILIKE 'Revertida%' AND coalesce(n.data_desfecho, n.updated_at::date) >= hoje - coalesce(p_param, 365)::int
               ELSE nullif(btrim(n.medida_preventiva), '') IS NOT NULL AND NOT coalesce(n.medida_concluida, false) AND n.medida_prazo < hoje END)
    SELECT jsonb_build_object(
      'observacao', 'Notificações de Jurídico › Notificações (JUR_NOTIFICACOES) que entram na conta, com o mesmo filtro do indicador. Valores em R$.',
      'total_registros', (SELECT count(*) FROM f),
      'por_contrato_e_causa', (SELECT jsonb_agg(jsonb_build_object('contrato', contrato_ou_orgao, 'causa', causa, 'qtd', q, 'valor', v) ORDER BY v DESC NULLS LAST, q DESC)
                                 FROM (SELECT contrato_ou_orgao, left(coalesce(nullif(btrim(causa_raiz), ''), nullif(btrim(assunto), ''), tipo, 'Sem causa registrada'), 100) AS causa,
                                              count(*) q, sum(coalesce(valor_final, valor_original)) v FROM f GROUP BY 1, 2 ORDER BY 4 DESC NULLS LAST, 3 DESC LIMIT 20) z),
      'registros', (SELECT jsonb_agg(jsonb_build_object('protocolo', protocolo, 'documento', numero_documento, 'tipo', tipo, 'contrato', contrato_ou_orgao,
                       'posto', local_posto, 'ocorrencia', data_ocorrencia, 'recebida', data_recebimento, 'assunto', left(assunto, 150), 'causa_raiz', left(causa_raiz, 150),
                       'valor_original', valor_original, 'valor_final', valor_final, 'valor_descontado', valor_descontado, 'etapa', etapa, 'resultado', resultado,
                       'prazo_defesa', prazo_defesa, 'setor_responsavel', setor_responsavel,
                       'medida_preventiva', left(medida_preventiva, 120), 'medida_prazo', medida_prazo, 'medida_concluida', medida_concluida))
                      FROM (SELECT * FROM f ORDER BY coalesce(valor_final, valor_original) DESC NULLS LAST, coalesce(prazo_defesa, data_recebimento) LIMIT 40) z),
      'descontos_nas_nfs', CASE WHEN p_alvo = 'fin_glosas' THEN (
          SELECT jsonb_agg(jsonb_build_object('nf', numero_nf, 'contrato', contrato, 'competencia', competencia, 'emissao', data_emissao,
                                              'descontos_pos_emissao', descontos_pos_emissao_total, 'conta_vinculada_retida', desconto_conta_vinculada) ORDER BY tot DESC)
            FROM (SELECT n.numero_nf, c.nome AS contrato, n.competencia, n.data_emissao, n.descontos_pos_emissao_total, n.desconto_conta_vinculada,
                         coalesce(n.descontos_pos_emissao_total, 0) AS tot
                    FROM public.nf_emissao n LEFT JOIN public.contratos c ON c.id = n.contrato_id
                   WHERE n.deleted_at IS NULL AND n.status::text <> 'cancelada' AND n.data_emissao >= hoje - coalesce(p_param, 90)::int
                     AND coalesce(n.descontos_pos_emissao_total, 0) > 0
                   ORDER BY tot DESC LIMIT 25) z) END)
      INTO r;
    RETURN r;
  END IF;

  -- ── Processos do Jurídico (sem o nome do reclamante) ──────────────────
  IF p_alvo IN ('jur_audiencias', 'jur_reincidentes', 'jur_risco', 'jur_valor_condenacao', 'jur_valor_acordo') THEN
    WITH p AS (
      SELECT p.*, coalesce(nullif(btrim(p.contrato), ''), p.comarca, 'Sem contrato') AS contrato_ou_comarca,
             coalesce(p.valor_pedidos, p.valor_causa, 0)::numeric AS pedidos,
             (SELECT min(left(d, 10)::date) FROM unnest(ARRAY[p.data_audiencia_designada, p.data_primeira_audiencia, p.data_audiencia_instrucao, p.data_pericia]) d
               WHERE d ~ '^\d{4}-\d{2}-\d{2}' AND left(d, 10)::date BETWEEN hoje AND hoje + coalesce(p_param, 15)::int) AS proxima
        FROM public."JUR_PROCESSOS" p WHERE p.status = 'EM ANDAMENTO'),
    f AS (SELECT * FROM p WHERE CASE p_alvo
            WHEN 'jur_audiencias' THEN proxima IS NOT NULL
            WHEN 'jur_risco' THEN numero_processo IN (SELECT q.numero_processo FROM public."JUR_PROCESSOS" q WHERE q.status = 'EM ANDAMENTO' GROUP BY 1 HAVING coalesce(sum(q.valor_pedidos), max(q.valor_causa), 0) >= coalesce(p_param, 100000))
            WHEN 'jur_valor_condenacao' THEN coalesce(valor_sentenca, 0) > 0
            WHEN 'jur_valor_acordo' THEN coalesce(valor_acordo, 0) > 0
            ELSE EXISTS (SELECT 1 FROM regexp_split_to_table(coalesce(motivos, ''), '\s*[,;]\s*') x WHERE btrim(x) = ANY (nomes)) END)
    SELECT jsonb_build_object(
      'observacao', 'Processos em andamento de Jurídico › Processos (JUR_PROCESSOS) que entram na conta. Valores em R$; pedidos = valor dos pedidos (ou da causa).',
      'total_registros', (SELECT count(*) FROM f), 'total_processos', (SELECT count(DISTINCT numero_processo) FROM f), 'obs_linhas', 'Cada processo tem uma linha por motivo (pedido); pedidos/sentença/acordo de cada linha são a parte daquele motivo.',
      'por_contrato', (SELECT jsonb_agg(jsonb_build_object('contrato', contrato_ou_comarca, 'processos', q, 'pedidos', s1, 'sentencas', s2, 'acordos', s3) ORDER BY s1 DESC)
                         FROM (SELECT contrato_ou_comarca, count(*) q, sum(pedidos) s1, sum(valor_sentenca) s2, sum(valor_acordo) s3 FROM f GROUP BY 1 ORDER BY 3 DESC LIMIT 15) z),
      'por_motivo_e_contrato', CASE WHEN p_alvo = 'jur_reincidentes' THEN (
          SELECT jsonb_agg(jsonb_build_object('motivo', m, 'contrato', contrato_ou_comarca, 'processos', q) ORDER BY array_position(nomes, m), q DESC)
            FROM (SELECT btrim(x) m, contrato_ou_comarca, count(DISTINCT numero_processo) q
                    FROM f, regexp_split_to_table(coalesce(motivos, ''), '\s*[,;]\s*') x WHERE btrim(x) = ANY (nomes) GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 40) z) END,
      'registros', (SELECT jsonb_agg(jsonb_build_object('processo', numero_processo, 'contrato', contrato_ou_comarca, 'comarca', comarca, 'tipo', tipo_processo,
                       'motivos', left(motivos, 200), 'entrada', data_entrada_reclamatoria, 'pedidos', pedidos, 'valor_sentenca', valor_sentenca,
                       'status_sentenca', status_sentenca, 'houve_acordo', houve_acordo, 'valor_acordo', valor_acordo, 'recursos', status_recursos,
                       'proxima_data', proxima, 'audiencia_designada', data_audiencia_designada, 'instrucao', data_audiencia_instrucao, 'pericia', data_pericia))
                      FROM (SELECT * FROM f ORDER BY proxima NULLS LAST, pedidos DESC LIMIT CASE WHEN p_alvo = 'jur_reincidentes' THEN 12 ELSE 35 END) z))
      INTO r;
    RETURN r;
  END IF;

  -- ── Licitações: as linhas da grade ────────────────────────────────────
  IF p_alvo IN ('lic_prazo', 'lic_propostas', 'lic_implantacao', 'lic_perdidas', 'lic_valor', 'lic_documentos', 'lic_risco') THEN
    WITH f AS (
      SELECT g.* FROM public.grade g
       WHERE CASE p_alvo
               WHEN 'lic_prazo' THEN g.fase::text IN ('À Iniciar', 'Iniciado') AND g.data BETWEEN hoje AND hoje + coalesce(p_param, 3)::int
               WHEN 'lic_propostas' THEN g.fase::text IN ('À Iniciar', 'Iniciado', 'Em Andamento') AND g.data BETWEEN hoje AND hoje + coalesce(p_param, 7)::int
               WHEN 'lic_implantacao' THEN g.fase::text = 'Finalizada' AND g.posicao = 1 AND g.data >= hoje - coalesce(p_param, 365)::int
                    AND NOT EXISTS (SELECT 1 FROM public.implantacao_contrato i WHERE g.capa_id IS NOT NULL AND i.capa_id = g.capa_id)
                    AND NOT EXISTS (SELECT 1 FROM public.contratos c WHERE c.grade_id = g.id)
               WHEN 'lic_perdidas' THEN g.fase::text = 'Finalizada' AND g.posicao IS DISTINCT FROM 1 AND coalesce(g.updated_at, g.created_at) >= now() - make_interval(days => coalesce(p_param, 90)::int)
               WHEN 'lic_valor' THEN g.fase::text IN ('À Iniciar', 'Iniciado', 'Em Andamento')
               WHEN 'lic_documentos' THEN g.fase::text IN ('À Iniciar', 'Iniciado', 'Em Andamento') AND g.capa_id IS NULL AND g.data BETWEEN hoje AND hoje + coalesce(p_param, 15)::int
               ELSE g.fase::text IN ('Suspenso', 'Revogado') AND coalesce(g.updated_at, g.created_at) >= now() - make_interval(days => coalesce(p_param, 180)::int) END)
    SELECT jsonb_build_object(
      'observacao', 'Processos da grade de Licitações que entram na conta. posicao = colocação da empresa (1 = vencedora); status_obs = observação/motivo registrado.',
      'total_registros', (SELECT count(*) FROM f),
      'registros', (SELECT jsonb_agg(jsonb_build_object('edital', edital, 'cidade', cidade, 'uf', uf, 'sessao', data, 'horario', horario, 'fase', fase,
                       'objeto', left(objeto, 150), 'valor_global', public.tvg_num_br(valor_global), 'pessoas', qtd_pessoas, 'posicao', posicao,
                       'status_obs', left(status_obs, 150), 'capa_preenchida', capa_id IS NOT NULL, 'captada_em', data_captacao))
                      FROM (SELECT * FROM f ORDER BY CASE WHEN p_alvo = 'lic_valor' THEN -public.tvg_num_br(valor_global) END NULLS LAST, data LIMIT 40) z))
      INTO r;
    RETURN r;
  END IF;

  -- ── Supply: pedidos parados ───────────────────────────────────────────
  IF p_alvo IN ('sup_compras_vencidas', 'sup_contratos_sem_entrega', 'sst_epi', 'sst_imp_epi', 'sup_fornecedor') THEN
    WITH f AS (
      SELECT p.*, hoje - p.data_solicitacao AS dias, coalesce(nullif(btrim(p.contrato_nome), ''), 'Sem contrato') AS contrato
        FROM public.sup_pedido p
       WHERE CASE p_alvo
               WHEN 'sup_compras_vencidas' THEN p.status = 'AGUARDANDO COMPRA' AND p.data_solicitacao < hoje - coalesce(p_param, 15)::int
               WHEN 'sup_contratos_sem_entrega' THEN p.status IN ('AGUARDANDO COMPRA', 'AGUARDANDO ENVIO', 'EM PREPARACAO', 'EM SEPARACAO') AND p.data_solicitacao < hoje - coalesce(p_param, 10)::int
               WHEN 'sup_fornecedor' THEN p.status IN ('AGUARDANDO COMPRA', 'AGUARDANDO ENVIO', 'EM PREPARACAO', 'EM SEPARACAO') AND p.data_solicitacao < hoje - coalesce(p_param, 15)::int
               ELSE p.tipo_pedido IN ('uniforme', 'ambos') AND p.status IN ('AGUARDANDO COMPRA', 'AGUARDANDO ENVIO', 'EM PREPARACAO', 'EM SEPARACAO')
                    AND p.data_solicitacao < hoje - coalesce(p_param, 10)::int END)
    SELECT jsonb_build_object(
      'observacao', 'Pedidos de material/uniforme do Supply (sup_pedido) parados, com o mesmo filtro do indicador. dias = desde a solicitação.',
      'total_registros', (SELECT count(*) FROM f),
      'por_contrato_e_status', (SELECT jsonb_agg(jsonb_build_object('contrato', contrato, 'status', status, 'qtd', q, 'mais_antigo_dias', d) ORDER BY q DESC)
                                  FROM (SELECT contrato, status, count(*) q, max(dias) d FROM f GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20) z),
      'registros', (SELECT jsonb_agg(jsonb_build_object('pedido', pedido_id, 'contrato', contrato, 'posto', posto_nome, 'funcao', funcao_nome, 'tipo', tipo_pedido,
                       'status', status, 'solicitado_em', data_solicitacao, 'dias', dias, 'admissao', admissao, 'origem', origem, 'observacao', left(observacao, 120)))
                      FROM (SELECT * FROM f ORDER BY dias DESC LIMIT 40) z))
      INTO r;
    RETURN r;
  END IF;

  -- ── Supply: itens de estoque ──────────────────────────────────────────
  IF p_alvo IN ('sup_abaixo_minimo', 'sup_valor_estoque', 'sup_sem_mov') THEN
    WITH s AS (SELECT item_estoque_id, sum(disponivel) AS disp, sum(fisico) AS fis FROM public.sup_estoque_saldo GROUP BY 1),
    i AS (SELECT ei.id, it.nome, it.tipo, it.tamanho, ei.estoque_minimo AS minimo, coalesce(ei.valor_unitario, 0) AS vu, ei.fornecedor, ei.validade,
                 coalesce(s.disp, 0) AS disp, coalesce(s.fis, 0) AS fis,
                 (SELECT max(m.created_at)::date FROM public.sup_estoque_movimento m WHERE m.item_estoque_id = ei.id) AS ult_mov,
                 (SELECT max(c.consumido_em)::date FROM public.sup_estoque_consumo c WHERE c.item_estoque_id = ei.id) AS ult_consumo
            FROM public.sup_estoque_item ei JOIN public.sup_item it ON it.id = ei.sup_item_id
            LEFT JOIN s ON s.item_estoque_id = ei.id WHERE ei.arquivado_em IS NULL),
    f AS (SELECT * FROM i WHERE CASE p_alvo
            WHEN 'sup_abaixo_minimo' THEN minimo > 0 AND disp < minimo
            WHEN 'sup_valor_estoque' THEN fis > 0
            ELSE fis > 0 AND coalesce(greatest(ult_mov, ult_consumo), '1900-01-01') < hoje - coalesce(p_param, 90)::int END)
    SELECT jsonb_build_object(
      'observacao', 'Itens do estoque do Supply que entram na conta. disp = disponível; fis = físico; vu = valor unitário; ult_mov/ult_consumo = última movimentação/consumo.',
      'total_registros', (SELECT count(*) FROM f), 'valor_total', (SELECT round(sum(fis * vu), 2) FROM f),
      'por_tipo', (SELECT jsonb_agg(jsonb_build_object('tipo', tipo, 'itens', q, 'valor', v) ORDER BY v DESC) FROM (SELECT tipo, count(*) q, round(sum(fis * vu), 2) v FROM f GROUP BY 1) z),
      'registros', (SELECT jsonb_agg(jsonb_build_object('item', nome, 'tipo', tipo, 'tamanho', tamanho, 'minimo', minimo, 'disp', disp, 'fis', fis, 'vu', vu,
                       'valor', round(fis * vu, 2), 'fornecedor', fornecedor, 'validade', validade, 'ult_mov', ult_mov, 'ult_consumo', ult_consumo))
                      FROM (SELECT * FROM f ORDER BY CASE WHEN p_alvo = 'sup_abaixo_minimo' THEN disp::numeric / greatest(minimo, 1) ELSE -(fis * vu) END LIMIT 40) z))
      INTO r;
    RETURN r;
  END IF;

  -- ── Frota e patrimônio ────────────────────────────────────────────────
  IF p_alvo IN ('fro_indisponiveis', 'fro_manutencoes', 'fro_sem_responsavel', 'fro_documentos', 'fro_nao_localizados') THEN
    WITH p AS (
      SELECT p.*, c.nome AS contrato,
             greatest(p.updated_at, (SELECT max(l.created_at) FROM public.sup_patrimonio_log l WHERE l.patrimonio_id = p.id))::date AS ult_atualizacao
        FROM public.sup_patrimonio p LEFT JOIN public.contratos c ON c.id = p.contrato_id WHERE p.ativo),
    f AS (SELECT * FROM p WHERE CASE p_alvo
            WHEN 'fro_indisponiveis' THEN categoria = 'veiculo' AND (em_manutencao OR motivo_indisponivel IS NOT NULL)
            WHEN 'fro_manutencoes' THEN em_manutencao AND data_previsao_fim < hoje
            WHEN 'fro_sem_responsavel' THEN contrato_id IS NULL AND posto_id IS NULL AND nullif(btrim(lotacao), '') IS NULL
            WHEN 'fro_documentos' THEN categoria = 'veiculo' AND NOT EXISTS (SELECT 1 FROM public.sup_patrimonio_arquivo a WHERE a.patrimonio_id = p.id)
            ELSE hoje - ult_atualizacao > coalesce(p_param, 180) END)
    SELECT jsonb_build_object(
      'observacao', 'Bens ativos de Patrimônio/Frota (sup_patrimonio) que entram na conta. ult_atualizacao = última alteração ou movimentação registrada.',
      'total_registros', (SELECT count(*) FROM f),
      'por_categoria_e_lotacao', (SELECT jsonb_agg(jsonb_build_object('categoria', categoria, 'lotacao', lot, 'qtd', q) ORDER BY q DESC)
                                    FROM (SELECT categoria, coalesce(nullif(btrim(lotacao), ''), contrato, 'Sem lotação') lot, count(*) q FROM f GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20) z),
      'registros', (SELECT jsonb_agg(jsonb_build_object('bem', nome, 'identificador', identificador, 'categoria', categoria, 'lotacao', lotacao, 'contrato', contrato,
                       'em_manutencao', em_manutencao, 'motivo_indisponivel', motivo_indisponivel, 'motivo_detalhe', left(motivo_detalhe, 150),
                       'inicio_manutencao', data_inicio_manutencao, 'previsao_retorno', data_previsao_fim, 'ult_atualizacao', ult_atualizacao))
                      FROM (SELECT * FROM f ORDER BY data_previsao_fim NULLS LAST, ult_atualizacao LIMIT 40) z))
      INTO r;
    RETURN r;
  END IF;

  IF p_alvo = 'fro_combustivel' THEN
    WITH a AS (SELECT * FROM public.cs_veiculo_agendamento a
                WHERE a.controle_km AND coalesce(a.status, '') NOT ILIKE '%cancel%' AND a.data_fim BETWEEN hoje - coalesce(p_param, 60)::int AND hoje - 1)
    SELECT jsonb_build_object(
      'observacao', 'Viagens do agendamento de veículos com controle de km nos últimos ' || coalesce(p_param, 60)::int || ' dias; sem_km = encerrada sem km inicial ou final.',
      'por_veiculo', (SELECT jsonb_agg(jsonb_build_object('veiculo', v, 'viagens', q, 'sem_km', s, 'km_rodado', km) ORDER BY s DESC, km DESC)
                        FROM (SELECT coalesce(veiculo_nome, 'Veículo') || coalesce(' · ' || veiculo_identificador, '') v, count(*) q,
                                     count(*) FILTER (WHERE km_inicial IS NULL OR km_final IS NULL) s,
                                     sum(km_final - km_inicial) FILTER (WHERE km_final >= km_inicial) km FROM a GROUP BY 1) z),
      'viagens_sem_km', (SELECT jsonb_agg(jsonb_build_object('agendamento', numero, 'veiculo', coalesce(veiculo_nome, 'Veículo') || coalesce(' · ' || veiculo_identificador, ''),
                            'inicio', data_inicio, 'fim', data_fim, 'destino', left(destino, 80), 'status', status, 'km_inicial', km_inicial, 'km_final', km_final))
                           FROM (SELECT * FROM a WHERE km_inicial IS NULL OR km_final IS NULL ORDER BY data_fim DESC LIMIT 40) z))
      INTO r;
    RETURN r;
  END IF;

  -- ── Recrutamento: as vagas, com os candidatos por etapa ───────────────
  IF p_alvo IN ('rec_risco', 'rec_abertas', 'rec_prazo', 'rec_admissoes') THEN
    WITH f AS (
      SELECT s.*, hoje - (s.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dias,
             hoje - (coalesce(s.status_changed_at, s.created_at) AT TIME ZONE 'America/Sao_Paulo')::date AS dias_no_status
        FROM public."SISTEMA_RECRUTAMENTO" s
       WHERE CASE WHEN p_alvo = 'rec_admissoes'
                  THEN s.status NOT IN ('Reprovada', 'Contratado', 'Concluído') AND s.data_inicio_prevista ~ '^\d{4}-\d{2}-\d{2}'
                       AND left(s.data_inicio_prevista, 10)::date BETWEEN date_trunc('month', hoje)::date AND hoje
                  ELSE s.status NOT IN ('Concluído', 'Reprovada', 'Contratado')
                       AND (p_alvo = 'rec_abertas' OR (p_alvo = 'rec_risco' AND s.grau_urgencia ILIKE 'Alta%' AND hoje - (s.created_at AT TIME ZONE 'America/Sao_Paulo')::date > coalesce(p_param, 15))
                            OR (p_alvo = 'rec_prazo' AND hoje - (s.created_at AT TIME ZONE 'America/Sao_Paulo')::date > coalesce(p_param, 15))) END)
    SELECT jsonb_build_object(
      'observacao', 'Vagas da Gestão Recrutamento (SISTEMA_RECRUTAMENTO) que entram na conta' ||
                    CASE WHEN p_alvo = 'rec_admissoes' THEN ' (só as PENDENTES: início previsto no mês até hoje e ainda não contratadas)' ELSE '' END ||
                    '. candidatos = currículos no kanban da vaga por etapa (sem desistentes).',
      'total_registros', (SELECT count(*) FROM f),
      'por_status', (SELECT jsonb_object_agg(status, q) FROM (SELECT status, sum(greatest(coalesce(quantidade_vagas, 1), 1)) q FROM f GROUP BY 1) z),
      'registros', (SELECT jsonb_agg(jsonb_build_object('vaga', id, 'contrato', contrato, 'cidade', cidade, 'cargo', cargo, 'qtd', coalesce(quantidade_vagas, 1),
                       'status', status, 'urgencia', grau_urgencia, 'motivo', motivo_vaga, 'aberta_ha_dias', dias, 'dias_no_status', dias_no_status,
                       'inicio_previsto', data_inicio_prevista, 'alta_rotatividade', alta_rotatividade,
                       'candidatos', (SELECT jsonb_object_agg(coalesce(etapa_processo, '—'), q) FROM (SELECT etapa_processo, count(*) q FROM public."WA_CURRICULOS" c
                                        WHERE c.vaga_id = z.id AND NOT coalesce(c.desistiu, false) GROUP BY 1) w),
                       'desistencias', (SELECT count(*) FROM public."WA_CURRICULOS" c WHERE c.vaga_id = z.id AND c.desistiu)))
                      FROM (SELECT * FROM f ORDER BY dias DESC LIMIT 40) z))
      INTO r;
    RETURN r;
  END IF;

  IF p_alvo = 'rec_desistencias' THEN
    WITH d AS (SELECT h.created_at::date AS dia, h.solicitacao_id, s.contrato, s.cidade, s.cargo, h.de_status, h.evento,
                      coalesce(substring(h.evento FROM '\(em ([^)]+)\)'), coalesce(h.de_status, 'etapa não informada')) AS etapa,
                      (SELECT c.desistencia_motivo FROM public."WA_CURRICULOS" c WHERE c.id = h.candidato_id) AS motivo
                 FROM public."RECRUTAMENTO_HISTORICO" h LEFT JOIN public."SISTEMA_RECRUTAMENTO" s ON s.id = h.solicitacao_id
                WHERE h.evento ILIKE '%desist%' AND h.created_at >= now() - make_interval(days => coalesce(p_param, 30)::int))
    SELECT jsonb_build_object(
      'observacao', 'Desistências registradas no histórico das vagas nos últimos ' || coalesce(p_param, 30)::int || ' dias (sem o nome do candidato).',
      'por_etapa', (SELECT jsonb_object_agg(etapa, q) FROM (SELECT etapa, count(*) q FROM d GROUP BY 1) z),
      'por_motivo', (SELECT jsonb_object_agg(m, q) FROM (SELECT coalesce(nullif(btrim(motivo), ''), 'não informado') m, count(*) q FROM d GROUP BY 1) z),
      'registros', (SELECT jsonb_agg(jsonb_build_object('dia', dia, 'vaga', solicitacao_id, 'contrato', contrato, 'cidade', cidade, 'cargo', cargo,
                       'etapa', etapa, 'motivo', left(motivo, 150)) ORDER BY dia DESC) FROM (SELECT * FROM d ORDER BY dia DESC LIMIT 40) z))
      INTO r;
    RETURN r;
  END IF;

  -- ── Rescisões e ASO (sem nome do colaborador/candidato) ───────────────
  IF p_alvo IN ('rh_ob_rescisoes', 'sst_aso', 'sst_imp_aso') THEN
    SELECT jsonb_build_object(
      'observacao', 'Solicitações de demissão pendentes' || CASE WHEN p_alvo = 'rh_ob_rescisoes' THEN '' ELSE ' no SST e candidatos na etapa SST + COMPRAS (admissional)' END ||
                    '; dias = desde a solicitação / desde que entrou na etapa.',
      'demissionais', (SELECT jsonb_agg(jsonb_build_object('solicitacao', id, 'contrato', contrato, 'cargo', colaborador_cargo, 'posto', colaborador_posto,
                          'motivo', left(coalesce(motivo_solicitacao, motivo_pedido), 120), 'status', status, 'solicitada_em', coalesce(data_solicitacao, criado_em::date),
                          'dias', hoje - coalesce(data_solicitacao, criado_em::date), 'aviso', data_aviso, 'modelo_aviso', modelo_aviso,
                          'exame_agendado', sst_data_exame, 'devolvida', left(devolvido_motivo, 120)) ORDER BY coalesce(data_solicitacao, criado_em::date))
                         FROM (SELECT * FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s
                                WHERE s.status IN (CASE WHEN p_alvo = 'rh_ob_rescisoes' THEN 'Pendente Operacional' END, CASE WHEN p_alvo = 'rh_ob_rescisoes' THEN 'Pendente RH' END,
                                                   'Pendente SST', 'Solicitação de agendamento de DEMISSIONAL recebida')
                                AND hoje - coalesce(s.data_solicitacao, s.criado_em::date) > coalesce(p_param, CASE WHEN p_alvo = 'rh_ob_rescisoes' THEN 10 ELSE 5 END)
                                ORDER BY coalesce(s.data_solicitacao, s.criado_em::date) LIMIT 40) z),
      'admissionais', CASE WHEN p_alvo <> 'rh_ob_rescisoes' THEN (
          SELECT jsonb_agg(jsonb_build_object('vaga', v.id, 'contrato', v.contrato, 'cidade', v.cidade, 'cargo', v.cargo,
                   'dias_na_etapa', hoje - coalesce(c.etapa_changed_at, c.created_at)::date, 'exame_agendado', c.sst_data_exame,
                   'sst_ok', c.sst_ok, 'compras_ok', c.compras_ok) ORDER BY coalesce(c.etapa_changed_at, c.created_at))
            FROM (SELECT * FROM public."WA_CURRICULOS" c WHERE c.etapa_processo = 'SST + COMPRAS' AND NOT coalesce(c.desistiu, false)
                     AND hoje - coalesce(c.etapa_changed_at, c.created_at)::date > coalesce(p_param, 5)
                   ORDER BY coalesce(c.etapa_changed_at, c.created_at) LIMIT 40) c
            LEFT JOIN public."SISTEMA_RECRUTAMENTO" v ON v.id = c.vaga_id) END)
      INTO r;
    RETURN r;
  END IF;

  -- ── Treinamentos ──────────────────────────────────────────────────────
  IF p_alvo = 'trn_integracoes' THEN
    WITH a AS (SELECT a.*, coalesce(nullif(btrim(a.contrato), ''), 'Sem contrato') AS ctr FROM public."TRN_ALUNO" a
                WHERE a.status = 'ativo' AND a.created_at >= now() - make_interval(days => coalesce(p_param, 30)::int) AND a.created_at < now() - interval '7 days'
                  AND NOT EXISTS (SELECT 1 FROM public."TRN_PROGRESSO" p WHERE p.aluno_id = a.id AND p.concluida))
    SELECT jsonb_build_object(
      'observacao', 'Alunos ativos criados nos últimos ' || coalesce(p_param, 30)::int || ' dias sem nenhuma aula concluída na plataforma de Treinamentos.',
      'por_contrato_e_cargo', (SELECT jsonb_agg(jsonb_build_object('contrato', ctr, 'cargo', cargo, 'alunos', q, 'nunca_acessaram', na) ORDER BY q DESC)
                                 FROM (SELECT ctr, cargo, count(*) q, count(*) FILTER (WHERE primeiro_acesso_em IS NULL) na FROM a GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 25) z),
      'matriculas_desses_alunos', (SELECT jsonb_object_agg(curso, q) FROM (SELECT c.nome curso, count(*) q FROM a JOIN public."TRN_MATRICULA" m ON m.aluno_id = a.id
                                     JOIN public."TRN_CURSO" c ON c.id = m.curso_id GROUP BY 1 ORDER BY 2 DESC LIMIT 15) z))
      INTO r;
    RETURN r;
  END IF;

  IF p_alvo IN ('trn_contratuais', 'trn_vencidos', 'sst_imp_treinamento', 'trn_programados', 'trn_sem_comprovacao') THEN
    v_mes := date_trunc('month', hoje)::date;
    WITH m AS (SELECT coalesce(nullif(btrim(a.contrato), ''), 'Sem contrato') AS contrato, c.nome AS curso, m.inscrito_em, hoje - m.inscrito_em AS dias, a.expira_em,
                      EXISTS (SELECT 1 FROM public."TRN_CERTIFICADO" ce WHERE ce.aluno_id = m.aluno_id AND ce.curso_id = m.curso_id) AS certificado
                 FROM public."TRN_MATRICULA" m JOIN public."TRN_ALUNO" a ON a.id = m.aluno_id JOIN public."TRN_CURSO" c ON c.id = m.curso_id
                WHERE CASE WHEN p_alvo IN ('trn_programados') THEN m.inscrito_em >= v_mes
                           WHEN p_alvo = 'trn_sem_comprovacao' THEN m.inscrito_em < hoje - coalesce(p_param, 60)::int
                           ELSE a.status = 'ativo' END),
    f AS (SELECT * FROM m WHERE CASE p_alvo
            WHEN 'trn_contratuais' THEN NOT certificado AND dias > coalesce(p_param, 30)
            WHEN 'trn_programados' THEN true
            WHEN 'trn_sem_comprovacao' THEN NOT certificado
            ELSE NOT certificado AND expira_em IS NOT NULL AND expira_em <= hoje + coalesce(p_param, 15)::int END)
    SELECT jsonb_build_object(
      'observacao', 'Matrículas da plataforma de Treinamentos que entram na conta, por curso e contrato do aluno.' ||
                    CASE WHEN p_alvo = 'trn_programados' THEN ' Mês corrente: matrículas e quantas já têm certificado.' ELSE '' END,
      'total_registros', (SELECT count(*) FROM f),
      'por_curso', (SELECT jsonb_agg(jsonb_build_object('curso', curso, 'matriculas', q, 'com_certificado', ok, 'mais_antiga_dias', d) ORDER BY q DESC)
                      FROM (SELECT curso, count(*) q, count(*) FILTER (WHERE certificado) ok, max(dias) d FROM f GROUP BY 1 ORDER BY 2 DESC LIMIT 20) z),
      'por_curso_e_contrato', (SELECT jsonb_agg(jsonb_build_object('curso', curso, 'contrato', contrato, 'qtd', q, 'vence_ate', v) ORDER BY q DESC)
                                 FROM (SELECT curso, contrato, count(*) q, min(expira_em) v FROM f GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 30) z))
      INTO r;
    RETURN r;
  END IF;

  -- ── Faturamento, recebimento, inadimplência, fluxo ────────────────────
  IF p_alvo IN ('fin_notas_pendentes', 'fin_valor_pendente') THEN
    v_mes := CASE WHEN extract(day FROM hoje) > coalesce(p_param, 20) THEN date_trunc('month', hoje - interval '1 month')
                  ELSE date_trunc('month', hoje - interval '2 months') END::date;
    SELECT jsonb_build_object(
      'observacao', 'Contratos ativos sem NF enviada/concluída da competência ' || to_char(v_mes, 'MM/YYYY') || ' no Faturamento (nf_emissao). nf_da_competencia = NF que existe mas ainda não foi enviada/concluída.',
      'registros', coalesce(jsonb_agg(jsonb_build_object('contrato', c.nome, 'cliente', c.cliente, 'valor', coalesce(nullif(c.valor_executado_mensal, 0), c.valor_mensal_contratado),
                     'ultima_competencia_emitida', (SELECT max(n.competencia) FROM public.nf_emissao n WHERE n.contrato_id = c.id AND n.deleted_at IS NULL AND n.status::text IN ('enviada', 'concluida')),
                     'nf_da_competencia', (SELECT jsonb_agg(jsonb_build_object('status', n.status, 'numero', n.numero_nf)) FROM public.nf_emissao n
                                             WHERE n.contrato_id = c.id AND n.deleted_at IS NULL AND n.competencia = v_mes))
                     ORDER BY coalesce(nullif(c.valor_executado_mensal, 0), c.valor_mensal_contratado) DESC), '[]'::jsonb))
      INTO r
      FROM public.contratos c
     WHERE c.status = 'ativo' AND coalesce(c.valor_mensal_contratado, 0) > 0
       AND NOT EXISTS (SELECT 1 FROM public.nf_emissao n WHERE n.contrato_id = c.id AND n.deleted_at IS NULL AND n.status::text IN ('enviada', 'concluida') AND n.competencia = v_mes);
    RETURN r;
  END IF;

  IF p_alvo IN ('fin_recebimentos', 'fin_inadimplencia', 'fin_fluxo') THEN
    WITH n AS (
      SELECT n.*, c.nome AS contrato, n.data_emissao + CASE WHEN p_alvo = 'fin_fluxo' THEN 30 ELSE coalesce(p_param, 30)::int END AS vencimento
        FROM public.nf_emissao n LEFT JOIN public.contratos c ON c.id = n.contrato_id
       WHERE n.deleted_at IS NULL AND n.status::text = 'concluida' AND n.data_emissao IS NOT NULL),
    f AS (SELECT * FROM n WHERE CASE p_alvo
            WHEN 'fin_recebimentos' THEN vencimento BETWEEN date_trunc('month', hoje)::date AND hoje
            WHEN 'fin_inadimplencia' THEN data_pagamento IS NULL AND hoje - vencimento >= 15
            ELSE data_pagamento IS NULL AND vencimento BETWEEN hoje AND hoje + coalesce(p_param, 30)::int END)
    SELECT jsonb_build_object(
      'observacao', 'NFs concluídas do Faturamento (nf_emissao) que entram na conta; vencimento = emissão + ' ||
                    CASE WHEN p_alvo = 'fin_fluxo' THEN 30 ELSE coalesce(p_param, 30)::int END || ' dias; pago = tem data de pagamento.' ||
                    CASE WHEN p_alvo = 'fin_fluxo' THEN ' Saídas = despesas do Malote a pagar no período.' ELSE '' END,
      'total_registros', (SELECT count(*) FROM f),
      'por_contrato', (SELECT jsonb_agg(jsonb_build_object('contrato', coalesce(contrato, 'Sem contrato'), 'nfs', q, 'valor', v, 'em_aberto', a) ORDER BY a DESC)
                         FROM (SELECT contrato, count(*) q, sum(vlr_liquido_total) v, sum(vlr_liquido_total) FILTER (WHERE data_pagamento IS NULL) a FROM f GROUP BY 1 ORDER BY 4 DESC NULLS LAST LIMIT 20) z),
      'registros', (SELECT jsonb_agg(jsonb_build_object('nf', numero_nf, 'contrato', contrato, 'competencia', competencia, 'emissao', data_emissao, 'vencimento', vencimento,
                       'dias_atraso', CASE WHEN data_pagamento IS NULL AND vencimento < hoje THEN hoje - vencimento END, 'valor_liquido', vlr_liquido_total,
                       'pago_em', data_pagamento, 'valor_pago', valor_pago, 'falta_receber', falta_receber, 'obs_financeiro', left(observacoes_financeiro, 120)))
                      FROM (SELECT * FROM f ORDER BY (data_pagamento IS NULL) DESC, vlr_liquido_total DESC NULLS LAST LIMIT 40) z),
      'saidas_malote', CASE WHEN p_alvo = 'fin_fluxo' THEN (
          SELECT jsonb_agg(jsonb_build_object('despesa', numero, 'descricao', left(nome, 80), 'tipo', tipo, 'pagar_em', data_pagamento,
                                              'valor', coalesce(valor_aprovado, valor_total), 'status', status) ORDER BY data_pagamento)
            FROM (SELECT * FROM public.malote_despesa d
                   WHERE d.deleted_at IS NULL AND d.pago_em IS NULL AND coalesce(d.status, '') NOT ILIKE ANY (ARRAY['%cancel%', '%reprov%', '%pag%'])  -- igual à tvg_calc_extra (fin_fluxo)
                     AND d.data_pagamento BETWEEN hoje AND hoje + coalesce(p_param, 30)::int
                   ORDER BY coalesce(d.valor_aprovado, d.valor_total) DESC NULLS LAST LIMIT 40) z) END)
      INTO r;
    RETURN r;
  END IF;

  -- ── Controladoria: planos de ação e indicadores manuais ───────────────
  IF p_alvo = 'ctl_planos' THEN
    WITH f AS (SELECT p.* FROM public.plano_acao p
                WHERE p.deleted_at IS NULL AND coalesce(p.status_normalizado, '') NOT LIKE 'concluida%' AND p.data_fim_planejado < hoje)
    SELECT jsonb_build_object(
      'observacao', 'Planos de ação (Plano de Ações) com prazo final vencido e não concluídos.',
      'total_registros', (SELECT count(*) FROM f),
      'por_status', (SELECT jsonb_object_agg(coalesce(status_normalizado, '—'), q) FROM (SELECT status_normalizado, count(*) q FROM f GROUP BY 1) z),
      'registros', (SELECT jsonb_agg(jsonb_build_object('titulo', left(coalesce(titulo, acao), 120), 'area', coalesce(nullif(btrim(area), ''), nullif(btrim(setor), ''), comite),
                       'comite', comite, 'prioridade', prioridade_normalizada, 'prazo', data_fim_planejado, 'dias_atraso', hoje - data_fim_planejado,
                       'status', status_normalizado, 'custo_previsto', custo_previsto, 'tipo', tipo_acao))
                      FROM (SELECT * FROM f ORDER BY data_fim_planejado LIMIT 40) z))
      INTO r;
    RETURN r;
  END IF;

  IF p_alvo = 'ctl_nao_atualizados' THEN
    SELECT jsonb_build_object('observacao', 'Indicadores de lançamento manual das TVs sem lançamento dentro da periodicidade.',
      'registros', coalesce(jsonb_agg(jsonb_build_object('indicador', i.nome, 'tv', pa.titulo, 'periodicidade', i.periodicidade, 'responsavel_area', i.responsavel,
                     'ultimo_lancamento', (SELECT max(l.created_at)::date FROM public."TVG_LANCAMENTO" l WHERE l.indicador = i.codigo)) ORDER BY pa.titulo), '[]'::jsonb))
      INTO r
      FROM public."TVG_INDICADOR" i JOIN public."TVG_PAINEL" pa ON pa.slug = i.painel
     WHERE i.ativo AND i.fonte = 'manual'
       AND coalesce((SELECT max(l.created_at) FROM public."TVG_LANCAMENTO" l WHERE l.indicador = i.codigo), '-infinity')
           < now() - make_interval(days => CASE i.periodicidade WHEN 'diaria' THEN 2 WHEN 'semanal' THEN 8 ELSE 35 END);
    RETURN r;
  END IF;

  -- ── TI ────────────────────────────────────────────────────────────────
  IF p_alvo IN ('ti_erros', 'ti_demandas') THEN
    WITH f AS (SELECT c.* FROM public."CHAMADO_SISTEMA" c
                WHERE c.status IN ('aberto', 'em_andamento', 'aguardando_retorno') AND (p_alvo <> 'ti_erros' OR c.urgencia = 'ate_1h') AND (p_alvo = 'ti_erros' OR c.prioridade = 'alta')
                  AND ((p_alvo = 'ti_erros' AND c.tipo_solicitacao = 'correcao')
                    OR (p_alvo = 'ti_demandas' AND (c.prazo_previsto < hoje
                         OR (c.prazo_previsto IS NULL AND c.created_at < now() - make_interval(days => coalesce(p_param, 30)::int))))))
    SELECT jsonb_build_object('observacao', 'Chamados de Sistemas (CHAMADO_SISTEMA) de prioridade alta que entram na conta.',
      'registros', coalesce((SELECT jsonb_agg(jsonb_build_object('chamado', numero, 'assunto', left(assunto, 120), 'modulo', coalesce(nullif(btrim(modulo_sistema), ''), 'Outro'),
                       'tipo', tipo_solicitacao, 'status', status, 'setor', setor, 'aberto_ha_dias', hoje - (created_at AT TIME ZONE 'America/Sao_Paulo')::date,
                       'prazo', prazo_previsto) ORDER BY created_at) FROM (SELECT * FROM f ORDER BY created_at LIMIT 40) z), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_alvo = 'ti_integracoes' THEN
    SELECT jsonb_build_object('observacao', 'Itens da fila de integrações (fila_http) com erro e não processados, agrupados por destino e erro.',
      'registros', coalesce(jsonb_agg(jsonb_build_object('destino', destino, 'erro', erro, 'qtd', q, 'primeiro', p1, 'ultimo', p2, 'tentativas_max', t) ORDER BY q DESC), '[]'::jsonb))
      INTO r
      FROM (SELECT f.destino, left(f.erro, 200) erro, count(*) q, min(f.criado_em) p1, max(f.criado_em) p2, max(f.tentativas) t FROM public.fila_http f
             WHERE f.erro IS NOT NULL AND f.processado_em IS NULL AND f.destino NOT ILIKE 'novidade-ia%' AND f.criado_em >= now() - make_interval(days => coalesce(p_param, 7)::int)
             GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20) z;
    RETURN r;
  END IF;

  IF p_alvo = 'ti_acessos' THEN
    SELECT jsonb_build_object('observacao', 'Logins do ERP ainda ativos de colaboradores demitidos na Senior (sem nome): setor, cargo, data de afastamento e último login.',
      'registros', coalesce(jsonb_agg(jsonb_build_object('setor', coalesce(nullif(btrim(e."Setor_ERP"), ''), nullif(btrim(e."Nome Filial"), ''), 'Sem setor'),
                     'cargo', coalesce(nullif(btrim(e."Título do Cargo"), ''), e."Nome do Cargo"), 'data_afastamento', e."Data Afastamento",
                     'ultimo_login', u.last_sign_in_at::date)), '[]'::jsonb))
      INTO r
      FROM (SELECT * FROM public."EMPREGADOS" e WHERE e."Situação" = 'Demitido' AND e.auth_user_id IS NOT NULL) e
      JOIN auth.users u ON u.id = e.auth_user_id
     WHERE u.banned_until IS NULL OR u.banned_until < now();
    RETURN r;
  END IF;

  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_calc_ajuste(text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tvg_ia_detalhe_dados(text, numeric) FROM PUBLIC, anon, authenticated;

UPDATE public."TVG_INDICADOR"
   SET nome = 'Turnover no ano (%)', meta = 41, alerta = NULL, parametro = NULL, parametro_rotulo = NULL, periodicidade = 'mensal',
       regra = 'Igual a Relatórios › Turnover: soma das taxas mensais do ano corrente (demissões ÷ efetivo no fim do mês), todas as causas de desligamento. Meta: 41% no ano (3,42% ao mês). Por contrato: demissões ÷ efetivo médio do contrato no ano.'
 WHERE codigo = 'op_turnover';
UPDATE public."TVG_INDICADOR" SET nome = 'Turnover no ano (%)', meta = 41, alerta = NULL WHERE codigo = 'rh_turnover';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- UPDATE public."TVG_INDICADOR" SET nome = 'Turnover por contrato (%)', meta = 3, alerta = 5, parametro = 3, parametro_rotulo = 'Meses na média' WHERE codigo = 'op_turnover';
-- UPDATE public."TVG_INDICADOR" SET nome = 'Turnover por contrato (%)', meta = 3, alerta = 5 WHERE codigo = 'rh_turnover';
-- tvg_calc_ajuste / tvg_ia_detalhe_dados: reaplicar as versões das migs 20261014000025 / 20261014000024.
