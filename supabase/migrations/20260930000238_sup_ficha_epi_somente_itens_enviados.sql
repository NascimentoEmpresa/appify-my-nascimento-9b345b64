-- =====================================================================
-- SIS-2026-0528 — Ficha de EPI somente com itens efetivamente enviados.
--
-- A ficha usava `sup_pedido_item.quantidade`, isto é, o total solicitado,
-- mesmo quando parte do pedido permanecia pendente. A tela de Pedidos de
-- Materiais já separa enviado de pendente por duas fontes, reproduzidas aqui:
--   • etiqueta única vinculada ao pedido (quantidade 1);
--   • `sup_estoque_consumo`, que registra a quantidade retirada de um lote.
--
-- O `NOT EXISTS` no ramo de etiqueta única é a mesma proteção de
-- `sup_est_tags_do_pedido`: se o código também estiver no ledger, ele não pode
-- ser contado duas vezes. A quantidade da ficha passa a ser a soma realmente
-- enviada; item sem saída não entra no documento.
--
-- ROLLBACK
--   Recriar public.sup_pedido_ficha_epi(uuid) conforme a definição da
--   migration 20260930000114_sup_pedido_baixa_por_codigo_e_ca.sql.
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================

CREATE OR REPLACE FUNCTION public.sup_pedido_ficha_epi(p_pedido_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
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

  SELECT jsonb_build_object('razao_social', e.razao_social, 'cnpj', e.cnpj, 'codigo', e.codigo),
         jsonb_build_object('nome', c.nome, 'cliente', c.cliente)
    INTO v_empresa, v_contrato
    FROM public.contratos c
    LEFT JOIN public.empresas e ON e.id = c.empresa_id
   WHERE c.id = v_contrato_id;

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
     ORDER BY (e."Situação" = 'Demitido') NULLS LAST,
              public.sup_norm_data(e."Admissão"::text) DESC NULLS LAST
     LIMIT 1;
    v_achou := FOUND;
  END IF;

  IF NOT v_achou AND v_nome IS NOT NULL THEN
    SELECT x.cadastro, x.admissao, x.situacao, x.cargo, x.local, x.afastamento
      INTO v_cadastro, v_admissao, v_situacao, v_cargo, v_local, v_afastamento
      FROM (
        SELECT e."Cadastro"::text            AS cadastro,
               e."Admissão"::text            AS admissao,
               e."Situação"::text            AS situacao,
               e."Título do Cargo"::text     AS cargo,
               e."Descrição do Local"::text  AS local,
               e."Data Afastamento"::text    AS afastamento,
               count(*) OVER ()               AS homonimos
          FROM public."EMPREGADOS" e
         WHERE e."Situação" <> 'Demitido'
           AND public.sup_norm_nome(e."Nome") = public.sup_norm_nome(v_nome)
      ) x
     WHERE x.homonimos = 1;
    v_achou := FOUND;
  END IF;

  -- A quantidade vem das mesmas duas fontes usadas na separação visual do
  -- pedido. O agrupamento também reúne os C.A. dos lotes realmente enviados.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'nome_item',  i.nome_item,
           'tamanho',    i.tamanho,
           'quantidade', saida.quantidade,
           'litros',     i.litros,
           'ordem',      i.ordem,
           'ca',         saida.ca
         ) ORDER BY i.ordem), '[]'::jsonb)
    INTO v_itens
    FROM public.sup_pedido_item i
    JOIN (
      SELECT movimento.pedido_item_id,
             sum(movimento.quantidade)::integer AS quantidade,
             string_agg(DISTINCT movimento.ca, ' / ' ORDER BY movimento.ca)
               FILTER (WHERE movimento.ca IS NOT NULL) AS ca
        FROM (
          SELECT t.pedido_item_id,
                 1::integer AS quantidade,
                 nullif(btrim(t.ca_numero), '') AS ca
            FROM public.sup_estoque_tag t
           WHERE t.pedido_id = p_pedido_id
             AND t.tipo = 'unico'
             AND NOT EXISTS (
               SELECT 1
                 FROM public.sup_estoque_consumo c
                WHERE c.codigo = t.codigo
                  AND c.pedido_id = p_pedido_id
             )
          UNION ALL
          SELECT c.pedido_item_id,
                 c.quantidade,
                 nullif(btrim(t.ca_numero), '') AS ca
            FROM public.sup_estoque_consumo c
            JOIN public.sup_estoque_tag t ON t.codigo = c.codigo
           WHERE c.pedido_id = p_pedido_id
        ) movimento
       WHERE movimento.pedido_item_id IS NOT NULL
       GROUP BY movimento.pedido_item_id
      HAVING sum(movimento.quantidade) > 0
    ) saida ON saida.pedido_item_id = i.id
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
        'demissao',  CASE WHEN v_situacao = 'Demitido' THEN public.sup_norm_data(v_afastamento) END
      ) END,
    'itens', v_itens
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.sup_pedido_ficha_epi(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.sup_pedido_ficha_epi(uuid) TO authenticated;

COMMENT ON FUNCTION public.sup_pedido_ficha_epi(uuid) IS
  'Dados da Ficha de EPI: empresa, colaborador e somente itens efetivamente enviados, com quantidade e C.A.';

NOTIFY pgrst, 'reload schema';
