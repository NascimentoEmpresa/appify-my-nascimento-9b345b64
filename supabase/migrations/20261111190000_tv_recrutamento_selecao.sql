-- =========================================================================
-- TV › RECRUTAMENTO E SELEÇÃO (11/11/2026)
--
-- Pablo, com o modelo "TV Recrutamento e Seleção — Onde precisamos agir para
-- garantir o preenchimento dos postos?": "a tela do recrutamento desenvolve
-- assim, mas animada e vai trocando os contratos com o tempo, e já troca ela
-- pra mim também pra essa nova playlist".
--
-- Relatório de TV novo, 'rec-painel' (src/pages/tv/relatorio/paginasRecPainel.tsx).
-- Os 5 indicadores do modelo, com as MESMAS contas e janelas dos cards da TV
-- gerencial de Recrutamento (tvg_calc, mig 20261019000005):
--   1. Vagas com risco de posto descoberto — urgência Alta, aberta há mais de 15 dias;
--   2. Vagas abertas por contrato e cidade — SISTEMA_RECRUTAMENTO não
--      concluída/reprovada/contratada, somando quantidade_vagas; "em
--      preenchimento" = já passou da aprovação (não está em Pendente Analista);
--   3. Vagas acima do prazo — abertas há mais de 15 dias, por contrato;
--   4. Admissões previstas x concluídas — início previsto no mês até hoje;
--   5. Desistências antes da admissão — histórico das vagas, últimos 30 dias,
--      com o MOTIVO agrupado (o motivo é texto livre no currículo: as palavras
--      viram grupos — distância/transporte, salário, horário, outra vaga, sem
--      retorno, requisito da vaga, demora do processo; o resto é "Outros").
-- A TV vai trocando os contratos (a lista inteira, em blocos) a cada 10 s.
--
-- PRIVACIDADE: nada de nome de candidato; só contrato, cidade e número.
-- A TV RH (a que passava Vagas e a Gestão Recrutamento) passa a tocar a
-- playlist nova; a antiga fica guardada. Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Relatório novo no item ────────────────────────────────────────────
ALTER TABLE public."TV_ITEM" DROP CONSTRAINT IF EXISTS tv_item_relatorio_check;
ALTER TABLE public."TV_ITEM" ADD CONSTRAINT tv_item_relatorio_check CHECK (
  tipo <> 'relatorio' OR (
    (relatorio = ANY (ARRAY['geral', 'recrutamento', 'demissoes', 'materiais', 'ferias', 'medida-disciplinar', 'chamados',
                            'orientacoes', 'mudanca-funcao', 'colaboradores', 'turnover', 'vagas', 'licitacoes', 'treinamentos',
                            'ger-operacional', 'ger-licitacoes', 'ger-supply', 'ger-frota', 'ger-recrutamento', 'ger-rh', 'ger-sst',
                            'ger-treinamento', 'ger-financeiro', 'ger-juridico', 'ger-controladoria', 'ger-ti', 'ger-presidencia',
                            'ope-contratos', 'sup-painel', 'rec-painel'])
     OR relatorio ~ '^ind:[a-z0-9_]+$'
     OR relatorio ~ '^bi:[0-9]+$')
    AND COALESCE(rel_periodo, '12m') = ANY (ARRAY['mes', '3m', '6m', '12m', 'ano'])));

-- ── 2) Os dados da TV ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tv_recrutamento_dados()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  d_prazo int := 15;   -- prazo de preenchimento (o mesmo dos cards)
  d_desist int := 30;  -- janela das desistências
  v_vagas jsonb; v_adm jsonb; v_desist jsonb;
BEGIN
  WITH a AS (
    SELECT coalesce(nullif(btrim(s.contrato), ''), 'Sem contrato') AS contrato,
           coalesce(nullif(btrim(s.cidade), ''), '—') AS cidade,
           greatest(coalesce(s.quantidade_vagas, 1), 1) AS q, s.status, coalesce(s.grau_urgencia, '') AS urg,
           hoje - (s.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dias
      FROM public."SISTEMA_RECRUTAMENTO" s
     WHERE s.status NOT IN ('Concluído', 'Reprovada', 'Contratado')),
  g AS (SELECT contrato, cidade, sum(q) AS solicitadas, sum(q) FILTER (WHERE status <> 'Pendente Analista') AS preenchimento,
               sum(q) FILTER (WHERE dias > d_prazo) AS atrasadas, sum(q) FILTER (WHERE urg ILIKE 'Alta%' AND dias > d_prazo) AS risco,
               max(dias) AS mais_antiga
          FROM a GROUP BY 1, 2)
  SELECT jsonb_build_object(
    'prazo_dias', d_prazo,
    'abertas', (SELECT coalesce(sum(q), 0) FROM a),
    'contratos', (SELECT count(DISTINCT contrato) FROM a),
    'cidades', (SELECT count(DISTINCT cidade) FROM a),
    'em_preenchimento', (SELECT coalesce(sum(q) FILTER (WHERE status <> 'Pendente Analista'), 0) FROM a),
    'acima_prazo', (SELECT coalesce(sum(q) FILTER (WHERE dias > d_prazo), 0) FROM a),
    'risco', (SELECT coalesce(sum(q) FILTER (WHERE urg ILIKE 'Alta%' AND dias > d_prazo), 0) FROM a),
    'por_status', coalesce((SELECT jsonb_agg(jsonb_build_object('status', status, 'qtd', n) ORDER BY n DESC)
                              FROM (SELECT status, sum(q) n FROM a GROUP BY 1) t), '[]'::jsonb),
    -- Todos os contratos·cidade, do que tem mais vaga para o que tem menos (a TV gira em blocos).
    'por_contrato', coalesce((SELECT jsonb_agg(jsonb_build_object('contrato', contrato, 'cidade', cidade, 'solicitadas', solicitadas,
                                'preenchimento', coalesce(preenchimento, 0), 'atrasadas', coalesce(atrasadas, 0), 'risco', coalesce(risco, 0),
                                'mais_antiga', mais_antiga) ORDER BY solicitadas DESC, atrasadas DESC NULLS LAST, contrato)
                                FROM g), '[]'::jsonb)
  ) INTO v_vagas;

  WITH a AS (
    SELECT coalesce(nullif(btrim(s.contrato), ''), 'Sem contrato') AS contrato, greatest(coalesce(s.quantidade_vagas, 1), 1) AS q,
           s.status IN ('Contratado', 'Concluído') AS ok
      FROM public."SISTEMA_RECRUTAMENTO" s
     WHERE s.status <> 'Reprovada' AND s.data_inicio_prevista ~ '^\d{4}-\d{2}-\d{2}'
       AND left(s.data_inicio_prevista, 10)::date BETWEEN date_trunc('month', hoje)::date AND hoje)
  SELECT jsonb_build_object(
    'previstas', (SELECT coalesce(sum(q), 0) FROM a),
    'concluidas', (SELECT coalesce(sum(q) FILTER (WHERE ok), 0) FROM a),
    'pendentes_por_contrato', coalesce((SELECT jsonb_agg(jsonb_build_object('contrato', contrato, 'qtd', n) ORDER BY n DESC)
                                          FROM (SELECT contrato, sum(q) FILTER (WHERE NOT ok) n FROM a GROUP BY 1
                                                HAVING sum(q) FILTER (WHERE NOT ok) > 0 ORDER BY 2 DESC LIMIT 10) t), '[]'::jsonb)
  ) INTO v_adm;

  WITH d AS (
    SELECT lower(translate(coalesce((SELECT c.desistencia_motivo FROM public."WA_CURRICULOS" c WHERE c.id = h.candidato_id), ''),
                           'ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç', 'AAAAEEIOOOUCaaaaeeiooouc')) AS m
      FROM public."RECRUTAMENTO_HISTORICO" h
     WHERE h.evento ILIKE '%desist%' AND h.created_at >= now() - make_interval(days => d_desist)),
  c AS (SELECT CASE
          WHEN m ~ '(longe|onibus|transporte|\mvt\M|passagem|distancia|mudar|cidade|deslocamento)' THEN 'Distância e transporte'
          WHEN m ~ '(salari|seguro desemprego|beneficio|valor)' THEN 'Salário e benefícios'
          WHEN m ~ '(horario|\m8h|turno|escala|filho)' THEN 'Horário'
          WHEN m ~ '(outra vaga|outro emprego|outra proposta|outra empresa|outra oportunidade|empregad|chamad[ao] em outr|aprovad[ao] em outr|continuar na empresa)' THEN 'Outra vaga ou emprego'
          WHEN m ~ '(sem retorno|falta de retorno|nao nos deu retorno|nao respondeu|nao compareceu|nao foi)' THEN 'Sem retorno'
          WHEN m ~ '(experiencia|ensino medio|documento|exercito|nao aprovad|vaga errada|colaborador errado)' THEN 'Requisito da vaga'
          WHEN m ~ '(demora|exame|aso)' THEN 'Demora do processo'
          ELSE 'Outros' END AS grupo
          FROM d)
  SELECT jsonb_build_object(
    'dias', d_desist,
    'total', (SELECT count(*) FROM c),
    'por_motivo', coalesce((SELECT jsonb_agg(jsonb_build_object('motivo', grupo, 'qtd', n) ORDER BY (grupo = 'Outros'), n DESC)
                              FROM (SELECT grupo, count(*) n FROM c GROUP BY 1) t), '[]'::jsonb)
  ) INTO v_desist;

  RETURN jsonb_build_object('vagas', v_vagas, 'admissoes', v_adm, 'desistencias', v_desist, 'gerado_em', now());
END $fn$;
REVOKE ALL ON FUNCTION public.tv_recrutamento_dados() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tv_recrutamento_previa()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'visualizar') OR public.has_screen_access(auth.uid(), 'sistemas_tvs', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem acesso às TVs.' USING ERRCODE = '42501';
  END IF;
  RETURN public.tv_recrutamento_dados();
END $fn$;
REVOKE ALL ON FUNCTION public.tv_recrutamento_previa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tv_recrutamento_previa() TO authenticated;

-- ── 3) tv_relatorio com o relatório novo ─────────────────────────────────
-- Mesmo corpo da mig 20261111180000, com o ramo 'rec-painel'.
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

-- ── 4) A playlist e a TV RH tocando ela ──────────────────────────────────
DO $$
DECLARE v_pl uuid;
BEGIN
  SELECT id INTO v_pl FROM public."TV_PLAYLIST" WHERE nome = 'Recrutamento e Seleção' LIMIT 1;
  IF v_pl IS NULL THEN
    INSERT INTO public."TV_PLAYLIST" (nome, descricao)
    VALUES ('Recrutamento e Seleção',
            'Onde precisamos agir para garantir o preenchimento dos postos: risco de posto descoberto, vagas por contrato e cidade, prazo, admissões e desistências.')
    RETURNING id INTO v_pl;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."TV_ITEM" WHERE playlist_id = v_pl AND relatorio = 'rec-painel') THEN
    -- Um item só: os contratos giram dentro dele, 10 s cada bloco (paginasRecPainel.tsx).
    INSERT INTO public."TV_ITEM" (playlist_id, ordem, tipo, titulo, relatorio, duracao_seg, ativo)
    VALUES (v_pl, 10, 'relatorio', 'Recrutamento e Seleção', 'rec-painel', 3600, true);
  END IF;
  UPDATE public."TV_DISPOSITIVO" SET playlist_id = v_pl
   WHERE ativo AND (id = 'b7750fbd-5fc9-4349-a0e4-629e22c4efd7'::uuid OR upper(btrim(coalesce(nome, ''))) = 'TV RH');
END $$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- UPDATE public."TV_DISPOSITIVO" SET playlist_id = (SELECT id FROM public."TV_PLAYLIST" WHERE nome = 'TV RH' LIMIT 1)
--  WHERE id = 'b7750fbd-5fc9-4349-a0e4-629e22c4efd7'::uuid;
-- DELETE FROM public."TV_PLAYLIST" WHERE nome = 'Recrutamento e Seleção';
-- (reexecutar o CREATE de tv_relatorio e o tv_item_relatorio_check da mig 20261111180000)
-- DROP FUNCTION IF EXISTS public.tv_recrutamento_previa();
-- DROP FUNCTION IF EXISTS public.tv_recrutamento_dados();
-- NOTIFY pgrst, 'reload schema';
