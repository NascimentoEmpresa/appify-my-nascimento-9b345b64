-- =========================================================================
-- FINANCEIRO › FICHA FINANCEIRA — tudo o que cada colaborador já recebeu, dos
-- eventos de pagamento da Senior (espelho."BiFichaFinanceira")   (29/10/2026)
--
-- PEDIDO (Pablo, 29/10/2026)
--   "Esse espelho da senior mostra o que cada colaborador já recebeu, são
--   todos eventos de pagamento da senior, preciso que fique vinculado a CADA
--   USUARIO DO SISTEMA, ao pesquisar um usuario dá pra ver toda ficha
--   financeira, valores etc. igual a gestão de ponto mas de ficha financeira."
--
-- A FONTE
--   espelho."BiFichaFinanceira" (view de BI da Senior, copiada pelo
--   espelho-mysql a cada ~10 min). Colunas: empresa, matricula, calculo,
--   data_pagamento, codigo_evento, descricao_evento, tipo_evento, valor,
--   referencia. Amostra que o Pablo colou:
--       1,7,1,2011-02-04,2646,Adicional de Lider,200,200.00,2646.00
--       1,5,11,2011-11-04,650,Férias Vencidas Rescisão,520,1.00,650.00
--       1,21,23,2012-08-03,750,13o Salário Adiantado,,12.00,750.00
--   ⚠ OS NOMES DAS COLUNAS NÃO BATEM COM O CONTEÚDO — a view da Senior
--   rotula uma coluna e entrega a vizinha:
--       tipo_evento  → é o VALOR em R$ (vazio quando o evento não teve valor)
--       valor        → é a REFERÊNCIA (dias, horas, avos, % ou o próprio R$
--                      quando o evento é de valor fixo, como o Adicional)
--       referencia   → repete o código do evento (descartada)
--   A leitura certa mora num lugar só: o CTE "lin" de ff_ficha. Se um dia a
--   Senior corrigir a view, é só trocar as duas linhas marcadas "MAPA".
--   ⚠ Conferido pela amostra e pelo histórico do repositório, não por
--   consulta ao banco (a sessão que escreveu isto não alcançava o cluster).
--   Primeira coisa a olhar se a tela mostrar valor estranho.
--
--   Por que não o R046VER (verbas por cálculo, ~2 mi de linhas): a exportação
--   da Senior manda valeve NULL nele (conferido em 07/10, ver mig
--   20261007000006). O BiFichaFinanceira é o único com o R$.
--   R044CAL (numemp, codcal) dá a competência (perref) e o tipo de cálculo
--   (tipcal); R008EVC dá o tipo do evento (tipeve: 1/2 provento, 3 desconto,
--   demais informativo) — mas tinha só 25 eventos em 07/10, então o front
--   completa a classificação pela descrição (src/lib/fichaFinanceira.ts,
--   com teste). Os dois são lidos por to_jsonb(linha): coluna que faltar
--   vira NULL em vez de derrubar a tela.
--
-- LIGAÇÃO COM A PESSOA E COM O USUÁRIO
--   EMPREGADOS ("Empresa", "Cadastro") = (empresa, matricula). A Senior
--   REAPROVEITA matrícula (1/10542 era LUIZA e virou DAIANE — memória do
--   sync), então só entram pagamentos a partir da admissão daquele cadastro
--   (e até 400 dias depois do desligamento, para a rescisão complementar).
--   A ficha junta todos os cadastros com o MESMO CPF (readmissão gera
--   matrícula nova). O usuário do ERP é EMPREGADOS.auth_user_id → profiles:
--   a busca acha pelo nome do colaborador, CPF, matrícula, ou pelo nome /
--   e-mail do login.
--
-- ACESSO (nasce sem ninguém — liberar em Administração › Acesso por Usuário)
--   financeiro_ficha_financeira          a tela (visualizar; exportar)
--   financeiro_ficha_financeira_valores  fantasma: ver os R$. Sem ele a
--                                        ficha mostra eventos e referências,
--                                        com os valores em branco.
--   Nada é copiado: as RPCs SECURITY DEFINER leem o espelho na hora.
--
-- DESEMPENHO
--   Índice (empresa, matricula, data_pagamento) no BiFichaFinanceira: a ficha
--   de uma pessoa vira uma busca por faixa em vez de varrer a tabela. A carga
--   do espelho é TRUNCATE + COPY, então o índice sobrevive. A ficha vem por
--   ANOS (padrão: os dois últimos com pagamento; o front pede mais).
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1. Índice no espelho ─────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('espelho."BiFichaFinanceira"') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_bifichafinanceira_emp_mat_pag
               ON espelho."BiFichaFinanceira" (empresa, matricula, data_pagamento)';
  END IF;
END $$;

-- ── 2. Menus ─────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'financeiro_ficha_financeira', 'Ficha Financeira', '/app/financeiro/ficha-financeira',
       COALESCE((SELECT max(ordem) FROM public.app_menu WHERE modulo_id = m.id), 0) + 1, true
  FROM public.app_modulo m
 WHERE m.codigo = 'financeiro'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu x WHERE x.codigo = 'financeiro_ficha_financeira');

-- Fantasma: quem vê os valores em R$.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'financeiro_ficha_financeira_valores', 'Ficha Financeira — Ver valores (R$)', NULL,
       COALESCE((SELECT max(ordem) FROM public.app_menu WHERE modulo_id = m.id), 0) + 1, true
  FROM public.app_modulo m
 WHERE m.codigo = 'financeiro'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu x WHERE x.codigo = 'financeiro_ficha_financeira_valores');

INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('financeiro_ficha_financeira', 'exportar'::public.app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- ── 3. Portões ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ff_exige()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501'; END IF;
  IF NOT public.can_access(v_uid, 'financeiro_ficha_financeira', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso à Ficha Financeira' USING ERRCODE = '42501';
  END IF;
  RETURN v_uid;
END $$;
REVOKE ALL ON FUNCTION public.ff_exige() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ff_exige() TO authenticated;

CREATE OR REPLACE FUNCTION public.ff_ve_valores()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL
     AND public.can_access(auth.uid(), 'financeiro_ficha_financeira_valores', 'visualizar'::public.app_acao)
$$;
REVOKE ALL ON FUNCTION public.ff_ve_valores() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ff_ve_valores() TO authenticated;

-- Sem acento e em maiúsculas, para a busca por nome ("JOAO" acha "João").
CREATE OR REPLACE FUNCTION public.ff_norm(_t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT translate(upper(btrim(coalesce(_t, ''))),
                   'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'AAAAAEEEEIIIIOOOOOUUUUCN')
$$;
REVOKE ALL ON FUNCTION public.ff_norm(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ff_norm(text) TO authenticated;

-- ── 4. Busca ─────────────────────────────────────────────────────────────
-- Nome do colaborador, CPF (com ou sem pontuação, basta o começo), matrícula,
-- ou nome / e-mail do login no ERP. Ativos primeiro. CPF sai mascarado.
CREATE OR REPLACE FUNCTION public.ff_buscar(p_termo text, p_limite int DEFAULT 30)
RETURNS TABLE (
  id bigint, empresa text, cadastro text, nome text, cargo text, filial text,
  situacao text, ativo boolean, admissao date, afastamento date, cpf text,
  usuario_id uuid, usuario_nome text, usuario_email text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_t text := btrim(coalesce(p_termo, ''));
  v_dig text := regexp_replace(coalesce(p_termo, ''), '\D', '', 'g');
  v_nome text := public.ff_norm(p_termo);
BEGIN
  PERFORM public.ff_exige();
  -- Matrícula pode ter um dígito só; nome precisa de dois.
  IF v_t = '' OR (length(v_t) < 2 AND v_dig <> v_t) THEN RETURN; END IF;

  RETURN QUERY
  SELECT e."ID"::bigint, e."Empresa"::text, e."Cadastro"::text, e."Nome"::text,
         e."Título do Cargo"::text, e."Nome Filial"::text, e."Situação"::text,
         public.esp_col_esta_ativo(e."Situação"),
         public.data_universal(e."Admissão"::text),
         CASE WHEN NOT public.esp_col_esta_ativo(e."Situação") THEN public.data_universal(e."Data Afastamento"::text) END,
         CASE WHEN length(d.cpf) = 11
              THEN '***.' || substr(d.cpf, 4, 3) || '.' || substr(d.cpf, 7, 3) || '-**' END,
         p.id, p.display_name::text, p.email::text
    FROM public."EMPREGADOS" e
    CROSS JOIN LATERAL (SELECT lpad(regexp_replace(coalesce(e."CPF"::text, ''), '\D', '', 'g'), 11, '0') AS cpf) d
    LEFT JOIN public.profiles p ON p.id = e.auth_user_id
   WHERE coalesce(btrim(e."Nome"), '') <> ''
     AND (
          public.ff_norm(e."Nome") LIKE '%' || v_nome || '%'
       OR (length(v_dig) >= 1 AND v_dig = v_t AND btrim(e."Cadastro"::text) = v_dig)
       OR (length(v_dig) >= 5 AND d.cpf LIKE v_dig || '%')
       OR (p.id IS NOT NULL AND (public.ff_norm(p.display_name) LIKE '%' || v_nome || '%'
                                 OR p.email ILIKE '%' || v_t || '%'))
     )
   ORDER BY public.esp_col_esta_ativo(e."Situação") DESC, e."Nome", e."ID"
   LIMIT greatest(1, least(coalesce(p_limite, 30), 100));
END $$;
REVOKE ALL ON FUNCTION public.ff_buscar(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ff_buscar(text, int) TO authenticated;

-- ── 5. A ficha ───────────────────────────────────────────────────────────
-- p_ano_de / p_ano_ate: anos de PAGAMENTO a trazer (no máximo 10 por vez).
-- Sem eles: os dois últimos anos com pagamento. 'anos' sempre vem inteiro
-- (ano → quantos eventos), para o seletor saber até onde dá para voltar.
--
-- Eventos em arrays posicionais (a resposta de 15 anos de uma pessoa cabe em
-- poucas centenas de KB):
--   [0 data_pagamento, 1 empresa, 2 matricula, 3 calculo, 4 competencia
--    (AAAA-MM, do R044CAL; NULL se o cálculo não estiver lá), 5 tipcal,
--    6 codigo_evento, 7 descricao, 8 valor R$ (NULL sem permissão),
--    9 referencia, 10 tipeve do R008EVC]
CREATE OR REPLACE FUNCTION public.ff_ficha(p_empregado_id bigint, p_ano_de int DEFAULT NULL, p_ano_ate int DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_valores boolean;
  v_cpf text;
  v_vinc jsonb;
  v_col jsonb;
  v_anos jsonb;
  v_ev jsonb;
  v_de int; v_ate int;
  v_tem_cal boolean := to_regclass('espelho."R044CAL"') IS NOT NULL;
  v_tem_evc boolean := to_regclass('espelho."R008EVC"') IS NOT NULL;
  v_sql text;
BEGIN
  PERFORM public.ff_exige();
  v_valores := public.ff_ve_valores();

  SELECT nullif(ltrim(regexp_replace(coalesce(e."CPF"::text, ''), '\D', '', 'g'), '0'), ''),
         jsonb_build_object(
           'id', e."ID", 'empresa', e."Empresa", 'cadastro', e."Cadastro", 'nome', e."Nome",
           'cargo', e."Título do Cargo", 'filial', e."Nome Filial", 'situacao', e."Situação",
           'ativo', public.esp_col_esta_ativo(e."Situação"),
           'admissao', public.data_universal(e."Admissão"::text),
           'afastamento', CASE WHEN NOT public.esp_col_esta_ativo(e."Situação")
                               THEN public.data_universal(e."Data Afastamento"::text) END,
           'usuario', (SELECT jsonb_build_object('id', p.id, 'nome', p.display_name, 'email', p.email)
                         FROM public.profiles p WHERE p.id = e.auth_user_id))
    INTO v_cpf, v_col
    FROM public."EMPREGADOS" e
   WHERE e."ID" = p_empregado_id;
  IF v_col IS NULL THEN RAISE EXCEPTION 'Colaborador não encontrado.'; END IF;

  -- Todos os cadastros da mesma pessoa (mesmo CPF), cada um com a sua janela.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', e."ID", 'empresa', x.emp, 'cadastro', x.cad, 'situacao', e."Situação",
           'filial', e."Nome Filial", 'de', x.adm,
           'ate', CASE WHEN x.afa IS NOT NULL THEN x.afa + 400 END)
         ORDER BY x.adm NULLS FIRST), '[]'::jsonb)
    INTO v_vinc
    FROM public."EMPREGADOS" e
    CROSS JOIN LATERAL (SELECT
        CASE WHEN btrim(e."Empresa"::text) ~ '^\d+$' THEN btrim(e."Empresa"::text)::int END AS emp,
        CASE WHEN btrim(e."Cadastro"::text) ~ '^\d+$' THEN btrim(e."Cadastro"::text)::bigint END AS cad,
        public.data_universal(e."Admissão"::text) AS adm,
        CASE WHEN NOT public.esp_col_esta_ativo(e."Situação")
             THEN public.data_universal(e."Data Afastamento"::text) END AS afa) x
   WHERE x.emp IS NOT NULL AND x.cad IS NOT NULL
     AND (e."ID" = p_empregado_id
          OR (v_cpf IS NOT NULL
              AND nullif(ltrim(regexp_replace(coalesce(e."CPF"::text, ''), '\D', '', 'g'), '0'), '') = v_cpf));

  IF to_regclass('espelho."BiFichaFinanceira"') IS NULL THEN
    RETURN jsonb_build_object('disponivel', false, 'motivo', 'A ficha financeira da Senior não está no banco (espelho."BiFichaFinanceira").',
                              'colaborador', v_col, 'vinculos', v_vinc, 'anos', '[]'::jsonb, 'eventos', '[]'::jsonb,
                              've_valores', v_valores);
  END IF;

  -- Anos com pagamento (só índice).
  EXECUTE $q$
    SELECT coalesce(jsonb_agg(jsonb_build_object('ano', ano, 'eventos', n) ORDER BY ano), '[]'::jsonb)
      FROM (SELECT extract(year FROM f.data_pagamento)::int AS ano, count(*)::int AS n
              FROM jsonb_to_recordset($1) AS v(empresa int, cadastro bigint, de date, ate date)
              JOIN espelho."BiFichaFinanceira" f
                ON f.empresa = v.empresa AND f.matricula = v.cadastro
               AND (v.de IS NULL OR f.data_pagamento >= v.de)
               AND (v.ate IS NULL OR f.data_pagamento < v.ate)
             GROUP BY 1) a
  $q$ INTO v_anos USING v_vinc;

  v_ate := coalesce(p_ano_ate, (SELECT max((a->>'ano')::int) FROM jsonb_array_elements(v_anos) a),
                    extract(year FROM current_date)::int);
  v_de := coalesce(p_ano_de, v_ate - 1);
  IF v_de > v_ate THEN v_de := v_ate; END IF;
  IF v_ate - v_de > 9 THEN v_de := v_ate - 9; END IF;

  v_sql := format($q$
    WITH lin AS (
      SELECT f.data_pagamento::date AS pag, f.empresa, f.matricula, f.calculo,
             f.codigo_evento AS codigo, btrim(f.descricao_evento::text) AS descricao,
             public.col_num(f.tipo_evento::text) AS valor,       -- MAPA: o R$ vem em tipo_evento
             public.col_num(f.valor::text)       AS referencia   -- MAPA: a referência vem em valor
        FROM jsonb_to_recordset($1) AS v(empresa int, cadastro bigint, de date, ate date)
        JOIN espelho."BiFichaFinanceira" f
          ON f.empresa = v.empresa AND f.matricula = v.cadastro
         AND f.data_pagamento >= greatest(make_date($2, 1, 1), coalesce(v.de, make_date($2, 1, 1)))
         AND f.data_pagamento <  make_date($3 + 1, 1, 1)
         AND (v.ate IS NULL OR f.data_pagamento < v.ate)
    ),
    -- Cálculos e eventos: tabelas pequenas, lidas uma vez e casadas por hash
    -- (um LATERAL por evento varreria o R044CAL dezenas de milhares de vezes).
    cal AS (%s),
    evc AS (%s)
    SELECT coalesce(jsonb_agg(jsonb_build_array(
             l.pag, l.empresa, l.matricula, l.calculo, c.competencia, c.tipcal,
             l.codigo, l.descricao, CASE WHEN $4 THEN l.valor END, l.referencia, ev.tipeve)
           ORDER BY l.pag, l.calculo, l.codigo), '[]'::jsonb)
      FROM (SELECT * FROM lin LIMIT 60000) l
      LEFT JOIN cal c ON c.empresa = l.empresa::numeric AND c.calculo = l.calculo::numeric
      LEFT JOIN evc ev ON ev.codigo = l.codigo::numeric
  $q$,
    CASE WHEN v_tem_cal THEN
      $c$SELECT DISTINCT ON (1, 2) public.col_num(j->>'numemp') AS empresa, public.col_num(j->>'codcal') AS calculo,
                CASE WHEN j->>'perref' ~ '^\d{4}-\d{2}' THEN left(j->>'perref', 7) END AS competencia,
                public.col_num(j->>'tipcal') AS tipcal
           FROM (SELECT to_jsonb(c0) AS j FROM espelho."R044CAL" c0) x
          WHERE public.col_num(j->>'numemp') IN (SELECT DISTINCT empresa::numeric FROM lin)
          ORDER BY 1, 2$c$
    ELSE 'SELECT NULL::numeric AS empresa, NULL::numeric AS calculo, NULL::text AS competencia, NULL::numeric AS tipcal WHERE false' END,
    CASE WHEN v_tem_evc THEN
      $e$SELECT DISTINCT ON (1) public.col_num(j->>'codeve') AS codigo, public.col_num(j->>'tipeve') AS tipeve
           FROM (SELECT to_jsonb(e0) AS j FROM espelho."R008EVC" e0) x
          WHERE public.col_num(j->>'codeve') IN (SELECT DISTINCT codigo::numeric FROM lin)
          ORDER BY 1$e$
    ELSE 'SELECT NULL::numeric AS codigo, NULL::numeric AS tipeve WHERE false' END);

  EXECUTE v_sql INTO v_ev USING v_vinc, v_de, v_ate, v_valores;

  RETURN jsonb_build_object(
    'disponivel', true,
    'colaborador', v_col,
    'vinculos', v_vinc,
    'anos', v_anos,
    'ano_de', v_de,
    'ano_ate', v_ate,
    've_valores', v_valores,
    'limite', jsonb_array_length(v_ev) >= 60000,
    'gerado_em', now(),
    'eventos', v_ev);
END $$;
REVOKE ALL ON FUNCTION public.ff_ficha(bigint, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ff_ficha(bigint, int, int) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.ff_ficha(bigint, int, int), public.ff_buscar(text, int),
--   public.ff_norm(text), public.ff_ve_valores(), public.ff_exige();
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'financeiro_ficha_financeira';
-- UPDATE public.app_menu SET ativo = false
--  WHERE codigo IN ('financeiro_ficha_financeira', 'financeiro_ficha_financeira_valores');
-- DROP INDEX IF EXISTS espelho.idx_bifichafinanceira_emp_mat_pag;
