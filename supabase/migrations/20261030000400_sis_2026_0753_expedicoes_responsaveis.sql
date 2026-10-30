-- SIS-2026-0753 — expedições por modalidade e responsável
--
-- O dashboard mostrava apenas pedidos solicitados no período. Para a gestão
-- logística isso não responde quantos volumes foram efetivamente despachados
-- pelos Correios ou por supervisor, nem quem ficou responsável pelo envio.
--
-- Esta extensão da RPC usa a data efetiva do despacho (data_despachado),
-- preserva os mesmos filtros de empresa/contrato/categoria e cruza:
--   • sup_pedido.envio_tipo / envio_rastreio;
--   • a pessoa que registrou a transição para DESPACHADO no histórico;
--   • a pessoa que retirou o romaneio, quando o envio é via supervisor;
--   • a comprovação enviada pelo destinatário.
--
-- Regra do responsável:
--   SUPERVISOR -> quem retirou o romaneio; na ausência, operador do despacho.
--   CORREIO    -> operador que registrou o despacho.
-- Registros históricos sem modalidade continuam visíveis como pendência de
-- cadastro, em vez de serem silenciosamente atribuídos a uma das rotas.
--
-- ROLLBACK:
--   Restaurar public.sup_dashboard_compras_estoque a partir da definição-base
--   de 20261007000001 e reaplicar, em ordem, os hotfixes anteriores desta RPC.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_sup_pedido_empresa_data_despachado
  ON public.sup_pedido (empresa_id, data_despachado DESC)
  WHERE data_despachado IS NOT NULL;

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

  v_origem := $trecho$
    meses AS (
$trecho$;

  v_destino := $trecho$
    pedidos_despachados AS (
      SELECT
        p.id,
        p.pedido_id,
        p.contrato_nome,
        p.posto_nome,
        p.data_despachado,
        p.envio_tipo,
        p.envio_rastreio,
        CASE
          WHEN COALESCE(
            CASE
              WHEN p.envio_tipo = 'SUPERVISOR' THEN
                COALESCE(NULLIF(btrim(p.retirado_por_nome), ''), NULLIF(btrim(h.alterado_por_nome), ''))
              ELSE
                COALESCE(NULLIF(btrim(h.alterado_por_nome), ''), NULLIF(btrim(p.retirado_por_nome), ''))
            END,
            ''
          ) = '' THEN 'Não informado'
          ELSE initcap(regexp_replace(lower(
            CASE
              WHEN p.envio_tipo = 'SUPERVISOR' THEN
                COALESCE(NULLIF(btrim(p.retirado_por_nome), ''), NULLIF(btrim(h.alterado_por_nome), ''))
              ELSE
                COALESCE(NULLIF(btrim(h.alterado_por_nome), ''), NULLIF(btrim(p.retirado_por_nome), ''))
            END
          ), '\s+', ' ', 'g'))
        END AS responsavel,
        CASE
          WHEN c.status = 'ENVIADO' THEN 'CONFIRMADA'
          WHEN c.status = 'PENDENTE' THEN 'PENDENTE'
          WHEN c.status = 'DISPENSADO' THEN 'LEGADO'
          ELSE 'SEM_REGISTRO'
        END AS comprovacao,
        c.recebedor_nome
      FROM public.sup_pedido p
      LEFT JOIN LATERAL (
        SELECT ph.alterado_por_nome
          FROM public.sup_pedido_historico ph
         WHERE ph.pedido_id = p.id
           AND ph.status_novo = 'DESPACHADO'
         ORDER BY ph.data_alteracao DESC
         LIMIT 1
      ) h ON true
      LEFT JOIN public.sup_pedido_comprovacao c ON c.pedido_id = p.id
      WHERE p.empresa_id = p_empresa_id
        AND (p.data_despachado AT TIME ZONE 'America/Sao_Paulo')::date
              BETWEEN p_inicio AND p_fim
        AND (p_contrato_id IS NULL OR p.contrato_id = p_contrato_id)
        AND (
          p_categoria IS NULL OR EXISTS (
            SELECT 1
              FROM public.sup_pedido_item pi
              JOIN public.sup_item i ON i.id = pi.item_id
             WHERE pi.pedido_id = p.id AND i.tipo = p_categoria
          )
        )
    ),
    meses AS (
$trecho$;

  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Âncora dos CTEs do dashboard não encontrada.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  v_origem := $trecho$
      'solicitacoes_recentes', COALESCE((
$trecho$;

  v_destino := $trecho$
      'entregas_resumo', jsonb_build_object(
        'total_despachado', (SELECT count(*) FROM pedidos_despachados),
        'correios', (SELECT count(*) FROM pedidos_despachados WHERE envio_tipo = 'CORREIO'),
        'supervisores', (SELECT count(*) FROM pedidos_despachados WHERE envio_tipo = 'SUPERVISOR'),
        'confirmadas', (SELECT count(*) FROM pedidos_despachados WHERE comprovacao = 'CONFIRMADA'),
        'sem_modalidade', (SELECT count(*) FROM pedidos_despachados
                           WHERE envio_tipo IS NULL OR envio_tipo NOT IN ('CORREIO', 'SUPERVISOR'))
      ),
      'entregas_por_responsavel', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.total DESC, x.nome)
          FROM (
            SELECT responsavel AS nome,
                   count(*) FILTER (WHERE envio_tipo = 'CORREIO')::int AS correios,
                   count(*) FILTER (WHERE envio_tipo = 'SUPERVISOR')::int AS supervisores,
                   count(*) FILTER (WHERE envio_tipo IS NULL OR envio_tipo NOT IN ('CORREIO', 'SUPERVISOR'))::int
                     AS sem_modalidade,
                   count(*)::int AS total
              FROM pedidos_despachados
             GROUP BY responsavel
             ORDER BY count(*) DESC, responsavel
             LIMIT 15
          ) x
      ), '[]'::jsonb),
      'entregas_recentes', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.data DESC)
          FROM (
            SELECT pedido_id AS id,
                   data_despachado AS data,
                   COALESCE(NULLIF(btrim(contrato_nome), ''), 'Sem contrato') AS contrato,
                   COALESCE(NULLIF(btrim(posto_nome), ''), 'Não informado') AS destino,
                   COALESCE(envio_tipo, 'NAO_INFORMADO') AS modalidade,
                   responsavel,
                   comprovacao,
                   recebedor_nome AS recebedor,
                   envio_rastreio AS rastreio
              FROM pedidos_despachados
             ORDER BY data_despachado DESC
             LIMIT 50
          ) x
      ), '[]'::jsonb),
      'solicitacoes_recentes', COALESCE((
$trecho$;

  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Âncora das solicitações recentes não encontrada.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  EXECUTE v_definicao;
END;
$bloco$;

NOTIFY pgrst, 'reload schema';
