-- SIS-2026-0607 — Dashboard executivo de Compras, Solicitações, Estoque e Saving
--
-- Os indicadores vêm das fontes operacionais já existentes:
--   sup_pedido / sup_pedido_item                 solicitações de materiais
--   sup_estoque_* / sup_item                     estoque e movimentações
--   malote_despesa                               cotações e saving de Compras
--   cotacoes_licitacao                           cotações pedidas por Licitações
--
-- A RPC agrega no banco para não enviar milhares de linhas ao navegador. Ela
-- é SECURITY DEFINER, mas só executa para quem tem a tela liberada e valida a
-- empresa solicitada contra user_empresa/acessa_todas_empresas.
--
-- Saving: valor inicial da solicitação menos o valor da cotação aprovada,
-- limitado a zero. "Implantação" é identificada pelo texto operacional da
-- solicitação (nome, motivo ou descrição contendo "implant"); o restante é
-- classificado como contrato em execução.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sup_dashboard_compras_estoque(uuid,date,date,uuid,text,text);
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'sup_dashboard_compras_estoque';
--   DELETE FROM public.screen_permission_user WHERE menu_codigo = 'sup_dashboard_compras_estoque';
--   DELETE FROM public.app_menu WHERE codigo = 'sup_dashboard_compras_estoque';
-- ============================================================================

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sup_dashboard_compras_estoque', 'Dashboard de Compras, Estoque e Saving',
       '/app/suprimentos/dashboard', 5, true
  FROM public.app_modulo m
 WHERE m.codigo = 'suprimentos'
ON CONFLICT (modulo_id, codigo) DO UPDATE
  SET nome = EXCLUDED.nome,
      rota = EXCLUDED.rota,
      ordem = EXCLUDED.ordem,
      ativo = true;

-- Perfis que já enxergam a operação de pedidos, estoque ou cotações recebem a
-- visão consolidada. Exceções individuais continuam sendo administradas pelo
-- toggle normal de Acesso por Usuário.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT DISTINCT pa.id, 'sup_dashboard_compras_estoque',
       'visualizar'::public.app_acao, true
  FROM public.perfil_acesso pa
 WHERE pa.ativo
   AND (
     pa.concede_tudo OR EXISTS (
       SELECT 1 FROM public.perfil_acesso_permissao p
        WHERE p.perfil_id = pa.id AND p.allow
          AND p.acao = 'visualizar'::public.app_acao
          AND p.menu_codigo IN (
            'sup_pedidos_materiais', 'sup_estoque', 'sup_cotacoes_malote', 'sup_cotacoes'
          )
     )
   )
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sup_dashboard_compras_estoque(
  p_empresa_id uuid,
  p_inicio date,
  p_fim date,
  p_contrato_id uuid DEFAULT NULL,
  p_categoria text DEFAULT NULL,
  p_comprador text DEFAULT NULL
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
    SELECT 1 FROM public.profiles pr
     WHERE pr.id = v_uid
       AND (pr.acessa_todas_empresas OR pr.empresa_id = p_empresa_id)
  ) AND NOT EXISTS (
    SELECT 1 FROM public.user_empresa ue
     WHERE ue.user_id = v_uid AND ue.empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'Usuário sem acesso à empresa selecionada.' USING ERRCODE = '42501';
  END IF;

  RETURN (
    WITH
    pedidos AS (
      SELECT p.*
        FROM public.sup_pedido p
       WHERE p.empresa_id = p_empresa_id
         AND p.data_solicitacao BETWEEN p_inicio AND p_fim
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
    pedido_itens AS (
      SELECT pi.*, p.contrato_id, p.contrato_nome, p.data_solicitacao,
             COALESCE(i.tipo, pi.tipo_item, 'insumo') AS categoria
        FROM pedidos p
        JOIN public.sup_pedido_item pi ON pi.pedido_id = p.id
        LEFT JOIN public.sup_item i ON i.id = pi.item_id
       WHERE p_categoria IS NULL OR COALESCE(i.tipo, pi.tipo_item) = p_categoria
    ),
    estoque AS (
      SELECT ei.id AS item_estoque_id,
             ei.sup_item_id,
             i.nome AS item,
             i.tipo AS categoria,
             COALESCE(sum(s.disponivel), 0)::numeric AS disponivel,
             COALESCE(sum(s.fisico), 0)::numeric AS fisico,
             COALESCE(sum(s.reservado), 0)::numeric AS reservado,
             COALESCE(sum(s.consumido), 0)::numeric AS consumido,
             ei.estoque_minimo,
             ei.valor_unitario,
             COALESCE(sum(s.disponivel), 0) * ei.valor_unitario AS valor_total
        FROM public.sup_estoque_item ei
        JOIN public.sup_item i ON i.id = ei.sup_item_id
        LEFT JOIN public.sup_estoque_saldo s ON s.item_estoque_id = ei.id
       WHERE ei.empresa_id = p_empresa_id
         AND ei.arquivado_em IS NULL
         AND (p_categoria IS NULL OR i.tipo = p_categoria)
       GROUP BY ei.id, ei.sup_item_id, i.nome, i.tipo,
                ei.estoque_minimo, ei.valor_unitario
    ),
    movimentos AS (
      SELECT m.*, e.item, e.categoria
        FROM public.sup_estoque_movimento m
        JOIN estoque e ON e.item_estoque_id = m.item_estoque_id
       WHERE m.empresa_id = p_empresa_id
         AND m.created_at >= p_inicio::timestamptz
         AND m.created_at < (p_fim + 1)::timestamptz
         AND m.tipo IN ('entrada', 'saida', 'devolucao', 'ajuste', 'remocao', 'correcao')
    ),
    cotacoes_malote AS (
      SELECT d.*,
             c.nome AS contrato_nome,
             cardinality(array_remove(ARRAY[d.cot1_valor, d.cot2_valor, d.cot3_valor], NULL)) AS qtd_cotacoes,
             GREATEST(COALESCE(d.valor_total, 0) - COALESCE(d.valor_aprovado_cotacao, 0), 0) AS saving,
             lower(COALESCE(d.nome, '') || ' ' || COALESCE(d.motivo, '') || ' ' || COALESCE(d.descricao, ''))
               LIKE '%implant%' AS implantacao
        FROM public.malote_despesa d
        LEFT JOIN public.contratos c ON c.id = d.contrato_id
       WHERE d.empresa_id = p_empresa_id
         AND d.cotacao_enviada_em IS NOT NULL
         AND d.cotacao_enviada_em >= p_inicio::timestamptz
         AND d.cotacao_enviada_em < (p_fim + 1)::timestamptz
         AND d.deleted_at IS NULL
         AND (p_contrato_id IS NULL OR d.contrato_id = p_contrato_id)
         AND (p_comprador IS NULL OR d.cotacao_enviada_por_nome = p_comprador)
         AND (
           p_categoria IS NULL OR EXISTS (
             SELECT 1
               FROM public.malote_despesa_item mdi
               JOIN public.sup_item i ON i.id = mdi.sup_item_id
              WHERE mdi.despesa_id = d.id AND i.tipo = p_categoria
           )
         )
    ),
    cotacoes_licitacao AS (
      SELECT q.*
        FROM public.cotacoes_licitacao q
       WHERE q.empresa_id = p_empresa_id
         AND q.created_at >= p_inicio::timestamptz
         AND q.created_at < (p_fim + 1)::timestamptz
         AND p_categoria IS NULL
         AND (p_comprador IS NULL OR q.respondente_nome = p_comprador)
         AND (
           p_contrato_id IS NULL OR EXISTS (
             SELECT 1 FROM public.contratos c
              WHERE c.id = p_contrato_id AND q.contrato = c.nome
           )
         )
    ),
    meses AS (
      SELECT generate_series(
        date_trunc('month', p_inicio::timestamp),
        date_trunc('month', p_fim::timestamp),
        interval '1 month'
      ) AS mes
    ),
    movimentacao_item AS (
      SELECT e.item_estoque_id, e.item, e.categoria,
             COALESCE(sum(abs(m.quantidade)), 0)::numeric AS quantidade,
             e.valor_total
        FROM estoque e
        LEFT JOIN movimentos m ON m.item_estoque_id = e.item_estoque_id
       GROUP BY e.item_estoque_id, e.item, e.categoria, e.valor_total
    ),
    saving_contrato AS (
      SELECT COALESCE(cm.contrato_nome, 'Sem contrato') AS contrato,
             sum(COALESCE(cm.valor_total, 0))::numeric AS valor_inicial,
             sum(COALESCE(cm.valor_aprovado_cotacao, 0))::numeric AS valor_comprado,
             sum(cm.saving)::numeric AS saving
        FROM cotacoes_malote cm
       WHERE cm.valor_aprovado_cotacao IS NOT NULL
       GROUP BY COALESCE(cm.contrato_nome, 'Sem contrato')
    )
    SELECT jsonb_build_object(
      'atualizado_em', now(),
      'filtros', jsonb_build_object(
        'contratos', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'status', c.status) ORDER BY c.nome)
            FROM public.contratos c
           WHERE c.empresa_id = p_empresa_id
        ), '[]'::jsonb),
        'categorias', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('valor', x.tipo, 'nome',
            CASE x.tipo WHEN 'epi' THEN 'EPI' WHEN 'uniforme' THEN 'Uniformes'
                        WHEN 'insumo' THEN 'Insumos' WHEN 'equipamento' THEN 'Equipamentos'
                        ELSE initcap(x.tipo) END) ORDER BY x.tipo)
            FROM (SELECT DISTINCT i.tipo FROM public.sup_item i WHERE i.empresa_id = p_empresa_id AND i.ativo) x
        ), '[]'::jsonb),
        'compradores', COALESCE((
          SELECT jsonb_agg(x.nome ORDER BY x.nome)
            FROM (
              SELECT DISTINCT d.cotacao_enviada_por_nome AS nome
                FROM public.malote_despesa d
               WHERE d.empresa_id = p_empresa_id AND d.cotacao_enviada_por_nome IS NOT NULL
              UNION
              SELECT DISTINCT q.respondente_nome
                FROM public.cotacoes_licitacao q
               WHERE q.empresa_id = p_empresa_id AND q.respondente_nome IS NOT NULL
            ) x
        ), '[]'::jsonb)
      ),
      'resumo', jsonb_build_object(
        'solicitacoes', (SELECT count(*) FROM pedidos),
        'despachadas', (SELECT count(*) FROM pedidos WHERE status = 'DESPACHADO'),
        'pendentes', (SELECT count(*) FROM pedidos WHERE status NOT IN ('DESPACHADO', 'CANCELADO')),
        'tempo_medio_dias', COALESCE((
          SELECT round(avg(extract(epoch FROM (data_despachado - created_at)) / 86400)::numeric, 1)
            FROM pedidos WHERE data_despachado IS NOT NULL
        ), 0),
        'cotacoes', (SELECT count(*) FROM cotacoes_malote) + (SELECT count(*) FROM cotacoes_licitacao),
        'media_cotacoes', COALESCE((SELECT round(avg(qtd_cotacoes)::numeric, 1) FROM cotacoes_malote), 0),
        'licitacoes', (SELECT count(*) FROM cotacoes_licitacao),
        'participacao_licitacoes', CASE
          WHEN ((SELECT count(*) FROM cotacoes_malote) + (SELECT count(*) FROM cotacoes_licitacao)) = 0 THEN 0
          ELSE round(100.0 * (SELECT count(*) FROM cotacoes_licitacao)
            / ((SELECT count(*) FROM cotacoes_malote) + (SELECT count(*) FROM cotacoes_licitacao)), 1)
        END
      ),
      'estoque_resumo', jsonb_build_object(
        'valor_total', COALESCE((SELECT sum(valor_total) FROM estoque), 0),
        'quantidade_itens', COALESCE((SELECT sum(disponivel) FROM estoque), 0),
        'itens_distintos', (SELECT count(*) FROM estoque),
        'entradas', COALESCE((SELECT sum(quantidade) FROM movimentos WHERE tipo IN ('entrada', 'devolucao')), 0),
        'saidas', COALESCE((SELECT sum(abs(quantidade)) FROM movimentos WHERE tipo IN ('saida', 'remocao')), 0)
      ),
      'saving_resumo', jsonb_build_object(
        'total', COALESCE((SELECT sum(saving) FROM cotacoes_malote WHERE valor_aprovado_cotacao IS NOT NULL), 0),
        'implantacao', COALESCE((SELECT sum(saving) FROM cotacoes_malote WHERE valor_aprovado_cotacao IS NOT NULL AND implantacao), 0),
        'execucao', COALESCE((SELECT sum(saving) FROM cotacoes_malote WHERE valor_aprovado_cotacao IS NOT NULL AND NOT implantacao), 0)
      ),
      'solicitacoes_por_contrato', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.quantidade DESC)
          FROM (
            SELECT COALESCE(p.contrato_nome, 'Sem contrato') AS nome,
                   count(*)::int AS quantidade,
                   count(*) FILTER (WHERE p.status = 'DESPACHADO')::int AS despachadas,
                   count(*) FILTER (WHERE p.status NOT IN ('DESPACHADO','CANCELADO'))::int AS pendentes
              FROM pedidos p
             GROUP BY COALESCE(p.contrato_nome, 'Sem contrato')
             ORDER BY count(*) DESC LIMIT 10
          ) x
      ), '[]'::jsonb),
      'motivos_pendencias', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.quantidade DESC)
          FROM (
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
          ) x
      ), '[]'::jsonb),
      'cotacoes_por_comprador', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.quantidade DESC)
          FROM (
            SELECT nome, sum(quantidade)::int AS quantidade
              FROM (
                SELECT COALESCE(cotacao_enviada_por_nome, 'Não informado') AS nome, count(*) AS quantidade
                  FROM cotacoes_malote GROUP BY COALESCE(cotacao_enviada_por_nome, 'Não informado')
                UNION ALL
                SELECT COALESCE(respondente_nome, 'Não informado'), count(*)
                  FROM cotacoes_licitacao GROUP BY COALESCE(respondente_nome, 'Não informado')
              ) q GROUP BY nome ORDER BY sum(quantidade) DESC LIMIT 10
          ) x
      ), '[]'::jsonb),
      'cotacoes_por_solicitacao', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('nome', x.qtd_cotacoes::text ||
          CASE WHEN x.qtd_cotacoes = 1 THEN ' cotação' ELSE ' cotações' END,
          'quantidade', x.quantidade) ORDER BY x.qtd_cotacoes)
          FROM (
            SELECT qtd_cotacoes, count(*)::int AS quantidade
              FROM cotacoes_malote GROUP BY qtd_cotacoes
          ) x
      ), '[]'::jsonb),
      'evolucao', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'mes', to_char(m.mes, 'YYYY-MM'),
          'rotulo', to_char(m.mes, 'Mon/YY'),
          'solicitacoes', (SELECT count(*) FROM pedidos p WHERE date_trunc('month', p.created_at) = m.mes),
          'cotacoes', (SELECT count(*) FROM cotacoes_malote c WHERE date_trunc('month', c.cotacao_enviada_em) = m.mes)
                     + (SELECT count(*) FROM cotacoes_licitacao q WHERE date_trunc('month', q.created_at) = m.mes),
          'entradas', COALESCE((SELECT sum(mv.quantidade) FROM movimentos mv
                                WHERE mv.tipo IN ('entrada','devolucao') AND date_trunc('month', mv.created_at) = m.mes), 0),
          'saidas', COALESCE((SELECT sum(abs(mv.quantidade)) FROM movimentos mv
                              WHERE mv.tipo IN ('saida','remocao') AND date_trunc('month', mv.created_at) = m.mes), 0)
        ) ORDER BY m.mes) FROM meses m
      ), '[]'::jsonb),
      'solicitacoes_recentes', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.data DESC)
          FROM (
            SELECT p.pedido_id AS id, p.data_solicitacao AS data,
                   p.contrato_nome AS contrato,
                   COALESCE((SELECT string_agg(pi.nome_item, ', ' ORDER BY pi.ordem)
                               FROM public.sup_pedido_item pi WHERE pi.pedido_id = p.id), '—') AS item,
                   COALESCE(p.solicitante_nome, p.solicitante_login) AS solicitante,
                   p.status,
                   CASE WHEN p.data_despachado IS NOT NULL
                        THEN round(extract(epoch FROM (p.data_despachado - p.created_at)) / 86400.0, 1)
                        ELSE round(extract(epoch FROM (now() - p.created_at)) / 86400.0, 1) END AS tempo_dias
              FROM pedidos p ORDER BY p.created_at DESC LIMIT 8
          ) x
      ), '[]'::jsonb),
      'cotacoes_recentes', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.data DESC)
          FROM (
            SELECT ('MAL-' || cm.numero::text) AS id, cm.cotacao_enviada_em AS data,
                   cm.contrato_nome AS contrato, cm.nome AS item,
                   cm.cotacao_enviada_por_nome AS comprador,
                   cm.qtd_cotacoes, false AS licitacao, cm.status
              FROM cotacoes_malote cm
            UNION ALL
            SELECT ('LIC-' || left(q.id::text, 8)), q.created_at, q.contrato,
                   COALESCE(q.comentario, q.arquivo_nome, 'Cotação de licitação'),
                   q.respondente_nome, 1, true, q.status
              FROM cotacoes_licitacao q
             ORDER BY data DESC LIMIT 8
          ) x
      ), '[]'::jsonb),
      'estoque_por_categoria', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.valor DESC)
          FROM (
            SELECT CASE categoria WHEN 'epi' THEN 'EPI' WHEN 'uniforme' THEN 'Uniformes'
                        WHEN 'insumo' THEN 'Insumos' WHEN 'equipamento' THEN 'Equipamentos'
                        ELSE initcap(categoria) END AS nome,
                   sum(valor_total)::numeric AS valor
              FROM estoque GROUP BY categoria
          ) x
      ), '[]'::jsonb),
      'saude_estoque', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.ordem)
          FROM (
            SELECT situacao AS nome, count(*)::int AS quantidade, min(ordem)::int AS ordem
              FROM (
                SELECT CASE
                         WHEN disponivel <= 0 THEN 'Sem estoque'
                         WHEN estoque_minimo > 0 AND disponivel <= estoque_minimo THEN 'Baixo'
                         WHEN estoque_minimo > 0 AND disponivel <= estoque_minimo * 1.5 THEN 'Atenção'
                         ELSE 'Adequado' END AS situacao,
                       CASE
                         WHEN disponivel <= 0 THEN 4
                         WHEN estoque_minimo > 0 AND disponivel <= estoque_minimo THEN 3
                         WHEN estoque_minimo > 0 AND disponivel <= estoque_minimo * 1.5 THEN 2
                         ELSE 1 END AS ordem
                  FROM estoque
              ) s GROUP BY situacao
          ) x
      ), '[]'::jsonb),
      'mais_movimentados', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.quantidade DESC)
          FROM (SELECT item, categoria, quantidade, valor_total
                  FROM movimentacao_item ORDER BY quantidade DESC, item LIMIT 10) x
      ), '[]'::jsonb),
      'menos_movimentados', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.quantidade, x.item)
          FROM (SELECT item, categoria, quantidade, valor_total
                  FROM movimentacao_item ORDER BY quantidade, item LIMIT 10) x
      ), '[]'::jsonb),
      'estoque_detalhado', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.valor_total DESC)
          FROM (
            SELECT e.item, e.categoria, e.disponivel, e.reservado,
                   e.valor_unitario, e.valor_total,
                   CASE
                     WHEN e.disponivel <= 0 THEN 'Sem estoque'
                     WHEN e.estoque_minimo > 0 AND e.disponivel <= e.estoque_minimo THEN 'Baixo'
                     WHEN e.estoque_minimo > 0 AND e.disponivel <= e.estoque_minimo * 1.5 THEN 'Atenção'
                     ELSE 'Adequado' END AS situacao
              FROM estoque e ORDER BY e.valor_total DESC LIMIT 15
          ) x
      ), '[]'::jsonb),
      'saving_por_contrato', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'contrato', sc.contrato,
          'valor_inicial', sc.valor_inicial,
          'valor_comprado', sc.valor_comprado,
          'saving', sc.saving,
          'percentual', CASE WHEN sc.valor_inicial > 0 THEN round(100 * sc.saving / sc.valor_inicial, 1) ELSE 0 END
        ) ORDER BY sc.saving DESC) FROM saving_contrato sc
      ), '[]'::jsonb)
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.sup_dashboard_compras_estoque(uuid,date,date,uuid,text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_dashboard_compras_estoque(uuid,date,date,uuid,text,text)
  TO authenticated;

COMMENT ON FUNCTION public.sup_dashboard_compras_estoque(uuid,date,date,uuid,text,text) IS
  'SIS-2026-0607: indicadores consolidados de solicitações, cotações, estoque e saving, com escopo por empresa.';

NOTIFY pgrst, 'reload schema';
