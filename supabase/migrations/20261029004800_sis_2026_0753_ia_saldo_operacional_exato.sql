-- SIS-2026-0753 — saldo operacional exato para o Assistente do Estoque
--
-- Perguntas de saldo atual eram respondidas a partir de sup_estoque_saudavel.
-- Essa RPC é correta para planejamento, onde item e variantes são consolidados
-- por família, mas não serve para identificar uma ficha operacional exata.
-- O caso que evidenciou o erro possui dois cadastros independentes:
--   0000961 AVENTAL DE NAPA          = 2 disponíveis
--   0002573 AVENTAL DE NAPA (BRANCO) = 5 disponíveis
-- A IA recebeu apenas a família consolidada e respondeu 2 para o segundo item.
--
-- Esta RPC pequena usa a mesma view de saldo que fundamenta Estoque & Etiquetas,
-- preserva código, nome e tamanho do sup_item e soma somente fichas ativas. Ela
-- é exclusiva para respostas determinísticas; planejamento continua na função
-- sup_estoque_saudavel.
--
-- O mesmo relato mostrou outra divergência: o dashboard contava todo status
-- persistido DESPACHADO como concluído, enquanto Pedidos de Materiais deriva
-- "parcialmente despachado" pelos itens efetivamente atendidos. A segunda parte
-- desta migration aplica ao dashboard a mesma classificação operacional.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sup_estoque_saldo_operacional_ia(uuid,uuid);
--   Restaurar public.sup_dashboard_compras_estoque a partir da definição-base
--   de 20261007000001 e reaplicar, em ordem, os hotfixes anteriores desta RPC.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sup_estoque_saldo_operacional_ia(
  p_empresa_id      uuid,
  p_almoxarifado_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.can_access(
    v_uid, 'sup_dashboard_compras_estoque', 'visualizar'::public.app_acao
  ) THEN
    RAISE EXCEPTION 'Sem permissão para consultar o estoque.'
      USING ERRCODE = '42501';
  END IF;

  IF p_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Empresa é obrigatória.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.profiles perfil
     WHERE perfil.id = v_uid
       AND (perfil.acessa_todas_empresas OR perfil.empresa_id = p_empresa_id)
  ) AND NOT EXISTS (
    SELECT 1
      FROM public.user_empresa usuario_empresa
     WHERE usuario_empresa.user_id = v_uid
       AND usuario_empresa.empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'Usuário sem acesso à empresa selecionada.'
      USING ERRCODE = '42501';
  END IF;

  RETURN (
    WITH saldo_exato AS (
      SELECT
        item.id AS sup_item_id,
        item.codigo,
        item.nome AS item,
        item.tipo,
        COALESCE(
          public.sup_tamanho_da_variante(item.tamanho),
          public.sup_tamanho_da_variante(saldo.tamanho)
        ) AS tamanho,
        COALESCE(sum(saldo.fisico), 0)::numeric AS fisico,
        COALESCE(sum(saldo.reservado), 0)::numeric AS reservado,
        COALESCE(sum(saldo.disponivel), 0)::numeric AS disponivel
      FROM public.sup_estoque_item ficha
      JOIN public.sup_item item
        ON item.id = ficha.sup_item_id
      LEFT JOIN public.sup_estoque_saldo saldo
        ON saldo.item_estoque_id = ficha.id
      WHERE ficha.empresa_id = p_empresa_id
        AND ficha.arquivado_em IS NULL
        AND (p_almoxarifado_id IS NULL OR ficha.almoxarifado_id = p_almoxarifado_id)
      GROUP BY
        item.id,
        item.codigo,
        item.nome,
        item.tipo,
        COALESCE(
          public.sup_tamanho_da_variante(item.tamanho),
          public.sup_tamanho_da_variante(saldo.tamanho)
        )
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'sup_item_id', sup_item_id,
          'codigo', codigo,
          'item', item,
          'tipo', tipo,
          'tamanho', tamanho,
          'fisico', fisico,
          'reservado', reservado,
          'disponivel', disponivel
        )
        ORDER BY lower(item), codigo, tamanho
      ),
      '[]'::jsonb
    )
    FROM saldo_exato
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.sup_estoque_saldo_operacional_ia(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_estoque_saldo_operacional_ia(uuid,uuid) TO authenticated;

COMMENT ON FUNCTION public.sup_estoque_saldo_operacional_ia(uuid,uuid) IS
  'Saldo atual por cadastro operacional exato (código, nome e tamanho), usado pelo Assistente do Estoque sem consolidação por família.';

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

  -- Espelho de derivarStatusVisivel (useSupPedidos.ts). A situação dos itens e
  -- a comprovação são as fontes que a rota Pedidos de Materiais já usa para
  -- separar parcial, aguardando confirmação e entregue.
  v_origem := $trecho$
    ),
    pedido_itens AS (
$trecho$;
  v_destino := $trecho$
    ),
    pedidos_classificados AS (
      SELECT
        pedido.*,
        CASE
          WHEN pedido.status = 'EM SEPARACAO' THEN 'EM SEPARACAO'
          WHEN pedido.status = 'RETIRADO PARA ENTREGA' THEN 'RETIRADO PARA ENTREGA'
          WHEN pedido.status IN ('AGUARDANDO ENVIO', 'DESPACHADO')
           AND situacao.itens > 0
           AND situacao.itens_atendidos > 0
           AND situacao.itens_atendidos < situacao.itens
            THEN 'PARCIALMENTE DESPACHADO'
          WHEN pedido.status = 'DESPACHADO' AND comprovacao.status = 'PENDENTE'
            THEN 'DESPACHADO_AGUARDANDO'
          WHEN pedido.status = 'DESPACHADO' THEN 'DESPACHADO_ENTREGUE'
          WHEN pedido.status IN ('AGUARDANDO ENVIO', 'AGUARDANDO COMPRA', 'CANCELADO')
            THEN pedido.status
          ELSE 'EM PREPARACAO'
        END AS status_visivel
      FROM pedidos pedido
      LEFT JOIN public.sup_pedido_situacao situacao
        ON situacao.pedido_id = pedido.id
      LEFT JOIN public.sup_pedido_comprovacao comprovacao
        ON comprovacao.pedido_id = pedido.id
    ),
    pedido_itens AS (
$trecho$;
  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Âncora da classificação operacional dos pedidos não encontrada no dashboard.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  v_origem := $trecho$
        'despachadas', (SELECT count(*) FROM pedidos WHERE status = 'DESPACHADO'),
        'pendentes', (SELECT count(*) FROM pedidos WHERE status NOT IN ('DESPACHADO', 'CANCELADO')),
$trecho$;
  v_destino := $trecho$
        'despachadas', (
          SELECT count(*) FROM pedidos_classificados
           WHERE status_visivel IN ('DESPACHADO_AGUARDANDO', 'DESPACHADO_ENTREGUE')
        ),
        'pendentes', (
          SELECT count(*) FROM pedidos_classificados
           WHERE status_visivel NOT IN ('DESPACHADO_AGUARDANDO', 'DESPACHADO_ENTREGUE', 'CANCELADO')
        ),
$trecho$;
  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Âncora dos cartões Pendentes/Despachadas não encontrada no dashboard.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  v_origem := $trecho$
                   count(*) FILTER (WHERE p.status = 'DESPACHADO')::int AS despachadas,
                   count(*) FILTER (WHERE p.status NOT IN ('DESPACHADO','CANCELADO'))::int AS pendentes
              FROM pedidos p
$trecho$;
  v_destino := $trecho$
                   count(*) FILTER (
                     WHERE p.status_visivel IN ('DESPACHADO_AGUARDANDO', 'DESPACHADO_ENTREGUE')
                   )::int AS despachadas,
                   count(*) FILTER (
                     WHERE p.status_visivel NOT IN ('DESPACHADO_AGUARDANDO', 'DESPACHADO_ENTREGUE', 'CANCELADO')
                   )::int AS pendentes
              FROM pedidos_classificados p
$trecho$;
  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Âncora dos status por contrato não encontrada no dashboard.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  v_origem := $trecho$
            SELECT CASE p.status
                     WHEN 'AGUARDANDO COMPRA' THEN 'Aguardando compra'
                     WHEN 'AGUARDANDO ENVIO' THEN 'Aguardando envio'
                     WHEN 'EM PREPARACAO' THEN 'Em preparação'
                     ELSE initcap(lower(p.status))
                   END AS nome,
                   count(*)::int AS quantidade
              FROM pedidos p
             WHERE p.status NOT IN ('DESPACHADO','CANCELADO')
             GROUP BY p.status
$trecho$;
  v_destino := $trecho$
            SELECT CASE p.status_visivel
                     WHEN 'AGUARDANDO COMPRA' THEN 'Aguardando compra'
                     WHEN 'AGUARDANDO ENVIO' THEN 'Aguardando envio'
                     WHEN 'EM PREPARACAO' THEN 'Em preparação'
                     WHEN 'EM SEPARACAO' THEN 'Em separação'
                     WHEN 'PARCIALMENTE DESPACHADO' THEN 'Parcialmente despachado'
                     WHEN 'RETIRADO PARA ENTREGA' THEN 'Retirado para entrega'
                     ELSE initcap(lower(p.status_visivel))
                   END AS nome,
                   count(*)::int AS quantidade
              FROM pedidos_classificados p
             WHERE p.status_visivel NOT IN ('DESPACHADO_AGUARDANDO', 'DESPACHADO_ENTREGUE', 'CANCELADO')
             GROUP BY p.status_visivel
$trecho$;
  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Âncora dos motivos de pendência não encontrada no dashboard.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  EXECUTE v_definicao;
END;
$bloco$;

NOTIFY pgrst, 'reload schema';
