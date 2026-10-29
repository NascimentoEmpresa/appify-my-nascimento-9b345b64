-- SIS-2026-0753 — concilia o Dashboard de Suprimentos com as telas operacionais
--
-- 1. O valor do estoque era calculado sobre o DISPONÍVEL e só com o preço do
--    cadastro, enquanto Estoque & Etiquetas usa saldo FÍSICO e o maior custo
--    vigente das etiquetas. Reserva não retira patrimônio; por isso o painel
--    ficava menor.
-- 2. A tela de Pedidos mostra o total histórico da empresa. O dashboard só
--    devolvia o recorte do período, o que impedia exibir lado a lado os dois
--    números com seus escopos explícitos.
-- 3. A RPC antiga de rotatividade consolida por tamanho. A RPC detalhada abaixo
--    preserva código + item + tamanho para os cards e para a conferência.
--
-- A função principal já recebeu hotfixes por recompilação de pg_get_functiondef.
-- A alteração cirúrgica mantém esses hotfixes e para se o corpo instalado não
-- tiver o formato esperado.

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

  -- A tela Estoque & Etiquetas usa quantidade física e, como custo, o maior
  -- valor vigente entre o cadastro e as etiquetas ainda físicas. Repetir a
  -- MESMA fórmula aqui evita tanto descontar reserva quanto subavaliar um lote
  -- cujo custo individual supera o valor atual do cadastro.
  v_origem := E'ei.valor_unitario,\n             COALESCE(sum(s.disponivel), 0) * ei.valor_unitario AS valor_total';
  v_destino := E'GREATEST(\n               COALESCE(ei.valor_unitario, 0),\n               COALESCE((\n                 SELECT max(tag.valor_unitario)\n                   FROM public.sup_estoque_tag tag\n                  WHERE tag.item_estoque_id = ei.id\n                    AND NOT tag.usado\n                    AND tag.valor_unitario > 0\n               ), 0)\n             ) AS valor_unitario,\n             COALESCE(sum(s.fisico), 0) * GREATEST(\n               COALESCE(ei.valor_unitario, 0),\n               COALESCE((\n                 SELECT max(tag.valor_unitario)\n                   FROM public.sup_estoque_tag tag\n                  WHERE tag.item_estoque_id = ei.id\n                    AND NOT tag.usado\n                    AND tag.valor_unitario > 0\n               ), 0)\n             ) AS valor_total';
  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Não foi possível localizar o cálculo de valor do estoque no dashboard.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  v_origem := E'''resumo'', jsonb_build_object(\n        ''solicitacoes'', (SELECT count(*) FROM pedidos),';
  v_destino := E'''resumo'', jsonb_build_object(\n        ''solicitacoes_total_geral'', (\n          SELECT count(*) FROM public.sup_pedido p WHERE p.empresa_id = p_empresa_id\n        ),\n        ''solicitacoes'', (SELECT count(*) FROM pedidos),';
  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Não foi possível localizar o resumo de solicitações no dashboard.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  v_origem := E'''valor_total'', COALESCE((SELECT sum(valor_total) FROM estoque), 0),\n        ''quantidade_itens'', COALESCE((SELECT sum(disponivel) FROM estoque), 0),';
  v_destino := E'''valor_total'', COALESCE((SELECT sum(valor_total) FROM estoque), 0),\n        ''quantidade_fisica'', COALESCE((SELECT sum(fisico) FROM estoque), 0),\n        ''quantidade_reservada'', COALESCE((SELECT sum(reservado) FROM estoque), 0),\n        ''quantidade_itens'', COALESCE((SELECT sum(disponivel) FROM estoque), 0),';
  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Não foi possível localizar o resumo de estoque no dashboard.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  EXECUTE v_definicao;
END;
$bloco$;

-- Complemento da RPC de rotatividade. Mantém a resposta legada e substitui
-- somente os blocos que precisam da identidade operacional do produto.
CREATE OR REPLACE FUNCTION public.sup_dashboard_rotatividade_estoque_detalhado(
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
  v_base jsonb;
  v_categoria text := NULLIF(btrim(lower(COALESCE(p_categoria, ''))), '');
BEGIN
  -- A função-base executa todas as validações de usuário, empresa e período.
  -- Se o chamador não tiver acesso, a execução para aqui.
  v_base := public.sup_dashboard_rotatividade_estoque(
    p_empresa_id, p_inicio, p_fim, p_contrato_id, p_categoria
  );

  RETURN (
    WITH
    pedido_agg AS (
      SELECT
        COALESCE(base.id, item.id)::text AS item_chave,
        COALESCE(base.codigo, item.codigo) AS codigo,
        COALESCE(base.nome, pi.nome_item) AS item,
        public.sup_tamanho_da_variante(pi.tamanho) AS tamanho,
        sum(pi.quantidade)::numeric AS pedidas
      FROM public.sup_pedido pedido
      JOIN public.sup_pedido_item pi ON pi.pedido_id = pedido.id
      LEFT JOIN public.sup_item item ON item.id = pi.item_id
      LEFT JOIN public.sup_item base ON base.id = COALESCE(item.item_pai_id, item.id)
      WHERE pedido.empresa_id = p_empresa_id
        AND pedido.data_solicitacao BETWEEN p_inicio AND p_fim
        AND pedido.status <> 'CANCELADO'
        AND COALESCE(base.id, item.id) IS NOT NULL
        AND (p_contrato_id IS NULL OR pedido.contrato_id = p_contrato_id)
        AND (v_categoria IS NULL OR COALESCE(item.tipo, pi.tipo_item) = v_categoria)
      GROUP BY 1, 2, 3, 4
    ),
    movimento_agg AS (
      SELECT
        COALESCE(base.id, item.id)::text AS item_chave,
        COALESCE(base.codigo, item.codigo) AS codigo,
        COALESCE(base.nome, item.nome) AS item,
        COALESCE(
          public.sup_tamanho_da_variante(movimento.tamanho),
          public.sup_tamanho_da_variante(item.tamanho)
        ) AS tamanho,
        sum(abs(movimento.quantidade)) FILTER (WHERE movimento.tipo = 'entrada')::numeric AS entradas,
        sum(abs(movimento.quantidade)) FILTER (WHERE movimento.tipo IN ('saida', 'remocao'))::numeric AS saidas
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
      GROUP BY 1, 2, 3, 4
    ),
    saldo_agg AS (
      SELECT
        COALESCE(base.id, item.id)::text AS item_chave,
        COALESCE(base.codigo, item.codigo) AS codigo,
        COALESCE(base.nome, item.nome) AS item,
        COALESCE(
          public.sup_tamanho_da_variante(saldo.tamanho),
          public.sup_tamanho_da_variante(item.tamanho)
        ) AS tamanho,
        sum(COALESCE(saldo.fisico, 0))::numeric AS fisico,
        sum(COALESCE(saldo.reservado, 0))::numeric AS reservado,
        sum(COALESCE(saldo.disponivel, 0))::numeric AS disponivel
      FROM public.sup_estoque_saldo saldo
      JOIN public.sup_item item ON item.id = saldo.sup_item_id
      LEFT JOIN public.sup_item base ON base.id = COALESCE(item.item_pai_id, item.id)
      WHERE saldo.empresa_id = p_empresa_id
        AND (v_categoria IS NULL OR item.tipo = v_categoria)
      GROUP BY 1, 2, 3, 4
    ),
    chaves AS (
      SELECT item_chave, codigo, item, tamanho FROM pedido_agg
      UNION
      SELECT item_chave, codigo, item, tamanho FROM movimento_agg
      UNION
      SELECT item_chave, codigo, item, tamanho FROM saldo_agg
    ),
    por_item_tamanho AS (
      SELECT
        chave.item_chave,
        chave.codigo,
        chave.item,
        chave.tamanho,
        COALESCE(pedido.pedidas, 0)::numeric AS pedidas,
        COALESCE(movimento.entradas, 0)::numeric AS entradas,
        COALESCE(movimento.saidas, 0)::numeric AS saidas,
        COALESCE(saldo.fisico, 0)::numeric AS fisico,
        COALESCE(saldo.reservado, 0)::numeric AS reservado,
        COALESCE(saldo.disponivel, 0)::numeric AS saldo_disponivel,
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
    SELECT v_base || jsonb_build_object(
      'resumo', (v_base -> 'resumo') || COALESCE((SELECT valor FROM novo_resumo), '{}'::jsonb),
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
          'valor_pedido', COALESCE((
            SELECT (anterior ->> 'valor_pedido')::numeric
            FROM jsonb_array_elements(v_base -> 'por_peca') anterior
            WHERE anterior ->> 'peca' = por_peca.peca
            LIMIT 1
          ), 0),
          'entradas', entradas,
          'saidas', saidas,
          'fisico', fisico,
          'reservado', reservado,
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

REVOKE ALL ON FUNCTION public.sup_dashboard_rotatividade_estoque_detalhado(uuid,date,date,uuid,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_dashboard_rotatividade_estoque_detalhado(uuid,date,date,uuid,text)
  TO authenticated;

COMMENT ON FUNCTION public.sup_dashboard_rotatividade_estoque_detalhado(uuid,date,date,uuid,text) IS
  'SIS-2026-0753: rotatividade conferível por código, item e tamanho, preservando a resposta executiva existente.';

NOTIFY pgrst, 'reload schema';

-- O histórico mensal anterior devolvia SOMENTE meses que já tinham snapshot.
-- Como o primeiro fechamento existente é set/26, o eixo escondia toda a
-- demanda anterior e também a posição atual de outubro. A série abaixo mostra
-- todos os meses da janela: demanda real em todos eles, fechamentos onde
-- existem e a posição ao vivo no mês corrente. Saldo/alvo antigos sem
-- fechamento ficam NULL de propósito — lacuna honesta, nunca zero inventado.
DO $bloco$
DECLARE
  v_definicao text;
  v_origem text;
  v_destino text;
BEGIN
  SELECT pg_get_functiondef(
    'public.sup_estoque_saudavel(uuid,integer,uuid,text,uuid,integer)'::regprocedure
  ) INTO v_definicao;

  IF v_definicao IS NULL THEN
    RAISE EXCEPTION 'Função sup_estoque_saudavel não encontrada.';
  END IF;

  v_origem := $trecho$
    evolucao AS (
      SELECT to_char(s.competencia, 'YYYY-MM')  AS mes,
             to_char(s.competencia, 'TMMon/YY') AS rotulo,
             sum(s.saldo_disponivel)            AS saldo,
             sum(s.demanda_mes)                 AS demanda,
             sum(s.alvo_calculado)              AS alvo,
             round(sum(s.valor_em_estoque), 2)  AS valor
        FROM public.sup_estoque_snapshot s
       WHERE s.empresa_id = p_empresa_id
         AND (v_categoria IS NULL OR s.tipo_item = v_categoria)
         AND s.competencia >= (date_trunc('month', v_hoje) - interval '13 months')::date
       GROUP BY s.competencia
    )
$trecho$;

  v_destino := $trecho$
    meses_evolucao AS (
      SELECT generate_series(
               date_trunc('month', v_inicio::timestamp),
               date_trunc('month', v_hoje::timestamp),
               interval '1 month'
             )::date AS mes
    ),
    demanda_evolucao AS (
      SELECT d.mes, sum(d.quantidade)::numeric AS demanda
        FROM demanda d
       GROUP BY d.mes
    ),
    snapshot_evolucao AS (
      SELECT s.competencia AS mes,
             sum(s.saldo_disponivel)::numeric AS saldo,
             sum(s.alvo_calculado)::numeric AS alvo,
             round(sum(s.valor_em_estoque), 2) AS valor
        FROM public.sup_estoque_snapshot s
       WHERE s.empresa_id = p_empresa_id
         AND (v_categoria IS NULL OR s.tipo_item = v_categoria)
         AND s.competencia >= (date_trunc('month', v_hoje) - interval '13 months')::date
       GROUP BY s.competencia
    ),
    totais_atuais AS (
      SELECT COALESCE(sum(c.disponivel), 0)::numeric AS saldo,
             COALESCE(sum(c.alvo), 0)::numeric AS alvo,
             round(COALESCE(sum(c.valor_em_estoque), 0), 2) AS valor
        FROM completo c
    ),
    evolucao AS (
      SELECT to_char(m.mes, 'YYYY-MM') AS mes,
             to_char(m.mes, 'TMMon/YY') AS rotulo,
             CASE WHEN m.mes = date_trunc('month', v_hoje)::date
                  THEN atual.saldo ELSE snapshot.saldo END AS saldo,
             COALESCE(demanda.demanda, 0) AS demanda,
             CASE WHEN m.mes = date_trunc('month', v_hoje)::date
                  THEN atual.alvo ELSE snapshot.alvo END AS alvo,
             CASE WHEN m.mes = date_trunc('month', v_hoje)::date
                  THEN atual.valor ELSE snapshot.valor END AS valor,
             CASE
               WHEN m.mes = date_trunc('month', v_hoje)::date THEN 'hoje'
               WHEN snapshot.mes IS NOT NULL THEN 'fechamento'
               ELSE 'sem_fechamento'
             END AS tipo_ponto
        FROM meses_evolucao m
        LEFT JOIN demanda_evolucao demanda ON demanda.mes = m.mes
        LEFT JOIN snapshot_evolucao snapshot ON snapshot.mes = m.mes
        CROSS JOIN totais_atuais atual
    )
$trecho$;

  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Não foi possível localizar a evolução mensal em sup_estoque_saudavel.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  v_origem := $trecho$'mes', mes, 'rotulo', rotulo, 'saldo', saldo,
                 'demanda', demanda, 'alvo', alvo, 'valor', valor$trecho$;
  v_destino := $trecho$'mes', mes, 'rotulo', rotulo, 'saldo', saldo,
                 'demanda', demanda, 'alvo', alvo, 'valor', valor,
                 'tipo_ponto', tipo_ponto$trecho$;
  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Não foi possível expor o tipo do ponto mensal.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  v_definicao := replace(
    v_definicao,
    'WHERE NOT EXISTS (SELECT 1 FROM evolucao)',
    'WHERE NOT EXISTS (SELECT 1 FROM evolucao WHERE tipo_ponto = ''fechamento'')'
  );
  v_definicao := replace(
    v_definicao,
    'Ainda não há fechamento mensal gravado — a comparação mês a mês começa no próximo dia 1º',
    'Ainda não há fechamento mensal gravado — o consumo histórico aparece, e estoque/alvo começam no próximo dia 1º'
  );

  EXECUTE v_definicao;
END;
$bloco$;

NOTIFY pgrst, 'reload schema';
