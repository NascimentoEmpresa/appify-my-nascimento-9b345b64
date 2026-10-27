-- SIS-2026-0741 — código do produto nos itens do Dashboard de Suprimentos
--
-- O Dashboard agregava o estoque pelo item canônico (sup_item), mas removia
-- `sup_item.codigo` antes de devolver as linhas. Assim, dois materiais com
-- nomes parecidos não podiam ser conferidos na tela. O código é imutável e é
-- identidade operacional do produto; ele acompanha cada linha de estoque
-- e de movimentação devolvida pela RPC.
--
-- A função do dashboard é extensa e já recebeu correções após sua criação.
-- Em vez de republicar uma cópia antiga e apagar essas correções, a migration
-- recompila a definição instalada, alterando somente os trechos que carregam
-- o item do catálogo até o JSON de resposta.
--
-- ============================================================================
-- POR QUE ESTA MIGRATION FALHOU TRÊS VEZES (27/10/2026)
--
-- A primeira versão procurava os trechos com `position(...)` sobre o texto de
-- `pg_get_functiondef`, usando âncoras de VÁRIAS linhas escritas com `\n`.
-- Ela parava sempre na primeira âncora:
--
--   ERROR: Não foi possível localizar o item canônico na RPC do dashboard.
--
-- A função não havia mudado. O que não batia era o FIM DE LINHA. A RPC foi
-- publicada em 07/10 (20261007000001) colando o arquivo no SQL Editor da
-- Supabase, e esse arquivo está no repositório com fim de linha do Windows:
-- o corpo guardado em `pg_proc.prosrc` tem `\r\n`, e nenhuma âncora com `\n`
-- casa com ele. Reproduzido em cluster PostgreSQL 18 descartável: com o corpo
-- em CRLF dá exatamente o erro acima na linha 20; com o MESMO corpo em LF a
-- migration aplica e o código aparece no JSON.
--
-- Como a migration aborta na transação única e volta para a fila, ela barrou
-- todas as migrations seguintes (as de joão e pablo também) em cada merge para
-- a main — #1028, #1029 e a anterior. Por isso a correção vem no próprio
-- arquivo, que nunca foi registrado em supabase_migrations.schema_migrations.
--
-- O conserto tem três partes:
--   1. `\r` é removido da definição antes da conferência — e, como a definição
--      corrigida é republicada, o corpo volta a ficar só com `\n`, encerrando
--      a divergência de fim de linha nessa função;
--   2. as âncoras passam a ser de UMA linha (a única que precisa de duas
--      aceita qualquer espaçamento entre elas), então reindentar a função não
--      quebra mais a migration;
--   3. a migration é idempotente: se o código já estiver na RPC, ela não faz
--      nada e não falha.
--
-- ROLLBACK:
-- Recriar a função public.sup_dashboard_compras_estoque com a definição
-- anterior, removendo `codigo` da CTE estoque, das agregações e do JSON.
-- ============================================================================

DO $bloco$
DECLARE
  v_definicao text;
  v_antes text;
  v_par text[];
  -- {expressão de busca, texto que entra no lugar}. A busca é regex: só o
  -- primeiro par precisa atravessar a quebra de linha, e aceita qualquer
  -- espaçamento ali.
  v_pares text[] := ARRAY[
    [ 'i\.nome AS item,\s+i\.tipo AS categoria,',
      E'i.nome AS item,\n             i.codigo AS codigo,\n             i.tipo AS categoria,' ],
    [ 'GROUP BY ei\.id, ei\.sup_item_id, i\.nome, i\.tipo,',
      'GROUP BY ei.id, ei.sup_item_id, i.nome, i.codigo, i.tipo,' ],
    [ 'SELECT e\.item_estoque_id, e\.item, e\.categoria,',
      'SELECT e.item_estoque_id, e.item, e.codigo, e.categoria,' ],
    [ 'GROUP BY e\.item_estoque_id, e\.item, e\.categoria, e\.valor_total',
      'GROUP BY e.item_estoque_id, e.item, e.codigo, e.categoria, e.valor_total' ],
    [ 'SELECT item, categoria, quantidade, valor_total',
      'SELECT item, codigo, categoria, quantidade, valor_total' ],
    [ 'SELECT e\.item, e\.categoria, e\.disponivel, e\.reservado,',
      'SELECT e.item, e.codigo, e.categoria, e.disponivel, e.reservado,' ]
  ];
BEGIN
  SELECT pg_get_functiondef(
    'public.sup_dashboard_compras_estoque(uuid,date,date,uuid,text,text)'::regprocedure
  ) INTO v_definicao;

  IF v_definicao IS NULL THEN
    RAISE EXCEPTION 'Função sup_dashboard_compras_estoque não encontrada.';
  END IF;

  -- O corpo instalado veio de um arquivo com fim de linha do Windows. Sem
  -- isto, nenhuma âncora de mais de uma linha casa (ver cabeçalho).
  v_definicao := replace(v_definicao, chr(13), '');

  IF position('i.codigo AS codigo' IN v_definicao) > 0 THEN
    RAISE NOTICE 'sup_dashboard_compras_estoque já devolve o código do produto; nada a fazer.';
    RETURN;
  END IF;

  FOREACH v_par SLICE 1 IN ARRAY v_pares LOOP
    v_antes := v_definicao;
    -- Código vindo do MESMO sup_item que formou a linha de estoque; nunca do
    -- nome exibido, que não é uma chave de produto.
    v_definicao := regexp_replace(v_definicao, v_par[1], v_par[2], 'g');
    IF v_definicao = v_antes THEN
      RAISE EXCEPTION 'Não foi possível localizar "%" na RPC do dashboard.', v_par[1];
    END IF;
  END LOOP;

  EXECUTE v_definicao;
END;
$bloco$;

NOTIFY pgrst, 'reload schema';
