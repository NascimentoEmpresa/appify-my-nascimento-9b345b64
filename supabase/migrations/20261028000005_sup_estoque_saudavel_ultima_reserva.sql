-- SIS-2026-0753 — Não confundir reserva com baixa física no estoque saudável.
--
-- A reserva trava uma peça para separação, mas ela continua fisicamente no
-- almoxarifado até a baixa. Expor as duas datas evita que a lista de
-- liquidação trate uma reserva (inclusive uma posteriormente liberada) como
-- saída, sem esconder do gestor que houve tentativa de atendimento.

DO $bloco$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.sup_estoque_saudavel(uuid,integer,uuid,text,uuid,integer)'::regprocedure)
    INTO v_def;

  IF v_def IS NULL OR position('ultima_saida AS (' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Não foi possível localizar a versão esperada de sup_estoque_saudavel.';
  END IF;

  v_def := replace(v_def,
$$    ultima_saida AS (
      SELECT base_id, tamanho, max(created_at)::date AS data
        FROM movimento WHERE tipo IN ('saida', 'remocao')
       GROUP BY 1, 2
    ),$$,
$$    ultima_saida AS (
      SELECT base_id, tamanho, max(created_at)::date AS data
        FROM movimento WHERE tipo IN ('saida', 'remocao')
       GROUP BY 1, 2
    ),
    ultima_reserva AS (
      SELECT COALESCE(base.id, i.id) AS base_id,
             COALESCE(public.sup_tamanho_da_variante(m.tamanho),
                      public.sup_tamanho_da_variante(i.tamanho)) AS tamanho,
             max(m.created_at)::date AS data
        FROM public.sup_estoque_movimento m
        JOIN public.sup_item i ON i.id = m.sup_item_id
        LEFT JOIN public.sup_item base ON base.id = COALESCE(i.item_pai_id, i.id)
       WHERE m.empresa_id = p_empresa_id
         AND m.tipo = 'reserva'
         AND (v_categoria IS NULL OR i.tipo = v_categoria)
       GROUP BY 1, 2
    ),$$);

  IF position('ultima_reserva AS (' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Não foi possível incluir a última reserva em sup_estoque_saudavel.';
  END IF;

  v_def := replace(v_def,
    '             us.data AS ultima_saida,' || E'\n' || '             hp.ultimo_pedido,',
    '             us.data AS ultima_saida,' || E'\n' || '             ur.data AS ultima_reserva,' || E'\n' || '             hp.ultimo_pedido,');
  v_def := replace(v_def,
    '        LEFT JOIN ultima_saida us ON us.base_id = k.base_id AND us.tamanho IS NOT DISTINCT FROM k.tamanho',
    '        LEFT JOIN ultima_saida us ON us.base_id = k.base_id AND us.tamanho IS NOT DISTINCT FROM k.tamanho' || E'\n' ||
    '        LEFT JOIN ultima_reserva ur ON ur.base_id = k.base_id AND ur.tamanho IS NOT DISTINCT FROM k.tamanho');
  v_def := replace(v_def,
    '''ultima_saida'', ultima_saida, ''ultimo_pedido'', ultimo_pedido,',
    '''ultima_saida'', ultima_saida, ''ultima_reserva'', ultima_reserva, ''ultimo_pedido'', ultimo_pedido,');

  IF position('''ultima_reserva'', ultima_reserva' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Não foi possível expor a última reserva no retorno de sup_estoque_saudavel.';
  END IF;
  EXECUTE v_def;
END;
$bloco$;

NOTIFY pgrst, 'reload schema';
