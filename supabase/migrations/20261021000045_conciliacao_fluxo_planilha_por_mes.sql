-- ============================================================================
-- SIS-2026-0701 — Conciliação da Origem do Fluxo de Caixa: ponte da planilha importada com o que o ERP lê, mês a mês
-- ============================================================================
-- A tela só tinha o total da planilha por situação (em uso / ocultas / excluídas). Para conferir o ano inteiro sem comparar linha a
-- linha na mão, duas funções de leitura (respeitam a RLS de quem chama):
--   conciliacao_fluxo_planilha_por_mes(_base)        -> linhas, entradas e saídas da planilha carregada por MÊS e situação
--   conciliacao_fluxo_planilha_linhas(_mes, ...)     -> as linhas de um mês, com o número da linha NA PLANILHA (planilha_linha)
--   conciliacao_fluxo_planilha_diferencas(_mes, ...) -> (_mes NULL = todos os meses) as linhas em uso cujo valor, tipo ou mês no Fluxo é diferente do que a planilha
--                                                       trouxe (ajuste feito depois da carga): é o que explica a diferença do mês
-- _base: 'pagamento' (data de pagamento, padrão) ou 'competencia'.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.conciliacao_fluxo_planilha_por_mes(text);
--   DROP FUNCTION IF EXISTS public.conciliacao_fluxo_planilha_linhas(date, text, text);
--   DROP FUNCTION IF EXISTS public.conciliacao_fluxo_planilha_diferencas(date, text);

CREATE OR REPLACE FUNCTION public.conciliacao_fluxo_planilha_por_mes(_base text DEFAULT 'pagamento')
RETURNS TABLE (mes date, situacao text, qtd bigint, entradas numeric, saidas numeric)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    date_trunc('month', CASE WHEN _base = 'competencia' THEN f.competencia ELSE f.data_pagamento END)::date AS mes,
    CASE
      WHEN f.deleted_at IS NOT NULL AND f.deleted_by IS NOT NULL THEN 'excluida_por_usuario'
      WHEN f.deleted_at IS NOT NULL THEN 'excluida_na_carga'
      WHEN f.conferencia = 'ja_existe_no_erp' THEN 'ja_existe_no_erp'
      ELSE 'em_uso'
    END AS situacao,
    count(*) AS qtd,
    COALESCE(sum(f.valor) FILTER (WHERE f.tipo = 'entrada'), 0) AS entradas,
    COALESCE(sum(f.valor) FILTER (WHERE f.tipo = 'saida'), 0) AS saidas
  FROM public.fluxo_caixa_importado f
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;
GRANT EXECUTE ON FUNCTION public.conciliacao_fluxo_planilha_por_mes(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.conciliacao_fluxo_planilha_linhas(_mes date, _situacao text DEFAULT NULL, _base text DEFAULT 'pagamento')
RETURNS TABLE (
  planilha_linha int, planilha_id_original text, situacao text, tipo text, data_pagamento date, competencia date,
  classificacao_texto text, contrato_texto text, descricao text, banco_texto text, valor numeric, observacao text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM (
    SELECT
      f.planilha_linha, f.planilha_id_original,
      CASE
        WHEN f.deleted_at IS NOT NULL AND f.deleted_by IS NOT NULL THEN 'excluida_por_usuario'
        WHEN f.deleted_at IS NOT NULL THEN 'excluida_na_carga'
        WHEN f.conferencia = 'ja_existe_no_erp' THEN 'ja_existe_no_erp'
        ELSE 'em_uso'
      END AS situacao,
      f.tipo, f.data_pagamento, f.competencia, f.classificacao_texto, f.contrato_texto, f.descricao, f.banco_texto, f.valor,
      COALESCE(f.observacao_importacao, f.conferencia_ref) AS observacao
    FROM public.fluxo_caixa_importado f
    WHERE date_trunc('month', CASE WHEN _base = 'competencia' THEN f.competencia ELSE f.data_pagamento END)::date = date_trunc('month', _mes)::date
  ) t
  WHERE _situacao IS NULL OR t.situacao = _situacao
  ORDER BY t.planilha_linha;
$$;
GRANT EXECUTE ON FUNCTION public.conciliacao_fluxo_planilha_linhas(date, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.conciliacao_fluxo_planilha_diferencas(_mes date, _base text DEFAULT 'pagamento')
RETURNS TABLE (
  planilha_linha int, planilha_id_original text, despesa_id uuid, id_malote text, descricao text,
  tipo_planilha text, valor_planilha numeric, data_planilha date, competencia_planilha date,
  tipo_erp text, valor_erp numeric, data_erp date, competencia_erp date, motivo text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH j AS (
    SELECT
      f.planilha_linha, f.planilha_id_original, v.despesa_id, v.id_malote, COALESCE(v.descricao, f.descricao) AS descricao,
      f.tipo AS tipo_planilha, f.valor AS valor_planilha, f.data_pagamento AS data_planilha, f.competencia AS competencia_planilha,
      v.tipo AS tipo_erp, v.valor AS valor_erp, v.data_pagamento AS data_erp, v.competencia AS competencia_erp,
      date_trunc('month', CASE WHEN _base = 'competencia' THEN f.competencia ELSE f.data_pagamento END)::date AS mes_planilha,
      date_trunc('month', CASE WHEN _base = 'competencia' THEN v.competencia ELSE v.data_pagamento END)::date AS mes_erp
    FROM public.fluxo_caixa_importado f
    JOIN public.v_fluxo_caixa_importado_fluxo_caixa v ON v.linha_id = f.id
    WHERE f.deleted_at IS NULL AND f.conferencia <> 'ja_existe_no_erp'
  )
  SELECT
    j.planilha_linha, j.planilha_id_original, j.despesa_id, j.id_malote, j.descricao,
    j.tipo_planilha, j.valor_planilha, j.data_planilha, j.competencia_planilha,
    j.tipo_erp, j.valor_erp, j.data_erp, j.competencia_erp,
    -- A planilha guarda estorno como valor NEGATIVO (uma saída negativa abate as saídas). No ERP o ajuste costuma virar valor positivo,
    -- muitas vezes como entrada: o saldo é o mesmo, mas entradas e saídas ficam maiores que as do Excel pelo mesmo valor.
    concat_ws(' + ',
      CASE WHEN j.valor_planilha <> 0 AND j.valor_planilha = -j.valor_erp THEN 'estorno: valor negativo na planilha virou positivo no ERP' END,
      CASE WHEN j.tipo_planilha IS DISTINCT FROM j.tipo_erp THEN 'entrada/saída trocada' END,
      CASE WHEN j.valor_planilha IS DISTINCT FROM j.valor_erp AND NOT (j.valor_planilha <> 0 AND j.valor_planilha = -j.valor_erp) THEN 'valor alterado' END,
      CASE WHEN j.mes_planilha IS DISTINCT FROM j.mes_erp THEN 'mudou de mês' END
    ) AS motivo
  FROM j
  WHERE (j.tipo_planilha IS DISTINCT FROM j.tipo_erp OR j.valor_planilha IS DISTINCT FROM j.valor_erp OR j.mes_planilha IS DISTINCT FROM j.mes_erp)
    AND (_mes IS NULL OR date_trunc('month', _mes)::date IN (j.mes_planilha, j.mes_erp))
  ORDER BY j.planilha_linha;
$$;
GRANT EXECUTE ON FUNCTION public.conciliacao_fluxo_planilha_diferencas(date, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
