-- =====================================================================
-- Ficha de Controle e Entrega de EPI — dados para imprimir a ficha de um
-- pedido de materiais (/app/suprimentos/pedidos-materiais).
--
-- POR QUE UMA RPC, E NÃO UM SELECT DO NAVEGADOR
-- 1) Cabeçalho: a ficha sai com a empresa EMPREGADORA, que é a dona do
--    CONTRATO do pedido (contratos.empresa_id → empresas). O grupo tem seis
--    CNPJs (AGPS, Canaã, HAGG, LF, NH, SN) e o mesmo Supply atende todos.
--    A policy empresas_select_scoped só deixa ler as empresas em que o
--    usuário atua (user_pode_atuar_empresa) — um supply vinculado só à HAGG
--    receberia o cabeçalho VAZIO justamente na ficha de um colaborador da SN.
--    Conferido em 11/09/2026: os 74 contratos têm empresa_id preenchido.
-- 2) Colaborador: admissão, cargo e local vêm de EMPREGADOS, que guarda CPF,
--    salário e conta bancária na mesma linha. Aqui sai só a lista fixa de
--    campos que a ficha imprime (padrão do projeto para EMPREGADOS).
--
-- COMO O COLABORADOR É ENCONTRADO (nesta ordem, o primeiro que achar vale)
--   a) sup_pedido.colaborador_empregado_id — hoje NULL em todos os pedidos;
--   b) matrícula ("Cadastro") + nome normalizado. Só a matrícula NÃO basta:
--      cada empresa do grupo numera a sua, e há 13 mil linhas em EMPREGADOS
--      contando demitidos — na amostra de 200 pedidos, 7 matrículas batiam
--      com mais de uma pessoa;
--   c) nome normalizado, se houver exatamente UM não demitido com esse nome.
-- Não achou (toda admissão: a pessoa ainda não está na folha) → colaborador
-- sai NULL e a tela usa o que está no próprio pedido. Nada é inventado.
--
-- ACESSO: mesma regra de leitura da fila (sup_pedido_select, ramo Supply):
-- can_access(..., 'sup_pedidos_materiais', 'visualizar'). Sem menu novo — a
-- ficha é leitura de um pedido que o usuário já enxerga na tela.
--
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.sup_pedido_ficha_epi(uuid);
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================

CREATE OR REPLACE FUNCTION public.sup_pedido_ficha_epi(p_pedido_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_contrato_id uuid;
  v_empregado   bigint;
  v_matricula   text;
  v_nome        text;
  v_empresa     jsonb;
  v_contrato    jsonb;
  v_itens       jsonb;
  v_achou       boolean := false;
  v_cadastro    text;
  v_admissao    text;
  v_situacao    text;
  v_cargo       text;
  v_local       text;
  v_afastamento text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access(v_uid, 'sup_pedidos_materiais', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para ver pedidos de materiais' USING ERRCODE = '42501';
  END IF;

  SELECT p.contrato_id,
         p.colaborador_empregado_id,
         nullif(btrim(p.matricula_colaborador), ''),
         nullif(btrim(p.nome_colaborador), '')
    INTO v_contrato_id, v_empregado, v_matricula, v_nome
    FROM public.sup_pedido p
   WHERE p.id = p_pedido_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido não encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- ── Cabeçalho: empresa dona do contrato ─────────────────────────────
  SELECT jsonb_build_object('razao_social', e.razao_social, 'cnpj', e.cnpj, 'codigo', e.codigo),
         jsonb_build_object('nome', c.nome, 'cliente', c.cliente)
    INTO v_empresa, v_contrato
    FROM public.contratos c
    LEFT JOIN public.empresas e ON e.id = c.empresa_id
   WHERE c.id = v_contrato_id;

  -- ── Colaborador em EMPREGADOS (a → b → c, ver cabeçalho) ────────────
  IF v_empregado IS NOT NULL THEN
    SELECT e."Cadastro"::text, e."Admissão"::text, e."Situação"::text,
           e."Título do Cargo"::text, e."Descrição do Local"::text, e."Data Afastamento"::text
      INTO v_cadastro, v_admissao, v_situacao, v_cargo, v_local, v_afastamento
      FROM public."EMPREGADOS" e
     WHERE e."ID"::bigint = v_empregado;
    v_achou := FOUND;
  END IF;

  IF NOT v_achou AND v_matricula IS NOT NULL AND v_nome IS NOT NULL THEN
    SELECT e."Cadastro"::text, e."Admissão"::text, e."Situação"::text,
           e."Título do Cargo"::text, e."Descrição do Local"::text, e."Data Afastamento"::text
      INTO v_cadastro, v_admissao, v_situacao, v_cargo, v_local, v_afastamento
      FROM public."EMPREGADOS" e
     WHERE btrim(e."Cadastro"::text) = v_matricula
       AND public.sup_norm_nome(e."Nome") = public.sup_norm_nome(v_nome)
     -- Readmissão: a mesma pessoa pode ter a linha antiga (demitida) e a
     -- atual. Vale a ativa; entre iguais, a admissão mais recente.
     ORDER BY (e."Situação" = 'Demitido') NULLS LAST,
              public.sup_norm_data(e."Admissão"::text) DESC NULLS LAST
     LIMIT 1;
    v_achou := FOUND;
  END IF;

  IF NOT v_achou AND v_nome IS NOT NULL THEN
    SELECT x.cadastro, x.admissao, x.situacao, x.cargo, x.local, x.afastamento
      INTO v_cadastro, v_admissao, v_situacao, v_cargo, v_local, v_afastamento
      FROM (
        SELECT e."Cadastro"::text           AS cadastro,
               e."Admissão"::text           AS admissao,
               e."Situação"::text           AS situacao,
               e."Título do Cargo"::text    AS cargo,
               e."Descrição do Local"::text AS local,
               e."Data Afastamento"::text   AS afastamento,
               count(*) OVER ()             AS homonimos
          FROM public."EMPREGADOS" e
         WHERE e."Situação" <> 'Demitido'
           AND public.sup_norm_nome(e."Nome") = public.sup_norm_nome(v_nome)
      ) x
     WHERE x.homonimos = 1;
    v_achou := FOUND;
  END IF;

  -- ── Itens, com o C.A. das etiquetas que saíram para cada um ─────────
  -- O C.A. mora na etiqueta física (sup_estoque_tag.ca_numero, SIS-2026-0222)
  -- porque remessas do mesmo material podem ter certificados diferentes.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'nome_item',  i.nome_item,
           'tamanho',    i.tamanho,
           'quantidade', i.quantidade,
           'litros',     i.litros,
           'ordem',      i.ordem,
           'ca', (SELECT string_agg(DISTINCT btrim(t.ca_numero), ' / ')
                    FROM public.sup_estoque_tag t
                   WHERE t.pedido_item_id = i.id
                     AND nullif(btrim(t.ca_numero), '') IS NOT NULL)
         ) ORDER BY i.ordem), '[]'::jsonb)
    INTO v_itens
    FROM public.sup_pedido_item i
   WHERE i.pedido_id = p_pedido_id;

  RETURN jsonb_build_object(
    'empresa',  v_empresa,
    'contrato', v_contrato,
    'colaborador', CASE WHEN v_achou THEN jsonb_build_object(
        'matricula', nullif(btrim(v_cadastro), ''),
        'admissao',  public.sup_norm_data(v_admissao),
        'cargo',     nullif(btrim(v_cargo), ''),
        'local',     nullif(btrim(v_local), ''),
        'situacao',  v_situacao,
        -- "Data Afastamento" também é preenchida em férias e atestado; só
        -- vira data de demissão quando a situação é de fato Demitido.
        'demissao',  CASE WHEN v_situacao = 'Demitido' THEN public.sup_norm_data(v_afastamento) END
      ) END,
    'itens', v_itens
  );
END $$;

REVOKE ALL ON FUNCTION public.sup_pedido_ficha_epi(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.sup_pedido_ficha_epi(uuid) TO authenticated;

COMMENT ON FUNCTION public.sup_pedido_ficha_epi(uuid) IS
  'Dados da Ficha de Controle e Entrega de EPI de um pedido: empresa do contrato, colaborador (campos fixos de EMPREGADOS) e itens com C.A.';

-- ── Conferência ──────────────────────────────────────────────────────
-- (No SQL Editor auth.uid() é NULL, então a função em si responde "Não
-- autenticado" — o teste de verdade é abrir a ficha pela tela.)
SELECT p.proname, p.prosecdef AS security_definer, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'sup_pedido_ficha_epi';

NOTIFY pgrst, 'reload schema';
