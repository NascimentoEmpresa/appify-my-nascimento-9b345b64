-- =========================================================================
-- RH › Colaboradores: ordem por admissão, movimentação (hoje/semana/mês),
-- todos os contratos, e contrato casado por (empresa, filial)
--
-- Pedido do Pablo em 15/09/2026: "ordem de admissão por padrão e alfabética
-- também; dashboard de admitidos hoje / esta semana / este mês, demitidos
-- a mesma coisa; colaboradores por contrato".
--
-- E o mesmo defeito do Exportar Dados (chamado da Protege) estava nas RPCs
-- da tela: o contrato era casado só pela FILIAL, e o código de filial se
-- repete entre empresas — a Ademara (NH, filial 1097 GUAPORÉ) aparecia com
-- "SAMU TELEFONISTAS". 11 pessoas assim em 15/09/2026. Agora (empresa,
-- filial); sem contrato ativo, o contrato vem do "Nome Filial" do cadastro.
--
--   rh_colaboradores_lista      +_ordem ('admissao' padrão | 'nome')
--   rh_colaboradores_dashboard  +movimentacao {adm_hoje, adm_semana, adm_mes,
--                                desl_hoje, desl_semana, desl_mes}
--                               +por_contrato_todos (todos, não só top 10)
--
-- Assinatura da lista mudou (parâmetro novo): a anterior é derrubada antes,
-- senão o PostgREST vê duas e recusa por ambiguidade.
-- Corpo = o que estava no banco em 15/09/2026 (114) + os trechos acima.
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

DROP FUNCTION IF EXISTS public.rh_colaboradores_lista(integer, integer, text, text, text, text, integer, integer, text);

CREATE OR REPLACE FUNCTION public.rh_colaboradores_dashboard(_ano integer, _mes integer, _empresa text DEFAULT ''::text, _contrato text DEFAULT ''::text, _situacao text DEFAULT ''::text, _busca text DEFAULT ''::text, _cargo text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ver_salario boolean;
  v_ini date := make_date(_ano, _mes, 1);
  v_fim date := (make_date(_ano, _mes, 1) + interval '1 month' - interval '1 day')::date;
  v_q   text := nullif(btrim(coalesce(_busca, '')), '');
  -- Multi-valor (15/09/2026): cada filtro chega como texto com os valores
  -- separados por U+001F (unit separator) — '' continua sendo "todos".
  v_emps text[] := array_remove(string_to_array(coalesce(_empresa, ''),  E'\x1F'), '');
  v_ctrs text[] := array_remove(string_to_array(coalesce(_contrato, ''), E'\x1F'), '');
  v_sits text[] := array_remove(string_to_array(coalesce(_situacao, ''), E'\x1F'), '');
  v_cargos text[] := array_remove(string_to_array(coalesce(_cargo, ''),  E'\x1F'), '');
  v_ano int  := extract(year from current_date)::int;
  v_out jsonb;
BEGIN
  -- Uma checagem, no lugar de uma por linha. Ver o cabecalho da migration.
  IF NOT public.rh_pode_ver_colaboradores() THEN
    RAISE EXCEPTION 'sem acesso ao cadastro de colaboradores' USING ERRCODE = '42501';
  END IF;

  -- Salário é opt-in: sem o menu 'colaboradores_ver_salario' liberado, a
  -- coluna volta NULL e as somas de folha caem para zero sozinhas.
  v_ver_salario := public.rh_pode_ver_salario();

  WITH ct AS (
    -- Chave (empresa, filial): o código de filial se repete entre empresas
    -- (1064 é TRIUNFO VIGIAS na SN; a NH tem outra 1064). Casar só pela
    -- filial dava contrato de outra empresa — 11 pessoas em 15/09/2026.
    SELECT DISTINCT ON (btrim(c."Empresa"::text), btrim(c."Filial"::text))
           btrim(c."Empresa"::text) AS empresa_cod,
           btrim(c."Filial"::text) AS filial,
           btrim(coalesce(c."NOME CONTRATO", '')) AS nome
      FROM public."CONTRATOS" c
     WHERE c."ATIVO" = 'SIM' AND c."Filial" IS NOT NULL
  ),
  v AS (
    SELECT
      e."ID"                                                            AS id,
      coalesce(e."Nome", '')                                            AS nome,
      coalesce(e."CPF", '')                                             AS cpf,
      coalesce(nullif(btrim(coalesce(e."Título do Cargo", '')), ''),
               nullif(btrim(coalesce(e."Nome do Cargo", '')), ''), '—') AS cargo,
      coalesce(public.rh_empresa(e."Empresa"::text, e."Nome da Empresa"), '—') AS empresa,
      coalesce(nullif(ct.nome, ''),
               nullif(btrim(regexp_replace(coalesce(e."Nome Filial", ''), '^\d+\s*-\s*', '')), ''),
               '—')                                                      AS contrato,
      coalesce(nullif(btrim(coalesce(e."Nome Filial", '')), ''),
               nullif(btrim(coalesce(e."Filial"::text, '')), ''), '—')  AS filial,
      btrim(coalesce(e."Situação", ''))                                 AS situacao,
      btrim(coalesce(e."Setor_ERP", ''))                                AS setor,
      public.rh_data(e."Admissão"::text)                                AS admissao,
      public.rh_data(e."Data Afastamento"::text)                        AS afastamento,
      (CASE WHEN v_ver_salario THEN public.rh_num(e."Valor Salário"::text) END) AS salario,
      (btrim(coalesce(e."Situação", '')) ~* '(DEMIT|DESLIG|RESCIS|APOSENT)') AS eh_saida,
      (coalesce(e."Nome", '') || ' ' || coalesce(e."CPF", '') || ' ' ||
       coalesce(e."Título do Cargo", '') || ' ' || coalesce(e."Nome do Cargo", '') || ' ' ||
       coalesce(e."Nome Filial", '') || ' ' || coalesce(e."Setor_ERP", ''))  AS busca_txt
    FROM public."EMPREGADOS" e
    LEFT JOIN ct ON ct.filial = btrim(e."Filial"::text) AND ct.empresa_cod = btrim(coalesce(e."Empresa"::text, ''))
  ),
  flags AS (
    SELECT v.*,
      ((v.admissao IS NULL OR v.admissao <= v_fim)
        AND (NOT v.eh_saida OR (v.afastamento IS NOT NULL AND v.afastamento >= v_ini))) AS no_mes,
      (cardinality(v_emps)   = 0 OR v.empresa  = ANY (v_emps))   AS f_emp,
      (cardinality(v_ctrs)   = 0 OR v.contrato = ANY (v_ctrs))   AS f_ctr,
      (cardinality(v_sits)   = 0 OR v.situacao = ANY (v_sits))   AS f_sit,
      (cardinality(v_cargos) = 0 OR v.cargo    = ANY (v_cargos)) AS f_car,
      (v_q IS NULL OR v.busca_txt ILIKE '%' || v_q || '%') AS f_bus
    FROM v
  ),
  fil    AS (SELECT * FROM flags WHERE no_mes AND f_emp AND f_ctr AND f_car AND f_sit AND f_bus),
  semsit AS (SELECT * FROM flags WHERE no_mes AND f_emp AND f_ctr AND f_car AND f_bus),
  tempo  AS (SELECT * FROM flags WHERE f_emp AND f_ctr AND f_car)
  SELECT jsonb_build_object(
    'kpis', jsonb_build_object(
      'ativos_mes', (SELECT count(*) FROM semsit),
      'no_recorte', (SELECT count(*) FROM fil),
      'total',      (SELECT count(*) FROM flags),
      'folha',      (SELECT coalesce(sum(salario), 0) FROM fil),
      'admitidos',  (SELECT count(*) FROM tempo WHERE admissao BETWEEN v_ini AND v_fim),
      'desligados', (SELECT count(*) FROM tempo WHERE eh_saida AND afastamento BETWEEN v_ini AND v_fim)
    ),
    'por_empresa',   (SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', v) ORDER BY v DESC), '[]'::jsonb)
                        FROM (SELECT empresa AS k, count(*) AS v FROM fil GROUP BY 1) t),
    'folha_empresa', (SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', v) ORDER BY v DESC), '[]'::jsonb)
                        FROM (SELECT empresa AS k, coalesce(sum(salario), 0) AS v FROM fil GROUP BY 1) t),
    'por_situacao',  (SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', v) ORDER BY v DESC), '[]'::jsonb)
                        FROM (SELECT coalesce(nullif(situacao, ''), '—') AS k, count(*) AS v FROM semsit GROUP BY 1) t),
    'por_cargo',     (SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', v) ORDER BY v DESC), '[]'::jsonb)
                        FROM (SELECT cargo AS k, count(*) AS v FROM semsit GROUP BY 1) t),
    'por_contrato',  (SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', v) ORDER BY v DESC), '[]'::jsonb)
                        FROM (SELECT contrato AS k, count(*) AS v FROM fil GROUP BY 1 ORDER BY 2 DESC LIMIT 10) t),
    -- Todos os contratos (15/09/2026): o card "Colaboradores por contrato"
    -- lista tudo, não só o top 10.
    'por_contrato_todos', (SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', v) ORDER BY v DESC, k), '[]'::jsonb)
                        FROM (SELECT contrato AS k, count(*) AS v FROM fil GROUP BY 1) t),
    -- Movimentação (15/09/2026): admitidos e desligados hoje / esta semana /
    -- este mês, no recorte de empresa/contrato/cargo (não de situação nem
    -- de competência — é "o que aconteceu de verdade nesses dias").
    'movimentacao', (SELECT jsonb_build_object(
        'adm_hoje',   count(*) FILTER (WHERE admissao = current_date),
        'adm_semana', count(*) FILTER (WHERE admissao >= date_trunc('week', current_date)::date AND admissao <= current_date),
        'adm_mes',    count(*) FILTER (WHERE admissao >= date_trunc('month', current_date)::date AND admissao <= current_date),
        'desl_hoje',   count(*) FILTER (WHERE eh_saida AND afastamento = current_date),
        'desl_semana', count(*) FILTER (WHERE eh_saida AND afastamento >= date_trunc('week', current_date)::date AND afastamento <= current_date),
        'desl_mes',    count(*) FILTER (WHERE eh_saida AND afastamento >= date_trunc('month', current_date)::date AND afastamento <= current_date)
      ) FROM tempo),
    'por_faixa',     (SELECT jsonb_agg(jsonb_build_object('label', f.label, 'n',
                              (SELECT count(*) FROM fil x
                                WHERE x.admissao IS NOT NULL
                                  AND ((current_date - x.admissao) / 365.25) >= f.mn
                                  AND ((current_date - x.admissao) / 365.25) <  f.mx)) ORDER BY f.ord)
                        FROM (VALUES (1, '< 1 ano', 0::numeric, 1::numeric), (2, '1–3 anos', 1, 3),
                                     (3, '3–5 anos', 3, 5), (4, '5–10 anos', 5, 10),
                                     (5, '10+ anos', 10, 9999)) AS f(ord, label, mn, mx)),
    'timeline',      (SELECT coalesce(jsonb_agg(jsonb_build_object('ano', ano, 'adm', adm, 'desl', desl) ORDER BY ano), '[]'::jsonb)
                        FROM (SELECT a.ano,
                                     count(*) FILTER (WHERE a.tipo = 'adm')  AS adm,
                                     count(*) FILTER (WHERE a.tipo = 'desl') AS desl
                                FROM (SELECT extract(year from admissao)::int AS ano, 'adm' AS tipo
                                        FROM tempo WHERE admissao IS NOT NULL
                                       UNION ALL
                                      SELECT extract(year from afastamento)::int, 'desl'
                                        FROM tempo WHERE eh_saida AND afastamento IS NOT NULL) a
                               WHERE a.ano BETWEEN v_ano - 6 AND v_ano
                               GROUP BY a.ano) z),
    'opcoes', jsonb_build_object(
      'empresas',  (SELECT coalesce(jsonb_agg(DISTINCT empresa  ORDER BY empresa),  '[]'::jsonb) FROM flags WHERE empresa  <> '—'),
      'contratos', (SELECT coalesce(jsonb_agg(DISTINCT contrato ORDER BY contrato), '[]'::jsonb) FROM flags WHERE contrato <> '—'),
      'situacoes', (SELECT coalesce(jsonb_agg(DISTINCT situacao ORDER BY situacao), '[]'::jsonb) FROM flags WHERE situacao <> ''),
      'cargos',    (SELECT coalesce(jsonb_agg(DISTINCT cargo    ORDER BY cargo),    '[]'::jsonb) FROM flags WHERE cargo    <> '—'),
      'setores',   (SELECT coalesce(jsonb_agg(DISTINCT setor    ORDER BY setor),    '[]'::jsonb) FROM flags WHERE setor    <> '')
    )
  ) INTO v_out;
  RETURN v_out;
END $function$
;

CREATE OR REPLACE FUNCTION public.rh_colaboradores_lista(_ano integer, _mes integer, _empresa text DEFAULT ''::text, _contrato text DEFAULT ''::text, _situacao text DEFAULT ''::text, _busca text DEFAULT ''::text, _offset integer DEFAULT 0, _limite integer DEFAULT 50, _cargo text DEFAULT ''::text, _ordem text DEFAULT 'admissao'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ver_salario boolean;
  v_ini date := make_date(_ano, _mes, 1);
  v_fim date := (make_date(_ano, _mes, 1) + interval '1 month' - interval '1 day')::date;
  v_q   text := nullif(btrim(coalesce(_busca, '')), '');
  -- Multi-valor (15/09/2026): cada filtro chega como texto com os valores
  -- separados por U+001F (unit separator) — '' continua sendo "todos".
  v_emps text[] := array_remove(string_to_array(coalesce(_empresa, ''),  E'\x1F'), '');
  v_ctrs text[] := array_remove(string_to_array(coalesce(_contrato, ''), E'\x1F'), '');
  v_sits text[] := array_remove(string_to_array(coalesce(_situacao, ''), E'\x1F'), '');
  v_cargos text[] := array_remove(string_to_array(coalesce(_cargo, ''),  E'\x1F'), '');
  -- "Saída" quando ALGUMA situação escolhida é de desligamento: aí a lista
  -- mostra quem saiu no mês, não quem estava ativo.
  v_saida boolean := EXISTS (SELECT 1 FROM unnest(v_sits) s WHERE s ~* '(DEMIT|DESLIG|RESCIS|APOSENT)');
  v_out jsonb;
BEGIN
  -- Uma checagem, no lugar de uma por linha. Ver o cabecalho da migration.
  IF NOT public.rh_pode_ver_colaboradores() THEN
    RAISE EXCEPTION 'sem acesso ao cadastro de colaboradores' USING ERRCODE = '42501';
  END IF;

  -- Salário é opt-in: sem o menu 'colaboradores_ver_salario' liberado, a
  -- coluna volta NULL e as somas de folha caem para zero sozinhas.
  v_ver_salario := public.rh_pode_ver_salario();

  WITH ct AS (
    -- Chave (empresa, filial): o código de filial se repete entre empresas
    -- (1064 é TRIUNFO VIGIAS na SN; a NH tem outra 1064). Casar só pela
    -- filial dava contrato de outra empresa — 11 pessoas em 15/09/2026.
    SELECT DISTINCT ON (btrim(c."Empresa"::text), btrim(c."Filial"::text))
           btrim(c."Empresa"::text) AS empresa_cod,
           btrim(c."Filial"::text) AS filial,
           btrim(coalesce(c."NOME CONTRATO", '')) AS nome
      FROM public."CONTRATOS" c
     WHERE c."ATIVO" = 'SIM' AND c."Filial" IS NOT NULL
  ),
  v AS (
    SELECT
      e."ID"                                                            AS id,
      coalesce(e."Nome", '')                                            AS nome,
      coalesce(e."CPF", '')                                             AS cpf,
      coalesce(nullif(btrim(coalesce(e."Título do Cargo", '')), ''),
               nullif(btrim(coalesce(e."Nome do Cargo", '')), ''), '—') AS cargo,
      coalesce(public.rh_empresa(e."Empresa"::text, e."Nome da Empresa"), '—') AS empresa,
      coalesce(nullif(ct.nome, ''),
               nullif(btrim(regexp_replace(coalesce(e."Nome Filial", ''), '^\d+\s*-\s*', '')), ''),
               '—')                                                      AS contrato,
      coalesce(nullif(btrim(coalesce(e."Nome Filial", '')), ''),
               nullif(btrim(coalesce(e."Filial"::text, '')), ''), '—')  AS filial,
      btrim(coalesce(e."Situação", ''))                                 AS situacao,
      btrim(coalesce(e."Setor_ERP", ''))                                AS setor,
      public.rh_data(e."Admissão"::text)                                AS admissao,
      public.rh_data(e."Data Afastamento"::text)                        AS afastamento,
      (CASE WHEN v_ver_salario THEN public.rh_num(e."Valor Salário"::text) END) AS salario,
      (btrim(coalesce(e."Situação", '')) ~* '(DEMIT|DESLIG|RESCIS|APOSENT)') AS eh_saida,
      (coalesce(e."Nome", '') || ' ' || coalesce(e."CPF", '') || ' ' ||
       coalesce(e."Título do Cargo", '') || ' ' || coalesce(e."Nome do Cargo", '') || ' ' ||
       coalesce(e."Nome Filial", '') || ' ' || coalesce(e."Setor_ERP", ''))  AS busca_txt
    FROM public."EMPREGADOS" e
    LEFT JOIN ct ON ct.filial = btrim(e."Filial"::text) AND ct.empresa_cod = btrim(coalesce(e."Empresa"::text, ''))
  ),
  fil AS (
    SELECT v.* FROM v
     WHERE (v_saida
            OR ((v.admissao IS NULL OR v.admissao <= v_fim)
                AND (NOT v.eh_saida OR (v.afastamento IS NOT NULL AND v.afastamento >= v_ini))))
       AND (cardinality(v_emps)   = 0 OR v.empresa  = ANY (v_emps))
       AND (cardinality(v_ctrs)   = 0 OR v.contrato = ANY (v_ctrs))
       AND (cardinality(v_sits)   = 0 OR v.situacao = ANY (v_sits))
       AND (cardinality(v_cargos) = 0 OR v.cargo    = ANY (v_cargos))
       AND (v_q IS NULL OR v.busca_txt ILIKE '%' || v_q || '%')
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM fil),
    'linhas', (SELECT coalesce(jsonb_agg(to_jsonb(p) - 'busca_txt' - 'eh_saida'), '[]'::jsonb)
                 FROM (SELECT * FROM fil
                        -- 'admissao' (padrão, 15/09/2026): mais recentes primeiro; 'nome': A–Z.
                        ORDER BY (CASE WHEN coalesce(_ordem, 'admissao') = 'nome' THEN 0 ELSE 1 END),
                                 (CASE WHEN coalesce(_ordem, 'admissao') = 'admissao' THEN admissao END) DESC NULLS LAST,
                                 nome, id
                       OFFSET greatest(_offset, 0) LIMIT least(greatest(_limite, 1), 500)) p)
  ) INTO v_out;
  RETURN v_out;
END $function$
;

REVOKE ALL ON FUNCTION public.rh_colaboradores_lista(integer, integer, text, text, text, text, integer, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_colaboradores_lista(integer, integer, text, text, text, text, integer, integer, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DROP da lista com a assinatura nova e reaplicar o bloco das RPCs da
--   20260930000114_rh_colaboradores_filtros_multi.sql.
-- =========================================================================
