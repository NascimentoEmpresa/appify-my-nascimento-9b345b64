-- =========================================================================
-- DIRETORIA › RELATÓRIOS › TURN-OVER — meses selecionáveis (07/10/2026)
--
-- PEDIDO (Pablo): "consegue deixar selecionável os meses? tipo se eu quiser
-- ver mais de um ou só um". O filtro era "Ano inteiro / Até <mês>" (sempre
-- de janeiro até o mês). Agora a tela manda a LISTA de meses (_meses), em
-- qualquer combinação: só março, jan+jul, ago–out…
--
-- O QUE MUDA em dir_turnover_painel (mig 20261006000003):
--   · _meses int[]: os meses que entram. NULL = o comportamento antigo
--     (_mes NULL → ano inteiro; _mes N → janeiro até N). A tela publicada
--     antes desta mudança continua funcionando igual.
--   · Meses que ainda não começaram são ignorados (como antes, corte em
--     current_date).
--   · Tudo que era "entre v_ini e v_ult" passa a ser "num mês escolhido":
--     demissões, efetivo de fim de mês, efetivo médio (média só dos meses
--     escolhidos), causas, avisos da página Analistas.
--   · efetivo_atual = efetivo no fim do ÚLTIMO mês escolhido.
--   · Projeção = acumulado × (dias do ano ÷ dias dos meses escolhidos já
--     decorridos). Para "janeiro até N" dá exatamente o fator antigo.
--   · Devolve 'meses' (os meses efetivamente usados).
--
-- Assinatura nova (int, int, text, text[], int[]); a de 4 argumentos sai —
-- chamada antiga com argumentos nomeados cai nesta pelo DEFAULT de _meses.
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

DROP FUNCTION IF EXISTS public.dir_turnover_painel(int, int, text, text[]);

CREATE OR REPLACE FUNCTION public.dir_turnover_painel(_ano int DEFAULT NULL, _mes int DEFAULT NULL, _contrato text DEFAULT NULL,
                                                      _causas text[] DEFAULT NULL, _meses int[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ano int := COALESCE(_ano, extract(year FROM current_date)::int);
  v_meses int[];
  v_ini date;
  v_ult date;
  v_dias int;
  v_fator numeric;
  v_out jsonb;
BEGIN
  PERFORM public.dir_rel_exige('diretoria_rel_turnover');
  IF _mes IS NOT NULL AND (_mes < 1 OR _mes > 12) THEN RAISE EXCEPTION 'Mês inválido'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(_meses) m WHERE m IS NULL OR m < 1 OR m > 12) THEN RAISE EXCEPTION 'Mês inválido'; END IF;

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
       AND COALESCE(s.data_aviso, s.data_solicitacao, s.criado_em::date) BETWEEN v_ini AND v_ult
       AND extract(month FROM COALESCE(s.data_aviso, s.data_solicitacao, s.criado_em::date))::int = ANY(v_meses)
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
END $$;

REVOKE ALL ON FUNCTION public.dir_turnover_painel(int, int, text, text[], int[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dir_turnover_painel(int, int, text, text[], int[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.dir_turnover_painel(int, int, text, text[], int[]);
-- Reaplicar dir_turnover_painel(int, int, text, text[]) da mig 20261006000003.
