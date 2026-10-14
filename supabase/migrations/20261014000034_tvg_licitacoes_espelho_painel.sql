-- =========================================================================
-- TV LICITAÇÕES = LICITAÇÕES › PAINEL EXECUTIVO (14/10/2026)
--
-- Continuação do "replica pra TV" (Pablo). O Painel Executivo lê a grade com o
-- botão "Grupo (todas as empresas)" (a TV é do grupo, como a TV de
-- Licitações; só HAGG deixava de fora os editais da SN), sem filtro de
-- data nem responsável, e calcula no navegador (usePainelLicitacao.ts). Aqui, as
-- mesmas regras: participados = fora Não Participado/Suspenso/Revogado;
-- taxa de vitória = ganhas ÷ finalizadas (posição 1 = ganha); contratos
-- ganhos = soma do valor global das ganhas (e "Mês:" pelas atualizadas no
-- mês); alertas = sessão de hoje a 7 dias nas fases À Iniciar/Iniciado/Em
-- Andamento, os 6 primeiros (a tela corta em 6 — o cartão mostra esse
-- número). Valor com o mesmo parseValor da tela (vírgula = decimal; sem
-- vírgula, o parseFloat do JavaScript — tvg_js_parsefloat).
-- Gráficos: Próximas licitações (lista), Editais por status (participados),
-- Valor participado por faixa; tendência = evolução dos últimos 6 meses
-- (processos × valor em R$ mi, pela data de cadastro).
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

-- parseFloat do JavaScript: o maior prefixo numérico ("1.234.567" → 1.234).
CREATE OR REPLACE FUNCTION public.tvg_js_parsefloat(s text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce((regexp_match(btrim(coalesce(s, '')), '^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?'))[1]::numeric, 0);
$$;

-- parseValor de usePainelLicitacao.ts.
CREATE OR REPLACE FUNCTION public.tvg_valor_painel_lic(v text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN v IS NULL OR v = '' THEN 0
              WHEN regexp_replace(v, '[R$\s]', '', 'g') LIKE '%,%'
                THEN public.tvg_js_parsefloat(replace(replace(regexp_replace(v, '[R$\s]', '', 'g'), '.', ''), ',', '.'))
              ELSE public.tvg_js_parsefloat(regexp_replace(v, '[R$\s]', '', 'g')) END;
$$;

CREATE OR REPLACE FUNCTION public.tvg_espelho_licitacoes()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  r jsonb;
BEGIN
  WITH g AS (SELECT g.*, g.fase::text AS f, public.tvg_valor_painel_lic(g.valor_global) AS v FROM public.grade g),
  part AS (SELECT * FROM g WHERE f NOT IN ('Não Participado', 'Suspenso', 'Revogado')),
  fin AS (SELECT * FROM g WHERE f = 'Finalizada'),
  ganhas AS (SELECT * FROM fin WHERE posicao = 1),
  alertas AS (SELECT * FROM g WHERE f IN ('À Iniciar', 'Iniciado', 'Em Andamento') AND data BETWEEN hoje AND hoje + 7 ORDER BY data LIMIT 6)
  SELECT jsonb_build_object(
    'tela', 'Licitações › Painel Executivo (Grupo)',
    'periodo', NULL,
    'kpis', jsonb_build_array(
      jsonb_build_object('rotulo', 'Valor total participado', 'valor', (SELECT coalesce(sum(v), 0) FROM part), 'formato', 'brl', 'dica', 'Editais em andamento'),
      jsonb_build_object('rotulo', 'Taxa de vitória', 'valor', (SELECT CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE posicao = 1) / count(*)) ELSE 0 END FROM fin), 'formato', 'pct',
                         'dica', (SELECT count(*) FILTER (WHERE posicao = 1) || ' ganhos · ' || count(*) FILTER (WHERE posicao IS DISTINCT FROM 1) || ' perdidos' FROM fin)),
      jsonb_build_object('rotulo', 'Contratos ganhos', 'valor', (SELECT coalesce(sum(v), 0) FROM ganhas), 'formato', 'brl',
                         'dica', 'Valor global · Mês: R$ ' || replace(to_char((SELECT coalesce(sum(v), 0) FROM ganhas WHERE to_char(updated_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') = to_char(hoje, 'YYYY-MM')), 'FM999G999G990'), ',', '.')),
      jsonb_build_object('rotulo', 'Pessoas nos contratos ganhos', 'valor', (SELECT coalesce(sum(qtd_pessoas), 0) FROM ganhas), 'formato', 'n', 'dica', 'Qtd. pessoas (editais finalizados ganhos)'),
      jsonb_build_object('rotulo', 'Alertas de abertura (7 dias)', 'valor', (SELECT count(*) FROM alertas), 'formato', 'n', 'dica', 'Editais com abertura próxima'),
      jsonb_build_object('rotulo', 'Editais lidos', 'valor', (SELECT count(*) FROM g), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Editais participados', 'valor', (SELECT count(*) FROM part), 'formato', 'n', 'dica', 'Excluindo: Não Participado, Suspenso e Revogado'),
      jsonb_build_object('rotulo', 'Editais não participados', 'valor', (SELECT count(*) FROM g WHERE f = 'Não Participado'), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Editais suspensos', 'valor', (SELECT count(*) FROM g WHERE f = 'Suspenso'), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Editais revogados', 'valor', (SELECT count(*) FROM g WHERE f = 'Revogado'), 'formato', 'n')),
    'mensal', jsonb_build_object(
      'series', jsonb_build_array(jsonb_build_object('chave', 'processos', 'rotulo', 'Processos'), jsonb_build_object('chave', 'valor_mi', 'rotulo', 'Valor (R$ mi)')),
      'dados', (SELECT jsonb_agg(jsonb_build_object('mes', to_char(m, 'YYYY-MM'),
                  'processos', (SELECT count(*) FROM g WHERE date_trunc('month', g.created_at AT TIME ZONE 'America/Sao_Paulo') = m),
                  'valor_mi', (SELECT round(coalesce(sum(v), 0) / 1e6, 1) FROM g WHERE date_trunc('month', g.created_at AT TIME ZONE 'America/Sao_Paulo') = m)) ORDER BY m)
                  FROM generate_series(date_trunc('month', hoje::timestamp) - interval '5 months', date_trunc('month', hoje::timestamp), interval '1 month') m)),
    'graficos', jsonb_build_object(
      'alertas', jsonb_build_object('titulo', 'Próximas licitações', 'tipo', 'lista', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', coalesce(edital, 's/ edital'), 'valor', data - hoje, 'data', data,
                  'titulo', coalesce(edital, '—') || ' · ' || coalesce(nullif(btrim(objeto), ''), 'Sem objeto'),
                  'sub', coalesce(nullif(btrim(responsavel), ''), 'Sem responsável') || ' · ' || f,
                  'rotulo', CASE data - hoje WHEN 0 THEN 'hoje' WHEN 1 THEN 'amanhã' ELSE 'em ' || (data - hoje) || ' dias' END) ORDER BY data)
           FROM alertas), '[]'::jsonb)),
      'fase', jsonb_build_object('titulo', 'Editais por status (participados)', 'tipo', 'rosca', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', n) ORDER BY n DESC)
           FROM (SELECT CASE WHEN f = 'Finalizada' THEN CASE WHEN posicao = 1 THEN 'Finalizada (Ganho)' ELSE 'Finalizada (Perdido)' END ELSE f END AS nome, count(*) n
                   FROM part GROUP BY 1) t), '[]'::jsonb)),
      'faixa', jsonb_build_object('titulo', 'Valor participado por faixa', 'tipo', 'colunas', 'itens', (
         SELECT jsonb_agg(jsonb_build_object('nome', fx.rotulo, 'valor', (SELECT count(*) FROM g WHERE v >= fx.mi AND v < fx.ma),
                                             'rotulo', (SELECT count(*) FROM g WHERE v >= fx.mi AND v < fx.ma) || ' edital(is)') ORDER BY fx.o)
           FROM (VALUES (1, 'Até R$ 1 mi', 0::numeric, 1e6::numeric), (2, 'R$ 1 mi – R$ 10 mi', 1e6, 1e7), (3, 'R$ 10 mi – R$ 50 mi', 1e7, 5e7), (4, 'Acima de R$ 50 mi', 5e7, 1e30)) fx(o, rotulo, mi, ma)))))
    INTO r;
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_licitacoes() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tvg_espelho_fonte_extra(p_fonte text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF p_fonte = 'vagas' THEN RETURN public.tvg_espelho_vagas(); END IF;
  IF p_fonte = 'chamados' THEN RETURN public.tvg_espelho_chamados(); END IF;
  IF p_fonte = 'treinamentos' THEN RETURN public.tvg_espelho_treinamentos(); END IF;
  IF p_fonte = 'licitacoes' THEN RETURN public.tvg_espelho_licitacoes(); END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_fonte_extra(text) FROM PUBLIC, anon, authenticated;

-- ── Cadastro: os 10 cartões do painel, na ordem; gráficos Próximas licitações · Por status · Por faixa ─
UPDATE public."TVG_INDICADOR" SET na_tv = false WHERE painel = 'ger-licitacoes' AND espelho_fonte IS NULL;
UPDATE public."TVG_PAINEL" SET espelho_fonte = 'licitacoes', espelho_series = ARRAY['processos', 'valor_mi'] WHERE slug = 'ger-licitacoes';

INSERT INTO public."TVG_INDICADOR"
  (codigo, painel, ordem, nome, identificar, fonte, unidade, sentido, meta, alerta, periodicidade, responsavel, na_tv, regra,
   espelho_fonte, espelho_item, espelho_grafico, espelho_destaque)
VALUES
 ('lic_p_valor_participado', 'ger-licitacoes', 1, 'Valor total participado', 'Valor total participado — Painel Executivo de Licitações.', 'auto', 'brl', 'maior', NULL, NULL, 'diaria', 'Licitações', true,
  'Igual a Licitações › Painel Executivo (Grupo — todas as empresas, sem filtro): Valor total participado.', 'licitacoes', 'kpi:0', NULL, NULL),
 ('lic_p_taxa_vitoria', 'ger-licitacoes', 2, 'Taxa de vitória', 'Taxa de vitória — Painel Executivo de Licitações.', 'auto', 'pct', 'maior', NULL, NULL, 'diaria', 'Licitações', true,
  'Igual a Licitações › Painel Executivo (Grupo — todas as empresas, sem filtro): Taxa de vitória.', 'licitacoes', 'kpi:1', NULL, NULL),
 ('lic_p_contratos_ganhos', 'ger-licitacoes', 3, 'Contratos ganhos', 'Contratos ganhos — Painel Executivo de Licitações.', 'auto', 'brl', 'maior', NULL, NULL, 'diaria', 'Licitações', true,
  'Igual a Licitações › Painel Executivo (Grupo — todas as empresas, sem filtro): Contratos ganhos.', 'licitacoes', 'kpi:2', NULL, NULL),
 ('lic_p_pessoas_ganhos', 'ger-licitacoes', 4, 'Pessoas nos contratos ganhos', 'Pessoas nos contratos ganhos — Painel Executivo de Licitações.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Licitações', true,
  'Igual a Licitações › Painel Executivo (Grupo — todas as empresas, sem filtro): Pessoas nos contratos ganhos.', 'licitacoes', 'kpi:3', NULL, NULL),
 ('lic_p_alertas', 'ger-licitacoes', 5, 'Alertas de abertura (7 dias)', 'Alertas de abertura (7 dias) — Painel Executivo de Licitações.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'Licitações', true,
  'Igual a Licitações › Painel Executivo (Grupo — todas as empresas, sem filtro): Alertas de abertura (7 dias).', 'licitacoes', 'kpi:4', 'alertas', 1),
 ('lic_p_lidos', 'ger-licitacoes', 6, 'Editais lidos', 'Editais lidos — Painel Executivo de Licitações.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Licitações', true,
  'Igual a Licitações › Painel Executivo (Grupo — todas as empresas, sem filtro): Editais lidos.', 'licitacoes', 'kpi:5', 'faixa', 3),
 ('lic_p_participados', 'ger-licitacoes', 7, 'Editais participados', 'Editais participados — Painel Executivo de Licitações.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Licitações', true,
  'Igual a Licitações › Painel Executivo (Grupo — todas as empresas, sem filtro): Editais participados.', 'licitacoes', 'kpi:6', 'fase', 2),
 ('lic_p_nao_participados', 'ger-licitacoes', 8, 'Editais não participados', 'Editais não participados — Painel Executivo de Licitações.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'Licitações', true,
  'Igual a Licitações › Painel Executivo (Grupo — todas as empresas, sem filtro): Editais não participados.', 'licitacoes', 'kpi:7', NULL, NULL),
 ('lic_p_suspensos', 'ger-licitacoes', 9, 'Editais suspensos', 'Editais suspensos — Painel Executivo de Licitações.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'Licitações', true,
  'Igual a Licitações › Painel Executivo (Grupo — todas as empresas, sem filtro): Editais suspensos.', 'licitacoes', 'kpi:8', NULL, NULL),
 ('lic_p_revogados', 'ger-licitacoes', 10, 'Editais revogados', 'Editais revogados — Painel Executivo de Licitações.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'Licitações', true,
  'Igual a Licitações › Painel Executivo (Grupo — todas as empresas, sem filtro): Editais revogados.', 'licitacoes', 'kpi:9', NULL, NULL)
ON CONFLICT (codigo) DO UPDATE SET
  ordem = EXCLUDED.ordem, nome = EXCLUDED.nome, unidade = EXCLUDED.unidade, sentido = EXCLUDED.sentido, na_tv = true, regra = EXCLUDED.regra,
  espelho_fonte = EXCLUDED.espelho_fonte, espelho_item = EXCLUDED.espelho_item, espelho_grafico = EXCLUDED.espelho_grafico, espelho_destaque = EXCLUDED.espelho_destaque;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DELETE FROM public."TVG_INDICADOR" WHERE espelho_fonte = 'licitacoes';
-- UPDATE public."TVG_PAINEL" SET espelho_fonte = NULL, espelho_series = NULL WHERE slug = 'ger-licitacoes';
-- UPDATE public."TVG_INDICADOR" SET na_tv = true WHERE codigo IN ('lic_documentos', 'lic_ganhas', 'lic_implantacao', 'lic_perdidas', 'lic_prazo', 'lic_propostas', 'lic_risco', 'lic_valor');
-- DROP FUNCTION public.tvg_espelho_licitacoes(), public.tvg_valor_painel_lic(text), public.tvg_js_parsefloat(text); tvg_espelho_fonte_extra: reaplicar a da 20261014000033.
