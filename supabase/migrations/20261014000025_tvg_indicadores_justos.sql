-- =========================================================================
-- TVs GERENCIAIS: INDICADORES JUSTOS + O QUE ESTÁ INDO BEM (14/10/2026)
--
-- Pablo, na prévia da TV TI/ERP: "só tá aparecendo coisa ruim nessas
-- informações, tem que aparecer coisas boas […] não tem erro crítico nenhum
-- em aberto, nenhuma integração com falha também […] verifica essas
-- informações ruins de outras tvs também, não dá pra gente expor informação
-- ruim assim pra prejudicar os setores, só se forem verdadeiras".
--
-- Auditoria dos 87 indicadores contra o banco (14/10). O que estava
-- EXAGERADO (regra larga demais, não o setor):
--   · ti_erros "Erros críticos abertos" = 3 → eram 3 ajustes de tela do
--     Financeiro abertos na véspera e em andamento. "Crítico" era prioridade
--     ALTA, que é o padrão (445 de 665 chamados). Crítico agora = correção com
--     urgência "até 1 hora" (parou o trabalho). Hoje: 0.
--   · ti_integracoes = 10 → eram resumos de "novidade" de chamado que a I.A
--     não gerou (limite de uso, HTTP 429). Não é integração (Senior, WhatsApp,
--     e-mail…); destinos novidade-ia* saem. Hoje: 0.
--   · rec_risco = 56 → "Alta — Urgente" é o padrão (56 de 66 vagas). Risco
--     agora = urgente E aberta há mais de 15 dias (parâmetro). Hoje: 9.
--   · rh_absenteismo 5,7% → somava Auxílio-doença, licença-maternidade e
--     aposentadoria (INSS) como absenteísmo. Agora só atestado e falta (os
--     afastamentos já estão em SST › Afastamentos).
--   · rh_ob_rescisoes / sst_aso / trn_integracoes → contavam também o que
--     entrou ontem e está no prazo normal. Agora só o que passou do prazo
--     (parâmetro: 10 d / 5 d / carência de 7 d).
--   · rh_ob_experiencia (103) → contrato de experiência chegando ao fim é
--     agenda, não pendência: vira acompanhamento e sai da soma "Obrigações".
--   · trn_programados 15% → 10.146 matrículas EM MASSA no mês derrubavam a
--     conta. Vira "Certificados emitidos no mês" (1.554).
--   · fin_glosas / pre_glosas R$ 968 mil → R$ 958 mil eram CONTA VINCULADA:
--     depósito retido por lei nos contratos públicos e devolvido depois, não
--     dinheiro perdido. Sai da conta (glosas, multas e descontos ficam).
--   · op_custo_direto / ctl_desvio → contrato novo ou com mês anterior
--     incompleto no DRE (ex. BENTO GONÇALVES 048/2026: +594%, março sem
--     salários lançados) virava "alta de custo". Agora só entra contrato com
--     custo lançado nos 3 meses anteriores.
--   · jur_* → "924 processos em andamento" eram 924 LINHAS: cada processo tem
--     uma linha por motivo. São 157 processos. Contagens por processo.
--   · jur_risco, jur_reincidentes, lic_risco → exposição/mercado, não falha
--     do setor (meta 0 impossível): viram acompanhamento (sem meta).
-- O que é REAL e ficou: prazos jurídicos, notas não emitidas, recebimentos e
-- inadimplência, pedidos parados no Supply, planos de ação vencidos, TV sem
-- sinal, postos descobertos, turnover etc.
--
-- E o que vai BEM ganha número na TV (quanto mais, melhor — verde):
--   TI: chamados concluídos no mês + tempo médio de conclusão;
--   Recrutamento e RH: vagas preenchidas no mês; Treinamento: certificados;
--   Jurídico: multas revertidas (já existia, entra na TV); Licitações:
--   licitações ganhas; Financeiro: recebido no mês; Supply: pedidos
--   despachados; Controladoria: planos concluídos; SST: exames demissionais
--   agendados; Operacional e Presidência: contratos com margem saudável.
--
-- Como: tvg_calc_ajuste(codigo) é consultada ANTES de tvg_calc/tvg_calc_extra
-- em tvg_resultado — os ramos daqui substituem os antigos sem reescrever
-- aquelas funções. tvg_fonte (I.A) também lê daqui primeiro.
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

  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_calc_ajuste(text, numeric) FROM PUBLIC, anon, authenticated;

-- tvg_resultado: o ajuste vem primeiro.
CREATE OR REPLACE FUNCTION public.tvg_resultado(p_codigo text, p_nivel integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  i public."TVG_INDICADOR"; l public."TVG_LANCAMENTO"; r jsonb; c text; s numeric := 0; tem boolean := false; sub jsonb;
  partes jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO i FROM public."TVG_INDICADOR" WHERE codigo = p_codigo;
  IF NOT FOUND OR p_nivel > 3 THEN RETURN NULL; END IF;

  IF i.fonte = 'auto' THEN
    BEGIN
      r := coalesce(public.tvg_calc_ajuste(i.codigo, i.parametro), public.tvg_calc(i.codigo, i.parametro), public.tvg_calc_extra(i.codigo, i.parametro));
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
END $function$;

-- tvg_fonte (I.A): o trecho de cálculo vem do ajuste quando ele trata o código.
CREATE OR REPLACE FUNCTION public.tvg_fonte(p_codigo text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  i public."TVG_INDICADOR"; alvo text; trecho text; ajudantes jsonb := '[]'::jsonb; h text;
BEGIN
  IF NOT (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'visualizar') OR public.has_screen_access(auth.uid(), 'sistemas_tvs', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem acesso aos Indicadores gerenciais das TVs.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO i FROM public."TVG_INDICADOR" WHERE codigo = p_codigo;
  IF NOT FOUND THEN RETURN NULL; END IF;

  alvo := CASE WHEN i.fonte = 'espelho' THEN i.espelho_de ELSE i.codigo END;
  trecho := coalesce(public.tvg_trecho_calculo('tvg_calc_ajuste', alvo), public.tvg_trecho_calculo('tvg_calc', alvo), public.tvg_trecho_calculo('tvg_calc_extra', alvo));

  FOREACH h IN ARRAY ARRAY['tvg_quadro_contratos', 'tvg_dre_contratos', 'tvg_dre_competencia', 'dir_turnover_painel_dados'] LOOP
    IF trecho ~ h THEN
      ajudantes := ajudantes || jsonb_build_array(jsonb_build_object('funcao', h, 'definicao',
        left((SELECT pg_get_functiondef(p.oid) FROM pg_proc p WHERE p.proname = h AND p.pronamespace = 'public'::regnamespace LIMIT 1), 2500)));
    END IF;
  END LOOP;
  IF trecho ~ 'tvg_dre_contratos' THEN
    ajudantes := ajudantes || jsonb_build_array(jsonb_build_object('funcao', 'tvg_dre_mv',
      'definicao', 'Visão materializada (cache, atualizada a cada 6 h) que soma mz_60_view_dre_gerencial_competencia — o DRE gerencial carregado na migração contábil — por competência e contrato: RECEITA, CUSTO e DESPESA.'));
  END IF;

  RETURN jsonb_build_object(
    'codigo', i.codigo, 'nome', i.nome, 'painel', i.painel, 'fonte', i.fonte, 'regra', i.regra, 'identificar', i.identificar,
    'unidade', i.unidade, 'sentido', i.sentido, 'meta', i.meta, 'alerta', i.alerta, 'parametro', i.parametro,
    'parametro_rotulo', i.parametro_rotulo, 'responsavel', i.responsavel,
    'espelho_de', i.espelho_de,
    'espelho_regra', (SELECT o.regra FROM public."TVG_INDICADOR" o WHERE o.codigo = i.espelho_de),
    'componentes', (SELECT jsonb_agg(jsonb_build_object('codigo', c.codigo, 'nome', c.nome, 'regra', c.regra))
                      FROM public."TVG_INDICADOR" c WHERE c.codigo = ANY (coalesce(i.componentes, ARRAY[]::text[]))),
    'calculo_sql', trecho,
    'funcoes_de_apoio', ajudantes);
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_fonte(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tvg_fonte(text) TO authenticated;

-- ── Cadastro: regras novas, metas que não cabem, positivos na TV ────────
UPDATE public."TVG_INDICADOR" SET regra = 'Chamados de Sistemas do tipo correção com urgência "até 1 hora" (trabalho parado) que ainda estão abertos, em andamento ou aguardando retorno.' WHERE codigo = 'ti_erros';
UPDATE public."TVG_INDICADOR" SET regra = 'Itens da fila de integrações (fila_http) com erro e sem reprocessar na janela. Os resumos automáticos de chamado feitos pela I.A (novidade-ia) não contam: não são integração.' WHERE codigo = 'ti_integracoes';
UPDATE public."TVG_INDICADOR" SET regra = 'Vagas com urgência alta abertas há mais tempo que o parâmetro (padrão 15 dias). "Alta — Urgente" sozinha não é risco: é o padrão da maioria das vagas.' WHERE codigo = 'rec_risco';
UPDATE public."TVG_INDICADOR" SET nome = 'Absenteísmo por contrato (%)', regra = 'Colaboradores com atestado ou falta hoje ÷ ativos, por contrato. Auxílio-doença, licença-maternidade e aposentadoria (INSS) são afastamento, não absenteísmo — ficam em SST › Afastamentos.' WHERE codigo = 'rh_absenteismo';
UPDATE public."TVG_INDICADOR" SET regra = 'Solicitações de demissão paradas no fluxo (Operacional, RH ou SST) há mais dias que o parâmetro (padrão 10). As que estão dentro do prazo normal não contam.' WHERE codigo = 'rh_ob_rescisoes';
UPDATE public."TVG_INDICADOR" SET regra = 'ASOs aguardando o SST (admissional na etapa SST + COMPRAS; demissional pendente) há mais dias que o parâmetro (padrão 5).' WHERE codigo IN ('sst_aso', 'sst_imp_aso');
UPDATE public."TVG_INDICADOR" SET regra = 'Alunos criados na janela, com mais de 7 dias de casa, sem nenhuma aula concluída na plataforma.' WHERE codigo = 'trn_integracoes';
UPDATE public."TVG_INDICADOR" SET nome = 'Certificados emitidos no mês', unidade = 'qtd', sentido = 'maior', meta = NULL, alerta = NULL,
  regra = 'Certificados emitidos na plataforma de Treinamentos no mês corrente. (Era certificados ÷ matrículas, mas a matrícula em massa — 10 mil no mês — distorcia a conta.)' WHERE codigo = 'trn_programados';
UPDATE public."TVG_INDICADOR" SET nome = 'Glosas, multas e descontos',
  regra = 'Glosas e multas não revertidas + descontos nas NFs depois de emitidas, na janela. A conta vinculada fica de fora: é depósito retido por lei nos contratos públicos e devolvido depois, não dinheiro perdido.' WHERE codigo = 'fin_glosas';
UPDATE public."TVG_INDICADOR" SET nome = 'Glosas, multas e descontos' WHERE codigo = 'pre_glosas';
UPDATE public."TVG_INDICADOR" SET regra = 'Custo dos contratos na última competência do DRE × a média das 3 anteriores. Só entram contratos com custo lançado nos 3 meses anteriores (contrato novo ou mês incompleto no DRE não é alta de custo).' WHERE codigo IN ('op_custo_direto', 'ctl_desvio');
-- Acompanhamento (sem meta): exposição e mercado, não falha do setor.
UPDATE public."TVG_INDICADOR" SET meta = NULL, alerta = NULL WHERE codigo IN ('jur_risco', 'jur_reincidentes', 'lic_risco', 'rh_ob_experiencia', 'op_experiencia');
-- Experiência chegando ao fim é agenda, não pendência.
UPDATE public."TVG_INDICADOR" SET componentes = array_remove(componentes, 'rh_ob_experiencia') WHERE codigo = 'rh_obrigacoes';
-- Multas revertidas: o que o Jurídico recuperou — vai para a TV.
UPDATE public."TVG_INDICADOR" SET na_tv = true WHERE codigo = 'jur_multas_revertidas';

INSERT INTO public."TVG_INDICADOR"
  (codigo, painel, ordem, nome, identificar, fonte, unidade, sentido, meta, alerta, periodicidade, responsavel, parametro, parametro_rotulo, pai, na_tv, espelho_de, componentes, regra)
VALUES
 ('ti_concluidos', 'ger-ti', 7, 'Chamados concluídos no mês', 'O que o time de Sistemas entregou no mês.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'TI / ERP', NULL, NULL, NULL, true, NULL, NULL,
  'Chamados de Sistemas com status concluído e data de conclusão no mês corrente. Detalhe por módulo; o mês anterior vai junto para comparar.'),
 ('ti_tempo_conclusao', 'ger-ti', 8, 'Tempo médio de conclusão', 'Quantos dias, em média, um chamado leva da abertura à conclusão.', 'auto', 'dias', 'menor', 7, 10, 'diaria', 'TI / ERP', NULL, NULL, NULL, true, NULL, NULL,
  'Média de dias entre a abertura e a conclusão dos chamados concluídos no mês. Detalhe: a média dos últimos 6 meses.'),
 ('rec_preenchidas', 'ger-recrutamento', 6, 'Vagas preenchidas no mês', 'As vagas que o Recrutamento fechou no mês.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Recrutamento', NULL, NULL, NULL, true, NULL, NULL,
  'Vagas da Gestão Recrutamento (pela quantidade) que chegaram a Contratado no mês corrente. Detalhe por contrato.'),
 ('rh_preenchidas', 'ger-rh', 17, 'Vagas preenchidas no mês', 'As vagas fechadas no mês.', 'espelho', 'qtd', 'maior', NULL, NULL, 'diaria', 'Recrutamento', NULL, NULL, NULL, true, 'rec_preenchidas', NULL, NULL),
 ('sst_demissionais', 'ger-sst', 16, 'Exames demissionais agendados no mês', 'O que o SST encaminhou no mês.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'SST', NULL, NULL, NULL, true, NULL, NULL,
  'Solicitações de demissão em que o SST agendou o exame demissional no mês corrente. Detalhe por contrato.'),
 ('fin_recebido_mes', 'ger-financeiro', 7, 'Recebido no mês', 'O que entrou no caixa pelas NFs no mês.', 'auto', 'brl', 'maior', NULL, NULL, 'diaria', 'Financeiro', NULL, NULL, NULL, true, NULL, NULL,
  'NFs com data de pagamento no mês corrente (valor pago; sem ele, o líquido da NF). Detalhe por contrato.'),
 ('lic_ganhas', 'ger-licitacoes', 8, 'Licitações ganhas', 'Licitações em que a empresa ficou em 1º lugar.', 'auto', 'qtd', 'maior', NULL, NULL, 'semanal', 'Licitações', 90, 'Janela (dias)', NULL, true, NULL, NULL,
  'Licitações finalizadas em 1º lugar na janela (padrão 90 dias), na grade de Licitações. Impacto: o valor global somado.'),
 ('sup_despachados', 'ger-supply', 7, 'Pedidos despachados no mês', 'Material e uniforme que saiu para os contratos.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Supply', NULL, NULL, NULL, true, NULL, NULL,
  'Pedidos do Supply com data de despacho no mês corrente. Detalhe por contrato.'),
 ('ctl_planos_concluidos', 'ger-controladoria', 7, 'Planos de ação concluídos no mês', 'Os planos de ação entregues no mês.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Controladoria', NULL, NULL, NULL, true, NULL, NULL,
  'Planos de ação concluídos no mês corrente (data de fim real; sem ela, a última atualização). Detalhe por área.'),
 ('op_contratos_saudaveis', 'ger-operacional', 23, 'Contratos com margem saudável', 'Contratos que estão dando o resultado esperado.', 'auto', 'qtd', 'maior', NULL, NULL, 'mensal', 'Controladoria', 10, 'Margem mínima (%)', NULL, true, NULL, NULL,
  'Contratos com margem igual ou acima do parâmetro (padrão 10%) na última competência do DRE gerencial, entre os com receita de R$ 10 mil ou mais.'),
 ('pre_contratos_saudaveis', 'ger-presidencia', 9, 'Contratos com margem saudável', 'Contratos que estão dando o resultado esperado.', 'espelho', 'qtd', 'maior', NULL, NULL, 'mensal', 'Controladoria', NULL, NULL, NULL, true, 'op_contratos_saudaveis', NULL, NULL)
ON CONFLICT (codigo) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DELETE FROM public."TVG_INDICADOR" WHERE codigo IN ('ti_concluidos','ti_tempo_conclusao','rec_preenchidas','rh_preenchidas','sst_demissionais','fin_recebido_mes','lic_ganhas','sup_despachados','ctl_planos_concluidos','op_contratos_saudaveis','pre_contratos_saudaveis');
-- tvg_resultado / tvg_fonte: reaplicar as versões das migs 20261014000010 / 20261014000014; DROP FUNCTION public.tvg_calc_ajuste(text, numeric);
-- UPDATE public."TVG_INDICADOR" SET meta = 0, alerta = 1 WHERE codigo = 'lic_risco';
-- UPDATE public."TVG_INDICADOR" SET meta = 0, alerta = 3 WHERE codigo IN ('jur_risco', 'jur_reincidentes', 'rh_ob_experiencia', 'op_experiencia');
-- UPDATE public."TVG_INDICADOR" SET componentes = ARRAY['rh_ob_rescisoes', 'rh_ob_experiencia'] WHERE codigo = 'rh_obrigacoes';
-- UPDATE public."TVG_INDICADOR" SET na_tv = false WHERE codigo = 'jur_multas_revertidas';
-- UPDATE public."TVG_INDICADOR" SET nome = 'Certificados × matrículas no mês (%)', unidade = 'pct', sentido = 'maior', meta = 80, alerta = 60 WHERE codigo = 'trn_programados';
-- UPDATE public."TVG_INDICADOR" SET nome = 'Valores glosados ou retidos' WHERE codigo = 'fin_glosas';
-- UPDATE public."TVG_INDICADOR" SET nome = 'Glosas e retenções' WHERE codigo = 'pre_glosas';
