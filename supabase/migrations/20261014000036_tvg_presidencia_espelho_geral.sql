-- =========================================================================
-- TV PRESIDÊNCIA = RELATÓRIOS › RELATÓRIO GERAL (14/10/2026)
--
-- Continuação do "replica pra TV" (Pablo). O Relatório Geral (dir_rel_geral)
-- mostra um cartão por relatório — o 1º número de cada um (Gestão
-- Recrutamento, Demissões, Materiais, Férias, Medida Disciplinar, Chamados,
-- Orientações Jurídicas, Mudança de Função, Colaboradores, Turn-over), com o
-- 2º e o 3º embaixo — e os gráficos "Solicitações por sistema no período",
-- "Tempo médio até concluir" e "Solicitações abertas por mês". A TV da
-- Presidência repete isso, lendo cada relatório pela mesma dir_rel_dados
-- (12 meses), com o cache por requisição de tvg_espelho_fonte.
-- Observação: o cartão Turn-over do Relatório Geral é o dir_rel_turnover
-- (turn-over MÉDIO MENSAL), como na tela — não a soma do ano de
-- Relatórios › Turnover.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.tvg_espelho_geral()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  sist text[] := ARRAY['recrutamento', 'demissoes', 'materiais', 'ferias', 'medida-disciplinar', 'chamados', 'orientacoes', 'mudanca-funcao', 'colaboradores', 'turnover'];
  tit text[] := ARRAY['Gestão Recrutamento', 'Demissões', 'Materiais', 'Férias', 'Medida Disciplinar', 'Chamados', 'Orientações Jurídicas', 'Mudança de Função', 'Colaboradores', 'Turn-over'];
  solic text[] := ARRAY['recrutamento', 'demissoes', 'materiais', 'ferias', 'medida-disciplinar', 'chamados', 'orientacoes', 'mudanca-funcao'];
  ds jsonb := '{}'::jsonb; s text; d jsonb; per jsonb;
BEGIN
  FOREACH s IN ARRAY sist LOOP
    d := public.tvg_espelho_fonte('rel:' || s);
    ds := ds || jsonb_build_object(s, d);
    per := coalesce(per, d->'periodo');
  END LOOP;

  RETURN jsonb_build_object(
    'tela', 'Relatórios › Relatório Geral',
    'periodo', per,
    'kpis', (SELECT jsonb_agg(jsonb_build_object(
                'rotulo', tit[i] || ' — ' || coalesce(ds->sist[i]->'kpis'->0->>'rotulo', ''),
                'valor', ds->sist[i]->'kpis'->0->'valor', 'formato', ds->sist[i]->'kpis'->0->>'formato',
                'dica', concat_ws(' · ',
                          CASE WHEN ds->sist[i]->'kpis'->1 IS NOT NULL THEN (ds->sist[i]->'kpis'->1->>'valor') || ' ' || lower(ds->sist[i]->'kpis'->1->>'rotulo') END,
                          CASE WHEN ds->sist[i]->'kpis'->2 IS NOT NULL THEN (ds->sist[i]->'kpis'->2->>'valor') || ' ' || lower(ds->sist[i]->'kpis'->2->>'rotulo') END)) ORDER BY i)
               FROM generate_subscripts(sist, 1) i),
    'mensal', jsonb_build_object(
      'series', jsonb_build_array(jsonb_build_object('chave', 'abertas', 'rotulo', 'Solicitações abertas'), jsonb_build_object('chave', 'concluidas', 'rotulo', 'Concluídas')),
      'dados', (SELECT jsonb_agg(jsonb_build_object('mes', m->>'mes',
                  'abertas', (SELECT sum(coalesce((x->>'total')::numeric, 0)) FROM unnest(solic) z(sl), jsonb_array_elements(ds->sl->'mensal'->'dados') x WHERE x->>'mes' = m->>'mes'),
                  'concluidas', (SELECT sum(coalesce((x->>'concluidos')::numeric, 0)) FROM unnest(solic) z(sl), jsonb_array_elements(ds->sl->'mensal'->'dados') x WHERE x->>'mes' = m->>'mes')) ORDER BY m->>'mes')
                  FROM jsonb_array_elements(ds->'recrutamento'->'mensal'->'dados') m)),
    'graficos', jsonb_build_object(
      'sistemas', jsonb_build_object('titulo', 'Solicitações por sistema no período', 'tipo', 'agrupado', 'series', jsonb_build_array('Concluídas', 'Em andamento'),
         'itens', (SELECT jsonb_agg(jsonb_build_object('nome', tit[i], 'a', (ds->sist[i]->'kpis'->2->>'valor')::numeric, 'b', (ds->sist[i]->'kpis'->1->>'valor')::numeric,
                                                       'valor', (ds->sist[i]->'kpis'->0->>'valor')::numeric,
                                                       'rotulo', coalesce(ds->sist[i]->'kpis'->3->>'valor', '0') || ' recusada(s)') ORDER BY (ds->sist[i]->'kpis'->0->>'valor')::numeric DESC)
                     FROM generate_subscripts(sist, 1) i WHERE sist[i] = ANY (solic))),
      'tempo', jsonb_build_object('titulo', 'Tempo médio até concluir (dias)', 'tipo', 'colunas',
         'itens', (SELECT jsonb_agg(jsonb_build_object('nome', tit[i], 'valor', (ds->sist[i]->'kpis'->4->>'valor')::numeric,
                                                       'rotulo', replace((ds->sist[i]->'kpis'->4->>'valor'), '.', ',') || ' d') ORDER BY (ds->sist[i]->'kpis'->4->>'valor')::numeric DESC)
                     FROM generate_subscripts(sist, 1) i WHERE sist[i] = ANY (solic) AND ds->sist[i]->'kpis'->4->>'valor' IS NOT NULL)),
      'quadro', jsonb_build_object('titulo', 'Quadro de colaboradores (ativos no fim do mês)', 'tipo', 'colunas',
         'itens', (SELECT jsonb_agg(jsonb_build_object('nome', to_char(to_date(x->>'mes', 'YYYY-MM'), 'MM/YY'), 'valor', (x->>'ativos')::numeric) ORDER BY x->>'mes')
                     FROM jsonb_array_elements(ds->'colaboradores'->'mensal'->'dados') x))));
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_geral() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tvg_espelho_fonte_extra(p_fonte text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF p_fonte = 'vagas' THEN RETURN public.tvg_espelho_vagas(); END IF;
  IF p_fonte = 'chamados' THEN RETURN public.tvg_espelho_chamados(); END IF;
  IF p_fonte = 'treinamentos' THEN RETURN public.tvg_espelho_treinamentos(); END IF;
  IF p_fonte = 'licitacoes' THEN RETURN public.tvg_espelho_licitacoes(); END IF;
  IF p_fonte = 'plano_acoes' THEN RETURN public.tvg_espelho_plano_acoes(); END IF;
  IF p_fonte = 'geral' THEN RETURN public.tvg_espelho_geral(); END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_fonte_extra(text) FROM PUBLIC, anon, authenticated;

-- ── Cadastro: os 10 cartões do Relatório Geral, na ordem; gráficos por sistema · tempo médio · quadro ─
UPDATE public."TVG_INDICADOR" SET na_tv = false WHERE painel = 'ger-presidencia' AND espelho_fonte IS NULL;
UPDATE public."TVG_PAINEL" SET espelho_fonte = 'geral', espelho_series = ARRAY['abertas', 'concluidas'] WHERE slug = 'ger-presidencia';

INSERT INTO public."TVG_INDICADOR"
  (codigo, painel, ordem, nome, identificar, fonte, unidade, sentido, meta, alerta, periodicidade, responsavel, na_tv, regra,
   espelho_fonte, espelho_item, espelho_grafico, espelho_destaque)
VALUES
 ('pre_g_recrutamento', 'ger-presidencia', 1, 'Gestão Recrutamento', 'Gestão Recrutamento — cartão do Relatório Geral.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Presidência', true,
  'Igual ao cartão Gestão Recrutamento de Relatórios › Relatório Geral (12 meses).', 'geral', 'kpi:0', 'sistemas', 1),
 ('pre_g_demissoes', 'ger-presidencia', 2, 'Demissões', 'Demissões — cartão do Relatório Geral.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'Presidência', true,
  'Igual ao cartão Demissões de Relatórios › Relatório Geral (12 meses).', 'geral', 'kpi:1', NULL, NULL),
 ('pre_g_materiais', 'ger-presidencia', 3, 'Materiais', 'Materiais — cartão do Relatório Geral.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Presidência', true,
  'Igual ao cartão Materiais de Relatórios › Relatório Geral (12 meses).', 'geral', 'kpi:2', 'tempo', 2),
 ('pre_g_ferias', 'ger-presidencia', 4, 'Férias', 'Férias — cartão do Relatório Geral.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Presidência', true,
  'Igual ao cartão Férias de Relatórios › Relatório Geral (12 meses).', 'geral', 'kpi:3', NULL, NULL),
 ('pre_g_medida', 'ger-presidencia', 5, 'Medida Disciplinar', 'Medida Disciplinar — cartão do Relatório Geral.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'Presidência', true,
  'Igual ao cartão Medida Disciplinar de Relatórios › Relatório Geral (12 meses).', 'geral', 'kpi:4', NULL, NULL),
 ('pre_g_chamados', 'ger-presidencia', 6, 'Chamados', 'Chamados — cartão do Relatório Geral.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Presidência', true,
  'Igual ao cartão Chamados de Relatórios › Relatório Geral (12 meses).', 'geral', 'kpi:5', NULL, NULL),
 ('pre_g_orientacoes', 'ger-presidencia', 7, 'Orientações Jurídicas', 'Orientações Jurídicas — cartão do Relatório Geral.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Presidência', true,
  'Igual ao cartão Orientações Jurídicas de Relatórios › Relatório Geral (12 meses).', 'geral', 'kpi:6', NULL, NULL),
 ('pre_g_mudanca', 'ger-presidencia', 8, 'Mudança de Função', 'Mudança de Função — cartão do Relatório Geral.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Presidência', true,
  'Igual ao cartão Mudança de Função de Relatórios › Relatório Geral (12 meses).', 'geral', 'kpi:7', NULL, NULL),
 ('pre_g_colaboradores', 'ger-presidencia', 9, 'Colaboradores', 'Colaboradores — cartão do Relatório Geral.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Presidência', true,
  'Igual ao cartão Colaboradores de Relatórios › Relatório Geral (12 meses).', 'geral', 'kpi:8', 'quadro', 3),
 ('pre_g_turnover', 'ger-presidencia', 10, 'Turn-over', 'Turn-over — cartão do Relatório Geral.', 'auto', 'pct', 'menor', NULL, NULL, 'diaria', 'Presidência', true,
  'Igual ao cartão Turn-over de Relatórios › Relatório Geral (12 meses).', 'geral', 'kpi:9', NULL, NULL)
ON CONFLICT (codigo) DO UPDATE SET
  ordem = EXCLUDED.ordem, nome = EXCLUDED.nome, unidade = EXCLUDED.unidade, sentido = EXCLUDED.sentido, na_tv = true, regra = EXCLUDED.regra,
  espelho_fonte = EXCLUDED.espelho_fonte, espelho_item = EXCLUDED.espelho_item, espelho_grafico = EXCLUDED.espelho_grafico, espelho_destaque = EXCLUDED.espelho_destaque;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DELETE FROM public."TVG_INDICADOR" WHERE espelho_fonte = 'geral';
-- UPDATE public."TVG_PAINEL" SET espelho_fonte = NULL, espelho_series = NULL WHERE slug = 'ger-presidencia';
-- UPDATE public."TVG_INDICADOR" SET na_tv = true WHERE codigo IN ('pre_caixa', 'pre_clientes', 'pre_contratos_saudaveis', 'pre_glosas', 'pre_lucratividade', 'pre_planos', 'pre_postos', 'pre_salarios', 'pre_vermelhos');
-- DROP FUNCTION public.tvg_espelho_geral(); tvg_espelho_fonte_extra: reaplicar a da 20261014000035.
