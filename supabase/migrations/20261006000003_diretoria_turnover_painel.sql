-- =========================================================================
-- DIRETORIA › RELATÓRIOS › TURN-OVER no formato do Power BI (06/10/2026)
--
-- PEDIDO (Pablo): "preciso que o turnover fique assim" — o painel do Power
-- BI "TURNOVER GRUPO NASCIMENTO". Decidido com ele: páginas 1 (Resumo) e 3
-- (Analistas) agora, no visual do ERP; a página 2 (Valores das rescisões)
-- fica para depois — o ERP não tem as verbas (folha_evento vazio; teria que
-- vir da Senior, hagg.R046VER).
--
-- FÓRMULAS — calibradas contra o Power BI em 06/10/2026:
--   · Turnover do mês = demissões no mês ÷ efetivo no FIM do mês.
--     jan/26: 91 ÷ 2.163 = 4,21% (Power BI 4,20%); fev 103 ÷ 2.139 = 4,81%.
--   · Turnover do ano = SOMA das taxas mensais (o 32,7% do Power BI é a
--     soma de jan–jul). Meta 41%/ano → 3,42%/mês.
--   · Por empresa e por contrato: demissões ÷ efetivo MÉDIO dos meses
--     (fim de cada mês). "Em relação ao grupo" divide pelo efetivo médio
--     do grupo todo. No contrato, a média é só dos meses em que ele teve
--     gente — contrato que começou em agosto dividindo por 10 meses dava
--     451% (UFRGS - Aux. de Saúde Bucal, na primeira versão).
--   · Projeção = acumulado × (dias do ano ÷ dias decorridos).
--   · Efetivo = quem conta como ativo (esp_col_esta_ativo) ou foi demitido
--     depois da data — mesma base do dir_rel_turnover.
--   · Contrato = EMPREGADOS."Nome Filial" (= BiFilial.apelido na Senior).
--   · Empresa = EMPREGADOS."Empresa": 1 HAGG (Nascimento), 2 SN, 3 CANAÃ,
--     4 LF, 5 NH (hagg.R030EMP).
--   · Tipo de desligamento = "Descrição (Causa)" — vazio em ~metade dos
--     demitidos de 2026 (vira "(não informado)"); o filtro só recorta as
--     demissões, nunca o efetivo.
--   · Analistas (avisos): "SISTEMA_SOLICITACOES_DEMISSAO".modelo_aviso,
--     sem Cancelada/Reprovada, na data do aviso. Só existe para demissão
--     pedida pelo ERP — o histórico anterior não tem aviso.
--
-- Acesso: o mesmo do relatório Turn-over (dir_rel_exige).
-- Idempotente. Aplicar no banco do app (SQL Editor) — não se auto-aplica.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.dir_turnover_painel(_ano int DEFAULT NULL, _mes int DEFAULT NULL, _contrato text DEFAULT NULL, _causas text[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ano int := COALESCE(_ano, extract(year FROM current_date)::int);
  v_ini date := make_date(COALESCE(_ano, extract(year FROM current_date)::int), 1, 1);
  v_ult date;
  v_fator numeric;
  v_out jsonb;
BEGIN
  PERFORM public.dir_rel_exige('diretoria_rel_turnover');
  IF _mes IS NOT NULL AND (_mes < 1 OR _mes > 12) THEN RAISE EXCEPTION 'Mês inválido'; END IF;
  v_ult := LEAST(CASE WHEN _mes IS NULL THEN make_date(v_ano, 12, 31)
                      ELSE (make_date(v_ano, _mes, 1) + interval '1 month' - interval '1 day')::date END,
                 current_date);
  IF v_ult < v_ini THEN RAISE EXCEPTION 'Esse período ainda não começou.'; END IF;
  -- Projeção para o ano inteiro a partir do que já passou.
  v_fator := (make_date(v_ano, 12, 31) - v_ini + 1)::numeric / (v_ult - v_ini + 1);

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
  -- Demissões que entram na conta (recorte por tipo de desligamento).
  d AS MATERIALIZED (
    SELECT * FROM e WHERE e.dem BETWEEN v_ini AND v_ult AND (_causas IS NULL OR e.causa = ANY(_causas))
  ),
  mm AS MATERIALIZED (
    SELECT g::date ini, LEAST((g + interval '1 month' - interval '1 day')::date, v_ult) fim
      FROM generate_series(v_ini, v_ult, interval '1 month') g
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
      LEFT JOIN (SELECT contrato, count(*) n FROM e WHERE e.dem BETWEEN v_ini AND v_ult GROUP BY 1) dt USING (contrato)
  ),
  av AS (
    SELECT s.contrato,
           count(*) FILTER (WHERE s.modelo_aviso = 'Aviso Prévio Trabalhado') trabalhado,
           count(*) FILTER (WHERE s.modelo_aviso = 'Aviso Prévio Indenizado') indenizado
      FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s
     WHERE s.status NOT IN ('Cancelada', 'Reprovada')
       AND s.modelo_aviso IN ('Aviso Prévio Trabalhado', 'Aviso Prévio Indenizado')
       AND COALESCE(s.data_aviso, s.data_solicitacao, s.criado_em::date) BETWEEN v_ini AND v_ult
       AND (_contrato IS NULL OR s.contrato = _contrato)
     GROUP BY 1
  )
  SELECT jsonb_build_object(
    'ano', v_ano, 'mes', _mes, 'de', v_ini, 'ate', v_ult, 'fator_projecao', round(v_fator, 4),
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
    'causas', (SELECT COALESCE(jsonb_agg(jsonb_build_object('causa', x.causa, 'n', x.n) ORDER BY x.n DESC), '[]'::jsonb)
                 FROM (SELECT causa, count(*) n FROM e WHERE e.dem BETWEEN v_ini AND v_ult GROUP BY 1) x),
    'contratos', (SELECT COALESCE(jsonb_agg(x.c ORDER BY x.c), '[]'::jsonb) FROM (
                    SELECT DISTINCT btrim(y."Nome Filial") c FROM public."EMPREGADOS" y
                     WHERE COALESCE(btrim(y."Nome Filial"), '') <> ''
                       AND (public.esp_col_esta_ativo(y."Situação") OR public.data_universal(y."Data Afastamento") >= v_ini)) x)
  ) INTO v_out;
  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.dir_turnover_painel(int, int, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dir_turnover_painel(int, int, text, text[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.dir_turnover_painel(int, int, text, text[]);
