-- =====================================================================
-- SIS-2026-0799 — "Enviados" e "Pendentes envio" mostrando a mesma peça
--
-- SINTOMA (Pedidos de Materiais, 05/11/2026)
-- O Supply abre um pedido já despachado — o histórico diz "separada e
-- baixada", "retirou para entrega", "DESPACHADO" — e o botão "Pendentes
-- envio" do card ainda lista peças que saíram. Às vezes a mesma peça aparece
-- nas duas listas ("1 de 2" em Enviados e "1 de 2" em Pendentes).
--
-- CAUSA
-- `sup_est_tags_do_pedido` lia o ledger (`sup_estoque_consumo`) com INNER
-- JOIN em `sup_estoque_tag` pelo código do lote. Só que o lote é REMOVIDO
-- depois de usado com frequência ("não temos mais em estoque": 1.714
-- remoções nos 30 dias anteriores a esta migration) — e a linha do ledger,
-- que registra a peça que foi para o pedido, fica órfã do lote. O JOIN a
-- descartava: a peça enviada sumia de "Enviados" e voltava para "Pendentes".
-- Medido na produção em 05/11/2026: 2.981 linhas de ledger sem lote, em 869
-- pedidos (819 deles DESPACHADO). Exemplo: PED-20261005-0681, BOTINA 42 baixada
-- em 26/10 do lote L261023-7A7C5C1C51D844A9, que já não existe.
--
-- O resto do sistema já lia certo, por isso só os botões erravam:
--   * a view sup_pedido_situacao (badge "Despachado"/"Parcialmente") lê o
--     ledger direto, sem tag;
--   * buscarTagsDePedidos (src/hooks/useSupEstoque.ts — Excel e filtro por
--     status de item) também lê o ledger direto.
-- A regra do módulo é "quem levou quanto de qual lote se lê no ledger, nunca
-- na tag" (20260930000114); esta função era a exceção.
--
-- EFEITO COLATERAL CORRIGIDO JUNTO
-- O modal de Status/baixa (ModalBaixaPedido) usa esta mesma função para saber
-- quanto já saiu de cada item, e abria linha para baixar DE NOVO a peça cujo
-- lote fora removido. O pedido-editar (sup_pedido_editar) também a usa para
-- travar item que já saiu — e passa a travar estes também, como deve.
--
-- O QUE MUDA
-- Só o segundo ramo (ledger): os JOINs viram LEFT JOIN, a ficha de estoque
-- cai para a do próprio ledger (c.item_estoque_id) e nome/tamanho caem para
-- os do item do pedido quando o lote não existe mais. O primeiro ramo
-- (etiqueta única legada, que só existe enquanto a linha da tag existe)
-- fica idêntico. Assinatura, tipo de retorno, ordem e privilégios iguais.
--
-- Provado antes, na produção, em transação READ ONLY: para os itens de
-- pedidos DESPACHADO desde 04/08/2026, "só pendente" cai de 2.860 para 2.729
-- (os 2.729 restantes não têm saída nenhuma no ledger — despacho parcial de
-- verdade ou despacho sem baixa) e "nas duas listas" cai de 18 para 14 (os 14
-- são parciais reais, como divergência na doca "será enviado somente 1").
--
-- ROLLBACK
--   Recriar a função como em 20260820000002_supply_estoque_rpcs.sql:403
--   (os dois ramos com JOIN), seguido de NOTIFY pgrst, 'reload schema';
-- =====================================================================

CREATE OR REPLACE FUNCTION public.sup_est_tags_do_pedido(p_pedido_id uuid)
RETURNS TABLE (
  codigo text, pedido_item_id uuid, tipo text, quantidade int,
  tamanho text, material text, valor_unitario numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.codigo, t.pedido_item_id, t.tipo, 1,
         t.tamanho, i.nome, COALESCE(t.valor_unitario, ei.valor_unitario)
    FROM public.sup_estoque_tag t
    JOIN public.sup_estoque_item ei ON ei.id = t.item_estoque_id
    JOIN public.sup_item i ON i.id = ei.sup_item_id
   WHERE t.pedido_id = p_pedido_id
     AND t.tipo = 'unico'
     AND NOT EXISTS (
       SELECT 1 FROM public.sup_estoque_consumo c
        WHERE c.codigo = t.codigo AND c.pedido_id = p_pedido_id)
  UNION ALL
  -- Ledger: vale com ou sem o lote. Lote removido depois de usado não
  -- desfaz a saída da peça para o pedido.
  SELECT c.codigo, c.pedido_item_id, 'massa', c.quantidade,
         COALESCE(t.tamanho, pi.tamanho),
         COALESCE(i.nome, pi.nome_item),
         COALESCE(t.valor_unitario, ei.valor_unitario)
    FROM public.sup_estoque_consumo c
    LEFT JOIN public.sup_estoque_tag t   ON t.codigo = c.codigo
    LEFT JOIN public.sup_estoque_item ei ON ei.id = COALESCE(t.item_estoque_id, c.item_estoque_id)
    LEFT JOIN public.sup_item i          ON i.id = ei.sup_item_id
    LEFT JOIN public.sup_pedido_item pi  ON pi.id = c.pedido_item_id
   WHERE c.pedido_id = p_pedido_id
   ORDER BY 2, 1;
$$;

REVOKE ALL ON FUNCTION public.sup_est_tags_do_pedido(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_est_tags_do_pedido(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
