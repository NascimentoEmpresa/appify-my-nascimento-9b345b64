-- Cássio: previsão de abastecimento considera apenas o saldo ainda a receber.
-- Antes, uma entrega parcial continuava somando o pedido inteiro ao trânsito,
-- além das peças já disponíveis no estoque, reduzindo a reposição em dobro.
-- Conferências em andamento/canceladas não são recebimento confirmado.
-- Contrato segue o vínculo da despesa; sem filtro de contrato inclui todos.
-- Preserva a função instalada, os gates e a contagem de aguardando_compra.
-- ROLLBACK: restaurar a definição anterior de sup_estoque_saudavel; sem DML.

-- guardiao-ok: inspeciona apenas a definição da função, sem consultar dados de negócio; âncora ausente impede alteração parcial da RPC.
DO $migration$
DECLARE
  v_def text;
  v_origem text;
  v_destino text;
BEGIN
  SELECT pg_get_functiondef(
    'public.sup_estoque_saudavel(uuid,integer,uuid,text,uuid,integer)'::regprocedure
  ) INTO v_def;

  IF position('recebido_por_item_compra AS (' IN v_def) > 0 THEN
    RAISE NOTICE 'sup_estoque_saudavel já desconta recebimentos do trânsito.';
    RETURN;
  END IF;

  -- Recorta somente esta CTE, mantendo os hotfixes anteriores da função.
  v_origem := substring(v_def FROM '    em_transito AS \([\s\S]*?\n    \),');
  IF v_origem IS NULL THEN
    RAISE EXCEPTION 'CTE em_transito não encontrada em sup_estoque_saudavel.';
  END IF;
  v_destino := $trecho$
    recebido_por_item_compra AS (
      SELECT ri.sup_compra_pedido_item_id AS item_id,
             sum(GREATEST(COALESCE(ri.quantidade_conferida, 0), 0)) AS quantidade
        FROM public.sup_compra_pedido cp
        JOIN public.sup_compra_pedido_item ci ON ci.pedido_id = cp.id
        JOIN public.recebimento_nf_item ri ON ri.sup_compra_pedido_item_id = ci.id
        JOIN public.recebimento_nf r ON r.id = ri.recebimento_id
       WHERE cp.empresa_id = p_empresa_id
         AND cp.status IN ('enviado', 'aguardando_entrega', 'entrega_parcial')
         AND r.empresa_id = p_empresa_id
         AND r.status IN ('recebido', 'recebido_com_ocorrencia')
       GROUP BY ri.sup_compra_pedido_item_id
    ),
    em_transito AS (
      SELECT COALESCE(i.item_pai_id, i.id) AS base_id,
             COALESCE(public.sup_tamanho_da_variante(ci.tamanho),
                      public.sup_tamanho_da_variante(i.tamanho)) AS tamanho,
             sum(GREATEST(ci.quantidade - COALESCE(rec.quantidade, 0), 0))::numeric AS quantidade
        FROM public.sup_compra_pedido cp
        JOIN public.sup_compra_pedido_item ci ON ci.pedido_id = cp.id
        JOIN public.sup_item i ON i.id = ci.sup_item_id
        LEFT JOIN recebido_por_item_compra rec ON rec.item_id = ci.id
       WHERE cp.empresa_id = p_empresa_id
         AND cp.status IN ('enviado', 'aguardando_entrega', 'entrega_parcial')
         AND (v_categoria IS NULL OR i.tipo = v_categoria)
         AND (p_contrato_id IS NULL OR EXISTS (
           SELECT 1 FROM public.malote_despesa d
            WHERE d.id = cp.despesa_id AND d.contrato_id = p_contrato_id
         ))
       GROUP BY 1, 2
    ),$trecho$;
  v_def := replace(v_def, v_origem, v_destino);
  EXECUTE v_def;
END;
$migration$;

NOTIFY pgrst, 'reload schema';
