-- =====================================================================
-- RH / COLABORADORES — salário só para quem tem a permissão.
--
-- Pedido: "por padrão ninguém pode ver a informação salário em
-- colaboradores; mas se permitir por acesso, pode ver".
--
-- POR QUE NÃO BASTA ESCONDER NO REACT. As duas RPCs da tela são
-- SECURITY DEFINER — elas ignoram a RLS de propósito, desde a
-- 20260906000007, que tirou a RLS do caminho quente porque a tela estourava
-- o statement_timeout com 12.909 empregados. Ou seja: o salário vem no JSON
-- da resposta. Esconder a coluna no componente deixaria o número a um
-- DevTools de distância de qualquer pessoa com acesso à tela.
--
-- Então o corte é no banco. As duas RPCs passam a devolver `salario` NULL
-- para quem não tem a permissão, e as somas de folha caem para zero
-- sozinhas (sum de NULL é NULL, e o coalesce que já existia devolve 0).
--
-- OPT-IN, e é o ponto do pedido: sem nada configurado, ninguém vê. Isso vem
-- de graça do has_screen_access, que é deny-by-default — menu sem regra em
-- perfil_acesso_permissao e sem exceção individual devolve false. Quem já
-- enxergava salário hoje PARA de enxergar até alguém ligar o toggle; é a
-- mudança de comportamento pretendida, não um efeito colateral.
--
-- O menu nasce sem rota (`rota = NULL`): é capacidade, não tela. Mesmo
-- padrão de 'chamados_sistemas_abrir' e 'formularios_acesso_botao', que
-- aparecem na lista de Acesso por Usuário como um item com toggle e sem
-- link.
-- =====================================================================

-- 1) A capacidade -------------------------------------------------------
-- Ancorada no PRÓPRIO menu de Colaboradores: herda o módulo dele (rh) e entra
-- na ordem logo abaixo, para cair colada nele na lista de Acesso por Usuário.
-- Fixar 'rh' na mão funcionaria hoje, mas se a tela mudar de módulo um dia a
-- capacidade ficaria órfã num módulo que ninguém abre.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT am.modulo_id, 'colaboradores_ver_salario', 'Colaboradores — Ver salário',
       NULL, am.ordem + 1, true
  FROM public.app_menu am
  JOIN public.app_modulo mo ON mo.id = am.modulo_id
 WHERE am.codigo = 'colaboradores' AND mo.codigo = 'rh'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- Se a linha já existia desativada, can_access devolveria false antes de
-- olhar perfil nenhum — e o toggle na tela de acesso não teria efeito.
UPDATE public.app_menu SET ativo = true WHERE codigo = 'colaboradores_ver_salario';

-- 2) A pergunta ---------------------------------------------------------
-- Espelha rh_pode_ver_colaboradores() no formato, mas com UM menu só: ver a
-- tela e ver o salário são coisas separadas de propósito.
CREATE OR REPLACE FUNCTION public.rh_pode_ver_salario()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.has_screen_access(auth.uid(), 'colaboradores_ver_salario', 'visualizar');
$$;
REVOKE ALL ON FUNCTION public.rh_pode_ver_salario() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_pode_ver_salario() TO authenticated;

-- 3) As duas RPCs da tela ----------------------------------------------
-- Corpo idêntico ao da 20260906000007, com três mudanças cada: a variável
-- v_ver_salario, o preenchimento dela junto da checagem de acesso que já
-- existia, e o CASE no cálculo do salário. Nada mais foi tocado.

CREATE OR REPLACE FUNCTION public.rh_colaboradores_dashboard(_ano integer, _mes integer, _empresa text DEFAULT ''::text, _contrato text DEFAULT ''::text, _situacao text DEFAULT ''::text, _busca text DEFAULT ''::text)
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

  -- Salário é opt-in: sem o menu 'colaboradores_ver_salario' liberado, a
  -- coluna volta NULL e as somas de folha caem para zero sozinhas.
  v_ver_salario := public.rh_pode_ver_salario();

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
      (CASE WHEN v_ver_salario THEN public.rh_num(e."Valor Salário"::text) END) AS salario,
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
  v_ver_salario boolean;
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

  -- Salário é opt-in: sem o menu 'colaboradores_ver_salario' liberado, a
  -- coluna volta NULL e as somas de folha caem para zero sozinhas.
  v_ver_salario := public.rh_pode_ver_salario();

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
      (CASE WHEN v_ver_salario THEN public.rh_num(e."Valor Salário"::text) END) AS salario,
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

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   Recriar as duas RPCs a partir da 20260906000007 (sem v_ver_salario) e:
--   DROP FUNCTION IF EXISTS public.rh_pode_ver_salario();
--   DELETE FROM public.app_menu WHERE codigo = 'colaboradores_ver_salario';
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
