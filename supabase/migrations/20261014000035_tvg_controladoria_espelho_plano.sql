-- =========================================================================
-- TV CONTROLADORIA = PLANO DE AÇÕES › DASHBOARD (14/10/2026)
--
-- Continuação do "replica pra TV" (Pablo). A tela lê plano_acao (não
-- excluídas, até 500, sem filtro) e conta no navegador (plano-acoes/
-- Dashboard.tsx): os 10 cartões — Total, Em andamento, A definir/Não
-- iniciadas, Atrasadas, Concluídas validadas, Aguardando validação, Pend.
-- evidência (legado), Sem responsável, Sem datas planejadas, Comitês
-- ativos — e os gráficos por status, prioridade, área e comitê. "Top 10
-- responsáveis" fica fora (nome de pessoa não vai para a TV de área comum).
-- A tela não tem gráfico mês a mês: a TV também não (tvg_espelho_tendencia
-- passa a devolver uma tendência vazia, e o dashboard mostra o 1º gráfico
-- grande — antes caía na tendência antiga, que não é desta tela).
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.tvg_espelho_plano_acoes()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE r jsonb;
BEGIN
  WITH p AS (SELECT * FROM public.plano_acao WHERE deleted_at IS NULL ORDER BY ordem NULLS LAST LIMIT 500),
  st(k, nome) AS (VALUES ('a_definir', 'A definir'), ('nao_iniciada', 'Não iniciada'), ('em_andamento', 'Em andamento'),
                         ('aguardando_validacao', 'Aguardando validação'), ('atrasada', 'Atrasada'),
                         ('concluida_pendente_evidencia', 'Concluída — pend. evidência'), ('concluida_validada', 'Concluída validada'), ('cancelada', 'Cancelada')),
  pr(k, nome) AS (VALUES ('emergencial', 'Emergencial'), ('alta', 'Alta'), ('media', 'Média'), ('baixa', 'Baixa'), ('nao_informada', 'Não informada'))
  SELECT jsonb_build_object(
    'tela', 'Plano de Ações › Dashboard',
    'periodo', NULL,
    'kpis', jsonb_build_array(
      jsonb_build_object('rotulo', 'Total de ações', 'valor', (SELECT count(*) FROM p), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Em andamento', 'valor', (SELECT count(*) FROM p WHERE status_normalizado = 'em_andamento'), 'formato', 'n'),
      jsonb_build_object('rotulo', 'A definir / Não iniciadas', 'valor', (SELECT count(*) FROM p WHERE status_normalizado IN ('a_definir', 'nao_iniciada')), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Atrasadas', 'valor', (SELECT count(*) FROM p WHERE status_normalizado = 'atrasada'), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Concluídas validadas', 'valor', (SELECT count(*) FROM p WHERE status_normalizado = 'concluida_validada'), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Aguardando validação', 'valor', (SELECT count(*) FROM p WHERE status_normalizado = 'aguardando_validacao'), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Pend. evidência (legado)', 'valor', (SELECT count(*) FROM p WHERE pendencia_evidencia), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Sem responsável', 'valor', (SELECT count(*) FROM p WHERE pendencia_responsavel), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Sem datas planejadas', 'valor', (SELECT count(*) FROM p WHERE pendencia_datas), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Comitês ativos', 'valor', (SELECT count(DISTINCT comite) FROM p WHERE coalesce(comite, '') <> ''), 'formato', 'n')),
    'mensal', jsonb_build_object('series', '[]'::jsonb, 'dados', '[]'::jsonb),
    'graficos', jsonb_build_object(
      'status', jsonb_build_object('titulo', 'Ações por status', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', coalesce(st.nome, p2.k), 'valor', p2.n) ORDER BY p2.n DESC)
           FROM (SELECT status_normalizado k, count(*) n FROM p GROUP BY 1) p2 LEFT JOIN st ON st.k = p2.k), '[]'::jsonb)),
      'prioridade', jsonb_build_object('titulo', 'Ações por prioridade', 'tipo', 'rosca', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', coalesce(pr.nome, p2.k), 'valor', p2.n) ORDER BY p2.n DESC)
           FROM (SELECT coalesce(prioridade_normalizada, 'nao_informada') k, count(*) n FROM p GROUP BY 1) p2 LEFT JOIN pr ON pr.k = p2.k), '[]'::jsonb)),
      'area', jsonb_build_object('titulo', 'Ações por área', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', area, 'valor', n) ORDER BY n DESC) FROM (SELECT area, count(*) n FROM p WHERE coalesce(area, '') <> '' GROUP BY 1 ORDER BY 2 DESC LIMIT 8) t), '[]'::jsonb)),
      'comite', jsonb_build_object('titulo', 'Ações por comitê', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', comite, 'valor', n) ORDER BY n DESC) FROM (SELECT comite, count(*) n FROM p WHERE coalesce(comite, '') <> '' GROUP BY 1 ORDER BY 2 DESC LIMIT 8) t), '[]'::jsonb))))
    INTO r;
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_plano_acoes() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tvg_espelho_fonte_extra(p_fonte text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF p_fonte = 'vagas' THEN RETURN public.tvg_espelho_vagas(); END IF;
  IF p_fonte = 'chamados' THEN RETURN public.tvg_espelho_chamados(); END IF;
  IF p_fonte = 'treinamentos' THEN RETURN public.tvg_espelho_treinamentos(); END IF;
  IF p_fonte = 'licitacoes' THEN RETURN public.tvg_espelho_licitacoes(); END IF;
  IF p_fonte = 'plano_acoes' THEN RETURN public.tvg_espelho_plano_acoes(); END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_fonte_extra(text) FROM PUBLIC, anon, authenticated;

-- Tela sem mês a mês → tendência vazia (o dashboard da TV mostra o 1º gráfico grande).
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
    'unidade', 'qtd',
    'meses', (SELECT jsonb_agg(jsonb_build_object('mes', to_char(to_date(m->>'mes', 'YYYY-MM'), 'MM/YY'), 'a', (m->>s1)::numeric, 'b', (m->>s2)::numeric) ORDER BY m->>'mes')
                FROM jsonb_array_elements(d->'mensal'->'dados') m));
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_tendencia(text) FROM PUBLIC, anon, authenticated;

-- ── Cadastro: os 10 cartões da tela, na ordem; gráficos status · prioridade · área · comitê ─
UPDATE public."TVG_INDICADOR" SET na_tv = false WHERE painel = 'ger-controladoria' AND espelho_fonte IS NULL;
UPDATE public."TVG_PAINEL" SET espelho_fonte = 'plano_acoes', espelho_series = NULL WHERE slug = 'ger-controladoria';

INSERT INTO public."TVG_INDICADOR"
  (codigo, painel, ordem, nome, identificar, fonte, unidade, sentido, meta, alerta, periodicidade, responsavel, na_tv, regra,
   espelho_fonte, espelho_item, espelho_grafico, espelho_destaque)
VALUES
 ('ctl_pa_total', 'ger-controladoria', 1, 'Total de ações', 'Total de ações — Dashboard do Plano de Ações.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Controladoria', true,
  'Igual a Plano de Ações › Dashboard (sem filtro): Total de ações.', 'plano_acoes', 'kpi:0', 'status', 1),
 ('ctl_pa_andamento', 'ger-controladoria', 2, 'Em andamento', 'Em andamento — Dashboard do Plano de Ações.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Controladoria', true,
  'Igual a Plano de Ações › Dashboard (sem filtro): Em andamento.', 'plano_acoes', 'kpi:1', NULL, NULL),
 ('ctl_pa_a_definir', 'ger-controladoria', 3, 'A definir / Não iniciadas', 'A definir / Não iniciadas — Dashboard do Plano de Ações.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'Controladoria', true,
  'Igual a Plano de Ações › Dashboard (sem filtro): A definir / Não iniciadas.', 'plano_acoes', 'kpi:2', NULL, NULL),
 ('ctl_pa_atrasadas', 'ger-controladoria', 4, 'Atrasadas', 'Atrasadas — Dashboard do Plano de Ações.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'Controladoria', true,
  'Igual a Plano de Ações › Dashboard (sem filtro): Atrasadas.', 'plano_acoes', 'kpi:3', 'prioridade', 2),
 ('ctl_pa_validadas', 'ger-controladoria', 5, 'Concluídas validadas', 'Concluídas validadas — Dashboard do Plano de Ações.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Controladoria', true,
  'Igual a Plano de Ações › Dashboard (sem filtro): Concluídas validadas.', 'plano_acoes', 'kpi:4', 'area', 3),
 ('ctl_pa_aguardando', 'ger-controladoria', 6, 'Aguardando validação', 'Aguardando validação — Dashboard do Plano de Ações.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'Controladoria', true,
  'Igual a Plano de Ações › Dashboard (sem filtro): Aguardando validação.', 'plano_acoes', 'kpi:5', 'comite', 4),
 ('ctl_pa_pend_evidencia', 'ger-controladoria', 7, 'Pend. evidência (legado)', 'Pend. evidência (legado) — Dashboard do Plano de Ações.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'Controladoria', true,
  'Igual a Plano de Ações › Dashboard (sem filtro): Pend. evidência (legado).', 'plano_acoes', 'kpi:6', NULL, NULL),
 ('ctl_pa_sem_resp', 'ger-controladoria', 8, 'Sem responsável', 'Sem responsável — Dashboard do Plano de Ações.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'Controladoria', true,
  'Igual a Plano de Ações › Dashboard (sem filtro): Sem responsável.', 'plano_acoes', 'kpi:7', NULL, NULL),
 ('ctl_pa_sem_datas', 'ger-controladoria', 9, 'Sem datas planejadas', 'Sem datas planejadas — Dashboard do Plano de Ações.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'Controladoria', true,
  'Igual a Plano de Ações › Dashboard (sem filtro): Sem datas planejadas.', 'plano_acoes', 'kpi:8', NULL, NULL),
 ('ctl_pa_comites', 'ger-controladoria', 10, 'Comitês ativos', 'Comitês ativos — Dashboard do Plano de Ações.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Controladoria', true,
  'Igual a Plano de Ações › Dashboard (sem filtro): Comitês ativos.', 'plano_acoes', 'kpi:9', NULL, NULL)
ON CONFLICT (codigo) DO UPDATE SET
  ordem = EXCLUDED.ordem, nome = EXCLUDED.nome, unidade = EXCLUDED.unidade, sentido = EXCLUDED.sentido, na_tv = true, regra = EXCLUDED.regra,
  espelho_fonte = EXCLUDED.espelho_fonte, espelho_item = EXCLUDED.espelho_item, espelho_grafico = EXCLUDED.espelho_grafico, espelho_destaque = EXCLUDED.espelho_destaque;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DELETE FROM public."TVG_INDICADOR" WHERE espelho_fonte = 'plano_acoes';
-- UPDATE public."TVG_PAINEL" SET espelho_fonte = NULL, espelho_series = NULL WHERE slug = 'ger-controladoria';
-- UPDATE public."TVG_INDICADOR" SET na_tv = true WHERE codigo IN ('ctl_desvio', 'ctl_margem', 'ctl_planos', 'ctl_planos_concluidos', 'ctl_reincidentes', 'ctl_vermelhos');
-- DROP FUNCTION public.tvg_espelho_plano_acoes(); tvg_espelho_fonte_extra / tvg_espelho_tendencia: reaplicar as da 20261014000034 / 20261014000030.
