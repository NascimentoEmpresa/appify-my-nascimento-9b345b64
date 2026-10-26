-- =========================================================================
-- TV GERÊNCIA OPERACIONAL — igual a Relatórios › Turnover (14/10/2026)
--
-- Pablo, com o print da TV ("Turnover do mês 1%") ao lado do relatório:
-- "por que o turnover foi pra 1%??? tem que ficar IGUAL esse do turnover".
--
-- O 1% era OUTUBRO, com 14 dias — o relatório mostra o mesmo 1,01% na barra
-- de outubro, mas em verde e no meio dos outros meses; na TV ele virou o
-- cartão "Turnover do mês", sozinho, e parecia que o turnover tinha caído.
-- E os cartões estavam "Sem meta" em azul, enquanto o relatório pinta 42,70%
-- de vermelho contra a meta de 41%.
--
--   1. "Turnover do mês" → "Turnover do último mês fechado" (setembro hoje);
--      a dica diz quanto vai o mês corrente. Em janeiro, sem mês fechado no
--      ano, cai no corrente.
--   2. Metas do relatório: 41% no ano (geral e projeção), 3,42% no mês.
--   3. Duas casas, como o relatório (42,70% · 54,31% · 4,91%): o espelho
--      manda `casas` no KPI e tvg_espelho_resultado repassa.
--   4. Gráfico mês a mês com `modo = meta`: uma barra por mês, vermelha acima
--      da meta e verde abaixo, meta tracejada — o desenho do relatório.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.tvg_espelho_turnover()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  ano int := extract(year FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int;
  mes_atual text := to_char((now() AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM');
  nomes text[] := ARRAY['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  d jsonb := public.dir_turnover_painel_dados(extract(year FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int, NULL, NULL, NULL, NULL);
  rr jsonb := public.dir_turnover_rescisoes_dados(extract(year FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int, NULL, NULL);
  soma numeric; dem numeric; ate3 numeric; tot numeric; ult jsonb; atual jsonb; nome_ult text;
BEGIN
  SELECT round(sum((m->>'taxa')::numeric), 2), sum((m->>'demissoes')::numeric) INTO soma, dem FROM jsonb_array_elements(d->'mensal') m;
  -- Último mês FECHADO; o corrente só entra na dica (ou no lugar, em janeiro).
  SELECT m INTO ult FROM jsonb_array_elements(d->'mensal') m WHERE m->>'mes' < mes_atual ORDER BY m->>'mes' DESC LIMIT 1;
  SELECT m INTO atual FROM jsonb_array_elements(d->'mensal') m WHERE m->>'mes' = mes_atual LIMIT 1;
  IF ult IS NULL THEN ult := atual; atual := NULL; END IF;
  nome_ult := nomes[extract(month FROM to_date(ult->>'mes', 'YYYY-MM'))::int];
  tot := coalesce((rr->>'total')::numeric, 0);
  ate3 := coalesce((SELECT (f->>'n')::numeric FROM jsonb_array_elements(rr->'por_faixa') f WHERE (f->>'ordem')::int = 1), 0);
  RETURN jsonb_build_object(
    'tela', 'Relatórios › Turnover',
    'periodo', NULL,
    'kpis', jsonb_build_array(
      jsonb_build_object('rotulo', 'Turnover geral ' || ano, 'valor', soma, 'formato', 'pct', 'casas', 2,
                         'dica', coalesce(dem, 0) || ' demissões · efetivo médio ' || round((d->>'efetivo_medio')::numeric) || ' · aceitável no ano: 41%'),
      jsonb_build_object('rotulo', 'Projeção para o ano', 'valor', round(soma * coalesce((d->>'fator_projecao')::numeric, 1), 2), 'formato', 'pct', 'casas', 2,
                         'dica', 'Soma até hoje × dias do ano ÷ dias decorridos · aceitável no ano: 41%'),
      jsonb_build_object('rotulo', 'Turnover de ' || coalesce(nome_ult, '—'), 'valor', round((ult->>'taxa')::numeric, 2), 'formato', 'pct', 'casas', 2,
                         'dica', initcap(coalesce(nome_ult, '—')) || CASE WHEN atual IS NULL THEN ' (mês em andamento)' ELSE ' (fechado)' END
                                 || ' · aceitável no mês: 3,42%'
                                 || CASE WHEN atual IS NOT NULL
                                         THEN ' · ' || nomes[extract(month FROM hoje)::int] || ' até ' || to_char(hoje, 'DD/MM') || ': '
                                              || replace(round((atual->>'taxa')::numeric, 2)::text, '.', ',') || '% (mês em andamento)'
                                         ELSE '' END),
      jsonb_build_object('rotulo', 'Demissões no ano', 'valor', dem, 'formato', 'n', 'dica', 'efetivo médio ' || round((d->>'efetivo_medio')::numeric)),
      jsonb_build_object('rotulo', 'Rescisões no período', 'valor', tot, 'formato', 'n', 'dica', 'Turnover em Valores · ' || ano),
      jsonb_build_object('rotulo', 'Tempo de casa médio', 'valor', round((rr->>'tempo_medio_dias')::numeric), 'formato', 'dias',
                         'dica', public.tvg_tempo_de_casa((rr->>'tempo_medio_dias')::numeric) || ' · da admissão ao afastamento'),
      jsonb_build_object('rotulo', 'Tempo de casa mediano', 'valor', round((rr->>'tempo_mediano_dias')::numeric), 'formato', 'dias',
                         'dica', public.tvg_tempo_de_casa((rr->>'tempo_mediano_dias')::numeric) || ' · metade saiu antes disso'),
      jsonb_build_object('rotulo', 'Saíram com até 3 meses', 'valor', CASE WHEN tot > 0 THEN round(ate3 * 1000 / tot) / 10 ELSE 0 END, 'formato', 'pct',
                         'dica', ate3 || ' rescisões')),
    'mensal', jsonb_build_object('unidade', 'pct', 'modo', 'meta',
      'series', jsonb_build_array(jsonb_build_object('chave', 'taxa', 'rotulo', 'Turnover do mês'), jsonb_build_object('chave', 'meta', 'rotulo', 'meta 3,42%')),
      'dados', (SELECT jsonb_agg(jsonb_build_object('mes', m->>'mes', 'taxa', round((m->>'taxa')::numeric, 2), 'meta', 3.42) ORDER BY m->>'mes') FROM jsonb_array_elements(d->'mensal') m)),
    'graficos', jsonb_build_object(
      'contrato', jsonb_build_object('titulo', 'Turnover por contrato (em relação ao próprio contrato)', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', regexp_replace(c->>'contrato', '^\s*\d+\s*-\s*', ''), 'valor', round((c->>'demissoes')::numeric * 100 / (c->>'efetivo_medio')::numeric, 2),
                                             'rotulo', (c->>'demissoes') || ' demissões') ORDER BY (c->>'demissoes')::numeric / (c->>'efetivo_medio')::numeric DESC)
           FROM (SELECT c FROM jsonb_array_elements(d->'por_contrato') c WHERE (c->>'demissoes')::int > 0 AND (c->>'efetivo_medio')::numeric > 0
                  ORDER BY (c->>'demissoes')::numeric / (c->>'efetivo_medio')::numeric DESC LIMIT 12) z), '[]'::jsonb)),
      'faixa', jsonb_build_object('titulo', 'Rescisões por tempo de empresa', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', f->>'faixa', 'valor', (f->>'n')::numeric) ORDER BY (f->>'ordem')::int)
           FROM jsonb_array_elements(rr->'por_faixa') f WHERE (f->>'ordem')::int > 0 OR (f->>'n')::int > 0), '[]'::jsonb)),
      'causa', jsonb_build_object('titulo', 'Por tipo de desligamento', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', c->>'causa', 'valor', (c->>'n')::numeric) ORDER BY (c->>'n')::int DESC)
           FROM (SELECT c FROM jsonb_array_elements(rr->'por_causa') c ORDER BY (c->>'n')::int DESC LIMIT 6) z), '[]'::jsonb)),
      'empresa', jsonb_build_object('titulo', 'Turnover geral por empresa', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', e->>'empresa', 'valor', (e->>'taxa')::numeric, 'rotulo', (e->>'demissoes') || ' demissões'))
           FROM jsonb_array_elements(d->'por_empresa') e), '[]'::jsonb))));
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_turnover() FROM PUBLIC, anon, authenticated;

-- `casas` do KPI chega à tela (só quem manda; os outros painéis seguem com 1 casa).
CREATE OR REPLACE FUNCTION public.tvg_espelho_resultado(p_codigo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  i public."TVG_INDICADOR"; d jsonb; kp jsonb; g jsonb;
BEGIN
  SELECT * INTO i FROM public."TVG_INDICADOR" WHERE codigo = p_codigo;
  IF i.espelho_fonte IS NULL THEN RETURN NULL; END IF;
  d := public.tvg_espelho_fonte(i.espelho_fonte);
  IF d IS NULL THEN RETURN jsonb_build_object('valor', NULL, 'observacao', 'Fonte do espelho indisponível: ' || i.espelho_fonte); END IF;
  kp := CASE WHEN i.espelho_item LIKE 'kpi:%' THEN d->'kpis'->(substr(i.espelho_item, 5)::int) END;
  g := CASE WHEN i.espelho_grafico IS NOT NULL THEN d->'graficos'->i.espelho_grafico END;
  RETURN jsonb_build_object(
    'valor', kp->'valor',
    'afetado', kp->>'dica',
    'base', (d->>'tela') || CASE WHEN d->'periodo'->>'de' IS NOT NULL
                                 THEN ' · ' || to_char((d->'periodo'->>'de')::date, 'DD/MM/YYYY') || ' a ' || to_char((d->'periodo'->>'ate')::date, 'DD/MM/YYYY') ELSE '' END,
    'detalhe', COALESCE(g->'itens', '[]'::jsonb),
    'grafico', g->>'tipo', 'grafico_titulo', g->>'titulo', 'grafico_series', g->'series', 'destaque', i.espelho_destaque,
    'casas', kp->'casas');
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_resultado(text) FROM PUBLIC, anon, authenticated;

-- `modo` do mês a mês chega à tela ('meta' = barra única colorida pela meta).
CREATE OR REPLACE FUNCTION public.tvg_espelho_tendencia(p_painel text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  p public."TVG_PAINEL"; d jsonb; s1 text; s2 text;
BEGIN
  SELECT * INTO p FROM public."TVG_PAINEL" WHERE slug = p_painel;
  IF p.espelho_fonte IS NULL THEN RETURN NULL; END IF;
  d := public.tvg_espelho_fonte(p.espelho_fonte);
  IF d IS NULL OR jsonb_array_length(coalesce(d->'mensal'->'dados', '[]'::jsonb)) = 0 THEN
    RETURN jsonb_build_object('titulo', NULL, 'series', '[]'::jsonb, 'unidade', 'qtd', 'meses', '[]'::jsonb);
  END IF;
  s1 := coalesce(p.espelho_series[1], d->'mensal'->'series'->0->>'chave');
  s2 := coalesce(p.espelho_series[2], d->'mensal'->'series'->1->>'chave');
  RETURN jsonb_build_object(
    'titulo', 'Mês a mês — ' || replace(d->>'tela', 'Relatórios › ', ''),
    'series', jsonb_build_array(
                (SELECT x->>'rotulo' FROM jsonb_array_elements(d->'mensal'->'series') x WHERE x->>'chave' = s1),
                (SELECT x->>'rotulo' FROM jsonb_array_elements(d->'mensal'->'series') x WHERE x->>'chave' = s2)),
    'unidade', coalesce(d->'mensal'->>'unidade', 'qtd'),
    'modo', d->'mensal'->>'modo',
    'meses', (SELECT jsonb_agg(jsonb_build_object('mes', to_char(to_date(m->>'mes', 'YYYY-MM'), 'MM/YY'), 'a', (m->>s1)::numeric, 'b', (m->>s2)::numeric) ORDER BY m->>'mes')
                FROM jsonb_array_elements(d->'mensal'->'dados') m));
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_tendencia(text) FROM PUBLIC, anon, authenticated;

-- Metas do relatório (as mesmas da tela: 41% no ano, 3,42% no mês).
UPDATE public."TVG_INDICADOR" SET meta = 41 WHERE codigo IN ('op_t_geral', 'op_t_projecao');
UPDATE public."TVG_INDICADOR" SET meta = 3.42, nome = 'Turnover do último mês fechado',
       identificar = 'Turnover do último mês fechado — Relatórios › Turnover (o mês corrente vai na dica).'
 WHERE codigo = 'op_t_mes';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- UPDATE public."TVG_INDICADOR" SET meta = NULL WHERE codigo IN ('op_t_geral', 'op_t_projecao', 'op_t_mes');
-- UPDATE public."TVG_INDICADOR" SET nome = 'Turnover do mês' WHERE codigo = 'op_t_mes';
-- (reaplicar tvg_espelho_turnover/tvg_espelho_tendencia da 20261014000037 e tvg_espelho_resultado da 20261014000036)
-- NOTIFY pgrst, 'reload schema';
