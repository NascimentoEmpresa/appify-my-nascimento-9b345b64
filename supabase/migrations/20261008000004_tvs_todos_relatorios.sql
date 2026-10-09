-- =========================================================================
-- SISTEMAS › TV's — TODOS OS RELATÓRIOS NAS TVs (08/10/2026)
--
-- PEDIDO (Pablo): "precisamos conseguir colocar TODOS os relatórios do módulo
-- Relatórios nas TVs, adaptados pra lá (o layout da TV pode cortar), e
-- melhorar completamente os que já existem".
--
-- Faltavam dois: o Vagas — Dashboard (dir_vagas_painel) e o Turn-over no
-- formato do painel (dir_turnover_painel — a TV mostrava a versão simples do
-- dir_rel_dados). Os dois começam conferindo o login de quem abre
-- (dir_vagas_exige / dir_rel_exige), e a TV não tem login. Mesmo desenho que
-- já existe para os outros (dir_rel_dados = conta sem checagem, chamada pela
-- TV e pelas telas):
--   · dir_vagas_painel_dados / dir_turnover_painel_dados = o corpo de hoje,
--     COPIADO da definição viva (pg_get_functiondef de 08/10/2026), sem a
--     linha da checagem. Internas: ninguém executa direto;
--   · dir_vagas_painel / dir_turnover_painel = checagem + chamada da _dados.
--     As telas continuam iguais (conferido: mesmo md5 da saída antes e depois);
--   · dir_turnover_filial(contrato) = o "Nome Filial" da Senior que o
--     Turn-over filtra, a partir do contrato (uuid) que a playlist guarda;
--   · tv_relatorio passa a responder 'vagas' e 'turnover' (painel), com o
--     mesmo período da TV. Turn-over é por ano: entram os meses do ano
--     corrente que caem no período;
--   · o CHECK do item aceita o relatório 'vagas'.
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── 1) Vagas — Dashboard: a conta sem a checagem ─────────────────────────
CREATE OR REPLACE FUNCTION public.dir_vagas_painel_dados(_de date DEFAULT NULL::date, _ate date DEFAULT NULL::date, _contrato uuid DEFAULT NULL::uuid, _meses integer[] DEFAULT NULL::integer[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ate date := COALESCE(_ate, current_date);
  v_de  date := COALESCE(_de, (date_trunc('month', COALESCE(_ate, current_date)) - interval '11 months')::date);
  v_nn  text := public.dir_rel_contrato_nn(_contrato);
  v_out jsonb;
BEGIN

  WITH v AS (
    SELECT s.*,
           (s.created_at::date BETWEEN v_de AND v_ate AND public.dir_rel_no_mes(s.created_at::date, _meses)) AS no_periodo,
           (s.status NOT IN ('Contratado', 'Reprovada', 'Cancelada') AND s.status NOT LIKE 'Concluído%') AS aberta
      FROM public."SISTEMA_RECRUTAMENTO" s
     WHERE public.dir_rel_no_contrato(s.contrato_id, s.contrato, _contrato, v_nn)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', v.id, 'criada', v.created_at, 'status', v.status, 'status_em', v.status_changed_at,
           'cargo', v.cargo, 'cidade', v.cidade, 'uf', v.estado, 'contrato', v.contrato, 'setor', v.setor,
           'motivo', v.motivo_vaga, 'urgencia', v.grau_urgencia, 'qtd', COALESCE(v.quantidade_vagas, 1),
           'solicitante', v.solicitante_nome, 'analista', v.analista_nome, 'aprovado_por', v.aprovado_por_nome,
           'contratado', v.contratado_nome, 'inicio_previsto', v.data_inicio_prevista, 'substituido', v.nome_substituido,
           'motivo_reprovacao', v.motivo_reprovacao,
           'legado', v.legado_chave IS NOT NULL, 'administrativa', COALESCE(v.administrativa, false),
           'reserva', COALESCE(v.reserva_tecnica, false), 'encarregado', COALESCE(v.vaga_encarregado, false),
           'no_periodo', v.no_periodo, 'aberta', v.aberta,
           'log', COALESCE(lg.log, '[]'::jsonb),
           'aprovada_em', h.aprovada_em,
           'cand', jsonb_build_object(
              'total', COALESCE(c.total, 0), 'desistiu', COALESCE(c.desistiu, 0),
              'etapas', COALESCE(c.etapas, '{}'::jsonb),
              'primeiro_em', c.primeiro_em, 'selecionado_em', c.selecionado_em, 'enviado_em', c.enviado_em)
         ) ORDER BY v.id DESC), '[]'::jsonb)
    INTO v_out
    FROM v
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_array(l.status_anterior, l.status_novo, l.changed_at) ORDER BY l.changed_at, l.id) AS log
        FROM public."SISTEMA_RECRUTAMENTO_STATUS_LOG" l WHERE l.solicitacao_id = v.id
    ) lg ON true
    LEFT JOIN LATERAL (
      SELECT min(hh.created_at) AS aprovada_em
        FROM public."RECRUTAMENTO_HISTORICO" hh
       WHERE hh.solicitacao_id = v.id
         AND hh.evento IN ('Operação aprovou', 'Aprovada pelo Operacional', 'Aprovada pelo Analista', 'Abertura de vaga confirmada')
    ) h ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS total,
             count(*) FILTER (WHERE cc.desistiu) AS desistiu,
             min(cc.created_at) AS primeiro_em,
             min(cc.selecionado_em) AS selecionado_em,
             min(cc.enviado_admissao_em) AS enviado_em,
             (SELECT jsonb_object_agg(e.etapa, e.n) FROM (
                SELECT upper(COALESCE(NULLIF(trim(c2.etapa_processo), ''), 'ENTRADA')) AS etapa, count(*) AS n
                  FROM public."WA_CURRICULOS" c2 WHERE c2.vaga_id = v.id GROUP BY 1) e) AS etapas
        FROM public."WA_CURRICULOS" cc WHERE cc.vaga_id = v.id
    ) c ON true
   WHERE v.no_periodo OR v.aberta;

  RETURN jsonb_build_object(
    'de', v_de, 'ate', v_ate, 'agora', now(),
    'log_desde', (SELECT min(changed_at) FROM public."SISTEMA_RECRUTAMENTO_STATUS_LOG"),
    'vagas', v_out);
END $function$;
REVOKE ALL ON FUNCTION public.dir_vagas_painel_dados(date, date, uuid, integer[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.dir_vagas_painel(_de date DEFAULT NULL::date, _ate date DEFAULT NULL::date, _contrato uuid DEFAULT NULL::uuid, _meses integer[] DEFAULT NULL::integer[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.dir_vagas_exige();
  RETURN public.dir_vagas_painel_dados(_de, _ate, _contrato, _meses);
END $function$;

-- ── 2) Turn-over (painel): a conta sem a checagem ────────────────────────
CREATE OR REPLACE FUNCTION public.dir_turnover_painel_dados(_ano integer DEFAULT NULL::integer, _mes integer DEFAULT NULL::integer, _contrato text DEFAULT NULL::text, _causas text[] DEFAULT NULL::text[], _meses integer[] DEFAULT NULL::integer[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ano int := COALESCE(_ano, extract(year FROM current_date)::int);
  v_meses int[];
  v_meses_req int[];  -- meses pedidos, inclusive os que ainda não começaram (avisos)
  v_ini date;
  v_ult date;
  v_dias int;
  v_fator numeric;
  v_out jsonb;
BEGIN
  IF _mes IS NOT NULL AND (_mes < 1 OR _mes > 12) THEN RAISE EXCEPTION 'Mês inválido'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(_meses) m WHERE m IS NULL OR m < 1 OR m > 12) THEN RAISE EXCEPTION 'Mês inválido'; END IF;

  SELECT array_agg(DISTINCT m ORDER BY m) INTO v_meses_req
    FROM unnest(COALESCE(NULLIF(_meses, '{}'), CASE WHEN _mes IS NULL THEN ARRAY(SELECT generate_series(1, 12))
                                                    ELSE ARRAY(SELECT generate_series(1, _mes)) END)) m;

  -- Meses escolhidos, sem repetição, só os que já começaram.
  SELECT array_agg(DISTINCT m ORDER BY m) INTO v_meses
    FROM unnest(COALESCE(NULLIF(_meses, '{}'), CASE WHEN _mes IS NULL THEN ARRAY(SELECT generate_series(1, 12))
                                                    ELSE ARRAY(SELECT generate_series(1, _mes)) END)) m
   WHERE make_date(v_ano, m, 1) <= current_date;
  IF v_meses IS NULL THEN RAISE EXCEPTION 'Esse período ainda não começou.'; END IF;

  v_ini := make_date(v_ano, v_meses[1], 1);
  v_ult := LEAST((make_date(v_ano, v_meses[array_length(v_meses, 1)], 1) + interval '1 month' - interval '1 day')::date, current_date);
  SELECT sum(LEAST((make_date(v_ano, m, 1) + interval '1 month' - interval '1 day')::date, current_date) - make_date(v_ano, m, 1) + 1)
    INTO v_dias FROM unnest(v_meses) m;
  -- Projeção para o ano inteiro a partir dos dias escolhidos que já passaram.
  v_fator := (make_date(v_ano, 12, 31) - make_date(v_ano, 1, 1) + 1)::numeric / v_dias;

  WITH e AS MATERIALIZED (
    SELECT public.data_universal(x."Admissão") adm,
           CASE WHEN x."Situação" = 'Demitido' THEN public.data_universal(x."Data Afastamento") END dem,
           (public.esp_col_esta_ativo(x."Situação") OR x."Situação" = 'Demitido') conta,
           COALESCE(NULLIF(btrim(x."Nome Filial"), ''), '(sem contrato)') contrato,
           CASE x."Empresa" WHEN 1 THEN 'HAGG' WHEN 2 THEN 'SN' WHEN 3 THEN 'CANAÃ' WHEN 4 THEN 'LF' WHEN 5 THEN 'NH' ELSE '(sem empresa)' END empresa,
           COALESCE(NULLIF(btrim(x."Descrição (Causa)"), ''), '(não informado)') causa
      FROM public."EMPREGADOS" x
     WHERE COALESCE(btrim(x."Nome"), '') <> ''
       AND (_contrato IS NULL OR x."Nome Filial" = _contrato)
  ),
  -- Demitido num mês escolhido (todas as causas) — base de causas e Analistas.
  dt_all AS MATERIALIZED (
    SELECT * FROM e WHERE e.dem BETWEEN v_ini AND v_ult AND extract(month FROM e.dem)::int = ANY(v_meses)
  ),
  -- Demissões que entram na conta (recorte por tipo de desligamento).
  d AS MATERIALIZED (
    SELECT * FROM dt_all WHERE _causas IS NULL OR dt_all.causa = ANY(_causas)
  ),
  mm AS MATERIALIZED (
    SELECT make_date(v_ano, m, 1) ini,
           LEAST((make_date(v_ano, m, 1) + interval '1 month' - interval '1 day')::date, v_ult) fim
      FROM unnest(v_meses) m
  ),
  ef AS MATERIALIZED (   -- efetivo no fim de cada mês, por contrato/empresa
    SELECT mm.ini, e.contrato, e.empresa, count(*) n
      FROM mm JOIN e ON e.conta AND e.adm <= mm.fim AND (e.dem IS NULL OR e.dem > mm.fim)
     GROUP BY 1, 2, 3
  ),
  mes AS (
    SELECT mm.ini,
           (SELECT COALESCE(sum(n), 0) FROM ef WHERE ef.ini = mm.ini) efetivo,
           (SELECT count(*) FROM d WHERE d.dem BETWEEN mm.ini AND mm.fim) demissoes
      FROM mm
  ),
  nmes AS (SELECT count(*)::numeric n FROM mm),
  ef_medio_grupo AS (SELECT COALESCE(sum(n), 0) / (SELECT n FROM nmes) n FROM ef),
  por_contrato AS (
    SELECT c.contrato, c.empresa, c.efetivo_medio, COALESCE(dd.n, 0) demissoes, COALESCE(at.n, 0) efetivo_atual,
           COALESCE(dt.n, 0) demissoes_todas
      FROM (SELECT contrato, max(empresa) empresa, sum(n)::numeric / count(DISTINCT ini) efetivo_medio FROM ef GROUP BY 1) c
      LEFT JOIN (SELECT contrato, count(*) n FROM d GROUP BY 1) dd USING (contrato)
      LEFT JOIN (SELECT contrato, sum(n) n FROM ef WHERE ef.ini = (SELECT max(ini) FROM mm) GROUP BY 1) at USING (contrato)
      LEFT JOIN (SELECT contrato, count(*) n FROM dt_all GROUP BY 1) dt USING (contrato)
  ),
  av AS (
    SELECT s.contrato,
           count(*) FILTER (WHERE s.modelo_aviso = 'Aviso Prévio Trabalhado') trabalhado,
           count(*) FILTER (WHERE s.modelo_aviso = 'Aviso Prévio Indenizado') indenizado
      FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s
     WHERE s.status NOT IN ('Cancelada', 'Reprovada')
       AND s.modelo_aviso IN ('Aviso Prévio Trabalhado', 'Aviso Prévio Indenizado')
       -- 07/10/2026: aviso já pedido com data futura conta (sem corte em hoje).
       AND extract(year FROM COALESCE(s.data_aviso, s.data_solicitacao, s.criado_em::date))::int = v_ano
       AND extract(month FROM COALESCE(s.data_aviso, s.data_solicitacao, s.criado_em::date))::int = ANY(v_meses_req)
       AND (_contrato IS NULL OR s.contrato = _contrato)
     GROUP BY 1
  )
  SELECT jsonb_build_object(
    'ano', v_ano, 'mes', _mes, 'meses', to_jsonb(v_meses), 'de', v_ini, 'ate', v_ult, 'fator_projecao', round(v_fator, 4),
    'efetivo_medio', round((SELECT n FROM ef_medio_grupo), 1),
    'mensal', (SELECT COALESCE(jsonb_agg(jsonb_build_object('mes', to_char(ini, 'YYYY-MM'), 'efetivo', efetivo, 'demissoes', demissoes,
                 'taxa', CASE WHEN efetivo > 0 THEN round(demissoes * 100.0 / efetivo, 2) END) ORDER BY ini), '[]'::jsonb) FROM mes),
    'por_empresa', (SELECT COALESCE(jsonb_agg(jsonb_build_object('empresa', x.empresa, 'efetivo_medio', round(x.ef, 1), 'demissoes', x.dem,
                     'taxa', CASE WHEN x.ef > 0 THEN round(x.dem * 100.0 / x.ef, 2) END) ORDER BY x.dem * 1.0 / NULLIF(x.ef, 0) DESC NULLS LAST), '[]'::jsonb)
                      FROM (SELECT ee.empresa, ee.ef, COALESCE(dd.dem, 0) dem FROM (SELECT empresa, sum(n) / (SELECT n FROM nmes) ef FROM ef GROUP BY 1) ee LEFT JOIN (SELECT empresa, count(*) dem FROM d GROUP BY 1) dd USING (empresa)) x
                     WHERE x.ef > 0 OR x.dem > 0),
    'por_contrato', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'contrato', pc.contrato, 'empresa', pc.empresa, 'efetivo_medio', round(pc.efetivo_medio, 1), 'efetivo_atual', pc.efetivo_atual,
                       'demissoes', pc.demissoes, 'demissoes_todas', pc.demissoes_todas,
                       'aviso_trabalhado', COALESCE(av.trabalhado, 0), 'aviso_indenizado', COALESCE(av.indenizado, 0))
                       ORDER BY pc.demissoes DESC, pc.contrato), '[]'::jsonb)
                       FROM por_contrato pc LEFT JOIN av USING (contrato)),
    'causas', (SELECT COALESCE(jsonb_agg(jsonb_build_object('causa', x.causa, 'n', x.n) ORDER BY x.n DESC, x.causa), '[]'::jsonb)
                 FROM (SELECT causa, count(*) n FROM dt_all GROUP BY 1) x),
    'contratos', (SELECT COALESCE(jsonb_agg(x.c ORDER BY x.c), '[]'::jsonb) FROM (
                    SELECT DISTINCT btrim(y."Nome Filial") c FROM public."EMPREGADOS" y
                     WHERE COALESCE(btrim(y."Nome Filial"), '') <> ''
                       AND (public.esp_col_esta_ativo(y."Situação") OR public.data_universal(y."Data Afastamento") >= v_ini)) x)
  ) INTO v_out;
  RETURN v_out;
END $function$;
REVOKE ALL ON FUNCTION public.dir_turnover_painel_dados(integer, integer, text, text[], integer[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.dir_turnover_painel(_ano integer DEFAULT NULL::integer, _mes integer DEFAULT NULL::integer, _contrato text DEFAULT NULL::text, _causas text[] DEFAULT NULL::text[], _meses integer[] DEFAULT NULL::integer[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.dir_rel_exige('diretoria_rel_turnover');
  RETURN public.dir_turnover_painel_dados(_ano, _mes, _contrato, _causas, _meses);
END $function$;

-- ── 3) Contrato (uuid) → "Nome Filial" que o Turn-over usa ───────────────
-- Pelo nome normalizado (rh_norm_contrato), a filial com mais gente. NULL
-- quando o contrato não tem correspondência no espelho da Senior (em
-- 08/10/2026: 51 de 77 contratos têm) — a TV mostra o grupo e avisa.
CREATE OR REPLACE FUNCTION public.dir_turnover_filial(_contrato uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e."Nome Filial"
    FROM public."EMPREGADOS" e
   WHERE _contrato IS NOT NULL
     AND public.rh_norm_contrato(e."Nome Filial") = public.dir_rel_contrato_nn(_contrato)
   GROUP BY e."Nome Filial"
   ORDER BY count(*) DESC
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.dir_turnover_filial(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dir_turnover_filial(uuid) TO authenticated;

-- ── 4) O item da playlist aceita o Vagas — Dashboard ─────────────────────
ALTER TABLE public."TV_ITEM" DROP CONSTRAINT IF EXISTS tv_item_relatorio_check;
ALTER TABLE public."TV_ITEM" ADD CONSTRAINT tv_item_relatorio_check CHECK (
  tipo <> 'relatorio' OR (
    relatorio IN ('geral', 'recrutamento', 'demissoes', 'materiais', 'ferias', 'medida-disciplinar', 'chamados',
                  'orientacoes', 'mudanca-funcao', 'colaboradores', 'turnover', 'vagas')
    AND COALESCE(rel_periodo, '12m') IN ('mes', '3m', '6m', '12m', 'ano')));

-- ── 5) tv_relatorio: Vagas e Turn-over (painel) ──────────────────────────
CREATE OR REPLACE FUNCTION public.tv_relatorio(p_token text, p_item uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
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

  IF i.relatorio = 'geral' THEN
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
    -- Turn-over é por ano: os meses do ano corrente que caem no período.
    v_ano := extract(year FROM v_ate)::int;
    v_meses := ARRAY(SELECT m FROM generate_series(1, 12) m
                      WHERE make_date(v_ano, m, 1) BETWEEN date_trunc('month', v_de)::date AND v_ate);
    v_filial := public.dir_turnover_filial(i.rel_contrato);
    v_out := jsonb_build_object('tipo', 'turnover', 'filial', v_filial,
                                'painel', public.dir_turnover_painel_dados(v_ano, NULL, v_filial, NULL, v_meses));
  ELSE
    v_out := jsonb_build_object('tipo', 'sistema', 'slug', i.relatorio) || public.dir_rel_dados(i.relatorio, v_de, v_ate, i.rel_contrato, NULL);
  END IF;

  RETURN v_out || jsonb_build_object('contrato', (SELECT c.nome FROM public.contratos c WHERE c.id = i.rel_contrato), 'gerado_em', now());
END $$;
REVOKE ALL ON FUNCTION public.tv_relatorio(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tv_relatorio(text, uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- tv_relatorio: reaplicar a da mig 20261007000014.
-- dir_vagas_painel / dir_turnover_painel: reaplicar o corpo das *_dados com a linha
--   PERFORM public.dir_vagas_exige(); / PERFORM public.dir_rel_exige('diretoria_rel_turnover');
--   de volta no começo, e DROP FUNCTION public.dir_vagas_painel_dados(date, date, uuid, integer[]),
--   public.dir_turnover_painel_dados(integer, integer, text, text[], integer[]);
-- DROP FUNCTION IF EXISTS public.dir_turnover_filial(uuid);
-- CHECK tv_item_relatorio_check: recriar sem 'vagas' (antes, apagar os itens com relatorio = 'vagas').
