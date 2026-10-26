-- SIS-2026-0688 — saldo do estoque pelo tamanho canônico do catálogo
--
-- A listagem operacional identifica uma peça pelo `sup_item` da ficha de
-- estoque. Desde 20260930000163, uniforme com grade fica em um item-filho
-- por tamanho (ex.: "CAMISETA ... M"). Já a view de saldo agrupava pelo
-- tamanho que havia sido gravado na etiqueta. Parte das etiquetas anteriores
-- à mudança ainda carrega o tamanho da primeira entrada da família; somá-las
-- por esse campo fazia o dashboard concentrar os saldos de vários tamanhos
-- em um só. A listagem e os dashboards, então, mostravam números diferentes.
--
-- O tamanho do item-filho é a fonte canônica. A etiqueta segue como fallback
-- para materiais antigos, sem item variante. Não há alteração de quantidade,
-- reserva ou movimento nesta migration: só a dimensão pela qual o mesmo saldo
-- é agrupado.
--
-- ROLLBACK:
--   Recriar public.sup_estoque_saldo com t.tamanho AS tamanho e agrupar por
--   t.tamanho, como em 20260930000163_sup_item_codigo_por_tamanho.sql.
-- ============================================================================

CREATE OR REPLACE VIEW public.sup_estoque_saldo
WITH (security_invoker = true) AS
SELECT
  ei.id                AS item_estoque_id,
  ei.empresa_id,
  ei.almoxarifado_id,
  ei.sup_item_id,
  -- O item-filho da ficha é a verdade para a grade. A etiqueta é apenas o
  -- fallback dos materiais antigos que ainda não possuem variante própria.
  COALESCE(i.tamanho, t.tamanho) AS tamanho,
  (COALESCE(SUM(CASE
     WHEN t.tipo = 'massa' AND NOT t.usado THEN COALESCE(t.quantidade_massa, 0)
     WHEN t.tipo = 'unico' AND NOT t.usado THEN 1
     ELSE 0 END), 0)
   - COALESCE(SUM(r.reservado), 0))::integer AS disponivel,
  COALESCE(SUM(CASE
    WHEN t.tipo = 'massa' THEN COALESCE(t.quantidade_original_massa, 0) - COALESCE(t.quantidade_massa, 0)
    WHEN t.tipo = 'unico' AND t.usado THEN 1
    ELSE 0 END), 0)::integer AS consumido,
  count(t.id) FILTER (WHERE t.id IS NOT NULL)::integer AS etiquetas,
  COALESCE(SUM(r.reservado), 0)::integer AS reservado,
  COALESCE(SUM(CASE
    WHEN t.tipo = 'massa' AND NOT t.usado THEN COALESCE(t.quantidade_massa, 0)
    WHEN t.tipo = 'unico' AND NOT t.usado THEN 1
    ELSE 0 END), 0)::integer AS fisico,
  public.sup_item_raiz(ei.sup_item_id) AS sup_item_base_id
  FROM public.sup_estoque_item ei
  JOIN public.sup_item i ON i.id = ei.sup_item_id
  LEFT JOIN public.sup_estoque_tag t ON t.item_estoque_id = ei.id
  LEFT JOIN LATERAL (
    SELECT SUM(rr.quantidade)::integer AS reservado
      FROM public.sup_estoque_reserva rr
     WHERE rr.tag_id = t.id AND rr.situacao = 'ATIVA'
  ) r ON true
 GROUP BY ei.id, ei.empresa_id, ei.almoxarifado_id, ei.sup_item_id, i.tamanho, t.tamanho;

NOTIFY pgrst, 'reload schema';
