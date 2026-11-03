-- SIS-2026-0753 — evita timeout na aba Rotatividade do Estoque.
--
-- A RPC `sup_dashboard_rotatividade_estoque_detalhado` executava a RPC
-- executiva inteira e, no mesmo statement, repetia as leituras de pedidos,
-- movimentos e saldo para identificar código + item + tamanho. Em períodos
-- maiores a soma das duas agregações ultrapassava o statement_timeout do
-- PostgREST. O detalhe passa a ter uma RPC independente; o frontend executa
-- as duas em requisições separadas e recompõe o mesmo payload.
--
-- Os índices cobrem os dois recortes mais caros (empresa + período) e também
-- beneficiam a RPC executiva já existente.

CREATE INDEX IF NOT EXISTS idx_sup_pedido_empresa_data_rotatividade
  ON public.sup_pedido (empresa_id, data_solicitacao, contrato_id)
  WHERE status <> 'CANCELADO';

CREATE INDEX IF NOT EXISTS idx_sup_mov_empresa_data_rotatividade
  ON public.sup_estoque_movimento (empresa_id, created_at)
  INCLUDE (sup_item_id, pedido_id, tipo, tamanho, quantidade)
  WHERE tipo IN ('entrada', 'saida', 'devolucao', 'remocao');

CREATE OR REPLACE FUNCTION public.sup_dashboard_rotatividade_itens_detalhe(
  p_empresa_id uuid,
  p_inicio date,
  p_fim date,
  p_contrato_id uuid DEFAULT NULL,
  p_categoria text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_categoria text := NULLIF(btrim(lower(COALESCE(p_categoria, ''))), '');
BEGIN
  IF v_uid IS NULL OR NOT public.can_access(
    v_uid, 'sup_dashboard_compras_estoque', 'visualizar'::public.app_acao
  ) THEN
    RAISE EXCEPTION 'Sem permissão para visualizar o Dashboard de Compras, Estoque e Saving.'
      USING ERRCODE = '42501';
  END IF;

  IF p_empresa_id IS NULL OR p_inicio IS NULL OR p_fim IS NULL OR p_inicio > p_fim THEN
    RAISE EXCEPTION 'Empresa e período válido são obrigatórios.' USING ERRCODE = '22023';
  END IF;

  IF p_fim - p_inicio > 1827 THEN
    RAISE EXCEPTION 'O período máximo do dashboard é de cinco anos.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.profiles perfil
     WHERE perfil.id = v_uid
       AND (perfil.acessa_todas_empresas OR perfil.empresa_id = p_empresa_id)
  ) AND NOT EXISTS (
    SELECT 1
      FROM public.user_empresa vinculo
     WHERE vinculo.user_id = v_uid
       AND vinculo.empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'Usuário sem acesso à empresa selecionada.' USING ERRCODE = '42501';
  END IF;

  RETURN (
    WITH
    pedido_agg AS (
      SELECT
        COALESCE(base.id, item.id)::text AS item_chave,
        max(COALESCE(item.codigo, base.codigo)) AS codigo,
        max(COALESCE(base.nome, item.nome, pedido_item.nome_item)) AS item,
        public.sup_tamanho_da_variante(pedido_item.tamanho) AS tamanho,
        sum(pedido_item.quantidade)::numeric AS pedidas
      FROM public.sup_pedido pedido
      JOIN public.sup_pedido_item pedido_item ON pedido_item.pedido_id = pedido.id
      LEFT JOIN public.sup_item item ON item.id = pedido_item.item_id
      LEFT JOIN public.sup_item base ON base.id = COALESCE(item.item_pai_id, item.id)
      WHERE pedido.empresa_id = p_empresa_id
        AND pedido.data_solicitacao BETWEEN p_inicio AND p_fim
        AND pedido.status <> 'CANCELADO'
        AND COALESCE(base.id, item.id) IS NOT NULL
        AND (p_contrato_id IS NULL OR pedido.contrato_id = p_contrato_id)
        AND (v_categoria IS NULL OR COALESCE(item.tipo, pedido_item.tipo_item) = v_categoria)
      GROUP BY 1, 4
    ),
    movimento_agg AS (
      SELECT
        COALESCE(base.id, item.id)::text AS item_chave,
        max(COALESCE(item.codigo, base.codigo)) AS codigo,
        max(COALESCE(base.nome, item.nome)) AS item,
        COALESCE(
          public.sup_tamanho_da_variante(movimento.tamanho),
          public.sup_tamanho_da_variante(item.tamanho)
        ) AS tamanho,
        COALESCE(
          sum(abs(movimento.quantidade)) FILTER (WHERE movimento.tipo = 'entrada'),
          0
        )::numeric AS entradas,
        COALESCE(
          sum(abs(movimento.quantidade)) FILTER (WHERE movimento.tipo IN ('saida', 'remocao')),
          0
        )::numeric AS saidas
      FROM public.sup_estoque_movimento movimento
      JOIN public.sup_item item ON item.id = movimento.sup_item_id
      LEFT JOIN public.sup_item base ON base.id = COALESCE(item.item_pai_id, item.id)
      LEFT JOIN public.sup_pedido pedido ON pedido.id = movimento.pedido_id
      WHERE movimento.empresa_id = p_empresa_id
        AND movimento.created_at >= p_inicio::timestamptz
        AND movimento.created_at < (p_fim + 1)::timestamptz
        AND movimento.tipo IN ('entrada', 'saida', 'remocao')
        AND (p_contrato_id IS NULL OR pedido.contrato_id = p_contrato_id)
        AND (v_categoria IS NULL OR item.tipo = v_categoria)
      GROUP BY 1, 4
    ),
    saldo_agg AS (
      SELECT
        COALESCE(base.id, item.id)::text AS item_chave,
        max(COALESCE(item.codigo, base.codigo)) AS codigo,
        max(COALESCE(base.nome, item.nome)) AS item,
        COALESCE(
          public.sup_tamanho_da_variante(saldo.tamanho),
          public.sup_tamanho_da_variante(item.tamanho)
        ) AS tamanho,
        sum(COALESCE(saldo.fisico, 0))::numeric AS fisico,
        sum(COALESCE(saldo.reservado, 0))::numeric AS reservado,
        sum(COALESCE(saldo.disponivel, 0))::numeric AS disponivel,
        bool_or(estoque_item.arquivado_em IS NULL) AS cadastro_ativo
      FROM public.sup_estoque_saldo saldo
      JOIN public.sup_estoque_item estoque_item ON estoque_item.id = saldo.item_estoque_id
      JOIN public.sup_item item ON item.id = saldo.sup_item_id
      LEFT JOIN public.sup_item base ON base.id = COALESCE(item.item_pai_id, item.id)
      WHERE saldo.empresa_id = p_empresa_id
        AND (v_categoria IS NULL OR item.tipo = v_categoria)
      GROUP BY 1, 4
    ),
    identidades AS (
      -- Saldo é a fonte prioritária porque identifica o código operacional
      -- da variante que a tela Estoque & Etiquetas exibe. Movimento vem em
      -- seguida e pedido é a rede para item sem cadastro de estoque.
      SELECT item_chave, codigo, item, tamanho, 1 AS prioridade FROM saldo_agg
      UNION ALL
      SELECT item_chave, codigo, item, tamanho, 2 AS prioridade FROM movimento_agg
      UNION ALL
      SELECT item_chave, codigo, item, tamanho, 3 AS prioridade FROM pedido_agg
    ),
    chaves AS (
      SELECT
        item_chave,
        tamanho,
        (array_remove(array_agg(codigo ORDER BY prioridade), NULL::text))[1] AS codigo,
        (array_remove(array_agg(item ORDER BY prioridade), NULL::text))[1] AS item
      FROM identidades
      GROUP BY item_chave, tamanho
    ),
    por_item_tamanho AS (
      SELECT
        chave.item_chave,
        chave.codigo,
        COALESCE(chave.item, 'Item sem nome') AS item,
        chave.tamanho,
        COALESCE(pedido.pedidas, 0)::numeric AS pedidas,
        COALESCE(movimento.entradas, 0)::numeric AS entradas,
        COALESCE(movimento.saidas, 0)::numeric AS saidas,
        COALESCE(saldo.fisico, 0)::numeric AS fisico,
        COALESCE(saldo.reservado, 0)::numeric AS reservado,
        COALESCE(saldo.disponivel, 0)::numeric AS saldo_disponivel,
        COALESCE(saldo.cadastro_ativo, false) AS cadastro_ativo,
        CASE
          WHEN COALESCE(saldo.disponivel, 0) > 0
          THEN round(COALESCE(movimento.saidas, 0) / saldo.disponivel, 2)
        END AS giro
      FROM chaves chave
      LEFT JOIN pedido_agg pedido
        ON pedido.item_chave = chave.item_chave
       AND pedido.tamanho IS NOT DISTINCT FROM chave.tamanho
      LEFT JOIN movimento_agg movimento
        ON movimento.item_chave = chave.item_chave
       AND movimento.tamanho IS NOT DISTINCT FROM chave.tamanho
      LEFT JOIN saldo_agg saldo
        ON saldo.item_chave = chave.item_chave
       AND saldo.tamanho IS NOT DISTINCT FROM chave.tamanho
    ),
    por_peca AS (
      SELECT
        item_chave,
        max(codigo) AS codigo,
        max(item) AS peca,
        sum(pedidas)::numeric AS pedidas,
        sum(entradas)::numeric AS entradas,
        sum(saidas)::numeric AS saidas,
        sum(fisico)::numeric AS fisico,
        sum(reservado)::numeric AS reservado,
        sum(saldo_disponivel)::numeric AS saldo_disponivel,
        CASE
          WHEN sum(saldo_disponivel) > 0 THEN round(sum(saidas) / sum(saldo_disponivel), 2)
        END AS giro,
        (
          SELECT detalhe.tamanho
          FROM por_item_tamanho detalhe
          WHERE detalhe.item_chave = agrupado.item_chave
          ORDER BY detalhe.saidas DESC, detalhe.pedidas DESC,
                   public.sup_tamanho_ordem(detalhe.tamanho) NULLS LAST
          LIMIT 1
        ) AS tamanho_top
      FROM por_item_tamanho agrupado
      GROUP BY item_chave
    ),
    novo_resumo AS (
      SELECT jsonb_build_object(
        'saldo_fisico', COALESCE(sum(fisico), 0),
        'reservado', COALESCE(sum(reservado), 0),
        'saldo_disponivel', COALESCE(sum(saldo_disponivel), 0),
        'item_tamanho_mais_sai', (
          SELECT jsonb_build_object(
            'codigo', codigo, 'item', item, 'tamanho', tamanho,
            'unidades', saidas, 'saldo', saldo_disponivel
          )
          FROM por_item_tamanho
          WHERE saidas > 0
          ORDER BY saidas DESC, item, public.sup_tamanho_ordem(tamanho)
          LIMIT 1
        ),
        'item_tamanho_mais_entra', (
          SELECT jsonb_build_object(
            'codigo', codigo, 'item', item, 'tamanho', tamanho,
            'unidades', entradas, 'saldo', saldo_disponivel
          )
          FROM por_item_tamanho
          WHERE entradas > 0
          ORDER BY entradas DESC, item, public.sup_tamanho_ordem(tamanho)
          LIMIT 1
        ),
        'item_tamanho_maior_giro', (
          SELECT jsonb_build_object(
            'codigo', codigo, 'item', item, 'tamanho', tamanho,
            'giro', giro, 'saldo', saldo_disponivel, 'saidas', saidas
          )
          FROM por_item_tamanho
          WHERE giro IS NOT NULL AND saidas >= 20 AND saldo_disponivel >= 10
          ORDER BY giro DESC, saidas DESC, item
          LIMIT 1
        ),
        'peca_mais_sai', (
          SELECT jsonb_build_object('codigo', codigo, 'peca', peca, 'unidades', saidas)
          FROM por_peca
          WHERE saidas > 0
          ORDER BY saidas DESC, peca
          LIMIT 1
        )
      ) AS valor
      FROM por_item_tamanho
    )
    SELECT jsonb_build_object(
      'resumo', COALESCE((SELECT valor FROM novo_resumo), '{}'::jsonb),
      'por_item_tamanho', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'codigo', codigo,
          'item', item,
          'tamanho', tamanho,
          'pedidas', pedidas,
          'entradas', entradas,
          'saidas', saidas,
          'fisico', fisico,
          'reservado', reservado,
          'saldo_disponivel', saldo_disponivel,
          'cadastro_ativo', cadastro_ativo,
          'giro', giro
        ) ORDER BY saidas DESC, pedidas DESC, item, public.sup_tamanho_ordem(tamanho))
        FROM por_item_tamanho
        WHERE pedidas > 0 OR entradas > 0 OR saidas > 0 OR fisico > 0
      ), '[]'::jsonb),
      'por_peca', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'codigo', codigo,
          'peca', peca,
          'pedidas', pedidas,
          'valor_pedido', 0,
          'entradas', entradas,
          'saidas', saidas,
          'saldo_disponivel', saldo_disponivel,
          'tamanho_top', tamanho_top,
          'giro', giro
        ) ORDER BY saidas DESC, pedidas DESC, peca)
        FROM por_peca
        WHERE pedidas > 0 OR entradas > 0 OR saidas > 0 OR fisico > 0
      ), '[]'::jsonb)
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.sup_dashboard_rotatividade_itens_detalhe(uuid,date,date,uuid,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_dashboard_rotatividade_itens_detalhe(uuid,date,date,uuid,text)
  TO authenticated;

COMMENT ON FUNCTION public.sup_dashboard_rotatividade_itens_detalhe(uuid,date,date,uuid,text) IS
  'SIS-2026-0753: detalhe de rotatividade por código, item e tamanho em consulta independente para evitar timeout.';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
-- DROP FUNCTION IF EXISTS public.sup_dashboard_rotatividade_itens_detalhe(uuid,date,date,uuid,text);
-- DROP INDEX IF EXISTS public.idx_sup_mov_empresa_data_rotatividade;
-- DROP INDEX IF EXISTS public.idx_sup_pedido_empresa_data_rotatividade;
