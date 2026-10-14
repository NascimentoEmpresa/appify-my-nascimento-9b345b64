-- =========================================================================
-- TV TI = SISTEMAS › DASHBOARD DE CHAMADOS (PAINEL DA EQUIPE) (14/10/2026)
--
-- Pablo: "o do TV TI ser parecido com o dashboard de chamados"
-- (/app/sistemas/chamados/dashboard-tv). A tela lê CHAMADO_SISTEMA e
-- CHAMADO_SISTEMA_AVALIACAO e calcula no navegador (DashboardChamados.tsx);
-- aqui, as mesmas regras:
--   · Na fila = ativos (não concluído/reprovado/cancelado — STATUS_ENCERRADOS);
--   · Em andamento / Aguardando = status em_andamento / aguardando_retorno;
--   · Concluídos/mês = concluído com concluido_em desde o dia 1º (horário de
--     Brasília, como o navegador);
--   · Atrasados = ativos com prazo_previsto antes de hoje;
--   · Satisfação = média das avaliações, cada uma a média PONDERADA dos 6
--     critérios (CRITERIOS_AVALIACAO: 0,30/0,20/0,15/0,10/0,10/0,15);
--   · gráficos: Chamados por categoria (top 5), Entregas por mês (6 meses),
--     Setores que mais abrem (top 5) e Situação dos chamados.
-- Os cards por desenvolvedor ficam fora (nome de pessoa não vai para a TV
-- gerencial, que é área comum). Os indicadores antigos da TV TI saem dela.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.tvg_espelho_chamados()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  ini date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
  r jsonb;
BEGIN
  WITH c AS (SELECT c.*, c.status NOT IN ('concluido', 'reprovado', 'cancelado') AS ativo,
                    (c.concluido_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia_conc
               FROM public."CHAMADO_SISTEMA" c),
  notas AS (SELECT coalesce(a.qualidade, 0) * 0.30 + coalesce(a.prazo, 0) * 0.20 + coalesce(a.comunicacao, 0) * 0.15
                 + coalesce(a.clareza, 0) * 0.10 + coalesce(a.facilidade, 0) * 0.10 + coalesce(a.satisfacao, 0) * 0.15 AS nota
              FROM public."CHAMADO_SISTEMA_AVALIACAO" a JOIN public."CHAMADO_SISTEMA" s ON s.id = a.chamado_id),
  cat AS (SELECT CASE x WHEN 'power_bi' THEN 'Power BI' WHEN 'relatorios_dashboards' THEN 'Relatórios / Dashboards'
                        WHEN 'ajuste_tela_cadastro' THEN 'Ajuste em Tela / Cadastro' WHEN 'correcao_erro' THEN 'Correção de Erro'
                        WHEN 'integracoes' THEN 'Integrações' WHEN 'dados_informacao' THEN 'Dados / Informação'
                        WHEN 'acesso_permissao' THEN 'Acesso / Permissão' WHEN 'outros' THEN 'Outros' ELSE x END AS nome
            FROM c, unnest(coalesce(c.categorias, ARRAY[]::text[])) x)
  SELECT jsonb_build_object(
    'tela', 'Sistemas › Dashboard de Chamados',
    'periodo', NULL,
    'kpis', jsonb_build_array(
      jsonb_build_object('rotulo', 'Na fila', 'valor', (SELECT count(*) FROM c WHERE ativo), 'formato', 'n', 'dica', 'Chamados ainda não concluídos, reprovados nem cancelados'),
      jsonb_build_object('rotulo', 'Em andamento', 'valor', (SELECT count(*) FROM c WHERE status = 'em_andamento'), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Aguardando', 'valor', (SELECT count(*) FROM c WHERE status = 'aguardando_retorno'), 'formato', 'n', 'dica', 'Aguardando retorno do solicitante'),
      jsonb_build_object('rotulo', 'Concluídos/mês', 'valor', (SELECT count(*) FROM c WHERE status = 'concluido' AND dia_conc >= ini), 'formato', 'n', 'dica', 'Desde ' || to_char(ini, 'DD/MM')),
      jsonb_build_object('rotulo', 'Atrasados', 'valor', (SELECT count(*) FROM c WHERE ativo AND prazo_previsto < hoje), 'formato', 'n', 'dica', 'Na fila com o prazo previsto vencido'),
      jsonb_build_object('rotulo', 'Satisfação', 'valor', (SELECT round(avg(nota)::numeric, 1) FROM notas), 'formato', 'n',
                         'dica', (SELECT count(*) || ' avaliação(ões) · nota de 0 a 5' FROM notas))),
    'mensal', jsonb_build_object(
      'series', jsonb_build_array(jsonb_build_object('chave', 'entregas', 'rotulo', 'Entregas'), jsonb_build_object('chave', 'abertos', 'rotulo', 'Abertos')),
      'dados', (SELECT jsonb_agg(jsonb_build_object('mes', to_char(g, 'YYYY-MM'),
                  'entregas', (SELECT count(*) FROM c WHERE dia_conc >= g AND dia_conc < g + interval '1 month'),
                  'abertos', (SELECT count(*) FROM c WHERE (c.created_at AT TIME ZONE 'America/Sao_Paulo')::date >= g AND (c.created_at AT TIME ZONE 'America/Sao_Paulo')::date < g + interval '1 month')) ORDER BY g)
                  FROM generate_series(ini - interval '5 months', ini, interval '1 month') g)),
    'graficos', jsonb_build_object(
      'categoria', jsonb_build_object('titulo', 'Chamados por categoria', 'tipo', 'colunas', 'itens',
         COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', n) ORDER BY n DESC) FROM (SELECT nome, count(*) n FROM cat GROUP BY 1 ORDER BY 2 DESC LIMIT 5) t), '[]'::jsonb)),
      'entregas', jsonb_build_object('titulo', 'Entregas por mês', 'tipo', 'colunas', 'itens',
         (SELECT jsonb_agg(jsonb_build_object('nome', to_char(g, 'MM/YY'), 'valor', (SELECT count(*) FROM c WHERE dia_conc >= g AND dia_conc < g + interval '1 month')) ORDER BY g)
            FROM generate_series(ini - interval '5 months', ini, interval '1 month') g)),
      'setores', jsonb_build_object('titulo', 'Setores que mais abrem', 'tipo', 'colunas', 'itens',
         COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', setor, 'valor', n) ORDER BY n DESC) FROM (SELECT setor, count(*) n FROM c WHERE nullif(btrim(setor), '') IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 5) t), '[]'::jsonb)),
      'situacao', jsonb_build_object('titulo', 'Situação dos chamados', 'tipo', 'rosca', 'itens',
         (SELECT jsonb_agg(jsonb_build_object('nome', s.rotulo, 'valor', (SELECT count(*) FROM c WHERE c.status = s.st)) ORDER BY s.o)
            FROM (VALUES (1, 'aberto', 'Aberto'), (2, 'em_andamento', 'Em andamento'), (3, 'aguardando_retorno', 'Aguardando retorno'),
                         (4, 'concluido', 'Concluído'), (5, 'reprovado', 'Reprovado'), (6, 'cancelado', 'Cancelado')) s(o, st, rotulo)))))
    INTO r;
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_chamados() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tvg_espelho_fonte_extra(p_fonte text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF p_fonte = 'vagas' THEN RETURN public.tvg_espelho_vagas(); END IF;
  IF p_fonte = 'chamados' THEN RETURN public.tvg_espelho_chamados(); END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_fonte_extra(text) FROM PUBLIC, anon, authenticated;

-- ── Cadastro: os 6 números do topo do painel, na ordem; gráficos categoria · entregas · situação ─
UPDATE public."TVG_INDICADOR" SET na_tv = false WHERE painel = 'ger-ti' AND espelho_fonte IS NULL;
UPDATE public."TVG_PAINEL" SET espelho_fonte = 'chamados', espelho_series = ARRAY['abertos', 'entregas'] WHERE slug = 'ger-ti';

INSERT INTO public."TVG_INDICADOR"
  (codigo, painel, ordem, nome, identificar, fonte, unidade, sentido, meta, alerta, periodicidade, responsavel, na_tv, regra,
   espelho_fonte, espelho_item, espelho_grafico, espelho_destaque)
VALUES
 ('ti_ch_fila', 'ger-ti', 1, 'Na fila', 'Chamados ainda em aberto.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'TI / ERP', true,
  'Igual ao Dashboard de Chamados: chamados não concluídos, reprovados nem cancelados.', 'chamados', 'kpi:0', 'categoria', 1),
 ('ti_ch_andamento', 'ger-ti', 2, 'Em andamento', 'Chamados sendo feitos agora.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'TI / ERP', true,
  'Igual ao Dashboard de Chamados: chamados com status em andamento.', 'chamados', 'kpi:1', 'situacao', 3),
 ('ti_ch_aguardando', 'ger-ti', 3, 'Aguardando', 'Esperando retorno do solicitante.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'TI / ERP', true,
  'Igual ao Dashboard de Chamados: chamados aguardando retorno.', 'chamados', 'kpi:2', NULL, NULL),
 ('ti_ch_concluidos', 'ger-ti', 4, 'Concluídos/mês', 'Entregues desde o dia 1º.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'TI / ERP', true,
  'Igual ao Dashboard de Chamados: concluídos com data de conclusão no mês corrente.', 'chamados', 'kpi:3', 'entregas', 2),
 ('ti_ch_atrasados', 'ger-ti', 5, 'Atrasados', 'Na fila com prazo vencido.', 'auto', 'qtd', 'menor', 0, NULL, 'diaria', 'TI / ERP', true,
  'Igual ao Dashboard de Chamados: chamados na fila com prazo previsto antes de hoje.', 'chamados', 'kpi:4', 'setores', NULL),
 ('ti_ch_satisfacao', 'ger-ti', 6, 'Satisfação', 'Nota média das avaliações (0 a 5).', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'TI / ERP', true,
  'Igual ao Dashboard de Chamados: média das avaliações, cada uma a média ponderada dos 6 critérios.', 'chamados', 'kpi:5', NULL, NULL)
ON CONFLICT (codigo) DO UPDATE SET
  ordem = EXCLUDED.ordem, nome = EXCLUDED.nome, unidade = EXCLUDED.unidade, sentido = EXCLUDED.sentido, meta = EXCLUDED.meta, na_tv = true, regra = EXCLUDED.regra,
  espelho_fonte = EXCLUDED.espelho_fonte, espelho_item = EXCLUDED.espelho_item, espelho_grafico = EXCLUDED.espelho_grafico, espelho_destaque = EXCLUDED.espelho_destaque;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DELETE FROM public."TVG_INDICADOR" WHERE espelho_fonte = 'chamados';
-- UPDATE public."TVG_PAINEL" SET espelho_fonte = NULL, espelho_series = NULL WHERE slug = 'ger-ti';
-- UPDATE public."TVG_INDICADOR" SET na_tv = true WHERE codigo IN ('ti_acessos', 'ti_backups', 'ti_concluidos', 'ti_demandas', 'ti_erros', 'ti_indisponiveis', 'ti_integracoes', 'ti_tempo_conclusao');
-- DROP FUNCTION public.tvg_espelho_chamados(); tvg_espelho_fonte_extra: reaplicar a da 20261014000031.
