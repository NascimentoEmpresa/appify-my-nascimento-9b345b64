-- =========================================================================
-- TV SST = AS TRÊS FILAS DO SST (14/10/2026)
--
-- Pablo: a TV SST "precisa ser dados desses 3 sistemas: ASO Demissional,
-- ASO / Admissão, Mudança de Função — ASO". São filas de trabalho (não têm
-- dashboard); a TV mostra os mesmos números que cada fila mostra, com as
-- mesmas regras de cada tela:
--   · ASO / Admissão (sst/aso, AsoCandidatos.tsx): pendentes = candidatos na
--     etapa SST + COMPRAS (ou EXAME SST, nome antigo) sem sst_ok — o
--     "N pendente(s)" da tela; e quantos já têm exame marcado;
--   · ASO Demissional (sst/aso-demissional, PainelDemissoes etapa "sst"): os
--     3 cartões da tela — A receber (Pendente SST), A agendar (solicitação de
--     agendamento recebida), Agendadas (Agendamento concluído);
--   · Mudança de Função — ASO (sst/troca-funcao, PainelTrocaFuncao etapa
--     "sst"): Aguardando você (Pendente SST) e Concluídas (das 500 mais
--     recentes da fila do SST, como a tela carrega).
-- Gráficos: ASO admissional por contrato, ASO demissional por situação,
-- Mudança de função por contrato; tendência = exames tratados pelo SST por
-- mês (demissional × admissional, pela data em que o SST registrou).
-- Nomes de pessoas não vão para a TV (área comum).
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.tvg_espelho_sst()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  ini date := (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')) - interval '5 months')::date;
  r jsonb;
BEGIN
  WITH adm AS (SELECT * FROM public."VW_RECRUTAMENTO_CANDIDATOS" WHERE etapa_processo IN ('SST + COMPRAS', 'EXAME SST') AND sst_ok IS NULL),
  dem AS (SELECT * FROM public."SISTEMA_SOLICITACOES_DEMISSAO"
           WHERE status IN ('Pendente SST', 'Solicitação de agendamento de DEMISSIONAL recebida', 'Agendamento concluído', 'ASO válido', 'Cancelamento solicitado')),
  tro AS (SELECT * FROM public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" WHERE status IN ('Pendente SST', 'Pendente RH', 'Concluída') ORDER BY criado_em DESC LIMIT 500)
  SELECT jsonb_build_object(
    'tela', 'SST › ASO / Admissão · ASO Demissional · Mudança de Função — ASO',
    'periodo', NULL,
    'kpis', jsonb_build_array(
      jsonb_build_object('rotulo', 'ASO admissional pendente', 'valor', (SELECT count(*) FROM adm), 'formato', 'n', 'dica', 'SST › ASO / Admissão'),
      jsonb_build_object('rotulo', 'ASO admissional com exame marcado', 'valor', (SELECT count(*) FROM adm WHERE sst_data_exame IS NOT NULL), 'formato', 'n', 'dica', 'dos pendentes, já com data'),
      jsonb_build_object('rotulo', 'Demissional a receber', 'valor', (SELECT count(*) FROM dem WHERE status = 'Pendente SST'), 'formato', 'n', 'dica', 'SST › ASO Demissional'),
      jsonb_build_object('rotulo', 'Demissional a agendar', 'valor', (SELECT count(*) FROM dem WHERE status = 'Solicitação de agendamento de DEMISSIONAL recebida'), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Demissional agendadas', 'valor', (SELECT count(*) FROM dem WHERE status = 'Agendamento concluído'), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Mudança de função aguardando ASO', 'valor', (SELECT count(*) FROM tro WHERE status = 'Pendente SST'), 'formato', 'n', 'dica', 'SST › Mudança de Função — ASO'),
      jsonb_build_object('rotulo', 'Mudança de função concluídas', 'valor', (SELECT count(*) FROM tro WHERE status = 'Concluída'), 'formato', 'n')),
    'mensal', jsonb_build_object(
      'series', jsonb_build_array(jsonb_build_object('chave', 'demissional', 'rotulo', 'ASO demissional'), jsonb_build_object('chave', 'admissional', 'rotulo', 'ASO admissional')),
      'dados', (SELECT jsonb_agg(jsonb_build_object('mes', to_char(g, 'YYYY-MM'),
                  'demissional', (SELECT count(*) FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s WHERE date_trunc('month', s.sst_em AT TIME ZONE 'America/Sao_Paulo') = g),
                  'admissional', (SELECT count(*) FROM public."WA_CURRICULOS" c WHERE date_trunc('month', c.sst_em AT TIME ZONE 'America/Sao_Paulo') = g)) ORDER BY g)
                  FROM generate_series(ini, date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')), interval '1 month') g)),
    'graficos', jsonb_build_object(
      'admissional', jsonb_build_object('titulo', 'ASO admissional pendente por contrato', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', q) ORDER BY q DESC)
           FROM (SELECT coalesce(nullif(btrim(contrato), ''), 'Sem contrato') nome, count(*) q FROM adm GROUP BY 1 ORDER BY 2 DESC LIMIT 8) t), '[]'::jsonb)),
      'demissional', jsonb_build_object('titulo', 'ASO demissional por situação', 'tipo', 'rosca', 'itens', (
         SELECT jsonb_agg(jsonb_build_object('nome', x.rotulo, 'valor', (SELECT count(*) FROM dem WHERE dem.status = x.st)) ORDER BY x.o)
           FROM (VALUES (1, 'Pendente SST', 'A receber'), (2, 'Solicitação de agendamento de DEMISSIONAL recebida', 'A agendar'),
                        (3, 'Agendamento concluído', 'Agendadas'), (4, 'ASO válido', 'ASO válido'), (5, 'Cancelamento solicitado', 'Cancelamento solicitado')) x(o, st, rotulo))),
      'troca', jsonb_build_object('titulo', 'Mudança de função na fila do SST, por contrato', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', q) ORDER BY q DESC)
           FROM (SELECT coalesce(nullif(btrim(local), ''), nullif(btrim(filial), ''), 'Sem contrato') nome, count(*) q FROM tro WHERE status = 'Pendente SST' GROUP BY 1 ORDER BY 2 DESC LIMIT 8) t), '[]'::jsonb))))
    INTO r;
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_sst() FROM PUBLIC, anon, authenticated;

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
  IF p_fonte = 'financeiro' THEN RETURN public.tvg_espelho_financeiro(); END IF;
  IF p_fonte = 'sst' THEN RETURN public.tvg_espelho_sst(); END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_fonte_extra(text) FROM PUBLIC, anon, authenticated;

-- ── Cadastro: os números das três filas; gráficos demissional · admissional · mudança de função ─
UPDATE public."TVG_INDICADOR" SET na_tv = false WHERE painel = 'ger-sst' AND espelho_fonte IS NULL;
UPDATE public."TVG_PAINEL" SET espelho_fonte = 'sst', espelho_series = ARRAY['demissional', 'admissional'] WHERE slug = 'ger-sst';

INSERT INTO public."TVG_INDICADOR"
  (codigo, painel, ordem, nome, identificar, fonte, unidade, sentido, meta, alerta, periodicidade, responsavel, na_tv, regra,
   espelho_fonte, espelho_item, espelho_grafico, espelho_destaque)
VALUES
 ('sst_f_adm_pend', 'ger-sst', 1, 'ASO admissional pendente', 'ASO admissional pendente — filas do SST.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'SST', true,
  'Igual às filas do SST (ASO / Admissão, ASO Demissional, Mudança de Função — ASO): ASO admissional pendente.', 'sst', 'kpi:0', 'admissional', 2),
 ('sst_f_adm_marcado', 'ger-sst', 2, 'ASO admissional com exame marcado', 'ASO admissional com exame marcado — filas do SST.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'SST', true,
  'Igual às filas do SST (ASO / Admissão, ASO Demissional, Mudança de Função — ASO): ASO admissional com exame marcado.', 'sst', 'kpi:1', NULL, NULL),
 ('sst_f_dem_receber', 'ger-sst', 3, 'Demissional a receber', 'Demissional a receber — filas do SST.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'SST', true,
  'Igual às filas do SST (ASO / Admissão, ASO Demissional, Mudança de Função — ASO): Demissional a receber.', 'sst', 'kpi:2', 'demissional', 1),
 ('sst_f_dem_agendar', 'ger-sst', 4, 'Demissional a agendar', 'Demissional a agendar — filas do SST.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'SST', true,
  'Igual às filas do SST (ASO / Admissão, ASO Demissional, Mudança de Função — ASO): Demissional a agendar.', 'sst', 'kpi:3', NULL, NULL),
 ('sst_f_dem_agendadas', 'ger-sst', 5, 'Demissional agendadas', 'Demissional agendadas — filas do SST.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'SST', true,
  'Igual às filas do SST (ASO / Admissão, ASO Demissional, Mudança de Função — ASO): Demissional agendadas.', 'sst', 'kpi:4', NULL, NULL),
 ('sst_f_troca_aguardando', 'ger-sst', 6, 'Mudança de função aguardando ASO', 'Mudança de função aguardando ASO — filas do SST.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'SST', true,
  'Igual às filas do SST (ASO / Admissão, ASO Demissional, Mudança de Função — ASO): Mudança de função aguardando ASO.', 'sst', 'kpi:5', 'troca', 3),
 ('sst_f_troca_concluidas', 'ger-sst', 7, 'Mudança de função concluídas', 'Mudança de função concluídas — filas do SST.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'SST', true,
  'Igual às filas do SST (ASO / Admissão, ASO Demissional, Mudança de Função — ASO): Mudança de função concluídas.', 'sst', 'kpi:6', NULL, NULL)
ON CONFLICT (codigo) DO UPDATE SET
  ordem = EXCLUDED.ordem, nome = EXCLUDED.nome, unidade = EXCLUDED.unidade, sentido = EXCLUDED.sentido, na_tv = true, regra = EXCLUDED.regra,
  espelho_fonte = EXCLUDED.espelho_fonte, espelho_item = EXCLUDED.espelho_item, espelho_grafico = EXCLUDED.espelho_grafico, espelho_destaque = EXCLUDED.espelho_destaque;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DELETE FROM public."TVG_INDICADOR" WHERE espelho_fonte = 'sst';
-- UPDATE public."TVG_PAINEL" SET espelho_fonte = NULL, espelho_series = NULL WHERE slug = 'ger-sst';
-- UPDATE public."TVG_INDICADOR" SET na_tv = true WHERE codigo IN ('sst_acidentes', 'sst_afastamentos', 'sst_aso', 'sst_demissionais', 'sst_epi', 'sst_impedidos', 'sst_treinamentos');
-- DROP FUNCTION public.tvg_espelho_sst(); tvg_espelho_fonte_extra: reaplicar a da 20261014000039.
