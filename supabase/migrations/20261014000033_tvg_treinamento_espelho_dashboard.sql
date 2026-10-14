-- =========================================================================
-- TV TREINAMENTO = TREINAMENTOS › DASHBOARD DE TREINAMENTOS (14/10/2026)
--
-- Continuação do "replica pra TV" (Pablo). A tela chama trn_dashboard (sem
-- curso nem período — o padrão) → trn_dashboard_dados; a TV chama a mesma
-- função interna e copia os 10 cartões (Número de alunos, Já acessaram,
-- Nunca acessaram, Acessaram recentemente, Demitidos, Aulas concluídas,
-- Avaliação das aulas, Provas %, Comentários, Certificados), os gráficos
-- (Situação dos alunos, Notas das aulas, Acesso por contrato) e a "Evolução no
-- ano" (primeiros acessos × aulas concluídas) como tendência. Mesmas contas
-- da tela: Provas = round(aprovadas ÷ enviadas × 100); avaliação com 1 casa.
-- Também: o resultado do espelho passa a levar as duas séries do gráfico
-- agrupado (grafico_series), para a TV nomear as barras como a tela.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.tvg_espelho_treinamentos()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  d jsonb := public.trn_dashboard_dados(NULL, NULL, NULL);
  ano int := coalesce((d->>'ano')::int, extract(year FROM now())::int);
BEGIN
  RETURN jsonb_build_object(
    'tela', 'Treinamentos › Dashboard de Treinamentos',
    'periodo', NULL,
    'kpis', jsonb_build_array(
      jsonb_build_object('rotulo', 'Número de alunos', 'valor', d->'alunos', 'formato', 'n', 'dica', 'colaboradores que podem acessar · ' || coalesce(d->>'alunos_afastados', '0') || ' afastado(s)'),
      jsonb_build_object('rotulo', 'Já acessaram (ativos)', 'valor', d->'alunos_ativos', 'formato', 'n',
                         'dica', CASE WHEN (d->>'alunos')::int > 0 THEN round((d->>'alunos_ativos')::numeric * 100 / (d->>'alunos')::numeric) || '% dos alunos' END),
      jsonb_build_object('rotulo', 'Nunca acessaram (inativos)', 'valor', d->'alunos_inativos', 'formato', 'n',
                         'dica', CASE WHEN coalesce((d->>'alunos_bloqueados')::int, 0) > 0 THEN (d->>'alunos_bloqueados') || ' bloqueado(s) à parte' ELSE 'ainda não entraram' END),
      jsonb_build_object('rotulo', 'Acessaram recentemente', 'valor', d->'acessaram_7d', 'formato', 'n', 'dica', 'últimos 7 dias · ' || coalesce(d->>'acessaram_30d', '0') || ' em 30 dias'),
      jsonb_build_object('rotulo', 'Demitidos', 'valor', d->'alunos_demitidos', 'formato', 'n', 'dica', 'no histórico, fora da conta'),
      jsonb_build_object('rotulo', 'Aulas concluídas', 'valor', d->'aulas_concluidas', 'formato', 'n', 'dica', coalesce(d->>'concluidos', '0') || ' aluno(s) concluíram'),
      jsonb_build_object('rotulo', 'Avaliação das aulas', 'valor', round((d->>'avaliacao_media')::numeric, 1), 'formato', 'n', 'dica', coalesce(d->>'avaliacoes', '0') || ' avaliação(ões)'),
      jsonb_build_object('rotulo', 'Provas', 'valor', CASE WHEN coalesce((d->>'provas_enviadas')::int, 0) > 0
                                                            THEN round((d->>'provas_aprovadas')::numeric * 100 / (d->>'provas_enviadas')::numeric) END, 'formato', 'pct',
                         'dica', coalesce(d->>'provas_aprovadas', '0') || ' aprovada(s) de ' || coalesce(d->>'provas_enviadas', '0') || ' enviada(s)'),
      jsonb_build_object('rotulo', 'Comentários nas aulas', 'valor', d->'comentarios', 'formato', 'n',
                         'dica', CASE WHEN coalesce((d->>'comentarios_pendentes')::int, 0) > 0 THEN (d->>'comentarios_pendentes') || ' aguardando moderação' ELSE 'nenhum pendente' END),
      jsonb_build_object('rotulo', 'Certificados emitidos', 'valor', d->'certificados', 'formato', 'n',
                         'dica', coalesce(d->>'cursos_publicados', '0') || ' de ' || coalesce(d->>'cursos_total', '0') || ' curso(s) publicado(s)')),
    'mensal', jsonb_build_object(
      'series', jsonb_build_array(jsonb_build_object('chave', 'acessos', 'rotulo', 'Primeiros acessos'), jsonb_build_object('chave', 'conclusoes', 'rotulo', 'Aulas concluídas')),
      'dados', (SELECT jsonb_agg(jsonb_build_object('mes', ano || '-' || lpad(m::text, 2, '0'),
                  'acessos', coalesce((d->'primeiros_acessos_por_mes'->>(m - 1))::numeric, 0),
                  'conclusoes', coalesce((d->'conclusoes_por_mes'->>(m - 1))::numeric, 0)) ORDER BY m)
                  FROM generate_series(1, extract(month FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int) m)),
    'graficos', jsonb_build_object(
      'situacao', jsonb_build_object('titulo', 'Situação dos alunos', 'tipo', 'rosca', 'itens', jsonb_build_array(
         jsonb_build_object('nome', 'Já acessaram', 'valor', d->'alunos_ativos'),
         jsonb_build_object('nome', 'Nunca acessaram', 'valor', d->'alunos_inativos'),
         jsonb_build_object('nome', 'Bloqueados', 'valor', d->'alunos_bloqueados'))),
      'notas', jsonb_build_object('titulo', 'Notas das aulas', 'tipo', 'colunas', 'itens',
         (SELECT jsonb_agg(jsonb_build_object('nome', o || ' ★', 'valor', (v)::numeric) ORDER BY o)
            FROM jsonb_array_elements_text(coalesce(d->'avaliacoes_por_nota', '[]'::jsonb)) WITH ORDINALITY z(v, o))),
      'contrato', jsonb_build_object('titulo', 'Acesso por contrato', 'tipo', 'agrupado', 'series', jsonb_build_array('Já acessaram', 'Ainda não'), 'itens',
         (SELECT jsonb_agg(jsonb_build_object('nome', regexp_replace(c->>'nome', '^\s*\d+\s*-\s*', ''), 'a', (c->>'ativos')::numeric,
                                              'b', (c->>'alunos')::numeric - (c->>'ativos')::numeric, 'valor', (c->>'alunos')::numeric,
                                              'rotulo', round((c->>'ativos')::numeric * 100 / nullif((c->>'alunos')::numeric, 0)) || '%') ORDER BY o)
            FROM jsonb_array_elements(coalesce(d->'por_contrato', '[]'::jsonb)) WITH ORDINALITY z(c, o) WHERE o <= 8))));
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_treinamentos() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tvg_espelho_fonte_extra(p_fonte text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF p_fonte = 'vagas' THEN RETURN public.tvg_espelho_vagas(); END IF;
  IF p_fonte = 'chamados' THEN RETURN public.tvg_espelho_chamados(); END IF;
  IF p_fonte = 'treinamentos' THEN RETURN public.tvg_espelho_treinamentos(); END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_fonte_extra(text) FROM PUBLIC, anon, authenticated;

-- O resultado do espelho leva também as séries do gráfico agrupado.
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
    'grafico', g->>'tipo', 'grafico_titulo', g->>'titulo', 'grafico_series', g->'series', 'destaque', i.espelho_destaque);
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_resultado(text) FROM PUBLIC, anon, authenticated;

-- ── Cadastro: os 10 cartões da tela, na ordem; gráficos Situação · Acesso por contrato · Notas ─
UPDATE public."TVG_INDICADOR" SET na_tv = false WHERE painel = 'ger-treinamento' AND espelho_fonte IS NULL;
UPDATE public."TVG_PAINEL" SET espelho_fonte = 'treinamentos', espelho_series = ARRAY['acessos', 'conclusoes'] WHERE slug = 'ger-treinamento';

INSERT INTO public."TVG_INDICADOR"
  (codigo, painel, ordem, nome, identificar, fonte, unidade, sentido, meta, alerta, periodicidade, responsavel, na_tv, regra,
   espelho_fonte, espelho_item, espelho_grafico, espelho_destaque)
VALUES
 ('trn_d_alunos', 'ger-treinamento', 1, 'Número de alunos', 'Número de alunos — Dashboard de Treinamentos.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Treinamentos', true,
  'Igual a Treinamentos › Dashboard de Treinamentos (sem filtro de curso nem período): Número de alunos.', 'treinamentos', 'kpi:0', 'situacao', 1),
 ('trn_d_ativos', 'ger-treinamento', 2, 'Já acessaram (ativos)', 'Já acessaram (ativos) — Dashboard de Treinamentos.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Treinamentos', true,
  'Igual a Treinamentos › Dashboard de Treinamentos (sem filtro de curso nem período): Já acessaram (ativos).', 'treinamentos', 'kpi:1', NULL, NULL),
 ('trn_d_inativos', 'ger-treinamento', 3, 'Nunca acessaram (inativos)', 'Nunca acessaram (inativos) — Dashboard de Treinamentos.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'Treinamentos', true,
  'Igual a Treinamentos › Dashboard de Treinamentos (sem filtro de curso nem período): Nunca acessaram (inativos).', 'treinamentos', 'kpi:2', NULL, NULL),
 ('trn_d_recentes', 'ger-treinamento', 4, 'Acessaram recentemente', 'Acessaram recentemente — Dashboard de Treinamentos.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Treinamentos', true,
  'Igual a Treinamentos › Dashboard de Treinamentos (sem filtro de curso nem período): Acessaram recentemente.', 'treinamentos', 'kpi:3', NULL, NULL),
 ('trn_d_demitidos', 'ger-treinamento', 5, 'Demitidos', 'Demitidos — Dashboard de Treinamentos.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'Treinamentos', true,
  'Igual a Treinamentos › Dashboard de Treinamentos (sem filtro de curso nem período): Demitidos.', 'treinamentos', 'kpi:4', NULL, NULL),
 ('trn_d_aulas', 'ger-treinamento', 6, 'Aulas concluídas', 'Aulas concluídas — Dashboard de Treinamentos.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Treinamentos', true,
  'Igual a Treinamentos › Dashboard de Treinamentos (sem filtro de curso nem período): Aulas concluídas.', 'treinamentos', 'kpi:5', 'contrato', 2),
 ('trn_d_avaliacao', 'ger-treinamento', 7, 'Avaliação das aulas', 'Avaliação das aulas — Dashboard de Treinamentos.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Treinamentos', true,
  'Igual a Treinamentos › Dashboard de Treinamentos (sem filtro de curso nem período): Avaliação das aulas.', 'treinamentos', 'kpi:6', 'notas', 3),
 ('trn_d_provas', 'ger-treinamento', 8, 'Provas', 'Provas — Dashboard de Treinamentos.', 'auto', 'pct', 'maior', NULL, NULL, 'diaria', 'Treinamentos', true,
  'Igual a Treinamentos › Dashboard de Treinamentos (sem filtro de curso nem período): Provas.', 'treinamentos', 'kpi:7', NULL, NULL),
 ('trn_d_comentarios', 'ger-treinamento', 9, 'Comentários nas aulas', 'Comentários nas aulas — Dashboard de Treinamentos.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Treinamentos', true,
  'Igual a Treinamentos › Dashboard de Treinamentos (sem filtro de curso nem período): Comentários nas aulas.', 'treinamentos', 'kpi:8', NULL, NULL),
 ('trn_d_certificados', 'ger-treinamento', 10, 'Certificados emitidos', 'Certificados emitidos — Dashboard de Treinamentos.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Treinamentos', true,
  'Igual a Treinamentos › Dashboard de Treinamentos (sem filtro de curso nem período): Certificados emitidos.', 'treinamentos', 'kpi:9', NULL, NULL)
ON CONFLICT (codigo) DO UPDATE SET
  ordem = EXCLUDED.ordem, nome = EXCLUDED.nome, unidade = EXCLUDED.unidade, sentido = EXCLUDED.sentido, na_tv = true, regra = EXCLUDED.regra,
  espelho_fonte = EXCLUDED.espelho_fonte, espelho_item = EXCLUDED.espelho_item, espelho_grafico = EXCLUDED.espelho_grafico, espelho_destaque = EXCLUDED.espelho_destaque;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DELETE FROM public."TVG_INDICADOR" WHERE espelho_fonte = 'treinamentos';
-- UPDATE public."TVG_PAINEL" SET espelho_fonte = NULL, espelho_series = NULL WHERE slug = 'ger-treinamento';
-- UPDATE public."TVG_INDICADOR" SET na_tv = true WHERE codigo IN ('trn_contratuais', 'trn_integracoes', 'trn_programados', 'trn_sem_comprovacao', 'trn_vencidos');
-- DROP FUNCTION public.tvg_espelho_treinamentos(); tvg_espelho_fonte_extra / tvg_espelho_resultado: reaplicar as da 20261014000032 / 20261014000030.
