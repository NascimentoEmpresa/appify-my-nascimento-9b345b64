-- =========================================================================
-- TVs GERENCIAIS = ESPELHO DOS RELATÓRIOS DE CADA MÓDULO (14/10/2026)
--
-- Pablo, depois da TV Supply igual ao Dashboard de Compras: "agora faz o
-- ajuste com todos os outros […] os relatórios estão todos corretos, replica
-- pra TV […] o do jurídico ser parecido com o Orientações Jurídicas do
-- relatórios e por assim em diante".
--
-- Em vez de reescrever cada conta, a TV CHAMA A MESMA FUNÇÃO que a tela usa
-- (a versão interna, sem o portão de login — dir_rel_dados etc.), com o
-- mesmo período padrão da tela (12 meses), e copia os cartões e gráficos:
--
--   TVG_INDICADOR.espelho_fonte    de onde vem ('rel:orientacoes', …)
--               .espelho_item      qual cartão ('kpi:0' = o 1º cartão da tela)
--               .espelho_grafico   o gráfico do card de baixo ('status',
--                                  'ranking:0' = o 1º ranking da tela, …)
--               .espelho_destaque  ordem do gráfico embaixo na TV (1, 2, 3)
--   TVG_PAINEL.espelho_fonte/_series  a tendência = o gráfico mês a mês da tela
--
-- tvg_espelho_fonte(fonte) devolve a fonte num formato único e guarda o
-- resultado até o fim da requisição (set_config local): a TV de RH lê
-- Colaboradores (0,85 s) UMA vez, não uma por cartão.
--
-- Nesta migration: a infraestrutura, Jurídico (= Relatórios › Orientações
-- Jurídicas) e RH (= Relatórios › Colaboradores + Turnover no ano, que já
-- espelha Relatórios › Turnover). Os indicadores antigos dessas TVs saem da
-- TV (na_tv = false; continuam cadastrados).
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

ALTER TABLE public."TVG_INDICADOR"
  ADD COLUMN IF NOT EXISTS espelho_fonte    text,
  ADD COLUMN IF NOT EXISTS espelho_item     text,
  ADD COLUMN IF NOT EXISTS espelho_grafico  text,
  ADD COLUMN IF NOT EXISTS espelho_destaque integer;
ALTER TABLE public."TVG_PAINEL"
  ADD COLUMN IF NOT EXISTS espelho_fonte  text,
  ADD COLUMN IF NOT EXISTS espelho_series text[];

-- A fonte num formato único: {tela, periodo, kpis[], mensal{series,dados}, graficos{chave:{titulo,tipo,itens[]}}}.
CREATE OR REPLACE FUNCTION public.tvg_espelho_fonte(p_fonte text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  k text := 'tvg.esp_' || md5(p_fonte);
  c text := current_setting(k, true);
  d jsonb; r jsonb;
BEGIN
  IF c IS NOT NULL AND c <> '' THEN RETURN c::jsonb; END IF;

  IF p_fonte LIKE 'rel:%' THEN
    -- Relatórios › <relatório padrão>: dir_rel_dados, período padrão da tela (12 meses).
    d := public.dir_rel_dados(substr(p_fonte, 5), NULL, NULL, NULL, NULL);
    r := jsonb_build_object(
      'tela', 'Relatórios › ' || coalesce(d->>'titulo', substr(p_fonte, 5)),
      'periodo', d->'periodo', 'kpis', d->'kpis', 'mensal', d->'mensal',
      'graficos', jsonb_build_object('status', jsonb_build_object('titulo', 'Por status', 'tipo', 'rosca',
                    'itens', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', x->>'nome', 'valor', (x->>'n')::numeric)) FROM jsonb_array_elements(d->'por_status') x), '[]'::jsonb)))
                  || COALESCE((SELECT jsonb_object_agg('ranking:' || (o - 1), jsonb_build_object('titulo', q->>'titulo', 'tipo', 'colunas',
                       'itens', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', i->>'nome', 'valor', (i->>'n')::numeric)) FROM jsonb_array_elements(q->'itens') i), '[]'::jsonb)))
                     FROM jsonb_array_elements(d->'rankings') WITH ORDINALITY z(q, o)), '{}'::jsonb));
  ELSE
    r := public.tvg_espelho_fonte_extra(p_fonte);
  END IF;

  IF r IS NOT NULL THEN PERFORM set_config(k, r::text, true); END IF;
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_fonte(text) FROM PUBLIC, anon, authenticated;

-- Fontes com formato próprio (Vagas, Chamados, Treinamentos…) — preenchida nas próximas migrations.
CREATE OR REPLACE FUNCTION public.tvg_espelho_fonte_extra(p_fonte text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_fonte_extra(text) FROM PUBLIC, anon, authenticated;

-- Um cartão da tela como resultado de indicador.
CREATE OR REPLACE FUNCTION public.tvg_espelho_resultado(p_codigo text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
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
    'grafico', g->>'tipo', 'grafico_titulo', g->>'titulo', 'destaque', i.espelho_destaque);
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_resultado(text) FROM PUBLIC, anon, authenticated;

-- A tendência da TV = o gráfico mês a mês da tela (as duas séries escolhidas).
CREATE OR REPLACE FUNCTION public.tvg_espelho_tendencia(p_painel text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  p public."TVG_PAINEL"; d jsonb; s1 text; s2 text;
BEGIN
  SELECT * INTO p FROM public."TVG_PAINEL" WHERE slug = p_painel;
  IF p.espelho_fonte IS NULL THEN RETURN NULL; END IF;
  d := public.tvg_espelho_fonte(p.espelho_fonte);
  IF d IS NULL OR jsonb_array_length(coalesce(d->'mensal'->'dados', '[]'::jsonb)) = 0 THEN RETURN NULL; END IF;
  s1 := coalesce(p.espelho_series[1], d->'mensal'->'series'->0->>'chave');
  s2 := coalesce(p.espelho_series[2], d->'mensal'->'series'->1->>'chave');
  RETURN jsonb_build_object(
    'titulo', 'Mês a mês — ' || replace(d->>'tela', 'Relatórios › ', ''),
    'series', jsonb_build_array(
                (SELECT x->>'rotulo' FROM jsonb_array_elements(d->'mensal'->'series') x WHERE x->>'chave' = s1),
                (SELECT x->>'rotulo' FROM jsonb_array_elements(d->'mensal'->'series') x WHERE x->>'chave' = s2)),
    'unidade', 'qtd',
    'meses', (SELECT jsonb_agg(jsonb_build_object('mes', to_char(to_date(m->>'mes', 'YYYY-MM'), 'MM/YY'), 'a', (m->>s1)::numeric, 'b', (m->>s2)::numeric) ORDER BY m->>'mes')
                FROM jsonb_array_elements(d->'mensal'->'dados') m));
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_tendencia(text) FROM PUBLIC, anon, authenticated;
-- tvg_resultado: o espelho de relatório (cadastro) vem antes de tudo.
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
      r := coalesce(public.tvg_espelho_resultado(i.codigo), public.tvg_calc_espelho(i.codigo, i.parametro), public.tvg_calc_ajuste(i.codigo, i.parametro),
                    public.tvg_calc(i.codigo, i.parametro), public.tvg_calc_extra(i.codigo, i.parametro));
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
  -- TV que espelha um relatório: a tendência é o gráfico mês a mês da tela (mig 20261014000030).
  r := public.tvg_espelho_tendencia(p_painel);
  IF r IS NOT NULL THEN RETURN r; END IF;
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

-- ── Jurídico = Relatórios › Orientações Jurídicas ───────────────────────
-- Cartões: Total no período · Em andamento · Concluídas · Recusadas/canceladas · Tempo médio.
-- Gráficos: Por status · Orientações por categoria · Origem ("Quem perguntou" fica fora:
-- nomes de pessoas não vão para a TV, que é área comum). Tendência: Abertas × Concluídas.
UPDATE public."TVG_INDICADOR" SET na_tv = false WHERE painel = 'ger-juridico' AND espelho_fonte IS NULL;
UPDATE public."TVG_PAINEL" SET espelho_fonte = 'rel:orientacoes', espelho_series = ARRAY['total', 'concluidos'] WHERE slug = 'ger-juridico';

-- ── RH = Relatórios › Colaboradores (+ Turnover no ano, = Relatórios › Turnover) ─
-- Cartões: Colaboradores ativos · Trabalhando · Afastados · Admitidos · Desligados (+ turnover).
-- Gráficos: Ativos por contrato · Situação · Ativos por cargo. Tendência: Admitidos × Desligados.
UPDATE public."TVG_INDICADOR" SET na_tv = false WHERE painel = 'ger-rh' AND espelho_fonte IS NULL AND codigo <> 'rh_turnover';
UPDATE public."TVG_INDICADOR" SET ordem = 6 WHERE codigo = 'rh_turnover';
UPDATE public."TVG_PAINEL" SET espelho_fonte = 'rel:colaboradores', espelho_series = ARRAY['admitidos', 'desligados'] WHERE slug = 'ger-rh';

INSERT INTO public."TVG_INDICADOR"
  (codigo, painel, ordem, nome, identificar, fonte, unidade, sentido, meta, alerta, periodicidade, responsavel, na_tv, regra,
   espelho_fonte, espelho_item, espelho_grafico, espelho_destaque)
VALUES
 ('jur_or_total',      'ger-juridico', 1, 'Total no período', 'Orientações jurídicas pedidas no período.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Jurídico', true,
  'Igual a Relatórios › Orientações Jurídicas (12 meses): total de dúvidas enviadas ao Jurídico.', 'rel:orientacoes', 'kpi:0', 'ranking:0', 2),
 ('jur_or_andamento',  'ger-juridico', 2, 'Em andamento', 'Orientações ainda não concluídas.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'Jurídico', true,
  'Igual a Relatórios › Orientações Jurídicas: ainda não concluídas.', 'rel:orientacoes', 'kpi:1', 'status', 1),
 ('jur_or_concluidas', 'ger-juridico', 3, 'Concluídas', 'Orientações respondidas.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Jurídico', true,
  'Igual a Relatórios › Orientações Jurídicas: concluídas.', 'rel:orientacoes', 'kpi:2', 'ranking:1', 3),
 ('jur_or_recusadas',  'ger-juridico', 4, 'Recusadas / canceladas', 'Orientações recusadas ou canceladas.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'Jurídico', true,
  'Igual a Relatórios › Orientações Jurídicas: recusadas ou canceladas.', 'rel:orientacoes', 'kpi:3', NULL, NULL),
 ('jur_or_tempo',      'ger-juridico', 5, 'Tempo médio até concluir', 'Da abertura à conclusão.', 'auto', 'dias', 'menor', NULL, NULL, 'diaria', 'Jurídico', true,
  'Igual a Relatórios › Orientações Jurídicas: média de dias da abertura à conclusão.', 'rel:orientacoes', 'kpi:4', NULL, NULL),

 ('rh_col_ativos',     'ger-rh', 1, 'Colaboradores ativos', 'O quadro de hoje.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'RH', true,
  'Igual a Relatórios › Colaboradores: ativos hoje na EMPREGADOS (folha Senior).', 'rel:colaboradores', 'kpi:0', 'ranking:0', 1),
 ('rh_col_trabalhando','ger-rh', 2, 'Trabalhando', 'Ativos em situação Trabalhando.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'RH', true,
  'Igual a Relatórios › Colaboradores: ativos com situação Trabalhando.', 'rel:colaboradores', 'kpi:1', 'status', 2),
 ('rh_col_afastados',  'ger-rh', 3, 'Afastados', 'Auxílio-doença, licença, férias…', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'RH', true,
  'Igual a Relatórios › Colaboradores: ativos fora de Trabalhando (auxílio-doença, licença, férias…).', 'rel:colaboradores', 'kpi:2', 'ranking:1', 3),
 ('rh_col_admitidos',  'ger-rh', 4, 'Admitidos no período', 'Admissões nos 12 meses.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'RH', true,
  'Igual a Relatórios › Colaboradores: admitidos no período (12 meses).', 'rel:colaboradores', 'kpi:3', NULL, NULL),
 ('rh_col_desligados', 'ger-rh', 5, 'Desligados no período', 'Desligamentos nos 12 meses.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'RH', true,
  'Igual a Relatórios › Colaboradores: desligados no período (12 meses).', 'rel:colaboradores', 'kpi:4', NULL, NULL)
ON CONFLICT (codigo) DO UPDATE SET
  ordem = EXCLUDED.ordem, nome = EXCLUDED.nome, unidade = EXCLUDED.unidade, sentido = EXCLUDED.sentido, na_tv = true, regra = EXCLUDED.regra,
  espelho_fonte = EXCLUDED.espelho_fonte, espelho_item = EXCLUDED.espelho_item, espelho_grafico = EXCLUDED.espelho_grafico, espelho_destaque = EXCLUDED.espelho_destaque;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DELETE FROM public."TVG_INDICADOR" WHERE espelho_fonte IS NOT NULL;
-- UPDATE public."TVG_PAINEL" SET espelho_fonte = NULL, espelho_series = NULL;
-- UPDATE public."TVG_INDICADOR" SET na_tv = true WHERE painel IN ('ger-juridico', 'ger-rh') AND codigo IN ('jur_audiencias', 'jur_contratos_analise', 'jur_multas_revertidas', 'jur_prazos', 'jur_reincidentes', 'jur_risco', 'jur_sem_resposta', 'rh_absenteismo', 'rh_obrigacoes', 'rh_preenchidas', 'rh_quadro', 'rh_salarios', 'rh_turnover');
-- tvg_resultado / tvg_tendencia: reaplicar as da 20261014000029; DROP FUNCTION tvg_espelho_resultado, tvg_espelho_tendencia, tvg_espelho_fonte, tvg_espelho_fonte_extra.
