-- =========================================================================
-- TV RH › Recrutamento e Seleção: "em aberto agora" = VAGA EM ANDAMENTO (22/10/2026)
--
-- A TV mostrava 91 e a Gestão Recrutamento 42 "em processo", as duas na
-- mesma tabela (SISTEMA_RECRUTAMENTO). Regra única pedida pelo Pablo: vaga em
-- andamento = todas as solicitações MENOS as pendentes do Operacional
-- (Pendente Analista — na tela "Pendente Operacional" —, o legado Pendente
-- Operacional e a Pendente Diretoria, etapa 1 da vaga administrativa), a
-- pendente do RH (Pendente Recrutamento), as concluídas (Contratado /
-- Concluído…) e as reprovadas/canceladas. Status desconhecido entra.
--
-- A mesma lista está em src/lib/recrutamento/vagaEmAndamento.ts (Gestão
-- Recrutamento) — mudou lá, muda aqui.
--
-- Muda só o cartão "Em aberto agora" (kpi:3) e o gráfico "Abertas agora — há
-- quanto tempo", que agora contam a mesma base. "Aberta mais antiga", o funil
-- e o desfecho do período continuam como estavam.
--
-- Corpo igual ao da 20261014000031 / 20261019000005 (conferido), fora a base
-- "andamento". Idempotente.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.tvg_espelho_vagas()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  d jsonb := public.dir_vagas_painel_dados(NULL, NULL, NULL, NULL);
  agora timestamptz := coalesce((d->>'agora')::timestamptz, now());
  r jsonb;
BEGIN
  WITH v AS (
    SELECT x, (x->>'id')::bigint AS id, (x->>'criada')::timestamptz AS criada, btrim(coalesce(x->>'status', '')) AS st,
           (x->>'status_em')::timestamptz AS status_em, coalesce((x->>'legado')::boolean, false) AS legado,
           coalesce((x->>'no_periodo')::boolean, false) AS per, greatest(coalesce((x->>'qtd')::int, 1), 1) AS qtd,
           x->>'cargo' AS cargo, coalesce(x->'log', '[]'::jsonb) AS log, (x->>'aprovada_em')::timestamptz AS aprovada_em,
           coalesce((x->'cand'->>'total')::int, 0) AS cand_total, coalesce((x->'cand'->>'desistiu')::int, 0) AS cand_desistiu
      FROM jsonb_array_elements(coalesce(d->'vagas', '[]'::jsonb)) x),
  v2 AS (
    SELECT v.*,
           CASE WHEN st = 'Reprovada' THEN 'reprovada' WHEN st = 'Cancelada' THEN 'cancelada'
                WHEN st = 'Contratado' OR st LIKE 'Concluído%' THEN 'contratada' ELSE 'andamento' END AS desfecho,
           (SELECT (l->>2)::timestamptz FROM jsonb_array_elements(v.log) WITH ORDINALITY z(l, o) ORDER BY o DESC LIMIT 1) AS ult_log,
           -- Aprovação: a 1ª troca que sai de Pendente Operacional/Analista/Diretoria para outra etapa do fluxo.
           (SELECT (l->>2)::timestamptz FROM jsonb_array_elements(v.log) WITH ORDINALITY z(l, o)
             WHERE btrim(coalesce(l->>0, '')) IN ('Pendente Operacional', 'Pendente Analista', 'Pendente Diretoria')
               AND l->>1 IS NOT NULL
               AND btrim(l->>1) NOT IN ('Pendente Operacional', 'Pendente Analista', 'Pendente Diretoria', 'Reprovada', 'Cancelada')
             ORDER BY o LIMIT 1) AS sai_aprovacao
      FROM v),
  v3 AS (
    SELECT v2.*,
           CASE WHEN desfecho <> 'andamento' THEN coalesce(status_em, ult_log) END AS fechada_em,
           CASE WHEN sai_aprovacao IS NOT NULL THEN greatest(extract(epoch FROM sai_aprovacao - criada) / 86400, 0)
                WHEN legado AND jsonb_array_length(log) = 0 AND aprovada_em IS NOT NULL THEN greatest(extract(epoch FROM aprovada_em - criada) / 86400, 0) END AS t_aprov
      FROM v2),
  v4 AS (SELECT v3.*, greatest(extract(epoch FROM coalesce(fechada_em, agora) - criada) / 86400, 0) AS dias_tot FROM v3),
  per AS (SELECT * FROM v4 WHERE per),
  contr AS (SELECT dias_tot FROM per WHERE desfecho = 'contratada'),
  abertas AS (SELECT * FROM v4 WHERE desfecho = 'andamento'),
  -- Vaga em andamento (vagaEmAndamento.ts): aberta e fora das filas de aprovação/conferência.
  andamento AS (SELECT * FROM abertas
                 WHERE st NOT IN ('Pendente Analista', 'Pendente Operacional', 'Pendente Diretoria', 'Pendente Recrutamento')),
  antiga AS (SELECT * FROM abertas ORDER BY criada LIMIT 1),
  med AS (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY dias_tot) AS m FROM contr),
  -- Funil (etapaAlcancada): até onde a vaga chegou no fluxo.
  etapas(chave, i, sts) AS (VALUES
    ('aprovacao', 0, ARRAY['Pendente Operacional', 'Pendente Analista', 'Pendente Diretoria']),
    ('recrutamento', 1, ARRAY['Pendente Recrutamento']),
    ('selecao', 2, ARRAY['Vaga aberta - Seleção de Currículos']),
    ('juridico', 3, ARRAY['Em análise jurídica']),
    ('entrevistas', 4, ARRAY['Entrevista e Avaliação', 'Entrevista com Gestor']),
    ('aprovado', 5, ARRAY['Aprovado - Aguardando SST', 'Compras Confirmou - Aguardando Documentação']),
    ('sst_compras', 6, ARRAY['Aguardando SST e Compras', 'Encaminhado para SST (ASO)', 'ASO Aprovado - Aguardando Informe de EPIs', 'Aguardando Confirmação Compras']),
    ('contratado', 7, ARRAY['Contratado'])),
  alc AS (
    SELECT p.id, p.desfecho,
           CASE WHEN p.desfecho = 'contratada' THEN 7 ELSE greatest(
             coalesce((SELECT max(e.i) FROM etapas e WHERE (p.st = ANY (e.sts) OR (e.i = 7 AND p.st LIKE 'Concluído%')) AND p.st NOT IN ('Reprovada', 'Cancelada')), -1),
             coalesce((SELECT max(e.i) FROM jsonb_array_elements(p.log) l, etapas e
                        WHERE (btrim(coalesce(l->>0, '')) = ANY (e.sts) OR btrim(coalesce(l->>1, '')) = ANY (e.sts))), -1),
             CASE WHEN p.legado AND jsonb_array_length(p.log) = 0 AND p.aprovada_em IS NOT NULL THEN 2 ELSE -1 END,
             CASE WHEN p.cand_total > 0 THEN 2 ELSE -1 END,
             CASE WHEN (p.x->'cand'->>'selecionado_em') IS NOT NULL THEN 5 ELSE -1 END) END AS ate
      FROM per p)
  SELECT jsonb_build_object(
    'tela', 'Relatórios › Vagas — Dashboard',
    'periodo', jsonb_build_object('de', d->>'de', 'ate', d->>'ate'),
    'kpis', jsonb_build_array(
      jsonb_build_object('rotulo', 'Vagas solicitadas', 'valor', (SELECT count(*) FROM per), 'formato', 'n',
                         'dica', replace(to_char((SELECT coalesce(sum(qtd), 0) FROM per), 'FM999G999G990'), ',', '.') || ' posições (soma das quantidades)'),
      jsonb_build_object('rotulo', 'Contratadas', 'valor', (SELECT count(*) FROM contr), 'formato', 'n',
                         'dica', (SELECT round(100.0 * count(*) FILTER (WHERE desfecho = 'contratada') / nullif(count(*) FILTER (WHERE desfecho <> 'andamento'), 0)) || '% das que já fecharam' FROM per)),
      jsonb_build_object('rotulo', 'Reprovadas / canceladas', 'valor', (SELECT count(*) FROM per WHERE desfecho IN ('reprovada', 'cancelada')), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Em aberto agora', 'valor', (SELECT count(*) FROM andamento), 'formato', 'n',
                         'dica', (SELECT coalesce(sum(qtd), 0) FROM andamento) || ' posições · sem as pendentes de aprovação/RH'),
      jsonb_build_object('rotulo', 'Tempo médio até contratar', 'valor', (SELECT round(avg(dias_tot)::numeric, 1) FROM contr), 'formato', 'dias',
                         'dica', 'Mediana ' || coalesce((SELECT CASE WHEN m < 1 AND m > 0 THEN round(m * 24) || ' h' ELSE replace(round(m::numeric, 1)::text, '.0', '') || ' d' END FROM med), '—') || ' · pedido → Contratado'),
      jsonb_build_object('rotulo', 'Contratadas em até 15 dias', 'valor', (SELECT round(100.0 * count(*) FILTER (WHERE dias_tot <= 15) / nullif(count(*), 0), 1) FROM contr), 'formato', 'pct'),
      jsonb_build_object('rotulo', 'Tempo médio de aprovação', 'valor', (SELECT round(avg(t_aprov)::numeric, 1) FROM per WHERE t_aprov IS NOT NULL), 'formato', 'dias',
                         'dica', 'Pedido → liberado ao Recrutamento'),
      jsonb_build_object('rotulo', 'Candidatos por vaga', 'valor', (SELECT round(avg(cand_total)::numeric, 1) FROM per WHERE NOT legado), 'formato', 'n',
                         'dica', 'Média, só vagas do sistema novo'),
      jsonb_build_object('rotulo', 'Desistências de candidatos', 'valor', (SELECT coalesce(sum(cand_desistiu), 0) FROM per), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Aberta mais antiga', 'valor', (SELECT floor(greatest(extract(epoch FROM agora - criada) / 86400, 0)) FROM antiga), 'formato', 'dias',
                         'dica', (SELECT '#' || id || coalesce(' · ' || nullif(btrim(cargo), ''), '') FROM antiga))),
    'mensal', jsonb_build_object(
      'series', jsonb_build_array(jsonb_build_object('chave', 'solicitadas', 'rotulo', 'Solicitadas'), jsonb_build_object('chave', 'contratadas', 'rotulo', 'Contratadas')),
      'dados', (SELECT jsonb_agg(jsonb_build_object('mes', to_char(g, 'YYYY-MM'),
                  'solicitadas', (SELECT count(*) FROM per WHERE to_char(criada, 'YYYY-MM') = to_char(g, 'YYYY-MM')),
                  'contratadas', (SELECT count(*) FROM per WHERE desfecho = 'contratada' AND to_char(criada, 'YYYY-MM') = to_char(g, 'YYYY-MM'))) ORDER BY g)
                  FROM generate_series(date_trunc('month', (d->>'de')::date), (d->>'ate')::date, interval '1 month') g)),
    'graficos', jsonb_build_object(
      'funil', jsonb_build_object('titulo', 'Funil das vagas do período', 'tipo', 'colunas', 'itens', jsonb_build_array(
         jsonb_build_object('nome', 'Solicitadas', 'valor', (SELECT count(*) FROM alc)),
         jsonb_build_object('nome', 'Aprovadas', 'valor', (SELECT count(*) FROM alc WHERE ate >= 1)),
         jsonb_build_object('nome', 'Abertas p/ seleção', 'valor', (SELECT count(*) FROM alc WHERE ate >= 2)),
         jsonb_build_object('nome', 'Em entrevistas', 'valor', (SELECT count(*) FROM alc WHERE ate >= 4)),
         jsonb_build_object('nome', 'Candidato aprovado', 'valor', (SELECT count(*) FROM alc WHERE ate >= 5)),
         jsonb_build_object('nome', 'Contratadas', 'valor', (SELECT count(*) FROM alc WHERE desfecho = 'contratada')))),
      'desfecho', jsonb_build_object('titulo', 'Desfecho das vagas do período', 'tipo', 'rosca', 'itens', jsonb_build_array(
         jsonb_build_object('nome', 'Contratadas', 'valor', (SELECT count(*) FROM per WHERE desfecho = 'contratada')),
         jsonb_build_object('nome', 'Em andamento', 'valor', (SELECT count(*) FROM per WHERE desfecho = 'andamento')),
         jsonb_build_object('nome', 'Reprovadas', 'valor', (SELECT count(*) FROM per WHERE desfecho = 'reprovada')),
         jsonb_build_object('nome', 'Canceladas', 'valor', (SELECT count(*) FROM per WHERE desfecho = 'cancelada')))),
      'aging', jsonb_build_object('titulo', 'Abertas agora — há quanto tempo', 'tipo', 'colunas', 'itens', (
         SELECT jsonb_agg(jsonb_build_object('nome', f.rotulo, 'valor', (SELECT count(*) FROM andamento a
                  WHERE extract(epoch FROM agora - a.criada) / 86400 > f.de AND extract(epoch FROM agora - a.criada) / 86400 <= f.ate)) ORDER BY f.o)
           FROM (VALUES (1, 'até 7 d', -1, 7), (2, '8–15 d', 7, 15), (3, '16–30 d', 15, 30), (4, '31–60 d', 30, 60), (5, '+60 d', 60, 1e9)) f(o, rotulo, de, ate)))))
    INTO r;
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_vagas() FROM PUBLIC, anon, authenticated;

UPDATE public."TVG_INDICADOR"
   SET identificar = 'Vagas em andamento hoje (sem as pendentes de aprovação/RH).',
       regra = 'Vaga em andamento — a mesma régua do "Em Processo" da Gestão Recrutamento: todas as solicitações menos Pendente Operacional/Analista/Diretoria, Pendente Recrutamento, concluídas (Contratado/Concluído) e reprovadas/canceladas. Inclui as pedidas antes do período.'
 WHERE codigo = 'rec_v_abertas';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Reaplicar o CREATE OR REPLACE FUNCTION public.tvg_espelho_vagas() da
-- 20261014000031 (cartão e gráfico voltam a contar todas as não fechadas) e:
-- UPDATE public."TVG_INDICADOR" SET identificar = 'Todas as vagas abertas hoje.',
--   regra = 'Igual a Vagas — Dashboard: todas as vagas em andamento agora (inclui as pedidas antes do período).'
--  WHERE codigo = 'rec_v_abertas';
-- NOTIFY pgrst, 'reload schema';
