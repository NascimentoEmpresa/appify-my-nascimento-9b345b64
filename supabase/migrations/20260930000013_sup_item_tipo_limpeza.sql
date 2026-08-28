-- =========================================================================
-- "Material de limpeza" entra como tipo de item
--
-- PEDIDO DO CASSIO (ajuste 11 da revisão de 27/08/2026)
-- Poder escolher o tipo na entrada de estoque e filtrar por ele no painel —
-- e a lista dele inclui material de limpeza, que não existia.
--
-- Os tipos atuais são 'uniforme', 'epi', 'insumo' e 'equipamento'. Hoje o
-- catálogo tem 556 equipamentos, 294 uniformes, 150 EPIs e nenhum insumo;
-- material de limpeza vinha sendo cadastrado como insumo ou equipamento,
-- misturado com o resto.
--
-- POR QUE 'limpeza' E NÃO 'material_limpeza'
-- Os quatro existentes são palavras únicas e curtas. O rótulo bonito é
-- problema da tela, não do banco — e valor de CHECK longo vira ruído em toda
-- query que filtra por ele.
--
-- Idempotente: o DROP/ADD do CHECK pode rodar de novo sem efeito diferente.
-- ROLLBACK (só funciona se nenhum item já usar 'limpeza'):
--   ALTER TABLE public.sup_item DROP CONSTRAINT sup_item_tipo_check;
--   ALTER TABLE public.sup_item ADD CONSTRAINT sup_item_tipo_check
--     CHECK (tipo IN ('uniforme', 'epi', 'insumo', 'equipamento'));
-- =========================================================================

ALTER TABLE public.sup_item DROP CONSTRAINT IF EXISTS sup_item_tipo_check;

ALTER TABLE public.sup_item
  ADD CONSTRAINT sup_item_tipo_check
  CHECK (tipo IN ('uniforme', 'epi', 'insumo', 'equipamento', 'limpeza'));

COMMENT ON COLUMN public.sup_item.tipo IS
  'uniforme | epi | insumo | equipamento | limpeza. O tipo epi e o unico com efeito de regra: e ele que aciona laudo do SST, exigencia de CA na entrada e bloqueio por CA irregular.';

-- ── Conferência ──────────────────────────────────────────────────────────
SELECT tipo, count(*) AS itens
  FROM public.sup_item
 GROUP BY tipo
 ORDER BY itens DESC;

NOTIFY pgrst, 'reload schema';
