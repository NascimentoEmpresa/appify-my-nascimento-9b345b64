-- SIS-2026-0741 — código do produto nos itens do Dashboard de Suprimentos
--
-- O Dashboard agregava o estoque pelo item canônico (sup_item), mas removia
-- `sup_item.codigo` antes de devolver as linhas. Assim, dois materiais com
-- nomes parecidos não podiam ser conferidos na tela. O código é imutável e é
-- a identidade operacional do produto; ele acompanha cada linha de estoque
-- e de movimentação devolvida pela RPC.
--
-- A função do dashboard é extensa e já recebeu correções após sua criação.
-- Em vez de republicar uma cópia antiga e apagar essas correções, a migration
-- recompila a definição instalada, alterando somente os trechos que carregam
-- o item do catálogo até o JSON de resposta. Cada trecho é conferido antes da
-- alteração: se a função tiver mudado de formato, a migration para em vez de
-- publicar uma RPC incompleta.
--
-- ROLLBACK:
--   Recriar a função public.sup_dashboard_compras_estoque com a definição
--   anterior, removendo `codigo` da CTE estoque, das agregações e do JSON.
-- ============================================================================

DO $bloco$
DECLARE
  v_definicao text;
  v_origem text;
  v_destino text;
BEGIN
  SELECT pg_get_functiondef(
    'public.sup_dashboard_compras_estoque(uuid,date,date,uuid,text,text)'::regprocedure
  ) INTO v_definicao;

  IF v_definicao IS NULL THEN
    RAISE EXCEPTION 'Função sup_dashboard_compras_estoque não encontrada.';
  END IF;

  -- Código vindo do MESMO sup_item que formou a linha de estoque; nunca do
  -- nome exibido, que não é uma chave de produto.
  v_origem := E'i.nome AS item,\n             i.tipo AS categoria,';
  v_destino := E'i.nome AS item,\n             i.codigo AS codigo,\n             i.tipo AS categoria,';
  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Não foi possível localizar o item canônico na RPC do dashboard.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  v_origem := E'GROUP BY ei.id, ei.sup_item_id, i.nome, i.tipo,\n                ei.estoque_minimo, ei.valor_unitario';
  v_destino := E'GROUP BY ei.id, ei.sup_item_id, i.nome, i.codigo, i.tipo,\n                ei.estoque_minimo, ei.valor_unitario';
  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Não foi possível localizar o agrupamento de estoque na RPC do dashboard.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  v_origem := E'SELECT e.item_estoque_id, e.item, e.categoria,\n             COALESCE(sum(abs(m.quantidade)), 0)::numeric AS quantidade,\n             e.valor_total';
  v_destino := E'SELECT e.item_estoque_id, e.item, e.codigo, e.categoria,\n             COALESCE(sum(abs(m.quantidade)), 0)::numeric AS quantidade,\n             e.valor_total';
  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Não foi possível localizar a agregação de movimentação na RPC do dashboard.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  v_origem := E'GROUP BY e.item_estoque_id, e.item, e.categoria, e.valor_total';
  v_destino := E'GROUP BY e.item_estoque_id, e.item, e.codigo, e.categoria, e.valor_total';
  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Não foi possível localizar o agrupamento de movimentação na RPC do dashboard.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  v_origem := 'SELECT item, categoria, quantidade, valor_total';
  v_destino := 'SELECT item, codigo, categoria, quantidade, valor_total';
  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Não foi possível localizar as listas de movimentação na RPC do dashboard.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  v_origem := E'SELECT e.item, e.categoria, e.disponivel, e.reservado,';
  v_destino := E'SELECT e.item, e.codigo, e.categoria, e.disponivel, e.reservado,';
  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Não foi possível localizar o detalhamento de estoque na RPC do dashboard.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  EXECUTE v_definicao;
END;
$bloco$;

NOTIFY pgrst, 'reload schema';
