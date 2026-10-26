-- =========================================================================
-- TV FROTA E PATRIMÔNIO = AGENDAMENTO DE VEÍCULOS › DASHBOARD (14/10/2026)
--
-- Pablo: a TV Frota espelha o "Agendamento de Veículos" (Central de Serviços
-- › Agendamento de Veículos, aba Dashboard). A tela lê cs_veiculo_agendamento
-- (+ contratos de cada viagem) e calcula em src/lib/veiculos/
-- dashboardVeiculos.ts; aqui, as mesmas regras, com o período padrão da tela
-- ("Este ano": a reserva conta se ENCOSTA no ano):
--   situação: cancelado → Cancelado; começa depois de hoje → Agendado;
--   terminou antes de hoje → Realizado; o resto → Em andamento;
--   dias de uso = dias corridos da reserva (início e fim contam), sem as
--   canceladas; veículos usados e contratos atendidos também sem as canceladas.
-- Cartões: Agendamentos, Realizados, Pela frente, Cancelados, Dias de uso,
-- Contratos atendidos. Gráficos: Situação, Uso por veículo, Contratos mais
-- atendidos; tendência = Agendamentos por mês (total × realizados).
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.tvg_espelho_frota()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  ini date := date_trunc('year', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
  fim date := (date_trunc('year', (now() AT TIME ZONE 'America/Sao_Paulo')) + interval '1 year - 1 day')::date;
  r jsonb;
BEGIN
  WITH a AS (
    SELECT a.*, CASE WHEN a.status = 'cancelado' THEN 'Cancelado' WHEN a.data_inicio > hoje THEN 'Agendado'
                     WHEN a.data_fim < hoje THEN 'Realizado' ELSE 'Em andamento' END AS sit,
           CASE WHEN a.data_fim >= a.data_inicio THEN a.data_fim - a.data_inicio + 1 ELSE 1 END AS dias
      FROM public.cs_veiculo_agendamento a
     WHERE a.data_fim >= ini AND a.data_inicio <= fim),
  vivos AS (SELECT * FROM a WHERE status <> 'cancelado'),
  ctr AS (SELECT c.contrato_nome FROM public.cs_veiculo_agendamento_contrato c JOIN vivos v ON v.id = c.agendamento_id),
  meses AS (SELECT generate_series(date_trunc('month', (SELECT min(data_inicio) FROM a)), date_trunc('month', (SELECT max(data_inicio) FROM a)), interval '1 month')::date AS m)
  SELECT jsonb_build_object(
    'tela', 'Agendamento de Veículos › Dashboard',
    'periodo', jsonb_build_object('de', ini, 'ate', fim),
    'kpis', jsonb_build_array(
      jsonb_build_object('rotulo', 'Agendamentos', 'valor', (SELECT count(*) FROM a), 'formato', 'n',
                         'dica', (SELECT count(DISTINCT solicitante_id) || ' solicitante(s)' FROM a)),
      jsonb_build_object('rotulo', 'Realizados', 'valor', (SELECT count(*) FROM a WHERE sit = 'Realizado'), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Pela frente', 'valor', (SELECT count(*) FROM a WHERE sit IN ('Agendado', 'Em andamento')), 'formato', 'n',
                         'dica', (SELECT count(*) FROM a WHERE sit = 'Em andamento') || ' em andamento'),
      jsonb_build_object('rotulo', 'Cancelados', 'valor', (SELECT count(*) FROM a WHERE sit = 'Cancelado'), 'formato', 'n',
                         'dica', (SELECT CASE WHEN count(*) > 0 THEN replace(round(100.0 * count(*) FILTER (WHERE sit = 'Cancelado') / count(*), 1)::text, '.', ',') ELSE '0' END || '% do total' FROM a)),
      jsonb_build_object('rotulo', 'Dias de uso', 'valor', (SELECT coalesce(sum(dias), 0) FROM vivos), 'formato', 'n',
                         'dica', (SELECT count(DISTINCT patrimonio_id) || ' veículo(s) usado(s)' FROM vivos)),
      jsonb_build_object('rotulo', 'Contratos atendidos', 'valor', (SELECT count(DISTINCT contrato_nome) FROM ctr), 'formato', 'n')),
    'mensal', jsonb_build_object(
      'series', jsonb_build_array(jsonb_build_object('chave', 'total', 'rotulo', 'Agendamentos'), jsonb_build_object('chave', 'realizados', 'rotulo', 'Realizados')),
      'dados', COALESCE((SELECT jsonb_agg(jsonb_build_object('mes', to_char(m, 'YYYY-MM'),
                  'total', (SELECT count(*) FROM a WHERE to_char(data_inicio, 'YYYY-MM') = to_char(m, 'YYYY-MM')),
                  'realizados', (SELECT count(*) FROM a WHERE sit = 'Realizado' AND to_char(data_inicio, 'YYYY-MM') = to_char(m, 'YYYY-MM'))) ORDER BY m)
                  FROM meses), '[]'::jsonb)),
    'graficos', jsonb_build_object(
      'situacao', jsonb_build_object('titulo', 'Situação', 'tipo', 'rosca', 'itens', (
         SELECT jsonb_agg(jsonb_build_object('nome', s, 'valor', (SELECT count(*) FROM a WHERE sit = s)) ORDER BY o)
           FROM (VALUES (1, 'Realizado'), (2, 'Em andamento'), (3, 'Agendado'), (4, 'Cancelado')) x(o, s))),
      'veiculo', jsonb_build_object('titulo', 'Uso por veículo (dias reservados)', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', d, 'rotulo', nres || ' reserva(s)') ORDER BY d DESC, nres DESC)
           FROM (SELECT veiculo_nome || coalesce(' · ' || nullif(veiculo_identificador, ''), '') nome, sum(dias) d, count(*) nres FROM vivos GROUP BY 1) t), '[]'::jsonb)),
      'contratos', jsonb_build_object('titulo', 'Contratos mais atendidos', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', contrato_nome, 'valor', q) ORDER BY q DESC, contrato_nome)
           FROM (SELECT contrato_nome, count(*) q FROM ctr GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10) t), '[]'::jsonb))))
    INTO r;
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_frota() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tvg_espelho_fonte_extra(p_fonte text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF p_fonte = 'vagas' THEN RETURN public.tvg_espelho_vagas(); END IF;
  IF p_fonte = 'chamados' THEN RETURN public.tvg_espelho_chamados(); END IF;
  IF p_fonte = 'treinamentos' THEN RETURN public.tvg_espelho_treinamentos(); END IF;
  IF p_fonte = 'licitacoes' THEN RETURN public.tvg_espelho_licitacoes(); END IF;
  IF p_fonte = 'plano_acoes' THEN RETURN public.tvg_espelho_plano_acoes(); END IF;
  IF p_fonte = 'geral' THEN RETURN public.tvg_espelho_geral(); END IF;
  IF p_fonte = 'turnover' THEN RETURN public.tvg_espelho_turnover(); END IF;
  IF p_fonte = 'frota' THEN RETURN public.tvg_espelho_frota(); END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_fonte_extra(text) FROM PUBLIC, anon, authenticated;

-- ── Cadastro: os 6 cartões da tela, na ordem; gráficos Situação · Uso por veículo · Contratos ─
UPDATE public."TVG_INDICADOR" SET na_tv = false WHERE painel = 'ger-frota' AND espelho_fonte IS NULL;
UPDATE public."TVG_PAINEL" SET espelho_fonte = 'frota', espelho_series = ARRAY['total', 'realizados'] WHERE slug = 'ger-frota';

INSERT INTO public."TVG_INDICADOR"
  (codigo, painel, ordem, nome, identificar, fonte, unidade, sentido, meta, alerta, periodicidade, responsavel, na_tv, regra,
   espelho_fonte, espelho_item, espelho_grafico, espelho_destaque)
VALUES
 ('fro_ag_agendamentos', 'ger-frota', 1, 'Agendamentos', 'Agendamentos — Dashboard do Agendamento de Veículos.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Frota', true,
  'Igual a Agendamento de Veículos › Dashboard (período Este ano): Agendamentos.', 'frota', 'kpi:0', 'situacao', 1),
 ('fro_ag_realizados', 'ger-frota', 2, 'Realizados', 'Realizados — Dashboard do Agendamento de Veículos.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Frota', true,
  'Igual a Agendamento de Veículos › Dashboard (período Este ano): Realizados.', 'frota', 'kpi:1', NULL, NULL),
 ('fro_ag_pela_frente', 'ger-frota', 3, 'Pela frente', 'Pela frente — Dashboard do Agendamento de Veículos.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Frota', true,
  'Igual a Agendamento de Veículos › Dashboard (período Este ano): Pela frente.', 'frota', 'kpi:2', NULL, NULL),
 ('fro_ag_cancelados', 'ger-frota', 4, 'Cancelados', 'Cancelados — Dashboard do Agendamento de Veículos.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'Frota', true,
  'Igual a Agendamento de Veículos › Dashboard (período Este ano): Cancelados.', 'frota', 'kpi:3', NULL, NULL),
 ('fro_ag_dias_uso', 'ger-frota', 5, 'Dias de uso', 'Dias de uso — Dashboard do Agendamento de Veículos.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Frota', true,
  'Igual a Agendamento de Veículos › Dashboard (período Este ano): Dias de uso.', 'frota', 'kpi:4', 'veiculo', 2),
 ('fro_ag_contratos', 'ger-frota', 6, 'Contratos atendidos', 'Contratos atendidos — Dashboard do Agendamento de Veículos.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Frota', true,
  'Igual a Agendamento de Veículos › Dashboard (período Este ano): Contratos atendidos.', 'frota', 'kpi:5', 'contratos', 3)
ON CONFLICT (codigo) DO UPDATE SET
  ordem = EXCLUDED.ordem, nome = EXCLUDED.nome, unidade = EXCLUDED.unidade, sentido = EXCLUDED.sentido, na_tv = true, regra = EXCLUDED.regra,
  espelho_fonte = EXCLUDED.espelho_fonte, espelho_item = EXCLUDED.espelho_item, espelho_grafico = EXCLUDED.espelho_grafico, espelho_destaque = EXCLUDED.espelho_destaque;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DELETE FROM public."TVG_INDICADOR" WHERE espelho_fonte = 'frota';
-- UPDATE public."TVG_PAINEL" SET espelho_fonte = NULL, espelho_series = NULL WHERE slug = 'ger-frota';
-- UPDATE public."TVG_INDICADOR" SET na_tv = true WHERE codigo IN ('fro_combustivel', 'fro_documentos', 'fro_indisponiveis', 'fro_manutencoes', 'fro_nao_localizados', 'fro_sem_responsavel');
-- DROP FUNCTION public.tvg_espelho_frota(); tvg_espelho_fonte_extra: reaplicar a da 20261014000037.
