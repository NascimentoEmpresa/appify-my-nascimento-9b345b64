-- =========================================================================
-- SIS-2026-0816 — TV do SST: painel gerencial automático (parte 2 de 2)
--
-- CHAMADO: a TV do setor de SST deve mostrar, sozinha, a partir do ERP:
--   1. Treinamentos obrigatórios de NRs — quantidade, realizados, pendentes,
--      vencidos e próximos do vencimento; obrigatório por contrato × feito
--      dos cursos online; e o que estava na planilha do setor (matriz e
--      cronograma, importados em SST › Treinamentos Obrigatórios (NR));
--   2. ASOs — total realizado, pendentes, acompanhamento mensal e por tipo;
--      periódicos realizados, pendentes e próximos do vencimento;
--   3. Afastamentos e atestados — total afastado, auxílio-doença,
--      licença-maternidade, retornos previstos; atestados e dias de
--      afastamento por atestado; comparativo mensal;
--   4. Acidentes de trabalho — total, típicos, de trajeto, indicador mensal
--      e acumulado do ano.
--
-- Relatório de TV novo, 'sst-painel' (src/pages/tv/relatorio/paginasSstPainel.tsx),
-- os 4 blocos girando dentro do item. As contas moram aqui
-- (tv_sst_painel_dados) e reaproveitam as régua de cada tela:
--   · periódicos: sst_aso_per_base + sst_aso_per_status + afastados — a MESMA
--     conta da tela ASO Periódico (afastado fora das pendências);
--   · ASOs realizados: as fontes de sst_aso_per_ultimos + o demissional,
--     sem contar duas vezes o mesmo exame (tipo + dia + CPF);
--   · treinamentos online: sst_trn_online_dados (mig 20261121100000).
--
-- PRIVACIDADE: TV fica em sala — nenhum nome de colaborador, só contagens,
-- contrato e curso.
--
-- O item entra na playlist "TV SST" (antes do painel gerencial, que fica).
-- Relatório novo na TV entra SÓ em tv_relatorio_item_dados (mig 20261120200000):
-- corpo copiado de lá, com o ramo 'sst-painel'.
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

SET lock_timeout = '5s';

-- ── 1. Relatório novo no item ────────────────────────────────────────────
ALTER TABLE public."TV_ITEM" DROP CONSTRAINT IF EXISTS tv_item_relatorio_check;
ALTER TABLE public."TV_ITEM" ADD CONSTRAINT tv_item_relatorio_check CHECK (
  tipo <> 'relatorio' OR (
    (relatorio = ANY (ARRAY['geral', 'recrutamento', 'demissoes', 'materiais', 'ferias', 'medida-disciplinar', 'chamados',
                            'orientacoes', 'mudanca-funcao', 'colaboradores', 'turnover', 'vagas', 'licitacoes', 'treinamentos',
                            'ger-operacional', 'ger-licitacoes', 'ger-supply', 'ger-frota', 'ger-recrutamento', 'ger-rh', 'ger-sst',
                            'ger-treinamento', 'ger-financeiro', 'ger-juridico', 'ger-controladoria', 'ger-ti', 'ger-presidencia',
                            'ope-contratos', 'sup-painel', 'rec-painel', 'rh-salarios', 'fin-painel', 'ctl-painel', 'pre-painel',
                            'sst-painel'])
     OR relatorio ~ '^ind:[a-z0-9_]+$'
     OR relatorio ~ '^bi:[0-9]+$')
    AND COALESCE(rel_periodo, '12m') = ANY (ARRAY['mes', '3m', '6m', '12m', 'ano'])));

-- ── 2. ASOs realizados, todas as fontes, sem repetir o mesmo exame ───────
CREATE OR REPLACE FUNCTION public.sst_painel_asos_realizados(p_de date)
RETURNS TABLE (tipo text, data date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT y.tipo, y.data FROM (SELECT DISTINCT x.tipo, x.data, x.chave
    FROM (
      SELECT 'admissional' AS tipo, COALESCE(c.sst_data_exame, c.sst_aso_realizado_em::date) AS data,
             COALESCE(nullif(regexp_replace(COALESCE(c.cpf, c.cpf_cand, ''), '\D', '', 'g'), ''), 'wa' || c.id) AS chave
        FROM public."WA_CURRICULOS" c
       WHERE c.sst_aso_realizado_em IS NOT NULL AND c.sst_ok IS DISTINCT FROM false
      UNION ALL
      SELECT 'demissional', (s.sst_em AT TIME ZONE 'America/Sao_Paulo')::date,
             COALESCE(nullif(regexp_replace(COALESCE(s.colaborador_cpf, ''), '\D', '', 'g'), ''), 'dem' || s.id)
        FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s
       WHERE s.sst_em IS NOT NULL
      UNION ALL
      SELECT 'troca_funcao', t.sst_aso_data,
             COALESCE(nullif(regexp_replace(COALESCE(t.colaborador_cpf, ''), '\D', '', 'g'), ''), 'tro' || t.id)
        FROM public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" t
       WHERE t.sst_aso_data IS NOT NULL AND t.status <> 'Reprovada'
      UNION ALL
      SELECT 'retorno', a.aso_recebido_em, COALESCE(nullif(regexp_replace(COALESCE(a.cpf, ''), '\D', '', 'g'), ''), 'ret' || a.id)
        FROM public."SST_CTRL_AFASTAMENTO" a
       WHERE a.aso_realizado AND a.aso_recebido_em IS NOT NULL
      UNION ALL
      SELECT 'periodico', p.realizado_em, p.cpf
        FROM public."SST_ASO_PERIODICO" p
       WHERE p.realizado AND p.realizado_em IS NOT NULL
      UNION ALL
      SELECT h.tipo, h.data_realizacao, COALESCE(h.cpf, 'his' || h.id)
        FROM public."SST_ASO_HISTORICO" h
       WHERE h.situacao = 'realizado'
    ) x
   WHERE x.data >= p_de AND x.data <= current_date) y
$$;
REVOKE ALL ON FUNCTION public.sst_painel_asos_realizados(date) FROM PUBLIC, anon, authenticated;

-- ── 3. Os dados da TV ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tv_sst_painel_dados()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  hoje     date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  ano_ini  date := date_trunc('year', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
  mes_ini  date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
  m12_ini  date := (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')) - interval '11 months')::date;
  v_aviso  integer := COALESCE((SELECT dias_aviso FROM public.sst_aso_per_cfg()), 60);
  v_trn jsonb; v_aso jsonb; v_afa jsonb; v_aci jsonb;
BEGIN
  -- 1) Treinamentos
  WITH o AS (SELECT o.*, public.sst_trn_status(o.ultimo_treinamento, o.periodicidade_meses, hoje) AS st
               FROM public."SST_TRN_OBRIGATORIO" o WHERE o.ativo),
  tu AS (SELECT * FROM public."SST_TRN_TURMA" WHERE NOT cancelada)
  SELECT jsonb_build_object(
    'nr', jsonb_build_object(
      'total', (SELECT count(*) FROM o),
      'em_dia', (SELECT count(*) FROM o WHERE st = 'em_dia'),
      'proximos', (SELECT count(*) FROM o WHERE st = 'proximo'),
      'vencidos', (SELECT count(*) FROM o WHERE st = 'vencido'),
      'pendentes', (SELECT count(*) FROM o WHERE st = 'pendente'),
      'contratos', (SELECT count(DISTINCT COALESCE(contrato_id::text, upper(btrim(contrato_texto)))) FROM o),
      'por_contrato', COALESCE((SELECT jsonb_agg(jsonb_build_object('contrato', x.contrato, 'total', x.total, 'vencidos', x.vencidos,
                                                                   'pendentes', x.pendentes, 'proximos', x.proximos)
                                                 ORDER BY x.vencidos + x.pendentes DESC, x.proximos DESC, x.contrato)
                                  FROM (SELECT COALESCE(c.nome, o.contrato_texto) AS contrato, count(*) total,
                                               count(*) FILTER (WHERE st = 'vencido') vencidos, count(*) FILTER (WHERE st = 'pendente') pendentes,
                                               count(*) FILTER (WHERE st = 'proximo') proximos
                                          FROM o LEFT JOIN public.contratos c ON c.id = o.contrato_id
                                         GROUP BY 1 HAVING count(*) FILTER (WHERE st IN ('vencido', 'pendente', 'proximo')) > 0
                                         ORDER BY count(*) FILTER (WHERE st IN ('vencido', 'pendente')) DESC LIMIT 8) x), '[]'::jsonb)),
    'online', public.sst_trn_online_dados(),
    'turmas', jsonb_build_object(
      'realizadas_ano', (SELECT count(*) FROM tu WHERE data BETWEEN ano_ini AND hoje),
      'participantes_ano', (SELECT COALESCE(sum(participantes), 0) FROM tu WHERE data BETWEEN ano_ini AND hoje),
      'previstas_30d', (SELECT count(*) FROM tu WHERE data > hoje AND data <= hoje + 30),
      'proxima', (SELECT jsonb_build_object('data', t.data, 'contrato', t.contrato_texto, 'nrs', t.nrs)
                    FROM tu t WHERE t.data > hoje ORDER BY t.data, t.id LIMIT 1),
      'mensal', (SELECT jsonb_agg(jsonb_build_object('mes', to_char(g, 'YYYY-MM'),
                   'turmas', (SELECT count(*) FROM tu WHERE date_trunc('month', tu.data) = g AND tu.data <= hoje),
                   'participantes', (SELECT COALESCE(sum(participantes), 0) FROM tu WHERE date_trunc('month', tu.data) = g AND tu.data <= hoje))
                   ORDER BY g)
                   FROM generate_series(m12_ini, mes_ini, interval '1 month') g)))
    INTO v_trn;

  -- 2) ASOs
  WITH r AS (SELECT * FROM public.sst_painel_asos_realizados(m12_ini)),
  per AS (
    SELECT public.sst_aso_per_status_afastado(
             public.sst_aso_per_status(b.vencimento, b.ultimo_tipo, c.id IS NOT NULL, c.agendado_para, hoje, v_aviso),
             af.motivo IS NOT NULL) AS st
      FROM public.sst_aso_per_base() b
      LEFT JOIN public."SST_ASO_PERIODICO" c ON c.cpf = b.cpf AND NOT c.realizado
      LEFT JOIN public.sst_aso_per_afastados() af ON af.empregado_id = b.empregado_id
  ),
  pend AS (SELECT
    (SELECT count(*) FROM public."VW_RECRUTAMENTO_CANDIDATOS" WHERE etapa_processo IN ('SST + COMPRAS', 'EXAME SST') AND sst_ok IS NULL) AS adm,
    (SELECT count(*) FROM public."SISTEMA_SOLICITACOES_DEMISSAO"
      WHERE status IN ('Pendente SST', 'Solicitação de agendamento de DEMISSIONAL recebida', 'Agendamento concluído')) AS dem,
    (SELECT count(*) FROM public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" WHERE status = 'Pendente SST') AS tro,
    (SELECT count(*) FROM public."SST_CTRL_AFASTAMENTO" WHERE status = 'Aguardando ASO de retorno') AS ret)
  SELECT jsonb_build_object(
    'ano', jsonb_build_object('total', (SELECT count(*) FROM public.sst_painel_asos_realizados(ano_ini)),
                              'por_tipo', COALESCE((SELECT jsonb_object_agg(q.tipo, q.n) FROM (
                                  SELECT tipo, count(*) n FROM public.sst_painel_asos_realizados(ano_ini) GROUP BY 1) q), '{}'::jsonb)),
    'mes', (SELECT count(*) FROM r WHERE data >= mes_ini),
    'mes_anterior', (SELECT count(*) FROM r WHERE data >= (mes_ini - interval '1 month')::date AND data < mes_ini),
    'mensal', (SELECT jsonb_agg(jsonb_build_object('mes', to_char(g, 'YYYY-MM'),
                 'admissional', (SELECT count(*) FROM r WHERE r.tipo = 'admissional' AND date_trunc('month', r.data) = g),
                 'periodico', (SELECT count(*) FROM r WHERE r.tipo = 'periodico' AND date_trunc('month', r.data) = g),
                 'retorno', (SELECT count(*) FROM r WHERE r.tipo = 'retorno' AND date_trunc('month', r.data) = g),
                 'troca_funcao', (SELECT count(*) FROM r WHERE r.tipo = 'troca_funcao' AND date_trunc('month', r.data) = g),
                 'demissional', (SELECT count(*) FROM r WHERE r.tipo = 'demissional' AND date_trunc('month', r.data) = g))
                 ORDER BY g)
                 FROM generate_series(m12_ini, mes_ini, interval '1 month') g),
    'pendentes', (SELECT jsonb_build_object('admissional', adm, 'demissional', dem, 'troca_funcao', tro, 'retorno', ret,
                                            'periodico', (SELECT count(*) FROM per WHERE st IN ('Vencido', 'Aguardando agendamento', 'Sem ASO')))
                    FROM pend),
    'periodicos', jsonb_build_object(
      'realizados_ano', (SELECT count(*) FROM public.sst_painel_asos_realizados(ano_ini) WHERE tipo = 'periodico'),
      'vencidos', (SELECT count(*) FROM per WHERE st IN ('Vencido', 'Sem ASO')),
      'proximos', (SELECT count(*) FROM per WHERE st = 'Próximo do vencimento'),
      'aguardando', (SELECT count(*) FROM per WHERE st = 'Aguardando agendamento'),
      'agendados', (SELECT count(*) FROM per WHERE st = 'Agendado'),
      'em_dia', (SELECT count(*) FROM per WHERE st IN ('Em dia', 'Realizado/recebido')),
      'afastados', (SELECT count(*) FROM per WHERE st = 'Afastado'),
      'dias_aviso', v_aviso))
    INTO v_aso;

  -- 3) Afastamentos (Controle de Afastamentos) e atestados (Afastamentos e Telemedicina)
  WITH a AS (SELECT * FROM public."SST_CTRL_AFASTAMENTO" WHERE status NOT IN ('Retornado', 'Afastamento encerrado')),
  t AS (SELECT data_inicio, COALESCE(dias_considerados, 0) AS dias FROM public."SST_AFASTAMENTO"
         WHERE NOT cancelado AND tipo IN ('atestado', 'atestado_acompanhante') AND data_inicio >= LEAST(m12_ini, ano_ini) AND data_inicio <= hoje)
  SELECT jsonb_build_object(
    'ativos', (SELECT count(*) FROM a),
    'auxilio_doenca', (SELECT count(*) FROM a WHERE status = 'Auxílio-doença' OR motivo = 'Auxílio-doença'),
    'licenca_maternidade', (SELECT count(*) FROM a WHERE status = 'Licença-maternidade' OR motivo = 'Licença-maternidade'),
    'acidente_trabalho', (SELECT count(*) FROM a WHERE motivo = 'Acidente de trabalho'),
    'retornos_30d', (SELECT count(*) FROM a WHERE COALESCE(data_prevista_retorno, retorno_informado_em) BETWEEN hoje AND hoje + 30),
    'retorno_atrasado', (SELECT count(*) FROM a WHERE COALESCE(data_prevista_retorno, retorno_informado_em) < hoje),
    'por_motivo', COALESCE((SELECT jsonb_agg(jsonb_build_object('motivo', motivo, 'qtd', n) ORDER BY n DESC)
                              FROM (SELECT motivo, count(*) n FROM a GROUP BY 1) q), '[]'::jsonb),
    'retornos_semanas', (SELECT jsonb_agg(jsonb_build_object('de', g::date, 'qtd',
                           (SELECT count(*) FROM a WHERE COALESCE(data_prevista_retorno, retorno_informado_em) >= g::date
                                                     AND COALESCE(data_prevista_retorno, retorno_informado_em) < g::date + 7)) ORDER BY g)
                           FROM generate_series(hoje, hoje + 27, interval '7 days') g),
    'atestados', jsonb_build_object(
      'mes', jsonb_build_object('qtd', (SELECT count(*) FROM t WHERE data_inicio >= mes_ini), 'dias', (SELECT COALESCE(sum(dias), 0) FROM t WHERE data_inicio >= mes_ini)),
      'mes_anterior', jsonb_build_object('qtd', (SELECT count(*) FROM t WHERE data_inicio >= (mes_ini - interval '1 month')::date AND data_inicio < mes_ini),
                                         'dias', (SELECT COALESCE(sum(dias), 0) FROM t WHERE data_inicio >= (mes_ini - interval '1 month')::date AND data_inicio < mes_ini)),
      'ano', jsonb_build_object('qtd', (SELECT count(*) FROM t WHERE data_inicio >= ano_ini), 'dias', (SELECT COALESCE(sum(dias), 0) FROM t WHERE data_inicio >= ano_ini)),
      'mensal', (SELECT jsonb_agg(jsonb_build_object('mes', to_char(g, 'YYYY-MM'),
                   'qtd', (SELECT count(*) FROM t WHERE date_trunc('month', t.data_inicio) = g),
                   'dias', (SELECT COALESCE(sum(dias), 0) FROM t WHERE date_trunc('month', t.data_inicio) = g)) ORDER BY g)
                   FROM generate_series(m12_ini, mes_ini, interval '1 month') g)))
    INTO v_afa;

  -- 4) Acidentes de trabalho (ano corrente, mês a mês, com o acumulado)
  WITH x AS (SELECT * FROM public."SST_ACIDENTE" WHERE data_acidente >= ano_ini AND data_acidente <= hoje),
  m AS (SELECT g, (SELECT count(*) FROM x WHERE date_trunc('month', x.data_acidente) = g AND x.tipo = 'tipico') AS tip,
               (SELECT count(*) FROM x WHERE date_trunc('month', x.data_acidente) = g AND x.tipo = 'trajeto') AS tra,
               (SELECT count(*) FROM x WHERE date_trunc('month', x.data_acidente) = g AND x.tipo IS NULL) AS sem
          FROM generate_series(ano_ini, mes_ini, interval '1 month') g),
  ma AS (SELECT m.*, sum(m.tip + m.tra + m.sem) OVER (ORDER BY m.g) AS acum FROM m)
  SELECT jsonb_build_object(
    'ano', jsonb_build_object('total', (SELECT count(*) FROM x), 'tipicos', (SELECT count(*) FROM x WHERE tipo = 'tipico'),
                              'trajeto', (SELECT count(*) FROM x WHERE tipo = 'trajeto'), 'nao_informado', (SELECT count(*) FROM x WHERE tipo IS NULL),
                              'com_afastamento', (SELECT count(*) FROM x WHERE houve_afastamento),
                              'dias_afastamento', (SELECT COALESCE(sum(dias_afastamento), 0) FROM x),
                              'com_cat', (SELECT count(*) FROM x WHERE cat_emitida)),
    'mes', (SELECT count(*) FROM x WHERE data_acidente >= mes_ini),
    'ano_anterior', (SELECT count(*) FROM public."SST_ACIDENTE"
                      WHERE data_acidente >= (ano_ini - interval '1 year')::date AND data_acidente <= (hoje - interval '1 year')::date),
    'dias_sem_acidente', (SELECT hoje - max(data_acidente) FROM public."SST_ACIDENTE" WHERE data_acidente <= hoje),
    'mensal', (SELECT jsonb_agg(jsonb_build_object('mes', to_char(m.g, 'YYYY-MM'), 'tipicos', m.tip, 'trajeto', m.tra, 'nao_informado', m.sem,
                                                   'acumulado', m.acum) ORDER BY m.g) FROM ma m))
    INTO v_aci;

  RETURN jsonb_build_object('treinamentos', v_trn, 'asos', v_aso, 'afastamentos', v_afa, 'acidentes', v_aci, 'gerado_em', now());
END $fn$;
REVOKE ALL ON FUNCTION public.tv_sst_painel_dados() FROM PUBLIC, anon, authenticated;

-- Prévia na gestão das TVs (login de quem edita a playlist).
CREATE OR REPLACE FUNCTION public.tv_sst_painel_previa()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'visualizar') OR public.has_screen_access(auth.uid(), 'sistemas_tvs', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem acesso às TVs.' USING ERRCODE = '42501';
  END IF;
  RETURN public.tv_sst_painel_dados();
END $fn$;
REVOKE ALL ON FUNCTION public.tv_sst_painel_previa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tv_sst_painel_previa() TO authenticated;

-- ── 4. O despacho do tv_relatorio com o ramo novo ────────────────────────
-- Corpo IGUAL ao da mig 20261120200000 + 'sst-painel'.
CREATE OR REPLACE FUNCTION public.tv_relatorio_item_dados(i public."TV_ITEM")
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_de date; v_ate date; v_out jsonb; s text;
  v_ano int; v_meses int[]; v_filial text;
BEGIN
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
  ELSIF i.relatorio = 'fin-painel' THEN
    v_out := jsonb_build_object('tipo', 'fin-painel') || public.tv_financeiro_dados();
  ELSIF i.relatorio = 'ctl-painel' THEN
    v_out := jsonb_build_object('tipo', 'ctl-painel') || public.tv_controladoria_dados();
  ELSIF i.relatorio = 'pre-painel' THEN
    v_out := jsonb_build_object('tipo', 'pre-painel') || public.tv_presidencia_dados();
  ELSIF i.relatorio = 'sst-painel' THEN
    -- SIS-2026-0816: TV do SST (treinamentos, ASOs, afastamentos, acidentes).
    v_out := jsonb_build_object('tipo', 'sst-painel') || public.tv_sst_painel_dados();
  ELSIF i.relatorio = 'geral' THEN
    v_out := jsonb_build_object('tipo', 'geral', 'periodo', jsonb_build_object('de', v_de, 'ate', v_ate), 'sistemas', '[]'::jsonb);
    -- 18/11/2026: + Turn-over (como o Relatório Geral do ERP).
    FOREACH s IN ARRAY ARRAY['recrutamento', 'demissoes', 'materiais', 'ferias', 'medida-disciplinar', 'mudanca-funcao', 'chamados', 'orientacoes',
                             'turnover'] LOOP
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
-- Sem grant: só os dois portões (tv_relatorio e tv_visualizar_relatorio) chamam.
REVOKE ALL ON FUNCTION public.tv_relatorio_item_dados(public."TV_ITEM") FROM PUBLIC, anon, authenticated;

-- ── 5. A playlist "TV SST" passa a abrir com o painel ────────────────────
-- Um item só: os 4 blocos giram dentro dele (20 s cada, paginasSstPainel.tsx);
-- o painel gerencial que já estava na playlist continua depois.
DO $$
DECLARE v_pl uuid;
BEGIN
  SELECT id INTO v_pl FROM public."TV_PLAYLIST" WHERE nome = 'TV SST' LIMIT 1;
  IF v_pl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public."TV_ITEM" WHERE playlist_id = v_pl AND relatorio = 'sst-painel') THEN
    INSERT INTO public."TV_ITEM" (playlist_id, ordem, tipo, titulo, relatorio, duracao_seg, ativo)
    VALUES (v_pl, 1, 'relatorio', 'SST — Painel gerencial', 'sst-painel', 80, true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DELETE FROM public."TV_ITEM" WHERE relatorio = 'sst-painel';
-- (recriar tv_relatorio_item_dados da mig 20261120200000 e o tv_item_relatorio_check da 20261111230000)
-- DROP FUNCTION IF EXISTS public.tv_sst_painel_previa(), public.tv_sst_painel_dados(), public.sst_painel_asos_realizados(date);
-- NOTIFY pgrst, 'reload schema';
