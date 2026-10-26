-- =========================================================================
-- RELATÓRIOS › TURN-OVER › VARIAÇÃO DE EFETIVO (25/10/2026)
--
-- PEDIDO (Pablo, com o modelo variacao_efetivo_erp.html): uma aba nova no
-- Turn-over com a variação mensal do efetivo por empresa e contrato — os 12
-- meses na mesma tabela (efetivo previsto, efetivo trabalhando, turnover,
-- demissões e admissões) — e o detalhamento de cada contrato. Os números
-- saem das mesmas regras das telas que já existem:
--
--   EFETIVO PREVISTO  = RH › Ativos/Contratos (rh_ac_painel): soma das vagas
--     (qt_postos) da Planilha de Custo EXECUTADA, não encerrada, um posto por
--     nome, a versão de maior data_vigencia. Aqui a versão vale no FIM DE CADA
--     MÊS (data_vigencia <= último dia do mês), então o previsto acompanha os
--     aditivos ao longo do ano.
--   EFETIVO TRABALHANDO = o "efetivo no fim do mês" do Turn-over
--     (dir_turnover_painel_dados): admitido até o último dia do mês e não
--     desligado até ele (ativos e demitidos — o demitido conta nos meses em
--     que ainda estava). O contrato da pessoa é ligado como no Ativos/
--     Contratos (rh_ac_ativos: de-para da filial, nome da filial, nome do local).
--   ADMISSÕES / DEMISSÕES = Relatórios › Colaboradores e Turn-over: data de
--     admissão no mês / desligamento (Situação Demitido + Data Afastamento)
--     no mês.
--   TURNOVER do mês = demissões ÷ efetivo trabalhando no fim do mês × 100 —
--     a taxa mensal do Turn-over (a tela soma/agrega a partir dos números).
--
-- Quem não liga a contrato do ERP entra agrupado pela filial da Senior
-- (previsto 0). Meses que ainda não começaram vêm vazios.
--
-- Mesmo acesso do Turn-over (diretoria_rel_turnover). Só leitura. Idempotente.
-- =========================================================================

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
           CASE x."Empresa" WHEN 1 THEN 'HAGG' WHEN 2 THEN 'SN' WHEN 3 THEN 'CANAÃ' WHEN 4 THEN 'LF' WHEN 5 THEN 'NH' ELSE '(sem empresa)' END empresa,
           COALESCE(NULLIF(btrim(x."Nome Filial"), ''), '(sem filial)') filial,
           public.rh_norm_contrato(x."Nome Filial") nn_filial,
           public.rh_norm_contrato(x."Descrição do Local") nn_local
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
     WHERE (e.adm IS NULL OR e.adm <= (SELECT max(fim) FROM mm))
       AND (e.dem IS NULL OR e.dem >= make_date(v_ano, 1, 1))
  ),
  -- Chave do contrato: o do ERP, ou a filial da Senior quando não liga.
  pessoa AS MATERIALIZED (
    SELECT ec.*, COALESCE(ec.contrato_id::text, 'filial:' || ec.filial) chave FROM ec
  ),
  mov AS MATERIALIZED (
    SELECT p.chave, mm.ini,
           count(*) FILTER (WHERE p.conta AND p.adm <= mm.fim AND (p.dem IS NULL OR p.dem > mm.fim)) trabalhando,
           count(*) FILTER (WHERE p.adm BETWEEN mm.ini AND mm.fim) admissoes,
           count(*) FILTER (WHERE p.dem BETWEEN mm.ini AND mm.fim) demissoes
      FROM pessoa p CROSS JOIN mm
     GROUP BY 1, 2
  ),
  -- Previsto: a planilha vigente no fim de cada mês, um posto por nome.
  pv AS MATERIALIZED (
    SELECT x.contrato_id::text chave, x.ini, sum(x.vagas) previsto
      FROM (
        SELECT DISTINCT ON (pc.contrato_id, public.sup_norm_nome(pc.posto), mm.ini)
               pc.contrato_id, mm.ini, COALESCE(pc.qt_postos, 0) vagas
          FROM public.planilha_custo pc
          JOIN mm ON pc.data_vigencia <= mm.fim
         WHERE pc.contrato_id IS NOT NULL
           AND pc.orexec = 'EXECUTADO'
           AND NOT COALESCE(pc.encerrado, false)
           AND pc.data_vigencia IS NOT NULL
           AND COALESCE(btrim(pc.posto), '') <> ''
         ORDER BY pc.contrato_id, public.sup_norm_nome(pc.posto), mm.ini, pc.data_vigencia DESC
      ) x
     GROUP BY 1, 2
  ),
  chaves AS MATERIALIZED (
    SELECT chave FROM mov WHERE trabalhando > 0 OR admissoes > 0 OR demissoes > 0
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

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.dir_turnover_variacao_efetivo(integer);
