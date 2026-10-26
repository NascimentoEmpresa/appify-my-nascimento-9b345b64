-- =========================================================================
-- TV GERÊNCIA OPERACIONAL = RELATÓRIOS › TURNOVER (14/10/2026)
--
-- Pablo: a TV Gerência Operacional espelha "/app/relatorios/turnover resumo
-- turnover e turnover em valores". Os cartões das duas abas (ano corrente,
-- todos os meses e causas — o padrão da tela): Turnover geral (soma das taxas
-- mensais, 42,66% em 14/10), Projeção para o ano, Turnover do mês, Rescisões
-- no período, Tempo de casa médio e mediano, Saíram com até 3 meses; gráficos
-- Turnover por contrato (próprio), Rescisões por tempo de empresa e Por tipo
-- de desligamento; tendência = Turnover mês a mês × aceitável (3,42%).
-- Para a TV ler a aba "Turnover em Valores", o corpo de dir_turnover_rescisoes
-- vira dir_turnover_rescisoes_dados (interna, sem portão) — a RPC da tela
-- continua cobrando o acesso e chama a interna.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

-- Relatórios › Turnover › Turnover em Valores: o corpo de dir_turnover_rescisoes vira a função
-- interna dir_turnover_rescisoes_dados (sem o portão de login, como dir_turnover_painel_dados),
-- para a TV ler a MESMA conta. A RPC da tela continua cobrando o acesso e chama a interna — nada
-- muda para a tela.
CREATE OR REPLACE FUNCTION public.dir_turnover_rescisoes_dados(_ano integer DEFAULT NULL::integer, _meses integer[] DEFAULT NULL::integer[], _contrato text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ano int := COALESCE(_ano, extract(year FROM current_date)::int);
  v_meses int[];
  v_out jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(_meses) m WHERE m IS NULL OR m < 1 OR m > 12) THEN RAISE EXCEPTION 'Mês inválido'; END IF;
  v_meses := COALESCE(NULLIF(_meses, '{}'), ARRAY(SELECT generate_series(1, 12)));

  WITH r AS MATERIALIZED (   -- uma linha por rescisão
    SELECT x."Empresa"::int emp, x."Cadastro"::int cad,
           public.data_universal(x."Admissão") adm,
           public.data_universal(x."Data Afastamento") dem,
           COALESCE(NULLIF(btrim(x."Nome Filial"), ''), '(sem contrato)') contrato,
           CASE x."Empresa" WHEN 1 THEN 'HAGG' WHEN 2 THEN 'SN' WHEN 3 THEN 'CANAÃ' WHEN 4 THEN 'LF' WHEN 5 THEN 'NH' ELSE '(sem empresa)' END empresa,
           COALESCE(NULLIF(btrim(x."Descrição (Causa)"), ''), '(não informado)') causa
      FROM public."EMPREGADOS" x
     WHERE x."Situação" = 'Demitido'
       AND COALESCE(btrim(x."Nome"), '') <> ''
       AND (_contrato IS NULL OR x."Nome Filial" = _contrato)
  ),
  d AS MATERIALIZED (
    SELECT r.*, CASE WHEN r.adm IS NOT NULL AND r.adm <= r.dem THEN r.dem - r.adm END dias
      FROM r
     WHERE extract(year FROM r.dem)::int = v_ano AND extract(month FROM r.dem)::int = ANY(v_meses)
  ),
  f AS (
    SELECT d.*,
           CASE WHEN d.dias IS NULL THEN 0 WHEN d.dias <= 90 THEN 1 WHEN d.dias <= 182 THEN 2 WHEN d.dias <= 365 THEN 3
                WHEN d.dias <= 730 THEN 4 WHEN d.dias <= 1826 THEN 5 ELSE 6 END ordem
      FROM d
  ),
  -- Verbas de férias da rescisão (cálculo mensal do mês do afastamento).
  vb AS (
    SELECT v.codeve, count(DISTINCT (d.emp, d.cad)) n
      FROM d
      JOIN espelho."R044CAL" c ON c.numemp = d.emp AND c.tipcal = 11 AND c.perref = date_trunc('month', d.dem)
      JOIN espelho."R046VER" v ON v.numemp = d.emp AND v.numcad = d.cad AND v.codcal = c.codcal
                              AND v.codeve IN (650, 651, 1400)
     GROUP BY 1
  ),
  av AS (
    SELECT s.modelo_aviso modelo, count(*) n
      FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s
     WHERE s.status NOT IN ('Cancelada', 'Reprovada')
       AND COALESCE(btrim(s.modelo_aviso), '') <> ''
       AND extract(year FROM COALESCE(s.data_aviso, s.data_solicitacao, s.criado_em::date))::int = v_ano
       AND extract(month FROM COALESCE(s.data_aviso, s.data_solicitacao, s.criado_em::date))::int = ANY(v_meses)
       AND (_contrato IS NULL OR s.contrato = _contrato)
     GROUP BY 1
  )
  SELECT jsonb_build_object(
    'ano', v_ano, 'meses', to_jsonb(v_meses),
    'total', (SELECT count(*) FROM d),
    'tempo_medio_dias', (SELECT round(avg(dias)) FROM d),
    'tempo_mediano_dias', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY dias) FROM d WHERE dias IS NOT NULL),
    'por_faixa', (SELECT COALESCE(jsonb_agg(jsonb_build_object('ordem', o.ordem, 'faixa', o.faixa, 'n', COALESCE(x.n, 0)) ORDER BY o.ordem), '[]'::jsonb)
                    FROM (VALUES (1, 'Até 3 meses'), (2, '3 a 6 meses'), (3, '6 meses a 1 ano'), (4, '1 a 2 anos'),
                                 (5, '2 a 5 anos'), (6, 'Mais de 5 anos'), (0, 'Sem data de admissão')) o(ordem, faixa)
                    LEFT JOIN (SELECT ordem, count(*) n FROM f GROUP BY 1) x USING (ordem)
                   WHERE o.ordem > 0 OR x.n > 0),
    'por_mes', (SELECT COALESCE(jsonb_agg(jsonb_build_object('mes', x.mes, 'n', x.n) ORDER BY x.mes), '[]'::jsonb)
                  FROM (SELECT to_char(dem, 'YYYY-MM') mes, count(*) n FROM d GROUP BY 1) x),
    'por_empresa', (SELECT COALESCE(jsonb_agg(jsonb_build_object('empresa', x.empresa, 'n', x.n) ORDER BY x.n DESC), '[]'::jsonb)
                      FROM (SELECT empresa, count(*) n FROM d GROUP BY 1) x),
    'por_causa', (SELECT COALESCE(jsonb_agg(jsonb_build_object('causa', x.causa, 'n', x.n) ORDER BY x.n DESC, x.causa), '[]'::jsonb)
                    FROM (SELECT causa, count(*) n FROM d GROUP BY 1) x),
    'por_contrato', (SELECT COALESCE(jsonb_agg(jsonb_build_object('contrato', x.contrato, 'n', x.n, 'ate_3m', x.ate_3m,
                                                                'tempo_medio_dias', x.medio) ORDER BY x.n DESC, x.contrato), '[]'::jsonb)
                       FROM (SELECT contrato, count(*) n, count(*) FILTER (WHERE ordem = 1) ate_3m, round(avg(dias)) medio
                               FROM f GROUP BY 1) x),
    'avisos', (SELECT COALESCE(jsonb_agg(jsonb_build_object('modelo', modelo, 'n', n) ORDER BY n DESC, modelo), '[]'::jsonb) FROM av),
    'verbas', (SELECT COALESCE(jsonb_agg(jsonb_build_object('codigo', o.codeve, 'verba', o.verba, 'n', COALESCE(vb.n, 0)) ORDER BY o.ordem), '[]'::jsonb)
                 FROM (VALUES (1, 651, 'Férias proporcionais'), (2, 650, 'Férias vencidas'), (3, 1400, 'Férias indenizadas')) o(ordem, codeve, verba)
                 LEFT JOIN vb USING (codeve))
  ) INTO v_out;
  RETURN v_out;
END $function$;
REVOKE ALL ON FUNCTION public.dir_turnover_rescisoes_dados(integer, integer[], text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.dir_turnover_rescisoes(_ano integer DEFAULT NULL::integer, _meses integer[] DEFAULT NULL::integer[], _contrato text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.dir_rel_exige('diretoria_rel_turnover');
  RETURN public.dir_turnover_rescisoes_dados(_ano, _meses, _contrato);
END $function$;

-- tempoDeCasa de src/lib/diretoria/turnover.ts: 45 → "45 dias"; 170 → "5 meses"; 453 → "1 ano e 2 meses".
CREATE OR REPLACE FUNCTION public.tvg_tempo_de_casa(p_dias numeric)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $fn$
DECLARE d int; mt int; a int; m int; sa text := ''; sm text := '';
BEGIN
  IF p_dias IS NULL THEN RETURN '—'; END IF;
  d := round(p_dias);
  IF d < 60 THEN RETURN d || ' dia' || CASE WHEN d = 1 THEN '' ELSE 's' END; END IF;
  mt := floor(d / 30.4375); a := mt / 12; m := mt % 12;
  IF a > 0 THEN sa := a || ' ano' || CASE WHEN a > 1 THEN 's' ELSE '' END; END IF;
  IF m > 0 THEN sm := m || ' ' || CASE WHEN m > 1 THEN 'meses' ELSE 'mês' END; END IF;
  RETURN coalesce(nullif(concat_ws(' e ', nullif(sa, ''), nullif(sm, '')), ''), '1 ano');
END $fn$;

-- Operacional = Relatórios › Turnover: abas "Resumo Turnover" e "Turnover em Valores", ano corrente,
-- todos os meses e causas (o padrão da tela) — dir_turnover_painel_dados + dir_turnover_rescisoes_dados.
CREATE OR REPLACE FUNCTION public.tvg_espelho_turnover()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  ano int := extract(year FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int;
  d jsonb := public.dir_turnover_painel_dados(extract(year FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int, NULL, NULL, NULL, NULL);
  rr jsonb := public.dir_turnover_rescisoes_dados(extract(year FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int, NULL, NULL);
  soma numeric; dem numeric; ate3 numeric; tot numeric; ult jsonb;
BEGIN
  SELECT round(sum((m->>'taxa')::numeric), 2), sum((m->>'demissoes')::numeric) INTO soma, dem FROM jsonb_array_elements(d->'mensal') m;
  SELECT m INTO ult FROM jsonb_array_elements(d->'mensal') m ORDER BY m->>'mes' DESC LIMIT 1;
  tot := coalesce((rr->>'total')::numeric, 0);
  ate3 := coalesce((SELECT (f->>'n')::numeric FROM jsonb_array_elements(rr->'por_faixa') f WHERE (f->>'ordem')::int = 1), 0);
  RETURN jsonb_build_object(
    'tela', 'Relatórios › Turnover',
    'periodo', NULL,
    'kpis', jsonb_build_array(
      jsonb_build_object('rotulo', 'Turnover geral ' || ano, 'valor', soma, 'formato', 'pct',
                         'dica', coalesce(dem, 0) || ' demissões · efetivo médio ' || round((d->>'efetivo_medio')::numeric) || ' · aceitável no ano: 41%'),
      jsonb_build_object('rotulo', 'Projeção para o ano', 'valor', round(soma * coalesce((d->>'fator_projecao')::numeric, 1), 2), 'formato', 'pct', 'dica', 'Soma até hoje × dias do ano ÷ dias decorridos'),
      jsonb_build_object('rotulo', 'Turnover do mês', 'valor', (ult->>'taxa')::numeric, 'formato', 'pct',
                         'dica', to_char(to_date(ult->>'mes', 'YYYY-MM'), 'MM/YYYY') || ' · aceitável no mês: 3,42%'),
      jsonb_build_object('rotulo', 'Demissões no ano', 'valor', dem, 'formato', 'n', 'dica', 'efetivo médio ' || round((d->>'efetivo_medio')::numeric)),
      jsonb_build_object('rotulo', 'Rescisões no período', 'valor', tot, 'formato', 'n', 'dica', 'Turnover em Valores · ' || ano),
      jsonb_build_object('rotulo', 'Tempo de casa médio', 'valor', round((rr->>'tempo_medio_dias')::numeric), 'formato', 'dias',
                         'dica', public.tvg_tempo_de_casa((rr->>'tempo_medio_dias')::numeric) || ' · da admissão ao afastamento'),
      jsonb_build_object('rotulo', 'Tempo de casa mediano', 'valor', round((rr->>'tempo_mediano_dias')::numeric), 'formato', 'dias',
                         'dica', public.tvg_tempo_de_casa((rr->>'tempo_mediano_dias')::numeric) || ' · metade saiu antes disso'),
      jsonb_build_object('rotulo', 'Saíram com até 3 meses', 'valor', CASE WHEN tot > 0 THEN round(ate3 * 1000 / tot) / 10 ELSE 0 END, 'formato', 'pct',
                         'dica', ate3 || ' rescisões')),
    'mensal', jsonb_build_object('unidade', 'pct',
      'series', jsonb_build_array(jsonb_build_object('chave', 'taxa', 'rotulo', 'Turnover do mês (%)'), jsonb_build_object('chave', 'meta', 'rotulo', 'Aceitável (3,42%)')),
      'dados', (SELECT jsonb_agg(jsonb_build_object('mes', m->>'mes', 'taxa', (m->>'taxa')::numeric, 'meta', 3.42) ORDER BY m->>'mes') FROM jsonb_array_elements(d->'mensal') m)),
    'graficos', jsonb_build_object(
      'contrato', jsonb_build_object('titulo', 'Turnover por contrato (em relação ao próprio contrato)', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', regexp_replace(c->>'contrato', '^\s*\d+\s*-\s*', ''), 'valor', round((c->>'demissoes')::numeric * 100 / (c->>'efetivo_medio')::numeric, 2),
                                             'rotulo', (c->>'demissoes') || ' demissões') ORDER BY (c->>'demissoes')::numeric / (c->>'efetivo_medio')::numeric DESC)
           FROM (SELECT c FROM jsonb_array_elements(d->'por_contrato') c WHERE (c->>'demissoes')::int > 0 AND (c->>'efetivo_medio')::numeric > 0
                  ORDER BY (c->>'demissoes')::numeric / (c->>'efetivo_medio')::numeric DESC LIMIT 12) z), '[]'::jsonb)),
      'faixa', jsonb_build_object('titulo', 'Rescisões por tempo de empresa', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', f->>'faixa', 'valor', (f->>'n')::numeric) ORDER BY (f->>'ordem')::int)
           FROM jsonb_array_elements(rr->'por_faixa') f WHERE (f->>'ordem')::int > 0 OR (f->>'n')::int > 0), '[]'::jsonb)),
      'causa', jsonb_build_object('titulo', 'Por tipo de desligamento', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', c->>'causa', 'valor', (c->>'n')::numeric) ORDER BY (c->>'n')::int DESC)
           FROM (SELECT c FROM jsonb_array_elements(rr->'por_causa') c ORDER BY (c->>'n')::int DESC LIMIT 6) z), '[]'::jsonb)),
      'empresa', jsonb_build_object('titulo', 'Turnover geral por empresa', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', e->>'empresa', 'valor', (e->>'taxa')::numeric, 'rotulo', (e->>'demissoes') || ' demissões'))
           FROM jsonb_array_elements(d->'por_empresa') e), '[]'::jsonb))));
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_turnover() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tvg_espelho_fonte_extra(p_fonte text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF p_fonte = 'vagas' THEN RETURN public.tvg_espelho_vagas(); END IF;
  IF p_fonte = 'chamados' THEN RETURN public.tvg_espelho_chamados(); END IF;
  IF p_fonte = 'treinamentos' THEN RETURN public.tvg_espelho_treinamentos(); END IF;
  IF p_fonte = 'licitacoes' THEN RETURN public.tvg_espelho_licitacoes(); END IF;
  IF p_fonte = 'plano_acoes' THEN RETURN public.tvg_espelho_plano_acoes(); END IF;
  IF p_fonte = 'geral' THEN RETURN public.tvg_espelho_geral(); END IF;
  IF p_fonte = 'turnover' THEN RETURN public.tvg_espelho_turnover(); END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_fonte_extra(text) FROM PUBLIC, anon, authenticated;

-- Tendência: a unidade vem da fonte (o turnover é %).
CREATE OR REPLACE FUNCTION public.tvg_espelho_tendencia(p_painel text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  p public."TVG_PAINEL"; d jsonb; s1 text; s2 text;
BEGIN
  SELECT * INTO p FROM public."TVG_PAINEL" WHERE slug = p_painel;
  IF p.espelho_fonte IS NULL THEN RETURN NULL; END IF;
  d := public.tvg_espelho_fonte(p.espelho_fonte);
  IF d IS NULL OR jsonb_array_length(coalesce(d->'mensal'->'dados', '[]'::jsonb)) = 0 THEN
    RETURN jsonb_build_object('titulo', NULL, 'series', '[]'::jsonb, 'unidade', 'qtd', 'meses', '[]'::jsonb);
  END IF;
  s1 := coalesce(p.espelho_series[1], d->'mensal'->'series'->0->>'chave');
  s2 := coalesce(p.espelho_series[2], d->'mensal'->'series'->1->>'chave');
  RETURN jsonb_build_object(
    'titulo', 'Mês a mês — ' || replace(d->>'tela', 'Relatórios › ', ''),
    'series', jsonb_build_array(
                (SELECT x->>'rotulo' FROM jsonb_array_elements(d->'mensal'->'series') x WHERE x->>'chave' = s1),
                (SELECT x->>'rotulo' FROM jsonb_array_elements(d->'mensal'->'series') x WHERE x->>'chave' = s2)),
    'unidade', coalesce(d->'mensal'->>'unidade', 'qtd'),
    'meses', (SELECT jsonb_agg(jsonb_build_object('mes', to_char(to_date(m->>'mes', 'YYYY-MM'), 'MM/YY'), 'a', (m->>s1)::numeric, 'b', (m->>s2)::numeric) ORDER BY m->>'mes')
                FROM jsonb_array_elements(d->'mensal'->'dados') m));
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_tendencia(text) FROM PUBLIC, anon, authenticated;

-- ── Cadastro: os cartões das duas abas, na ordem; gráficos por contrato · tempo de empresa · tipo de desligamento ─
UPDATE public."TVG_INDICADOR" SET na_tv = false WHERE painel = 'ger-operacional' AND espelho_fonte IS NULL;
UPDATE public."TVG_PAINEL" SET espelho_fonte = 'turnover', espelho_series = ARRAY['taxa', 'meta'] WHERE slug = 'ger-operacional';

INSERT INTO public."TVG_INDICADOR"
  (codigo, painel, ordem, nome, identificar, fonte, unidade, sentido, meta, alerta, periodicidade, responsavel, na_tv, regra,
   espelho_fonte, espelho_item, espelho_grafico, espelho_destaque)
VALUES
 ('op_t_geral', 'ger-operacional', 1, 'Turnover geral do ano', 'Turnover geral do ano — Relatórios › Turnover.', 'auto', 'pct', 'menor', NULL, NULL, 'diaria', 'Gerência Operacional', true,
  'Igual a Relatórios › Turnover (Resumo e Turnover em Valores, ano corrente, todos os meses e causas): Turnover geral do ano.', 'turnover', 'kpi:0', 'contrato', 1),
 ('op_t_projecao', 'ger-operacional', 2, 'Projeção para o ano', 'Projeção para o ano — Relatórios › Turnover.', 'auto', 'pct', 'menor', NULL, NULL, 'diaria', 'Gerência Operacional', true,
  'Igual a Relatórios › Turnover (Resumo e Turnover em Valores, ano corrente, todos os meses e causas): Projeção para o ano.', 'turnover', 'kpi:1', NULL, NULL),
 ('op_t_mes', 'ger-operacional', 3, 'Turnover do mês', 'Turnover do mês — Relatórios › Turnover.', 'auto', 'pct', 'menor', NULL, NULL, 'diaria', 'Gerência Operacional', true,
  'Igual a Relatórios › Turnover (Resumo e Turnover em Valores, ano corrente, todos os meses e causas): Turnover do mês.', 'turnover', 'kpi:2', NULL, NULL),
 ('op_t_rescisoes', 'ger-operacional', 4, 'Rescisões no período', 'Rescisões no período — Relatórios › Turnover.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'Gerência Operacional', true,
  'Igual a Relatórios › Turnover (Resumo e Turnover em Valores, ano corrente, todos os meses e causas): Rescisões no período.', 'turnover', 'kpi:4', 'faixa', 2),
 ('op_t_casa_medio', 'ger-operacional', 5, 'Tempo de casa médio', 'Tempo de casa médio — Relatórios › Turnover.', 'auto', 'dias', 'maior', NULL, NULL, 'diaria', 'Gerência Operacional', true,
  'Igual a Relatórios › Turnover (Resumo e Turnover em Valores, ano corrente, todos os meses e causas): Tempo de casa médio.', 'turnover', 'kpi:5', NULL, NULL),
 ('op_t_casa_mediano', 'ger-operacional', 6, 'Tempo de casa mediano', 'Tempo de casa mediano — Relatórios › Turnover.', 'auto', 'dias', 'maior', NULL, NULL, 'diaria', 'Gerência Operacional', true,
  'Igual a Relatórios › Turnover (Resumo e Turnover em Valores, ano corrente, todos os meses e causas): Tempo de casa mediano.', 'turnover', 'kpi:6', NULL, NULL),
 ('op_t_ate3', 'ger-operacional', 7, 'Saíram com até 3 meses', 'Saíram com até 3 meses — Relatórios › Turnover.', 'auto', 'pct', 'menor', NULL, NULL, 'diaria', 'Gerência Operacional', true,
  'Igual a Relatórios › Turnover (Resumo e Turnover em Valores, ano corrente, todos os meses e causas): Saíram com até 3 meses.', 'turnover', 'kpi:7', 'causa', 3)
ON CONFLICT (codigo) DO UPDATE SET
  ordem = EXCLUDED.ordem, nome = EXCLUDED.nome, unidade = EXCLUDED.unidade, sentido = EXCLUDED.sentido, na_tv = true, regra = EXCLUDED.regra,
  espelho_fonte = EXCLUDED.espelho_fonte, espelho_item = EXCLUDED.espelho_item, espelho_grafico = EXCLUDED.espelho_grafico, espelho_destaque = EXCLUDED.espelho_destaque;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DELETE FROM public."TVG_INDICADOR" WHERE espelho_fonte = 'turnover';
-- UPDATE public."TVG_PAINEL" SET espelho_fonte = NULL, espelho_series = NULL WHERE slug = 'ger-operacional';
-- UPDATE public."TVG_INDICADOR" SET na_tv = true WHERE codigo IN ('op_contratos_saudaveis', 'op_custo_direto', 'op_faltas', 'op_glosas', 'op_lucratividade', 'op_postos', 'op_reclamacoes', 'op_turnover');
-- DROP FUNCTION public.tvg_espelho_turnover(), public.tvg_tempo_de_casa(numeric); tvg_espelho_fonte_extra / tvg_espelho_tendencia: reaplicar as da 20261014000036 / 20261014000035.
-- dir_turnover_rescisoes: pode ficar (chama a _dados com o mesmo portão de antes).
