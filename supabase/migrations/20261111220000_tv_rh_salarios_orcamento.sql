-- =========================================================================
-- TV › RH — SALÁRIOS E BENEFÍCIOS × ORÇAMENTO, NA PLAYLIST DO RECRUTAMENTO
-- (11/11/2026)
--
-- Pablo, com a tabela do RH (ativos × necessários, salários e benefícios
-- acima do orçamento, turnover, absenteísmo, obrigações): "aqui do RH só
-- colocar um gráfico do salário e benefícios acima do orçamento. A TV do RH e
-- do Recrutamento são as mesmas, então funde essa tela nova do RH com a
-- playlist do Recrutamento, deixa as duas passando de tempo em tempo."
--
-- 1. Relatório de TV novo, 'rh-salarios' (paginasRhSalarios.tsx): por
--    contrato, o REALIZADO contra o ORÇADO da Planilha de Custo executada
--    vigente (a mesma régua de Indicadores por Contrato), só nas linhas que
--    têm as duas pontas medidas:
--      · salário-base: folha da Senior (Valor Salário dos ativos, ligados ao
--        contrato como na TV gerencial — rh_norm_contrato × dir_rel_contrato_nn)
--        × qt_postos × salário da Planilha;
--      · benefícios com rateio: Vale Transporte, Benefício Assistencial (BSF)
--        e Seguro — o último rateio de cada tipo em RH › Rateio de Despesas ×
--        transporte, beneficio_familiar e seguro_vida da Planilha.
--    VA/VR e os demais benefícios não têm lançamento por contrato no ERP e
--    ficam de fora (a TV diz isso), para não comparar orçado com nada.
--    O card "Salários e benefícios" da TV gerencial continua como era
--    (folha ÷ faturamento, 'parcial').
-- 2. A playlist "Recrutamento e Seleção" (a da TV RH) passa a girar três
--    itens: o painel de Recrutamento (90 s, continua do bloco de contratos em
--    que parou), a TV gerencial RH (45 s) e o gráfico novo (30 s).
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Relatório novo no item ────────────────────────────────────────────
ALTER TABLE public."TV_ITEM" DROP CONSTRAINT IF EXISTS tv_item_relatorio_check;
ALTER TABLE public."TV_ITEM" ADD CONSTRAINT tv_item_relatorio_check CHECK (
  tipo <> 'relatorio' OR (
    (relatorio = ANY (ARRAY['geral', 'recrutamento', 'demissoes', 'materiais', 'ferias', 'medida-disciplinar', 'chamados',
                            'orientacoes', 'mudanca-funcao', 'colaboradores', 'turnover', 'vagas', 'licitacoes', 'treinamentos',
                            'ger-operacional', 'ger-licitacoes', 'ger-supply', 'ger-frota', 'ger-recrutamento', 'ger-rh', 'ger-sst',
                            'ger-treinamento', 'ger-financeiro', 'ger-juridico', 'ger-controladoria', 'ger-ti', 'ger-presidencia',
                            'ope-contratos', 'sup-painel', 'rec-painel', 'rh-salarios'])
     OR relatorio ~ '^ind:[a-z0-9_]+$'
     OR relatorio ~ '^bi:[0-9]+$')
    AND COALESCE(rel_periodo, '12m') = ANY (ARRAY['mes', '3m', '6m', '12m', 'ano'])));

-- ── 2) Os dados ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tv_rh_salarios_dados()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_out jsonb;
BEGIN
  WITH ctr AS (
    SELECT c.id, c.nome, public.dir_rel_contrato_nn(c.id) AS nn
      FROM public.contratos c WHERE coalesce(c.status, 'ativo') <> 'encerrado'),
  -- Planilha EXECUTADA vigente hoje, um posto por nome (a régua do previsto).
  pc AS (
    SELECT DISTINCT ON (p.contrato_id, public.sup_norm_nome(p.posto))
           p.contrato_id, coalesce(p.qt_postos, 0) AS qt, coalesce(p.salario, 0) AS sal,
           coalesce(p.transporte, 0) AS vt, coalesce(p.beneficio_familiar, 0) AS bsf, coalesce(p.seguro_vida, 0) AS seg
      FROM public.planilha_custo p
     WHERE p.contrato_id IS NOT NULL AND p.orexec = 'EXECUTADO' AND NOT coalesce(p.encerrado, false)
       AND p.data_vigencia IS NOT NULL AND p.data_vigencia <= hoje AND coalesce(btrim(p.posto), '') <> ''
     ORDER BY p.contrato_id, public.sup_norm_nome(p.posto), p.data_vigencia DESC),
  orc AS (
    SELECT contrato_id, sum(qt * sal) AS sal, sum(qt * vt) AS vt, sum(qt * bsf) AS bsf, sum(qt * seg) AS seg
      FROM pc GROUP BY 1),
  folha AS (
    SELECT public.rh_norm_contrato(e."Nome Filial") AS nn, sum(public.tvg_num_br(e."Valor Salário"::text)) AS sal, count(*) AS pessoas
      FROM public."EMPREGADOS" e
     WHERE e."Situação" <> 'Demitido' AND e."Nome Filial" IS NOT NULL
     GROUP BY 1),
  -- O último rateio de cada tipo (conferido ou não: é o que o RH lançou).
  ult AS (
    SELECT DISTINCT ON (d.tipo) d.id, d.tipo, d.competencia
      FROM public."RH_RATEIO_DESPESA" d
     WHERE d.tipo IN ('vale_transporte', 'bsf', 'seguro')
     ORDER BY d.tipo, d.competencia DESC, d.updated_at DESC),
  ben AS (
    SELECT i.contrato_id,
           sum(i.valor) FILTER (WHERE u.tipo = 'vale_transporte') AS vt,
           sum(i.valor) FILTER (WHERE u.tipo = 'bsf') AS bsf,
           sum(i.valor) FILTER (WHERE u.tipo = 'seguro') AS seg
      FROM ult u JOIN public."RH_RATEIO_ITEM" i ON i.despesa_id = u.id
     WHERE i.contrato_id IS NOT NULL
     GROUP BY 1),
  linha AS (
    SELECT c.id, c.nome, f.pessoas,
           round(coalesce(o.sal, 0), 2) AS orc_sal, round(coalesce(f.sal, 0), 2) AS real_sal,
           -- Benefício só entra onde há rateio do tipo NO contrato e orçado dele.
           round(coalesce(CASE WHEN b.vt > 0 THEN o.vt END, 0) + coalesce(CASE WHEN b.bsf > 0 THEN o.bsf END, 0) + coalesce(CASE WHEN b.seg > 0 THEN o.seg END, 0), 2) AS orc_ben,
           round(coalesce(CASE WHEN o.vt > 0 THEN b.vt END, 0) + coalesce(CASE WHEN o.bsf > 0 THEN b.bsf END, 0) + coalesce(CASE WHEN o.seg > 0 THEN b.seg END, 0), 2) AS real_ben
      FROM ctr c
      JOIN orc o ON o.contrato_id = c.id
      LEFT JOIN folha f ON f.nn = c.nn
      LEFT JOIN ben b ON b.contrato_id = c.id
     WHERE coalesce(o.sal, 0) > 0 AND coalesce(f.sal, 0) > 0)
  SELECT jsonb_build_object(
    'competencias', coalesce((SELECT jsonb_object_agg(tipo, to_char(competencia, 'YYYY-MM')) FROM ult), '{}'::jsonb),
    'orcado', (SELECT round(sum(orc_sal + orc_ben), 2) FROM linha),
    'realizado', (SELECT round(sum(real_sal + real_ben), 2) FROM linha),
    'contratos', coalesce((SELECT jsonb_agg(jsonb_build_object(
                    'contrato', nome, 'pessoas', pessoas, 'orc_sal', orc_sal, 'real_sal', real_sal, 'orc_ben', orc_ben, 'real_ben', real_ben,
                    'desvio', round(100 * ((real_sal + real_ben) - (orc_sal + orc_ben)) / (orc_sal + orc_ben), 1))
                   ORDER BY ((real_sal + real_ben) - (orc_sal + orc_ben)) / (orc_sal + orc_ben) DESC)
                   FROM linha), '[]'::jsonb),
    'gerado_em', now()
  ) INTO v_out;
  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.tv_rh_salarios_dados() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tv_rh_salarios_previa()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'visualizar') OR public.has_screen_access(auth.uid(), 'sistemas_tvs', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem acesso às TVs.' USING ERRCODE = '42501';
  END IF;
  RETURN public.tv_rh_salarios_dados();
END $fn$;
REVOKE ALL ON FUNCTION public.tv_rh_salarios_previa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tv_rh_salarios_previa() TO authenticated;

-- ── 3) tv_relatorio com o relatório novo ─────────────────────────────────
-- Mesmo corpo da mig 20261111190000, com o ramo 'rh-salarios'.
CREATE OR REPLACE FUNCTION public.tv_relatorio(p_token text, p_item uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  d public."TV_DISPOSITIVO"; i public."TV_ITEM"; v_de date; v_ate date; v_out jsonb; s text;
  v_ano int; v_meses int[]; v_filial text;
BEGIN
  SELECT * INTO d FROM public."TV_DISPOSITIVO"
   WHERE token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') AND pareado_em IS NOT NULL AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'TV não autorizada.'; END IF;
  SELECT * INTO i FROM public."TV_ITEM" WHERE id = p_item AND playlist_id = d.playlist_id AND ativo AND tipo = 'relatorio';
  IF NOT FOUND THEN RAISE EXCEPTION 'Relatório não está na playlist desta TV.'; END IF;

  SELECT p.de, p.ate INTO v_de, v_ate FROM public.tv_rel_periodo(i.rel_periodo) p;

  IF i.relatorio LIKE 'ger-%' THEN
    v_out := jsonb_build_object('tipo', 'gerencial') || public.tvg_painel_dados(i.relatorio)
             || jsonb_build_object('equipe', public.tvg_equipe_meta(i.relatorio));
  ELSIF i.relatorio LIKE 'ind:%' THEN
    v_out := jsonb_build_object('tipo', 'indicador') || coalesce(public.tvg_indicador_dados(substr(i.relatorio, 5)), '{}'::jsonb);
  ELSIF i.relatorio LIKE 'bi:%' THEN
    v_out := jsonb_build_object('tipo', 'bi') || public.tv_bi_dados(substr(i.relatorio, 4)::bigint);
  ELSIF i.relatorio = 'ope-contratos' THEN
    v_out := jsonb_build_object('tipo', 'ope-contratos') || public.tv_ope_contratos_dados();
  ELSIF i.relatorio = 'sup-painel' THEN
    v_out := jsonb_build_object('tipo', 'sup-painel') || public.tv_supply_dados();
  ELSIF i.relatorio = 'rec-painel' THEN
    v_out := jsonb_build_object('tipo', 'rec-painel') || public.tv_recrutamento_dados();
  ELSIF i.relatorio = 'rh-salarios' THEN
    v_out := jsonb_build_object('tipo', 'rh-salarios') || public.tv_rh_salarios_dados();
  ELSIF i.relatorio = 'geral' THEN
    v_out := jsonb_build_object('tipo', 'geral', 'periodo', jsonb_build_object('de', v_de, 'ate', v_ate), 'sistemas', '[]'::jsonb);
    FOREACH s IN ARRAY ARRAY['recrutamento', 'demissoes', 'materiais', 'ferias', 'medida-disciplinar', 'mudanca-funcao', 'chamados', 'orientacoes'] LOOP
      v_out := jsonb_set(v_out, '{sistemas}', (v_out->'sistemas') || jsonb_build_array(
        (SELECT jsonb_build_object('slug', s, 'titulo', r->>'titulo', 'kpis', r->'kpis', 'rotulo_item', r->>'rotulo_item',
                                   'mensal', r->'mensal')
           FROM (SELECT public.dir_rel_dados(s, v_de, v_ate, i.rel_contrato, NULL) r) x)));
    END LOOP;
  ELSIF i.relatorio = 'vagas' THEN
    v_out := jsonb_build_object('tipo', 'vagas', 'periodo', jsonb_build_object('de', v_de, 'ate', v_ate),
                                'painel', public.dir_vagas_painel_dados(v_de, v_ate, i.rel_contrato, NULL));
  ELSIF i.relatorio = 'turnover' THEN
    v_ano := extract(year FROM v_ate)::int;
    v_meses := ARRAY(SELECT m FROM generate_series(1, 12) m
                      WHERE make_date(v_ano, m, 1) BETWEEN date_trunc('month', v_de)::date AND v_ate);
    v_filial := public.dir_turnover_filial(i.rel_contrato);
    v_out := jsonb_build_object('tipo', 'turnover', 'filial', v_filial,
                                'painel', public.dir_turnover_painel_dados(v_ano, NULL, v_filial, NULL, v_meses));
  ELSIF i.relatorio = 'licitacoes' THEN
    v_out := jsonb_build_object('tipo', 'licitacoes') || public.tv_licitacao_dados();
  ELSIF i.relatorio = 'treinamentos' THEN
    v_out := jsonb_build_object('tipo', 'treinamentos', 'painel', public.trn_dashboard_dados(NULL, NULL, NULL));
  ELSE
    v_out := jsonb_build_object('tipo', 'sistema', 'slug', i.relatorio) || public.dir_rel_dados(i.relatorio, v_de, v_ate, i.rel_contrato, NULL);
  END IF;

  RETURN v_out || jsonb_build_object('contrato', (SELECT c.nome FROM public.contratos c WHERE c.id = i.rel_contrato), 'gerado_em', now());
END $function$;
REVOKE ALL ON FUNCTION public.tv_relatorio(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tv_relatorio(text,uuid) TO anon,authenticated,service_role;

-- ── 4) A playlist do Recrutamento gira as três telas ─────────────────────
DO $$
DECLARE v_pl uuid;
BEGIN
  SELECT id INTO v_pl FROM public."TV_PLAYLIST" WHERE nome = 'Recrutamento e Seleção' LIMIT 1;
  IF v_pl IS NULL THEN RETURN; END IF;   -- a mig 20261111190000 cria a playlist
  UPDATE public."TV_ITEM" SET duracao_seg = 90, ordem = 10 WHERE playlist_id = v_pl AND relatorio = 'rec-painel';
  IF NOT EXISTS (SELECT 1 FROM public."TV_ITEM" WHERE playlist_id = v_pl AND relatorio = 'ger-rh') THEN
    INSERT INTO public."TV_ITEM" (playlist_id, ordem, tipo, titulo, relatorio, duracao_seg, ativo)
    VALUES (v_pl, 20, 'relatorio', 'Recursos Humanos', 'ger-rh', 45, true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."TV_ITEM" WHERE playlist_id = v_pl AND relatorio = 'rh-salarios') THEN
    INSERT INTO public."TV_ITEM" (playlist_id, ordem, tipo, titulo, relatorio, duracao_seg, ativo)
    VALUES (v_pl, 30, 'relatorio', 'Salários e benefícios × orçamento', 'rh-salarios', 30, true);
  END IF;
  UPDATE public."TV_PLAYLIST" SET nome = 'Recrutamento e Seleção', descricao = 'TV RH: Recrutamento e Seleção, painel do RH e salários e benefícios × orçamento, se revezando.'
   WHERE id = v_pl;
END $$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DELETE FROM public."TV_ITEM" WHERE relatorio IN ('ger-rh', 'rh-salarios')
--   AND playlist_id = (SELECT id FROM public."TV_PLAYLIST" WHERE nome = 'Recrutamento e Seleção');
-- UPDATE public."TV_ITEM" SET duracao_seg = 3600 WHERE relatorio = 'rec-painel';
-- (reexecutar o CREATE de tv_relatorio e o tv_item_relatorio_check da mig 20261111190000)
-- DROP FUNCTION IF EXISTS public.tv_rh_salarios_previa();
-- DROP FUNCTION IF EXISTS public.tv_rh_salarios_dados();
-- NOTIFY pgrst, 'reload schema';
