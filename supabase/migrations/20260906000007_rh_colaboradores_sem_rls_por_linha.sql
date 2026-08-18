-- =========================================================================
-- RH / COLABORADORES — tirar a RLS do caminho quente (timeout na tela)
--
-- Sintoma: a tela de Colaboradores demorava demais, as vezes ficava em
-- branco e as vezes mostrava zeros com o erro do Postgres
-- "canceling statement due to statement timeout".
--
-- CAUSA. A policy de SELECT da EMPREGADOS e:
--
--   (auth_user_id = auth.uid())
--   OR has_screen_access(auth.uid(), 'colaboradores', 'visualizar')
--   OR ... mais 8 menus
--
-- O primeiro operando referencia uma COLUNA. Isso impede o planner de
-- icar a expressao para fora do scan: ela vira filtro POR LINHA. Como
-- `auth_user_id = auth.uid()` e falso em praticamente toda linha, cada
-- uma segue para os has_screen_access — que sao plpgsql e fazem ate tres
-- consultas internas cada.
--
-- Com 12.909 empregados isso da centenas de milhares de consultas por
-- varredura. E as duas RPCs da tela NAO eram SECURITY DEFINER, entao
-- pagavam esse custo inteiro, varias vezes (a CTE `flags` e lida por tres
-- CTEs distintas).
--
-- Medido: rodando como `postgres` (que ignora RLS) o dashboard leva ~1 s;
-- como `authenticated` estoura o statement_timeout.
--
-- CORRECAO. As duas RPCs passam a SECURITY DEFINER e checam o acesso UMA
-- vez, no inicio, via rh_pode_ver_colaboradores(). O corpo das consultas
-- nao muda em nada.
--
-- Por que isso NAO afrouxa a seguranca: a policy e all-or-nothing. Quem
-- casa em qualquer um dos 9 menus ja enxergava TODAS as linhas hoje — ela
-- nao recorta empregado por empregado. A unica clausula que recorta e
-- `auth_user_id = auth.uid()` (ver a si mesmo), e quem so tem isso nao
-- alcanca esta tela: ela exige o menu para ser roteada, e estas RPCs sao
-- usadas somente por ela. A funcao nova replica exatamente a mesma lista
-- de menus da policy — mesma resposta, avaliada uma vez em vez de 12.909.
--
-- A policy da tabela fica INTOCADA: quem le a EMPREGADOS direto continua
-- protegido do mesmo jeito.
--
-- Idempotente.
-- ROLLBACK: recriar as duas funcoes sem SECURITY DEFINER e sem o IF do
--   inicio (definicao anterior em qualquer backup), e
--   DROP FUNCTION IF EXISTS public.rh_pode_ver_colaboradores();
-- =========================================================================

-- Mesma condicao da policy erp_auth_read_empregados, sem a parte por linha.
CREATE OR REPLACE FUNCTION public.rh_pode_ver_colaboradores()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.has_screen_access(auth.uid(), 'colaboradores', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'sst_aso', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'candidatos', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'processos', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'patrimonios', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'duvidas', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'central_servicos_formularios', 'visualizar');
$$;

REVOKE ALL ON FUNCTION public.rh_pode_ver_colaboradores() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rh_pode_ver_colaboradores() FROM anon;
GRANT EXECUTE ON FUNCTION public.rh_pode_ver_colaboradores() TO authenticated;

-- As duas RPCs abaixo sao a definicao ATUAL, sem alteracao de logica:
-- ganharam apenas SECURITY DEFINER e o IF de acesso no inicio.
CREATE OR REPLACE FUNCTION public.rh_colaboradores_dashboard(_ano integer, _mes integer, _empresa text DEFAULT ''::text, _contrato text DEFAULT ''::text, _situacao text DEFAULT ''::text, _busca text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ini date := make_date(_ano, _mes, 1);
  v_fim date := (make_date(_ano, _mes, 1) + interval '1 month' - interval '1 day')::date;
  v_q   text := nullif(btrim(coalesce(_busca, '')), '');
  v_emp text := coalesce(_empresa, '');
  v_ctr text := coalesce(_contrato, '');
  v_sit text := coalesce(_situacao, '');
  v_ano int  := extract(year from current_date)::int;
  v_out jsonb;
BEGIN
  -- Uma checagem, no lugar de uma por linha. Ver o cabecalho da migration.
  IF NOT public.rh_pode_ver_colaboradores() THEN
    RAISE EXCEPTION 'sem acesso ao cadastro de colaboradores' USING ERRCODE = '42501';
  END IF;

  WITH ct AS (
    SELECT DISTINCT ON (btrim(c."Filial"::text))
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
      coalesce(nullif(ct.nome, ''), '—')                                AS contrato,
      coalesce(nullif(btrim(coalesce(e."Nome Filial", '')), ''),
               nullif(btrim(coalesce(e."Filial"::text, '')), ''), '—')  AS filial,
      btrim(coalesce(e."Situação", ''))                                 AS situacao,
      btrim(coalesce(e."Setor_ERP", ''))                                AS setor,
      public.rh_data(e."Admissão"::text)                                AS admissao,
      public.rh_data(e."Data Afastamento"::text)                        AS afastamento,
      public.rh_num(e."Valor Salário"::text)                            AS salario,
      (btrim(coalesce(e."Situação", '')) ~* '(DEMIT|DESLIG|RESCIS|APOSENT)') AS eh_saida,
      (coalesce(e."Nome", '') || ' ' || coalesce(e."CPF", '') || ' ' ||
       coalesce(e."Título do Cargo", '') || ' ' || coalesce(e."Nome do Cargo", '') || ' ' ||
       coalesce(e."Nome Filial", '') || ' ' || coalesce(e."Setor_ERP", ''))  AS busca_txt
    FROM public."EMPREGADOS" e
    LEFT JOIN ct ON ct.filial = btrim(e."Filial"::text)
  ),
  flags AS (
    SELECT v.*,
      ((v.admissao IS NULL OR v.admissao <= v_fim)
        AND (NOT v.eh_saida OR (v.afastamento IS NOT NULL AND v.afastamento >= v_ini))) AS no_mes,
      (v_emp = '' OR v.empresa  = v_emp) AS f_emp,
      (v_ctr = '' OR v.contrato = v_ctr) AS f_ctr,
      (v_sit = '' OR v.situacao = v_sit) AS f_sit,
      (v_q IS NULL OR v.busca_txt ILIKE '%' || v_q || '%') AS f_bus
    FROM v
  ),
  fil    AS (SELECT * FROM flags WHERE no_mes AND f_emp AND f_ctr AND f_sit AND f_bus),
  semsit AS (SELECT * FROM flags WHERE no_mes AND f_emp AND f_ctr AND f_bus),
  tempo  AS (SELECT * FROM flags WHERE f_emp AND f_ctr)
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
      'setores',   (SELECT coalesce(jsonb_agg(DISTINCT setor    ORDER BY setor),    '[]'::jsonb) FROM flags WHERE setor    <> '')
    )
  ) INTO v_out;
  RETURN v_out;
END $function$;

CREATE OR REPLACE FUNCTION public.rh_colaboradores_lista(_ano integer, _mes integer, _empresa text DEFAULT ''::text, _contrato text DEFAULT ''::text, _situacao text DEFAULT ''::text, _busca text DEFAULT ''::text, _offset integer DEFAULT 0, _limite integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ini date := make_date(_ano, _mes, 1);
  v_fim date := (make_date(_ano, _mes, 1) + interval '1 month' - interval '1 day')::date;
  v_q   text := nullif(btrim(coalesce(_busca, '')), '');
  v_emp text := coalesce(_empresa, '');
  v_ctr text := coalesce(_contrato, '');
  v_sit text := coalesce(_situacao, '');
  v_saida boolean := v_sit ~* '(DEMIT|DESLIG|RESCIS|APOSENT)';
  v_out jsonb;
BEGIN
  -- Uma checagem, no lugar de uma por linha. Ver o cabecalho da migration.
  IF NOT public.rh_pode_ver_colaboradores() THEN
    RAISE EXCEPTION 'sem acesso ao cadastro de colaboradores' USING ERRCODE = '42501';
  END IF;

  WITH ct AS (
    SELECT DISTINCT ON (btrim(c."Filial"::text))
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
      coalesce(nullif(ct.nome, ''), '—')                                AS contrato,
      coalesce(nullif(btrim(coalesce(e."Nome Filial", '')), ''),
               nullif(btrim(coalesce(e."Filial"::text, '')), ''), '—')  AS filial,
      btrim(coalesce(e."Situação", ''))                                 AS situacao,
      btrim(coalesce(e."Setor_ERP", ''))                                AS setor,
      public.rh_data(e."Admissão"::text)                                AS admissao,
      public.rh_data(e."Data Afastamento"::text)                        AS afastamento,
      public.rh_num(e."Valor Salário"::text)                            AS salario,
      (btrim(coalesce(e."Situação", '')) ~* '(DEMIT|DESLIG|RESCIS|APOSENT)') AS eh_saida,
      (coalesce(e."Nome", '') || ' ' || coalesce(e."CPF", '') || ' ' ||
       coalesce(e."Título do Cargo", '') || ' ' || coalesce(e."Nome do Cargo", '') || ' ' ||
       coalesce(e."Nome Filial", '') || ' ' || coalesce(e."Setor_ERP", ''))  AS busca_txt
    FROM public."EMPREGADOS" e
    LEFT JOIN ct ON ct.filial = btrim(e."Filial"::text)
  ),
  fil AS (
    SELECT v.* FROM v
     WHERE (v_saida
            OR ((v.admissao IS NULL OR v.admissao <= v_fim)
                AND (NOT v.eh_saida OR (v.afastamento IS NOT NULL AND v.afastamento >= v_ini))))
       AND (v_emp = '' OR v.empresa  = v_emp)
       AND (v_ctr = '' OR v.contrato = v_ctr)
       AND (v_sit = '' OR v.situacao = v_sit)
       AND (v_q IS NULL OR v.busca_txt ILIKE '%' || v_q || '%')
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM fil),
    'linhas', (SELECT coalesce(jsonb_agg(to_jsonb(p) - 'busca_txt' - 'eh_saida'), '[]'::jsonb)
                 FROM (SELECT * FROM fil ORDER BY nome, id OFFSET greatest(_offset, 0) LIMIT least(greatest(_limite, 1), 500)) p)
  ) INTO v_out;
  RETURN v_out;
END $function$;

REVOKE ALL ON FUNCTION public.rh_colaboradores_dashboard(integer, integer, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.rh_colaboradores_lista(integer, integer, text, text, text, text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.rh_colaboradores_dashboard(integer, integer, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rh_colaboradores_lista(integer, integer, text, text, text, text, integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
