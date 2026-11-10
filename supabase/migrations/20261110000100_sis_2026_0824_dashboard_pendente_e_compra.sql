-- SIS-2026-0824 — Dashboard de Compras e Estoque: pendente de entrega, compra
-- em andamento e movimentação por item.
--
-- O QUE O CHAMADO PEDIU (escopo veio de conversa com o solicitante em
-- 09/11/2026; o texto do chamado é curto e não dizia a tela)
-- Na aba "Estoque e Saving" de /app/suprimentos/dashboard, que já mostra o que
-- tem, o que entrou e o que saiu, passar a mostrar também, por item:
--   1. quanto está PENDENTE de entrega nos pedidos de material
--      (/app/suprimentos/pedidos-materiais) — o exemplo dele: 3 pedidos,
--      juntando tudo faltam 2 calças sarja, então a calça sarja aparece como 2;
--   2. quanto entrou e saiu no período escolhido, por item (hoje só existe o
--      total da empresa nos cartões e o gráfico mês a mês);
--   3. quanto já foi comprado e está em processo de compra.
--
-- POR QUE A PENDÊNCIA É RECALCULADA AQUI, E NÃO LIDA DE UMA VIEW
-- A quantidade pendente que o usuário vê em Pedidos de Materiais é calculada
-- no NAVEGADOR, por calcularEnvioItens() (src/lib/suprimentos/envioItens.ts)
-- sobre o retorno de sup_est_tags_do_pedido, um pedido por vez. Ela não existe
-- no banco: a view sup_pedido_situacao conta ITENS por pedido, não QUANTIDADE
-- por item. Este bloco replica a mesma conta para todos os pedidos de uma vez.
--
-- Os dois lados TÊM de dar o mesmo número, senão o gerente vê 2 numa tela e 3
-- na outra. Por isso `entregue_por_pedido_item` copia os DOIS ramos de
-- sup_est_tags_do_pedido (20261105009100), com os detalhes que custaram um
-- chamado cada:
--   * o ledger (sup_estoque_consumo) vale COM OU SEM o lote — lote removido
--     depois de usado não desfaz a saída da peça (2.981 linhas órfãs em
--     05/11/2026, em 869 pedidos);
--   * a etiqueta única só conta quando NÃO há linha de ledger para o mesmo
--     código no mesmo pedido, senão a peça é contada duas vezes.
--
-- DUAS REGRAS QUE JÁ CUSTARAM CARO EM PRODUÇÃO
--   * DESPACHADO sem NENHUMA baixa registrada não é pendência. São pedidos
--     levados a "Despachado" pelo Status sem baixar peça (36 em 05/11/2026,
--     quase todos anteriores à separação existir). Contá-los infla o pendente
--     e contradiz o próprio selo da tela — é o despachadoSemRegistroDeSaida()
--     do front. Despacho PARCIAL de verdade continua pendente, porque é
--     verdade e é acionável.
--   * CANCELADO fora: cancelar devolve a reserva ao saldo.
--
-- A PENDÊNCIA NÃO RESPEITA O PERÍODO, DE PROPÓSITO
-- Disponível, pendente e em compra são POSIÇÃO DE AGORA; entrou e saiu são do
-- período filtrado. A tela escreve essa diferença no cabeçalho, porque
-- misturar as duas naturezas sem rótulo é a leitura errada mais provável deste
-- painel.
--
-- TAMANHO: o pedido aponta para o item BASE e carrega o tamanho em coluna
-- própria; o estoque vive nos FILHOS (um sup_item por tamanho, com ficha e
-- código próprios — 20260930000163). O casamento é por (base, tamanho) nas
-- duas pontas. Ligar por sup_item_id direto devolve "0 pendente" com a
-- prateleira cheia, que é o erro clássico deste módulo.
--
-- em_transito_por_item e malote_aguardando_compra são CÓPIAS das CTEs já
-- provadas em 20261106013000 e 20261106011000 (aba Estoque Saudável),
-- adaptadas só no nome do parâmetro de categoria (p_categoria aqui,
-- v_categoria lá). Não reescrever a lógica: divergência faria as duas abas do
-- MESMO dashboard discordarem. As duas não contam em dobro —
-- malote_aguardando_compra tem NOT EXISTS contra pedido de compra já enviado,
-- então a quantidade migra de uma coluna para a outra quando o pedido sai.
--
-- DESEMPENHO: esta RPC já levou hotfix de timeout na família (20261029002500).
-- A soma do entregue é restringida pelos pedidos DA EMPRESA antes de agregar,
-- e usa os índices que já existem: idx_sup_consumo_pedido (pedido_id) e
-- idx_sup_tag_pedido (pedido_id, pedido_item_id), ambos de 20260820000001.
-- Nenhum índice novo é criado — CREATE INDEX aqui pegaria ShareLock na tabela
-- do ledger em produção.
--
-- Patch por âncora, e não CREATE OR REPLACE do arquivo inteiro: esta função
-- acumula 4 patches por pg_get_functiondef (20261027000005, 20261027000010,
-- 20261028001800, 20261029000600) e a definição verdadeira só existe no banco.
-- Reescrever o arquivo apagaria esses hotfixes.
--
-- ROLLBACK: restaurar a definição anterior de sup_dashboard_compras_estoque
-- (a que pg_get_functiondef devolve antes desta migration); sem DML.
-- ============================================================================

-- guardiao-ok: inspeciona apenas a definição da função, sem consultar dados de negócio; âncora ausente impede alteração parcial da RPC.
DO $migration$
DECLARE
  v_def text;
  v_origem text;
  v_destino text;
BEGIN
  SELECT pg_get_functiondef(
    'public.sup_dashboard_compras_estoque(uuid,date,date,uuid,text,text)'::regprocedure
  ) INTO v_def;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'Função sup_dashboard_compras_estoque não encontrada.';
  END IF;

  IF position('pendente_por_item AS (' IN v_def) > 0 THEN
    RAISE NOTICE 'sup_dashboard_compras_estoque já expõe posicao_por_item; nada a fazer.';
    RETURN;
  END IF;

  -- ── 1. CTEs novas, logo antes de movimentacao_item ───────────────────
  -- Esse ponto é depois de `estoque` e de `movimentos`, que as CTEs abaixo
  -- consomem, e antes de qualquer uso no payload.
  v_origem := '    movimentacao_item AS (';
  IF position(v_origem IN v_def) = 0 THEN
    RAISE EXCEPTION 'Âncora movimentacao_item não encontrada em sup_dashboard_compras_estoque.';
  END IF;
  v_destino := $trecho$    -- SIS-2026-0824 ───────────────────────────────────────────────────
    -- Pedidos que ainda podem ter pendência. SEM filtro de período: a
    -- pendência é posição de agora, não um fato do intervalo escolhido.
    pedidos_pendencia AS (
      SELECT p.id, p.status
        FROM public.sup_pedido p
       WHERE p.empresa_id = p_empresa_id
         AND p.status <> 'CANCELADO'
         AND (p_contrato_id IS NULL OR p.contrato_id = p_contrato_id)
    ),
    -- Quanto já saiu de cada item de pedido. Copia os dois ramos de
    -- sup_est_tags_do_pedido para esta tela e Pedidos de Materiais não
    -- discordarem.
    entregue_por_pedido_item AS (
      SELECT x.pedido_item_id, sum(x.quantidade)::numeric AS entregue
        FROM (
          -- Etiqueta única sem linha de ledger: uma peça por etiqueta.
          SELECT t.pedido_item_id, 1::numeric AS quantidade
            FROM public.sup_estoque_tag t
           WHERE t.pedido_id IN (SELECT pp.id FROM pedidos_pendencia pp)
             AND t.tipo = 'unico'
             AND NOT EXISTS (
               SELECT 1 FROM public.sup_estoque_consumo c
                WHERE c.codigo = t.codigo AND c.pedido_id = t.pedido_id
             )
          UNION ALL
          -- Ledger: vale com ou sem o lote.
          SELECT c.pedido_item_id, c.quantidade::numeric
            FROM public.sup_estoque_consumo c
           WHERE c.pedido_id IN (SELECT pp.id FROM pedidos_pendencia pp)
        ) x
       WHERE x.pedido_item_id IS NOT NULL
       GROUP BY 1
    ),
    -- DESPACHADO sem baixa nenhuma: o selo da tela diz entregue e não há
    -- registro por peça. Não é pendência.
    pedidos_despachados_sem_baixa AS (
      SELECT pp.id
        FROM pedidos_pendencia pp
       WHERE pp.status = 'DESPACHADO'
         AND NOT EXISTS (
           SELECT 1
             FROM public.sup_pedido_item pi
             JOIN entregue_por_pedido_item e ON e.pedido_item_id = pi.id
            WHERE pi.pedido_id = pp.id AND e.entregue > 0
         )
    ),
    pendente_por_item AS (
      SELECT COALESCE(i.item_pai_id, i.id) AS base_id,
             COALESCE(public.sup_tamanho_da_variante(pi.tamanho),
                      public.sup_tamanho_da_variante(i.tamanho)) AS tamanho,
             sum(GREATEST(pi.quantidade - COALESCE(e.entregue, 0), 0))::numeric AS pendente
        FROM pedidos_pendencia pp
        JOIN public.sup_pedido_item pi ON pi.pedido_id = pp.id
        JOIN public.sup_item i ON i.id = pi.item_id
        LEFT JOIN entregue_por_pedido_item e ON e.pedido_item_id = pi.id
       WHERE (p_categoria IS NULL OR i.tipo = p_categoria)
         AND NOT EXISTS (
           SELECT 1 FROM pedidos_despachados_sem_baixa d WHERE d.id = pp.id
         )
       GROUP BY 1, 2
    ),
    -- Linha de pedido sem item de catálogo vinculado (nome livre, legado): não
    -- tem onde entrar na tabela por item. Entra no TOTAL, para a tela poder
    -- avisar em vez de exibir uma soma menor calada.
    pendente_sem_vinculo AS (
      SELECT COALESCE(sum(GREATEST(pi.quantidade - COALESCE(e.entregue, 0), 0)), 0)::numeric AS pendente
        FROM pedidos_pendencia pp
        JOIN public.sup_pedido_item pi ON pi.pedido_id = pp.id
        LEFT JOIN entregue_por_pedido_item e ON e.pedido_item_id = pi.id
       WHERE pi.item_id IS NULL
         AND (p_categoria IS NULL OR pi.tipo_item = p_categoria)
         AND NOT EXISTS (
           SELECT 1 FROM pedidos_despachados_sem_baixa d WHERE d.id = pp.id
         )
    ),
    -- Cópia de 20261106013000: entrega parcial já conferida sai do trânsito.
    recebido_por_item_compra AS (
      SELECT ri.sup_compra_pedido_item_id AS item_id,
             sum(GREATEST(COALESCE(ri.quantidade_conferida, 0), 0)) AS quantidade
        FROM public.sup_compra_pedido cp
        JOIN public.sup_compra_pedido_item ci ON ci.pedido_id = cp.id
        JOIN public.recebimento_nf_item ri ON ri.sup_compra_pedido_item_id = ci.id
        JOIN public.recebimento_nf r ON r.id = ri.recebimento_id
       WHERE cp.empresa_id = p_empresa_id
         AND cp.status IN ('enviado', 'aguardando_entrega', 'entrega_parcial')
         AND r.empresa_id = p_empresa_id
         AND r.status IN ('recebido', 'recebido_com_ocorrencia')
       GROUP BY ri.sup_compra_pedido_item_id
    ),
    em_transito_por_item AS (
      SELECT COALESCE(i.item_pai_id, i.id) AS base_id,
             COALESCE(public.sup_tamanho_da_variante(ci.tamanho),
                      public.sup_tamanho_da_variante(i.tamanho)) AS tamanho,
             sum(GREATEST(ci.quantidade - COALESCE(rec.quantidade, 0), 0))::numeric AS quantidade
        FROM public.sup_compra_pedido cp
        JOIN public.sup_compra_pedido_item ci ON ci.pedido_id = cp.id
        JOIN public.sup_item i ON i.id = ci.sup_item_id
        LEFT JOIN recebido_por_item_compra rec ON rec.item_id = ci.id
       WHERE cp.empresa_id = p_empresa_id
         AND cp.status IN ('enviado', 'aguardando_entrega', 'entrega_parcial')
         AND (p_categoria IS NULL OR i.tipo = p_categoria)
         AND (p_contrato_id IS NULL OR EXISTS (
           SELECT 1 FROM public.malote_despesa d
            WHERE d.id = cp.despesa_id AND d.contrato_id = p_contrato_id
         ))
       GROUP BY 1, 2
    ),
    -- Cópia de 20261106011000. Nome livre só resolve para UM material base da
    -- mesma empresa; o vínculo por id prevalece.
    catalogo_nome_compra AS (
      SELECT lower(btrim(i.nome)) AS nome,
             (array_agg(i.id ORDER BY i.id))[1] AS base_id
        FROM public.sup_item i
       WHERE i.empresa_id = p_empresa_id AND i.item_pai_id IS NULL AND i.ativo
       GROUP BY lower(btrim(i.nome))
      HAVING count(*) = 1
    ),
    malote_aguardando_compra AS (
      SELECT COALESCE(i.item_pai_id, i.id) AS base_id,
             COALESCE(public.sup_tamanho_da_variante(mi.tamanho),
                      public.sup_tamanho_da_variante(i.tamanho)) AS tamanho,
             sum(mi.quantidade)::numeric AS quantidade
        FROM public.malote_despesa d
        JOIN public.malote_despesa_item mi ON mi.despesa_id = d.id
        LEFT JOIN catalogo_nome_compra nome
          ON mi.sup_item_id IS NULL AND nome.nome = lower(btrim(mi.nome_item))
        JOIN public.sup_item i ON i.id = COALESCE(mi.sup_item_id, nome.base_id)
       WHERE d.empresa_id = p_empresa_id
         AND d.origem = 'solicitacao'
         AND d.deleted_at IS NULL
         AND d.status IN ('aguardando_cotacao', 'cotacao_realizada', 'cotacao_aprovada')
         AND (p_contrato_id IS NULL OR d.contrato_id = p_contrato_id)
         AND (p_categoria IS NULL OR i.tipo = p_categoria)
         AND NOT EXISTS (
           SELECT 1 FROM public.sup_compra_pedido cp
            WHERE cp.despesa_id = d.id
              AND cp.status IN ('enviado', 'aguardando_entrega', 'entrega_parcial', 'recebido')
         )
       GROUP BY 1, 2
    ),
    -- Entrou e saiu POR ITEM no período. Ajuste e correção ficam numa terceira
    -- coluna: não são entrada nem saída de operação, mas sem elas o total da
    -- linha não fecha com o saldo.
    movimento_por_item AS (
      SELECT m.item_estoque_id,
             COALESCE(sum(m.quantidade) FILTER (WHERE m.tipo IN ('entrada', 'devolucao')), 0)::numeric AS entrou,
             COALESCE(sum(abs(m.quantidade)) FILTER (WHERE m.tipo IN ('saida', 'remocao')), 0)::numeric AS saiu,
             COALESCE(sum(m.quantidade) FILTER (WHERE m.tipo IN ('ajuste', 'correcao')), 0)::numeric AS ajustes
        FROM movimentos m
       GROUP BY 1
    ),
    -- Estoque agregado por (base, tamanho): a ficha é por tamanho, e é nesse
    -- nível que pedido e compra conseguem casar.
    estoque_por_chave AS (
      SELECT COALESCE(it.item_pai_id, it.id) AS base_id,
             public.sup_tamanho_da_variante(it.tamanho) AS tamanho,
             min(e.codigo) AS codigo,
             min(e.item) AS item,
             min(e.categoria) AS categoria,
             sum(e.disponivel)::numeric AS disponivel,
             sum(e.reservado)::numeric AS reservado,
             sum(e.fisico)::numeric AS fisico,
             sum(e.valor_total)::numeric AS valor_total,
             max(e.valor_unitario)::numeric AS valor_unitario,
             sum(COALESCE(mi.entrou, 0))::numeric AS entrou,
             sum(COALESCE(mi.saiu, 0))::numeric AS saiu,
             sum(COALESCE(mi.ajustes, 0))::numeric AS ajustes
        FROM estoque e
        JOIN public.sup_item it ON it.id = e.sup_item_id
        LEFT JOIN movimento_por_item mi ON mi.item_estoque_id = e.item_estoque_id
       GROUP BY 1, 2
    ),
    -- Código do FILHO daquele tamanho, para a linha sem ficha de estoque não
    -- cair no código do item base. O código é a identidade operacional do
    -- produto (SIS-2026-0741): mostrar o do base numa linha de tamanho
    -- devolve a confusão que aquela migration foi feita para tirar.
    variante_codigo AS (
      SELECT COALESCE(v.item_pai_id, v.id) AS base_id,
             public.sup_tamanho_da_variante(v.tamanho) AS tamanho,
             min(v.codigo) AS codigo
        FROM public.sup_item v
       WHERE v.empresa_id = p_empresa_id
         AND v.codigo IS NOT NULL
       GROUP BY 1, 2
    ),
    -- Toda combinação que merece linha: tem ficha de estoque, OU tem
    -- pendência, OU tem compra em andamento. Item nunca estocado que já foi
    -- pedido é justamente o que mais precisa aparecer.
    posicao_chaves AS (
      SELECT base_id, tamanho FROM estoque_por_chave
      UNION SELECT base_id, tamanho FROM pendente_por_item
      UNION SELECT base_id, tamanho FROM em_transito_por_item
      UNION SELECT base_id, tamanho FROM malote_aguardando_compra
    ),
    posicao_item AS (
      SELECT ch.base_id,
             ch.tamanho,
             COALESCE(ek.codigo, vc.codigo, ib.codigo) AS codigo,
             COALESCE(ek.item, ib.nome) AS item,
             COALESCE(ek.categoria, ib.tipo) AS categoria,
             public.sup_tamanho_ordem(ch.tamanho) AS ordem_tamanho,
             COALESCE(ek.disponivel, 0)::numeric AS disponivel,
             COALESCE(ek.reservado, 0)::numeric AS reservado,
             COALESCE(ek.fisico, 0)::numeric AS fisico,
             COALESCE(ek.entrou, 0)::numeric AS entrou,
             COALESCE(ek.saiu, 0)::numeric AS saiu,
             COALESCE(ek.ajustes, 0)::numeric AS ajustes,
             COALESCE(pe.pendente, 0)::numeric AS pendente_entrega,
             COALESCE(mc.quantidade, 0)::numeric AS aguardando_compra,
             COALESCE(tr.quantidade, 0)::numeric AS em_transito,
             ek.valor_unitario,
             COALESCE(ek.valor_total, 0)::numeric AS valor_total
        FROM posicao_chaves ch
        JOIN public.sup_item ib ON ib.id = ch.base_id
        LEFT JOIN estoque_por_chave ek
          ON ek.base_id = ch.base_id AND ek.tamanho IS NOT DISTINCT FROM ch.tamanho
        LEFT JOIN variante_codigo vc
          ON vc.base_id = ch.base_id AND vc.tamanho IS NOT DISTINCT FROM ch.tamanho
        LEFT JOIN pendente_por_item pe
          ON pe.base_id = ch.base_id AND pe.tamanho IS NOT DISTINCT FROM ch.tamanho
        LEFT JOIN em_transito_por_item tr
          ON tr.base_id = ch.base_id AND tr.tamanho IS NOT DISTINCT FROM ch.tamanho
        LEFT JOIN malote_aguardando_compra mc
          ON mc.base_id = ch.base_id AND mc.tamanho IS NOT DISTINCT FROM ch.tamanho
       WHERE p_categoria IS NULL OR ib.tipo = p_categoria
    ),
$trecho$ || v_origem;
  v_def := replace(v_def, v_origem, v_destino);

  -- ── 2. Totais novos no resumo do estoque ─────────────────────────────
  v_origem := '        ''quantidade_itens'', COALESCE((SELECT sum(disponivel) FROM estoque), 0),';
  IF position(v_origem IN v_def) = 0 THEN
    RAISE EXCEPTION 'Âncora quantidade_itens não encontrada em sup_dashboard_compras_estoque.';
  END IF;
  v_destino := v_origem || E'\n' || $trecho$        'quantidade_pendente_entrega', COALESCE((SELECT sum(pendente) FROM pendente_por_item), 0),
        'quantidade_pendente_sem_vinculo', COALESCE((SELECT pendente FROM pendente_sem_vinculo), 0),
        'quantidade_aguardando_compra', COALESCE((SELECT sum(quantidade) FROM malote_aguardando_compra), 0),
        'quantidade_em_transito', COALESCE((SELECT sum(quantidade) FROM em_transito_por_item), 0),
        'itens_com_pendencia', (SELECT count(*) FROM pendente_por_item WHERE pendente > 0),$trecho$;
  v_def := replace(v_def, v_origem, v_destino);

  -- ── 3. A lista por item no payload ───────────────────────────────────
  -- Sem o LIMIT 15 de estoque_detalhado, que é ordenado por valor: a calça
  -- sarja pendente pode não estar entre as 15 mais caras. A tabela antiga
  -- fica como está, para não mudar o que já é lido hoje.
  v_origem := '      ''estoque_detalhado'', COALESCE((';
  IF position(v_origem IN v_def) = 0 THEN
    RAISE EXCEPTION 'Âncora estoque_detalhado não encontrada em sup_dashboard_compras_estoque.';
  END IF;
  v_destino := $trecho$      'posicao_por_item', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.pendente_entrega DESC, x.item, x.ordem_tamanho)
          FROM (
            SELECT pq.* FROM posicao_item pq
             WHERE pq.disponivel <> 0 OR pq.reservado <> 0 OR pq.entrou <> 0
                OR pq.saiu <> 0 OR pq.pendente_entrega <> 0
                OR pq.aguardando_compra <> 0 OR pq.em_transito <> 0
             ORDER BY pq.pendente_entrega DESC, pq.item, pq.ordem_tamanho
             LIMIT 2000
          ) x
      ), '[]'::jsonb),
$trecho$ || v_origem;
  v_def := replace(v_def, v_origem, v_destino);

  EXECUTE v_def;
END;
$migration$;

NOTIFY pgrst, 'reload schema';
