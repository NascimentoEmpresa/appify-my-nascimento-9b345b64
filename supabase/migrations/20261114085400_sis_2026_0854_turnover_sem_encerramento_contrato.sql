-- =========================================================================
-- SIS-2026-0854 — DESLIGAMENTO POR ENCERRAMENTO DO CONTRATO COM O CLIENTE
-- FICA FORA DO TURNOVER (12/11/2026)
--
-- PEDIDO: "o sistema está contabilizando como desligamentos as situações em
-- que o contrato de prestação de serviços entre a empresa e o cliente chega
-- ao fim. [...] esses casos não devem ser considerados para fins de cálculo
-- do índice de turnover". Quem abre a solicitação de demissão marca a
-- situação; o turnover desconsidera sozinho.
--
-- O QUE MUDA
--   0. SISTEMA_SOLICITACOES_DEMISSAO.encerramento_contrato (boolean, padrão
--      false): marcado no passo "Motivos" da Solicitar Demissão. O contrato
--      que encerrou é o do colaborador, que a solicitação já grava em
--      contrato / contrato_id.
--   A REGRA (uma só): public.turnover_desconsidera(EMPREGADOS."ID") — o
--      desligamento sai do turnover quando há solicitação de demissão desse
--      colaborador marcada como encerramento de contrato e que não foi
--      cancelada nem reprovada. O turnover conta os demitidos do espelho da
--      Senior (EMPREGADOS), e a solicitação guarda colaborador_id = "ID".
--   Toda conta de turnover/rotatividade passa a filtrar por ela, SÓ no
--   numerador (demissões). O efetivo não muda: a pessoa trabalhou até sair.
--      1. dir_turnover_painel_dados — Relatórios › Turnover (Resumo e
--         Analistas, inclusive os avisos trabalhado/indenizado), e quem
--         reaproveita: tv_relatorio, tvg_calc/tvg_espelho_turnover (TVs) e
--         Operacional › Indicadores › Pessoas e Capacidade. Devolve também
--         `fora_turnover` (quantos ficaram fora no período), que a tela mostra.
--      2. dir_rel_turnover_dados — Relatórios › Diretoria › Turn-over (e a IA
--         da Diretoria, que lê a mesma RPC).
--      3. dir_turnover_variacao_efetivo — Turn-over › Variação de Efetivo.
--      4. ope_contratos_ind_dados — Operacional › Indicadores de Contratos.
--      5. cs_form_rotatividade — Formulários › Rotatividade (e o assistente
--         de IA dos formulários).
--   Cada uma é a definição MAIS NOVA copiada sem outra mudança além da coluna
--   `fora_turnover` e do filtro (nenhuma outra branch as redefine).
--
-- O QUE FICA DE FORA, DE PROPÓSITO (contagem de movimento, não índice):
--   dir_turnover_rescisoes_dados (aba Turnover em Valores — quantas
--   rescisões houve), tvg_tendencia (gráfico admissões × demissões) e o
--   relatório de Desligamentos/Demissões por motivo.
--
-- Idempotente. Só leitura nas funções; a coluna nova é metadado (padrão
-- constante não reescreve a tabela).
-- =========================================================================

-- ── 0) A marcação na solicitação e a regra ──────────────────────────────
ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO"
  ADD COLUMN IF NOT EXISTS encerramento_contrato boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_DEMISSAO".encerramento_contrato IS
  'SIS-2026-0854: desligamento por encerramento do contrato de prestação de serviços com o cliente. Marcado = fora do turnover (turnover_desconsidera).';

CREATE INDEX IF NOT EXISTS idx_sol_demissao_encerramento_contrato
  ON public."SISTEMA_SOLICITACOES_DEMISSAO" (colaborador_id) WHERE encerramento_contrato;

-- A regra única. Chamada só para quem está Demitido (as contas fazem
-- `"Situação" = 'Demitido' AND ...`), uma busca no índice parcial acima.
CREATE OR REPLACE FUNCTION public.turnover_desconsidera(_empregado_id bigint)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT _empregado_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s
     WHERE s.colaborador_id = _empregado_id
       AND s.encerramento_contrato
       AND s.status NOT IN ('Cancelada', 'Reprovada'))
$$;
-- Só as RPCs (todas SECURITY DEFINER) chamam.
REVOKE ALL ON FUNCTION public.turnover_desconsidera(bigint) FROM PUBLIC, anon, authenticated;

-- ── 1) Relatórios › Turnover (Resumo, Analistas) — e quem reaproveita: TVs, TV Gerencial, Indicadores ───
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
           COALESCE(NULLIF(btrim(x."Descrição (Causa)"), ''), '(não informado)') causa,
           -- SIS-2026-0854: desligamento por encerramento do contrato com o cliente — fora do turnover.
           (x."Situação" = 'Demitido' AND public.turnover_desconsidera(x."ID")) fora_turnover
      FROM public."EMPREGADOS" x
     WHERE COALESCE(btrim(x."Nome"), '') <> ''
       AND (_contrato IS NULL OR x."Nome Filial" = _contrato)
  ),
  -- Demitido num mês escolhido (todas as causas) — base de causas e Analistas.
  dt_all AS MATERIALIZED (
    SELECT * FROM e WHERE e.dem BETWEEN v_ini AND v_ult AND extract(month FROM e.dem)::int = ANY(v_meses) AND NOT e.fora_turnover
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
       AND NOT public.turnover_desconsidera(s.colaborador_id)  -- SIS-2026-0854
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
    -- SIS-2026-0854: quantos desligamentos do período ficaram fora por encerramento de contrato.
    'fora_turnover', (SELECT count(*) FROM e WHERE e.fora_turnover AND e.dem BETWEEN v_ini AND v_ult AND extract(month FROM e.dem)::int = ANY(v_meses)),
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

-- ── 2) Relatórios › Diretoria › Turn-over (relatório geral e a IA da Diretoria) ───
CREATE OR REPLACE FUNCTION public.dir_rel_turnover_dados(_de date, _ate date, _contrato uuid, _meses int[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ate date := COALESCE(_ate, current_date);
  v_de  date := COALESCE(_de, (date_trunc('month', COALESCE(_ate, current_date)) - interval '11 months')::date);
  v_nn  text := public.dir_rel_contrato_nn(_contrato);
  v_out jsonb;
BEGIN
  WITH e AS MATERIALIZED (
    SELECT e."Nome" nome, e."Título do Cargo" cargo, e."Nome Filial" filial,
           public.data_universal(e."Admissão") adm,
           CASE WHEN e."Situação" = 'Demitido' THEN public.data_universal(e."Data Afastamento") END dem,
           public.esp_col_esta_ativo(e."Situação") ativo,
           -- SIS-2026-0854: desligamento por encerramento do contrato com o cliente — fora do turnover.
           (e."Situação" = 'Demitido' AND public.turnover_desconsidera(e."ID")) fora_turnover
      FROM public."EMPREGADOS" e
     WHERE COALESCE(btrim(e."Nome"), '') <> ''
       AND public.dir_rel_no_contrato(NULL, e."Nome Filial", _contrato, v_nn)
  ),
  m AS MATERIALIZED (
    SELECT to_char(g, 'YYYY-MM') mes, g::date ini, (g + interval '1 month' - interval '1 day')::date fim,
           (SELECT count(*) FROM e WHERE e.adm < g::date AND (e.dem IS NULL OR e.dem >= g::date) AND (e.ativo OR e.dem IS NOT NULL)) base,
           (SELECT count(*) FROM e WHERE e.adm BETWEEN g::date AND (g + interval '1 month' - interval '1 day')::date) adm,
           (SELECT count(*) FROM e WHERE NOT e.fora_turnover AND e.dem BETWEEN g::date AND (g + interval '1 month' - interval '1 day')::date) dem
      FROM generate_series(date_trunc('month', v_de), date_trunc('month', v_ate), interval '1 month') g
     WHERE public.dir_rel_no_mes(g::date, _meses)
  ),
  sai AS MATERIALIZED (SELECT * FROM e WHERE e.dem BETWEEN v_de AND v_ate AND public.dir_rel_no_mes(e.dem, _meses) AND NOT e.fora_turnover),
  t AS (SELECT sum(adm) adm, sum(dem) dem,
               round(avg(CASE WHEN base > 0 THEN (adm + dem) / 2.0 / base * 100 END), 2) taxa,
               (SELECT count(*) FROM sai WHERE sai.adm IS NOT NULL AND sai.dem - sai.adm <= 90) precoce
          FROM m)
  SELECT jsonb_build_object(
    'titulo', 'Turn-over',
    'periodo', jsonb_build_object('de', v_de, 'ate', v_ate),
    'filtro', jsonb_build_object('contrato', _contrato, 'meses', to_jsonb(_meses)),
    'kpis', jsonb_build_array(
      jsonb_build_object('rotulo', 'Turn-over médio mensal', 'valor', t.taxa, 'formato', 'pct', 'tom', 'primary', 'dica', '((admitidos + desligados) ÷ 2) ÷ quadro do início do mês'),
      jsonb_build_object('rotulo', 'Admitidos', 'valor', t.adm, 'formato', 'n', 'tom', 'success'),
      jsonb_build_object('rotulo', 'Desligados', 'valor', t.dem, 'formato', 'n', 'tom', 'destructive'),
      jsonb_build_object('rotulo', 'Saldo (admitidos − desligados)', 'valor', t.adm - t.dem, 'formato', 'n', 'tom', CASE WHEN t.adm >= t.dem THEN 'success' ELSE 'destructive' END),
      jsonb_build_object('rotulo', 'Desligados em até 90 dias', 'valor', t.precoce, 'formato', 'n', 'tom', 'warning',
                         'dica', CASE WHEN t.dem > 0 THEN round(t.precoce * 100.0 / t.dem) || '% dos desligamentos — contratação que não firmou' END)
    ),
    'mensal', jsonb_build_object(
      'series', jsonb_build_array(
        jsonb_build_object('chave', 'admitidos', 'rotulo', 'Admitidos'),
        jsonb_build_object('chave', 'desligados', 'rotulo', 'Desligados'),
        jsonb_build_object('chave', 'taxa', 'rotulo', 'Turn-over (%)', 'eixo', 'direita')),
      'dados', (SELECT COALESCE(jsonb_agg(jsonb_build_object('mes', mes, 'admitidos', adm, 'desligados', dem,
                  'taxa', CASE WHEN base > 0 THEN round((adm + dem) / 2.0 / base * 100, 2) END) ORDER BY mes), '[]'::jsonb) FROM m)),
    'por_status', jsonb_build_array(
      jsonb_build_object('nome', 'Admitidos', 'n', t.adm, 'grupo', 'concluido'),
      jsonb_build_object('nome', 'Desligados', 'n', t.dem, 'grupo', 'recusado')),
    'rankings', jsonb_build_array(
      jsonb_build_object('titulo', 'Desligamentos por contrato (filial)', 'itens', (SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', x.nome, 'n', x.n) ORDER BY x.n DESC), '[]'::jsonb)
         FROM (SELECT COALESCE(filial, '(sem filial)') nome, count(*) n FROM sai GROUP BY 1 ORDER BY 2 DESC LIMIT 12) x)),
      jsonb_build_object('titulo', 'Desligamentos por cargo', 'itens', (SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', x.nome, 'n', x.n) ORDER BY x.n DESC), '[]'::jsonb)
         FROM (SELECT COALESCE(cargo, '(sem cargo)') nome, count(*) n FROM sai GROUP BY 1 ORDER BY 2 DESC LIMIT 12) x)),
      jsonb_build_object('titulo', 'Tempo de casa de quem saiu', 'itens', (SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', x.nome, 'n', x.n) ORDER BY x.ord), '[]'::jsonb)
         FROM (SELECT CASE WHEN dem - adm <= 90 THEN 'Até 3 meses' WHEN dem - adm <= 180 THEN '3 a 6 meses' WHEN dem - adm <= 365 THEN '6 meses a 1 ano'
                           WHEN dem - adm <= 730 THEN '1 a 2 anos' ELSE 'Mais de 2 anos' END nome,
                      min(CASE WHEN dem - adm <= 90 THEN 1 WHEN dem - adm <= 180 THEN 2 WHEN dem - adm <= 365 THEN 3 WHEN dem - adm <= 730 THEN 4 ELSE 5 END) ord,
                      count(*) n
                 FROM sai WHERE adm IS NOT NULL GROUP BY 1) x))
    ),
    'recentes', jsonb_build_object(
      'colunas', jsonb_build_array('Desligamento', 'Colaborador', 'Tempo de casa', 'Contrato (filial)'),
      'linhas', (SELECT COALESCE(jsonb_agg(jsonb_build_array(to_char(x.dem, 'DD/MM/YYYY'), x.nome || COALESCE(' — ' || x.cargo, ''),
                          CASE WHEN x.adm IS NULL THEN '—' ELSE (x.dem - x.adm) || ' dias' END, x.filial)), '[]'::jsonb)
                   FROM (SELECT * FROM sai ORDER BY dem DESC LIMIT 15) x)),
    'rotulo_item', 'movimentações'
  ) INTO v_out FROM t;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.dir_rel_turnover_dados(date, date, uuid, int[]) FROM PUBLIC, anon, authenticated;

-- ── 3) Relatórios › Turn-over › Variação de Efetivo ───────────────────────────
CREATE OR REPLACE FUNCTION public.dir_turnover_variacao_efetivo(_ano integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ano int := COALESCE(_ano, extract(year FROM current_date)::int);
  v_out jsonb;
BEGIN
  PERFORM public.dir_rel_exige('diretoria_rel_turnover');
  IF v_ano < 2000 OR v_ano > 2100 THEN RAISE EXCEPTION 'Ano inválido.'; END IF;

  WITH
  mm AS MATERIALIZED (   -- só os meses que já começaram
    SELECT make_date(v_ano, m, 1) ini,
           LEAST((make_date(v_ano, m, 1) + interval '1 month' - interval '1 day')::date, current_date) fim
      FROM generate_series(1, 12) m
     WHERE make_date(v_ano, m, 1) <= current_date
  ),
  -- Contrato do ERP de cada filial/local (mesma ligação de rh_ac_ativos).
  ct AS MATERIALIZED (
    SELECT DISTINCT ON (public.rh_norm_contrato(c.nome)) public.rh_norm_contrato(c.nome) AS nn, c.id
      FROM public.contratos c
     WHERE public.rh_norm_contrato(c.nome) IS NOT NULL
     ORDER BY public.rh_norm_contrato(c.nome), (COALESCE(c.status, 'ativo') = 'encerrado'), c.created_at DESC
  ),
  dp_nome AS MATERIALIZED (
    SELECT DISTINCT ON (d.filial_nome) d.filial_nome, d.contrato_id
      FROM public.sup_empregado_contrato_depara d ORDER BY d.filial_nome, d.contrato_id
  ),
  dp_nn AS MATERIALIZED (
    SELECT DISTINCT ON (public.rh_norm_contrato(d.filial_nome)) public.rh_norm_contrato(d.filial_nome) AS nn, d.contrato_id
      FROM public.sup_empregado_contrato_depara d
     WHERE public.rh_norm_contrato(d.filial_nome) IS NOT NULL
     ORDER BY public.rh_norm_contrato(d.filial_nome), d.contrato_id
  ),
  e AS MATERIALIZED (
    SELECT public.data_universal(x."Admissão") adm,
           CASE WHEN x."Situação" = 'Demitido' THEN public.data_universal(x."Data Afastamento") END dem,
           (public.esp_col_esta_ativo(x."Situação") OR x."Situação" = 'Demitido') conta,
           public.esp_col_esta_ativo(x."Situação") ativo,
           -- Ocupa o posto hoje? A régua do Ativos/Contratos (só "Trabalhando").
           public.rh_ac_conta_no_posto(x."Situação") trabalhando_hoje,
           -- Fora de "Trabalhando" hoje (atestado, férias, auxílio-doença…):
           -- fora do "trabalhando" dos meses fechados desde a Data Afastamento.
           CASE WHEN public.esp_col_esta_ativo(x."Situação")
                 AND NOT public.rh_ac_conta_no_posto(x."Situação")
                THEN COALESCE(public.data_universal(x."Data Afastamento"), current_date) END afast_desde,
           x."Empresa"::bigint emp_num,
           x."Cadastro"::text cadastro,
           btrim(COALESCE(x."Nome do Posto", '')) posto_senior,
           CASE x."Empresa" WHEN 1 THEN 'HAGG' WHEN 2 THEN 'SN' WHEN 3 THEN 'CANAÃ' WHEN 4 THEN 'LF' WHEN 5 THEN 'NH' ELSE '(sem empresa)' END empresa,
           COALESCE(NULLIF(btrim(x."Nome Filial"), ''), '(sem filial)') filial,
           public.rh_norm_contrato(x."Nome Filial") nn_filial,
           public.rh_norm_contrato(x."Descrição do Local") nn_local,
           -- SIS-2026-0854: desligamento por encerramento do contrato com o cliente — fora do turnover.
           (x."Situação" = 'Demitido' AND public.turnover_desconsidera(x."ID")) fora_turnover
      FROM public."EMPREGADOS" x
     WHERE COALESCE(btrim(x."Nome"), '') <> ''
  ),
  ec AS MATERIALIZED (
    SELECT e.*, COALESCE(d1.contrato_id, c1.id, d2.contrato_id, c2.id) contrato_id
      FROM e
      LEFT JOIN dp_nome d1 ON d1.filial_nome = e.filial
      LEFT JOIN ct c1      ON c1.nn = e.nn_filial
      LEFT JOIN dp_nn d2   ON d2.nn = e.nn_filial
      LEFT JOIN ct c2      ON c2.nn = e.nn_local
     -- Ativo hoje entra sempre (mesmo com admissão futura): o Ativos/Contratos conta.
     WHERE (e.ativo OR e.adm IS NULL OR e.adm <= (SELECT max(fim) FROM mm))
       AND (e.dem IS NULL OR e.dem >= make_date(v_ano, 1, 1))
  ),
  -- Postos vigentes hoje (o pv do rh_ac_painel) e posto da Senior → posto
  -- da planilha (o lig do rh_ac_painel): para tirar do "trabalhando" quem o
  -- Ativos/Contratos tira do "Tem" — fora da conta e RENDA TÉCNICA.
  pv_hoje AS MATERIALIZED (
    SELECT DISTINCT ON (pc.contrato_id, public.sup_norm_nome(pc.posto))
           pc.contrato_id, btrim(pc.posto) AS posto, public.sup_norm_nome(pc.posto) AS pn
      FROM public.planilha_custo pc
     WHERE pc.contrato_id IS NOT NULL
       AND pc.orexec = 'EXECUTADO'
       AND NOT COALESCE(pc.encerrado, false)
       AND pc.data_vigencia IS NOT NULL
       AND pc.data_vigencia <= current_date
       AND COALESCE(btrim(pc.posto), '') <> ''
     ORDER BY pc.contrato_id, public.sup_norm_nome(pc.posto), pc.data_vigencia DESC
  ),
  lig AS MATERIALIZED (
    SELECT DISTINCT ON (d.contrato_id, d.posto_senior)
           d.contrato_id, d.posto_senior, d.ignorar, pv.posto AS planilha_posto
      FROM public."RH_POSTO_DEPARA" d
      LEFT JOIN pv_hoje pv ON pv.contrato_id = d.contrato_id
                          AND pv.pn = public.sup_norm_nome(d.planilha_posto)
     WHERE d.ignorar OR pv.posto IS NOT NULL
     ORDER BY d.contrato_id, d.posto_senior, d.ignorar DESC, pv.posto
  ),
  -- Chave do contrato: o do ERP, ou a filial da Senior quando não liga.
  pessoa AS MATERIALIZED (
    SELECT ec.*, COALESCE(ec.contrato_id::text, 'filial:' || ec.filial) chave,
           (ec.ativo AND ec.contrato_id IS NOT NULL AND (
              oc.planilha_posto = ''
              OR (NOT COALESCE(oc.rt, false) AND pvo.posto IS NULL AND COALESCE(l.ignorar, false))
              OR COALESCE(oc.rt, false)
              OR (pvo.posto IS NULL AND NOT COALESCE(l.ignorar, false)
                  AND public.sup_norm_nome(l.planilha_posto) = 'RENDATECNICA')
           )) IS TRUE fora_do_tem
      FROM ec
      LEFT JOIN LATERAL (
        SELECT x.planilha_posto, public.sup_norm_nome(x.planilha_posto) = 'RENDATECNICA' AS rt
          FROM public."RH_POSTO_COLABORADOR" x
         WHERE ec.ativo AND x.empresa = ec.emp_num AND x.cadastro::text = ec.cadastro
           AND x.contrato_id = ec.contrato_id
      ) oc ON true
      LEFT JOIN pv_hoje pvo
             ON pvo.contrato_id = ec.contrato_id AND oc.planilha_posto <> '' AND NOT oc.rt
            AND pvo.pn = public.sup_norm_nome(oc.planilha_posto)
      LEFT JOIN lig l
             ON ec.ativo AND l.contrato_id = ec.contrato_id AND l.posto_senior = ec.posto_senior
  ),
  mov AS MATERIALIZED (
    SELECT p.chave, mm.ini,
           count(*) FILTER (WHERE NOT p.fora_do_tem AND CASE
                              -- mês corrente: a foto de hoje, igual ao "Tem" do Ativos/Contratos
                              WHEN mm.ini = date_trunc('month', current_date)::date
                                THEN p.ativo AND p.trabalhando_hoje
                              ELSE p.conta AND COALESCE(p.adm <= mm.fim, true) AND (p.dem IS NULL OR p.dem > mm.fim)
                                   AND (p.afast_desde IS NULL OR p.afast_desde > mm.fim)
                            END) trabalhando,
           count(*) FILTER (WHERE p.conta AND p.adm <= mm.fim AND (p.dem IS NULL OR p.dem > mm.fim)) efetivo,
           count(*) FILTER (WHERE p.adm BETWEEN mm.ini AND mm.fim) admissoes,
           count(*) FILTER (WHERE NOT p.fora_turnover AND p.dem BETWEEN mm.ini AND mm.fim) demissoes
      FROM pessoa p CROSS JOIN mm
     GROUP BY 1, 2
  ),
  -- Contrato encerrado sem ninguém ativo: o Ativos/Contratos não lista.
  encerrado_vazio AS MATERIALIZED (
    SELECT c.id::text chave
      FROM public.contratos c
     WHERE COALESCE(c.status, 'ativo') = 'encerrado'
       AND NOT EXISTS (SELECT 1 FROM ec WHERE ec.ativo AND ec.contrato_id = c.id)
  ),
  -- Previsto: a planilha vigente no fim de cada mês, um posto por nome,
  -- sem RENDA TÉCNICA (a conta do Ativos/Contratos). `postos` conta todos,
  -- RT inclusive: é o "tem planilha" que o cartão do Ativos/Contratos usa.
  pv AS MATERIALIZED (
    SELECT x.contrato_id::text chave, x.ini,
           COALESCE(sum(x.vagas) FILTER (WHERE NOT x.rt), 0) previsto,
           count(*) postos
      FROM (
        SELECT DISTINCT ON (pc.contrato_id, public.sup_norm_nome(pc.posto), mm.ini)
               pc.contrato_id, mm.ini, COALESCE(pc.qt_postos, 0) vagas,
               public.sup_norm_nome(pc.posto) = 'RENDATECNICA' rt
          FROM public.planilha_custo pc
          JOIN mm ON pc.data_vigencia <= mm.fim
         WHERE pc.contrato_id IS NOT NULL
           AND pc.orexec = 'EXECUTADO'
           AND NOT COALESCE(pc.encerrado, false)
           AND pc.data_vigencia IS NOT NULL
           AND COALESCE(btrim(pc.posto), '') <> ''
         ORDER BY pc.contrato_id, public.sup_norm_nome(pc.posto), mm.ini, pc.data_vigencia DESC
      ) x
     WHERE NOT (x.ini = date_trunc('month', current_date)::date
                AND x.contrato_id::text IN (SELECT chave FROM encerrado_vazio))
     GROUP BY 1, 2
  ),
  chaves AS MATERIALIZED (
    SELECT chave FROM mov WHERE efetivo > 0 OR admissoes > 0 OR demissoes > 0
    UNION
    SELECT chave FROM pv WHERE previsto > 0
  ),
  info AS MATERIALIZED (   -- nome e empresa (a empresa de quem mais trabalha no contrato)
    SELECT k.chave,
           COALESCE(c.nome, substr(k.chave, 8)) nome,
           c.id IS NOT NULL no_erp,
           COALESCE((SELECT p.empresa FROM pessoa p WHERE p.chave = k.chave GROUP BY p.empresa ORDER BY count(*) DESC LIMIT 1), '(sem empresa)') empresa
      FROM chaves k
      LEFT JOIN public.contratos c ON k.chave !~ '^filial:' AND c.id::text = k.chave
  ),
  linhas AS (
    SELECT i.empresa, jsonb_build_object(
             'chave', i.chave, 'nome', i.nome, 'no_erp', i.no_erp,
             'meses', (SELECT jsonb_agg(jsonb_build_object(
                         'mes', to_char(mm.ini, 'YYYY-MM'),
                         'previsto', COALESCE(pv.previsto, 0), 'trabalhando', COALESCE(mv.trabalhando, 0),
                         'efetivo', COALESCE(mv.efetivo, 0), 'planilha', COALESCE(pv.postos, 0) > 0,
                         'admissoes', COALESCE(mv.admissoes, 0), 'demissoes', COALESCE(mv.demissoes, 0)) ORDER BY mm.ini)
                         FROM mm
                         LEFT JOIN pv  ON pv.chave = i.chave AND pv.ini = mm.ini
                         LEFT JOIN mov mv ON mv.chave = i.chave AND mv.ini = mm.ini)) c
      FROM info i
  )
  SELECT jsonb_build_object(
    'ano', v_ano,
    'meses', (SELECT COALESCE(jsonb_agg(to_char(ini, 'YYYY-MM') ORDER BY ini), '[]'::jsonb) FROM mm),
    'gerado_em', now(),
    'empresas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('empresa', x.empresa, 'contratos', x.cs) ORDER BY (x.empresa LIKE '(%'), x.empresa)
        FROM (SELECT empresa, jsonb_agg(c ORDER BY (c->>'no_erp')::boolean DESC, c->>'nome') cs FROM linhas GROUP BY empresa) x), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.dir_turnover_variacao_efetivo(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dir_turnover_variacao_efetivo(integer) TO authenticated;

-- ── 4) Operacional › Indicadores de Contratos (turnover por contrato) ─────────
CREATE OR REPLACE FUNCTION public.ope_contratos_ind_dados(p_competencia text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_comp text;
  v_ini date;
  v_fim date;
  v_dias int;
  v_jan date;
  v_janela_ini date;
  v_out jsonb;
BEGIN
  v_comp := CASE WHEN p_competencia ~ '^\d{4}-(0[1-9]|1[0-2])$' AND p_competencia <= to_char(hoje, 'YYYY-MM')
                 THEN p_competencia ELSE to_char(hoje, 'YYYY-MM') END;
  v_ini := to_date(v_comp || '-01', 'YYYY-MM-DD');
  v_fim := least((v_ini + interval '1 month' - interval '1 day')::date, hoje);
  v_dias := v_fim - v_ini + 1;
  v_jan := date_trunc('year', v_ini)::date;
  v_janela_ini := v_fim - 89;

  WITH
  -- Contrato do ERP de cada nome normalizado (mesma ligação de rh_ac_ativos).
  ct AS MATERIALIZED (
    SELECT DISTINCT ON (public.rh_norm_contrato(c.nome)) public.rh_norm_contrato(c.nome) AS nn, c.id
      FROM public.contratos c
     WHERE public.rh_norm_contrato(c.nome) IS NOT NULL
     ORDER BY public.rh_norm_contrato(c.nome), (COALESCE(c.status, 'ativo') = 'encerrado'), c.created_at DESC
  ),
  dp_nome AS MATERIALIZED (
    SELECT DISTINCT ON (d.filial_nome) d.filial_nome, d.contrato_id
      FROM public.sup_empregado_contrato_depara d ORDER BY d.filial_nome, d.contrato_id
  ),
  dp_nn AS MATERIALIZED (
    SELECT DISTINCT ON (public.rh_norm_contrato(d.filial_nome)) public.rh_norm_contrato(d.filial_nome) AS nn, d.contrato_id
      FROM public.sup_empregado_contrato_depara d
     WHERE public.rh_norm_contrato(d.filial_nome) IS NOT NULL
     ORDER BY public.rh_norm_contrato(d.filial_nome), d.contrato_id
  ),
  -- Efetivo e demissões da competência (Turn-over › Variação de Efetivo).
  e AS MATERIALIZED (
    SELECT public.data_universal(x."Admissão") AS adm,
           CASE WHEN x."Situação" = 'Demitido' THEN public.data_universal(x."Data Afastamento") END AS dem,
           (public.esp_col_esta_ativo(x."Situação") OR x."Situação" = 'Demitido') AS conta,
           COALESCE(NULLIF(btrim(x."Nome Filial"), ''), '(sem filial)') AS filial,
           public.rh_norm_contrato(x."Nome Filial") AS nn_filial,
           public.rh_norm_contrato(x."Descrição do Local") AS nn_local,
           -- SIS-2026-0854: desligamento por encerramento do contrato com o cliente — fora do turnover.
           (x."Situação" = 'Demitido' AND public.turnover_desconsidera(x."ID")) AS fora_turnover
      FROM public."EMPREGADOS" x
     WHERE COALESCE(btrim(x."Nome"), '') <> ''
  ),
  ec AS MATERIALIZED (
    SELECT e.adm, e.dem, e.conta, e.fora_turnover, COALESCE(d1.contrato_id, c1.id, d2.contrato_id, c2.id) AS contrato_id
      FROM e
      LEFT JOIN dp_nome d1 ON d1.filial_nome = e.filial
      LEFT JOIN ct c1      ON c1.nn = e.nn_filial
      LEFT JOIN dp_nn d2   ON d2.nn = e.nn_filial
      LEFT JOIN ct c2      ON c2.nn = e.nn_local
     WHERE e.dem IS NULL OR e.dem >= v_ini
  ),
  mov AS (
    SELECT contrato_id,
           count(*) FILTER (WHERE conta AND adm <= v_fim AND (dem IS NULL OR dem > v_fim)) AS efetivo,
           count(*) FILTER (WHERE NOT fora_turnover AND dem BETWEEN v_ini AND v_fim) AS demissoes
      FROM ec WHERE contrato_id IS NOT NULL
     GROUP BY 1
  ),
  -- Postos: implantado × Tem (ope_efet_previsto_planilha).
  base AS MATERIALIZED (SELECT * FROM public.contrato_postos_base(hoje)),
  pv AS (
    SELECT b.contrato_id,
           COALESCE(sum(b.implantado) FILTER (WHERE NOT b.rt), 0) AS implantado,
           COALESCE(sum(b.previsto) FILTER (WHERE NOT b.rt), 0) AS previsto,
           COALESCE(bool_or(b.registrado) FILTER (WHERE NOT b.rt), false) AS registrado
      FROM base b GROUP BY 1
  ),
  tem AS (
    SELECT a.contrato_id,
           count(*) FILTER (WHERE NOT a.fora AND NOT a.rt AND a.conta) AS tem,
           count(*) FILTER (WHERE NOT a.fora AND NOT a.rt AND NOT a.conta) AS afastados
      FROM public.rh_ac_pessoas_posto() a
     WHERE a.contrato_id IS NOT NULL
     GROUP BY 1
  ),
  -- Atestados por dia (rh_ac_atestados_dias), só a competência.
  afa AS MATERIALIZED (
    SELECT a.contrato_id, upper(btrim(a.nome)) AS quem, a.data_inicio AS ini,
           public.sst_afa_fim(a.data_inicio, a.dias_considerados, a.retornou_em) AS fim
      FROM public."SST_AFASTAMENTO" a
     WHERE a.tipo IN ('atestado', 'atestado_acompanhante')
       AND NOT a.cancelado
       AND a.contrato_id IS NOT NULL
       AND a.data_inicio <= v_fim
       AND a.data_inicio >= v_ini - 400   -- atestado não dura mais que isso; poupa o índice
  ),
  fal AS (
    SELECT contrato_id, count(*) AS dias_pessoa, count(DISTINCT quem) AS pessoas
      FROM (SELECT DISTINCT f.contrato_id, d.d::date AS dia, f.quem
              FROM afa f
              CROSS JOIN LATERAL generate_series(greatest(f.ini, v_ini), least(f.fim, v_fim), interval '1 day') AS d(d)
             WHERE f.fim >= v_ini) z
     GROUP BY 1
  ),
  -- Notificações do Jurídico (glosas e reclamações), 90 dias.
  nt AS MATERIALIZED (
    SELECT ct.id AS contrato_id, n.tipo,
           coalesce(n.valor_final, n.valor_original, 0) AS valor,
           coalesce(nullif(btrim(n.causa_raiz), ''), nullif(btrim(n.assunto), ''), n.tipo, 'Sem causa registrada') AS causa,
           n.resultado
      FROM public."JUR_NOTIFICACOES" n
      LEFT JOIN ct ON ct.nn = public.rh_norm_contrato(n.contrato)
     WHERE coalesce(n.data_recebimento, n.created_at::date) BETWEEN v_janela_ini AND v_fim
  ),
  gl AS (
    SELECT contrato_id, sum(valor) AS valor, count(*) AS qtd,
           (array_agg(left(causa, 90) ORDER BY valor DESC))[1] AS causa
      FROM nt
     WHERE tipo = 'Glosa' AND coalesce(resultado, '') NOT IN ('Revertida', 'Cancelada pelo órgão')
     GROUP BY 1
  ),
  rc AS (
    SELECT contrato_id, count(*) AS qtd,
           (SELECT left(x.causa, 90) FROM nt x
             WHERE x.contrato_id IS NOT DISTINCT FROM r.contrato_id AND coalesce(x.tipo, '') NOT IN ('Glosa', 'Multa')
             GROUP BY x.causa ORDER BY count(*) DESC, x.causa LIMIT 1) AS causa
      FROM nt r
     WHERE coalesce(tipo, '') NOT IN ('Glosa', 'Multa')
     GROUP BY 1
  ),
  -- Orçado: Planilha de Custo EXECUTADA vigente no fim de cada mês do ano.
  mm AS (
    SELECT g::date AS ini, least((g + interval '1 month' - interval '1 day')::date, hoje) AS fim
      FROM generate_series(v_jan, v_ini, interval '1 month') g
  ),
  pc AS MATERIALIZED (
    SELECT DISTINCT ON (p.contrato_id, public.sup_norm_nome(p.posto), mm.ini)
           p.contrato_id, mm.ini,
           COALESCE(p.qt_postos, 0) AS qt,
           COALESCE(p.total_por_empregado, 0) AS total,
           COALESCE(p.lucro, 0) AS lucro,
           COALESCE(p.custos_indiretos, 0) + COALESCE(p.lucro, 0) + COALESCE(p.cofins, 0) + COALESCE(p.pis, 0)
             + COALESCE(p.irpj_csll, 0) + COALESCE(p.iss, 0) AS fora_do_direto
      FROM public.planilha_custo p
      JOIN mm ON p.data_vigencia <= mm.fim
     WHERE p.contrato_id IS NOT NULL
       AND p.orexec = 'EXECUTADO'
       AND NOT COALESCE(p.encerrado, false)
       AND p.data_vigencia IS NOT NULL
       AND COALESCE(btrim(p.posto), '') <> ''
     ORDER BY p.contrato_id, public.sup_norm_nome(p.posto), mm.ini, p.data_vigencia DESC
  ),
  orc_mes AS (
    SELECT contrato_id, ini,
           sum(qt * greatest(total - fora_do_direto, 0)) AS custo_direto,
           sum(qt * total) AS preco,
           sum(qt * lucro) AS lucro
      FROM pc GROUP BY 1, 2
  ),
  orc AS (
    SELECT o.contrato_id,
           jsonb_object_agg(to_char(o.ini, 'YYYY-MM'), round(o.custo_direto, 2)) FILTER (WHERE o.custo_direto > 0) AS custo_por_mes,
           max(o.preco) FILTER (WHERE o.ini = v_ini) AS preco,
           max(o.lucro) FILTER (WHERE o.ini = v_ini) AS lucro
      FROM orc_mes o GROUP BY 1
  ),
  cids AS (
    SELECT id AS contrato_id FROM public.contratos WHERE COALESCE(status, 'ativo') <> 'encerrado'
    UNION SELECT contrato_id FROM tem WHERE tem > 0 OR afastados > 0
    UNION SELECT contrato_id FROM gl WHERE contrato_id IS NOT NULL
    UNION SELECT contrato_id FROM rc WHERE contrato_id IS NOT NULL
  )
  SELECT jsonb_build_object(
    'competencia', v_comp,
    'de', v_ini, 'ate', v_fim, 'dias', v_dias,
    'janela_notificacoes', jsonb_build_object('de', v_janela_ini, 'ate', v_fim),
    'gerado_em', now(),
    'contratos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', c.id, 'nome', c.nome, 'cliente', c.cliente,
               'encerrado', COALESCE(c.status, 'ativo') = 'encerrado',
               'postos', CASE WHEN pv.contrato_id IS NULL THEN NULL ELSE jsonb_build_object(
                           'contratados', pv.implantado, 'previsto', pv.previsto, 'implantado_registrado', pv.registrado,
                           'cobertos', COALESCE(t.tem, 0), 'afastados', COALESCE(t.afastados, 0)) END,
               'efetivo', COALESCE(mv.efetivo, 0),
               'demissoes', COALESCE(mv.demissoes, 0),
               'atestados', jsonb_build_object('dias_pessoa', COALESCE(f.dias_pessoa, 0), 'pessoas', COALESCE(f.pessoas, 0)),
               'glosas', jsonb_build_object('valor', COALESCE(g.valor, 0), 'qtd', COALESCE(g.qtd, 0), 'causa', g.causa),
               'reclamacoes', jsonb_build_object('qtd', COALESCE(r.qtd, 0), 'causa', r.causa),
               'orcado', CASE WHEN o.contrato_id IS NULL THEN NULL ELSE jsonb_build_object(
                           'custo_direto_por_mes', COALESCE(o.custo_por_mes, '{}'::jsonb),
                           'margem_prevista', CASE WHEN o.preco > 0 AND o.lucro > 0 AND o.lucro / o.preco < 0.6
                                                   THEN round(100 * o.lucro / o.preco, 2) END) END)
             ORDER BY c.nome)
        FROM cids
        JOIN public.contratos c ON c.id = cids.contrato_id
        LEFT JOIN pv  ON pv.contrato_id = c.id
        LEFT JOIN tem t ON t.contrato_id = c.id
        LEFT JOIN mov mv ON mv.contrato_id = c.id
        LEFT JOIN fal f ON f.contrato_id = c.id
        LEFT JOIN gl g ON g.contrato_id = c.id
        LEFT JOIN rc r ON r.contrato_id = c.id
        LEFT JOIN orc o ON o.contrato_id = c.id), '[]'::jsonb),
    'sem_contrato', jsonb_build_object(
      'glosas_valor', COALESCE((SELECT valor FROM gl WHERE contrato_id IS NULL), 0),
      'glosas_qtd', COALESCE((SELECT qtd FROM gl WHERE contrato_id IS NULL), 0),
      'reclamacoes_qtd', COALESCE((SELECT qtd FROM rc WHERE contrato_id IS NULL), 0))
  ) INTO v_out;

  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.ope_contratos_ind_dados(text) FROM PUBLIC, anon, authenticated;

-- ── 5) Central de Serviços › Formulários › Rotatividade (e o assistente de IA dos formulários) ───
CREATE OR REPLACE FUNCTION public.cs_form_rotatividade(p_meses integer DEFAULT 12)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_n   int := LEAST(GREATEST(COALESCE(p_meses, 12), 1), 24);
  v_out jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501'; END IF;
  IF NOT public.cs_form_cap('rotatividade') THEN
    RAISE EXCEPTION 'Sem acesso à Rotatividade dos formulários.' USING ERRCODE = '42501';
  END IF;
  WITH
  mm AS MATERIALIZED (
    SELECT (row_number() OVER (ORDER BY s.ini))::int AS i, s.ini,
           LEAST((s.ini + interval '1 month' - interval '1 day')::date, current_date) AS fim
      FROM (SELECT (date_trunc('month', current_date) - make_interval(months => g))::date AS ini
              FROM generate_series(0, v_n - 1) g) s
  ),
  e AS MATERIALIZED (
    SELECT public.data_universal(x."Admissão"::text) AS adm,
           CASE WHEN x."Situação" = 'Demitido' THEN public.data_universal(x."Data Afastamento"::text) END AS dem,
           (public.esp_col_esta_ativo(x."Situação") OR x."Situação" = 'Demitido') AS conta,
           x."Empresa"::bigint AS empresa, x."Filial"::bigint AS filial,
           NULLIF(btrim(x."Nome Filial"), '') AS nome_filial,
           NULLIF(btrim(CASE WHEN a.empregado_id IS NOT NULL THEN a.posto_codigo ELSE x."Posto" END), '') AS posto,
           NULLIF(btrim(x."Nome do Posto"), '') AS posto_senior,
           COALESCE(NULLIF(upper(btrim(regexp_replace(COALESCE(x."Título do Cargo", ''), '\s+', ' ', 'g'))), ''), '(SEM FUNÇÃO)') AS funcao,
           -- SIS-2026-0854: desligamento por encerramento do contrato com o cliente — fora do turnover.
           (x."Situação" = 'Demitido' AND public.turnover_desconsidera(x."ID")) AS fora_turnover
      FROM public."EMPREGADOS" x
      LEFT JOIN public."RH_POSTO_OCUPANTE_ERP" a ON a.empregado_id = x."ID"
     WHERE COALESCE(btrim(x."Nome"), '') <> '' AND x."Empresa" IS NOT NULL AND x."Filial" IS NOT NULL
  ),
  ep AS MATERIALIZED (
    SELECT * FROM e
     WHERE (e.adm IS NULL OR e.adm <= (SELECT max(fim) FROM mm))
       AND (e.dem IS NULL OR e.dem >= (SELECT min(ini) FROM mm))
  ),
  mov AS MATERIALIZED (
    SELECT p.empresa, p.filial, p.posto, p.funcao, mm.i,
           count(*) FILTER (WHERE p.conta AND p.adm <= mm.fim AND (p.dem IS NULL OR p.dem > mm.fim)) AS trab,
           count(*) FILTER (WHERE NOT p.fora_turnover AND p.dem BETWEEN mm.ini AND mm.fim) AS dem,
           count(*) FILTER (WHERE p.adm BETWEEN mm.ini AND mm.fim) AS adm
      FROM ep p CROSS JOIN mm
     GROUP BY 1, 2, 3, 4, 5
  ),
  g AS MATERIALIZED (
    SELECT DISTINCT empresa, filial, posto, funcao FROM mov WHERE trab > 0 OR dem > 0 OR adm > 0
  ),
  nomes AS MATERIALIZED (
    SELECT empresa, filial, min(nome_filial) AS nome FROM e GROUP BY 1, 2
  ),
  pnome AS MATERIALIZED (
    SELECT posto, min(posto_senior) AS nome FROM e WHERE posto IS NOT NULL GROUP BY 1
  ),
  linhas AS (
    SELECT g.empresa, g.filial, g.posto, g.funcao,
           array_agg(COALESCE(m.trab, 0) ORDER BY mm.i) AS trab,
           array_agg(COALESCE(m.dem, 0)  ORDER BY mm.i) AS dem,
           array_agg(COALESCE(m.adm, 0)  ORDER BY mm.i) AS adm
      FROM g CROSS JOIN mm
      LEFT JOIN mov m ON m.empresa = g.empresa AND m.filial = g.filial AND m.funcao = g.funcao
                     AND m.posto IS NOT DISTINCT FROM g.posto AND m.i = mm.i
     GROUP BY 1, 2, 3, 4
  )
  SELECT jsonb_build_object(
    'meses', (SELECT jsonb_agg(to_char(ini, 'YYYY-MM') ORDER BY ini) FROM mm),
    'gerado_em', now(),
    'linhas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'empresa', l.empresa, 'filial', l.filial,
               'contrato', COALESCE(n.nome, format('Filial %s-%s', l.empresa, l.filial)),
               'posto', l.posto,
               'posto_nome', COALESCE(NULLIF(btrim(pt.titulo), ''), pt.descricao, pn.nome),
               'funcao', l.funcao, 'trab', to_jsonb(l.trab), 'dem', to_jsonb(l.dem), 'adm', to_jsonb(l.adm)))
        FROM linhas l
        LEFT JOIN nomes n ON n.empresa = l.empresa AND n.filial = l.filial
        LEFT JOIN public."RH_POSTO_TRABALHO" pt ON pt.codigo = l.posto
        LEFT JOIN pnome pn ON pn.posto = l.posto), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.cs_form_rotatividade(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_form_rotatividade(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Reaplicar as cinco funções das migs de origem (20261008000004,
-- 20261007000013, 20261026000040, 20261111100000, 20261030001000), depois:
--   DROP FUNCTION IF EXISTS public.turnover_desconsidera(bigint);
--   DROP INDEX IF EXISTS public.idx_sol_demissao_encerramento_contrato;
--   ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO" DROP COLUMN IF EXISTS encerramento_contrato;
