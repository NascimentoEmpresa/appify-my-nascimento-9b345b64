-- SIS-2026-0855 — Estoque Saudável: pedidos pendentes por falta, giro dos
-- últimos 3 meses e "já em compra" no relatório item por item.
--
-- O QUE O CHAMADO PEDIU (Cássio, Compras, 10/11/2026)
-- No painel "Item por item: quanto ter, quanto tem e quanto comprar" da aba
-- Estoque Saudável (/app/suprimentos/dashboard), trocar "Aguardando compra"
-- por três colunas, no fluxo ESTOQUE → NECESSIDADE DE GIRO MENSAL → REPOSIÇÃO:
--   1. PEDIDOS PENDENTES: a soma, por item e tamanho, do que está pendente nos
--      pedidos de supervisores e recrutamento por falta de estoque — não importa
--      colaborador, posto ou contrato;
--   2. GIRO DOS ÚLTIMOS 3 MESES: o que de fato saiu do estoque para pedidos.
--      Ele mesmo avisa que no começo fica baixo, porque o estoque está baixo;
--   3. PEDIDO JÁ GERADO PARA O FORNECEDOR: o que já foi comprado, para ver que
--      dos 10 pedidos pendentes os 10 já estão comprados e falta só o
--      complemento dos novos.
--
-- DECISÕES (Eduardo, 12/11/2026) — mudam o número, não "simplificar":
--   * "Já em compra" = pedido de compra do sistema ainda a receber
--     (em_transito, 20261106013000) + solicitação do Malote em cotação
--     (malote_aguardando_compra, 20261106011000). As duas CTEs já não contam em
--     dobro: o Malote sai da cotação quando o pedido é enviado.
--   * COMPRAR = alvo + pendente por falta − disponível − já em compra.
--     Antes era alvo − disponível − em trânsito: o que chegava ia para os
--     pedidos parados e a prateleira nunca alcançava o alvo. E o Malote em
--     cotação passa a abater a compra — revoga o "não altera compra sugerida"
--     de 20261106011000. Cotação reprovada ou cancelada sai do filtro de status
--     e o Comprar volta a subir sozinho.
--   * "Pendente por falta" só conta pedido que JÁ PASSOU PELA SEPARAÇÃO
--     (os mesmos status e o mesmo piso v_corte_at de `atendimento`, a coluna
--     "Já faltou"). Pedido em preparação ou em separação ainda pode sair do
--     estoque — não é falta ainda.
--   * Giro de 3 meses é janela FIXA até hoje, independente do seletor
--     "Histórico usado" da aba. Saída física bruta, só a ligada a pedido de
--     contrato ativo; devolução não é descontada.
--
-- POR QUE EM PRODUÇÃO "JÁ EM COMPRA" VAI APARECER QUASE SÓ COM MALOTE
-- Em 12/11/2026 nenhum sup_compra_pedido tinha sido enviado (2 rascunhos, 1
-- cancelado) e nenhum recebimento_nf estava ligado a pedido. O fluxo que o
-- Cássio descreveu (pedido → NF → entrada → baixa nos pendentes) é o pedido de
-- compra de /app/suprimentos/pedidos-compra com Recebimentos, que existe e não
-- é usado. Enquanto não for, a solicitação do Malote sai de "já em compra" ao
-- ir para pagamento, antes da mercadoria chegar.
--
-- O QUE CONTA COMO JÁ ENTREGUE — copiado, não reescrito
-- `entregue_falta` é cópia de `entregue_por_pedido_item` (20261110000100,
-- SIS-0824), que copia sup_est_tags_do_pedido: ledger com ou sem lote, e a
-- etiqueta única só quando não há ledger do mesmo código no mesmo pedido.
-- DESPACHADO sem nenhuma baixa não é pendência (despachadoSemRegistroDeSaida
-- do front). Reserva ATIVA também abate: peça separada para o pedido não está
-- em falta.
--
-- TAMANHO: chave (base, tamanho) igual à do saldo — o pedido aponta para o
-- item BASE e o estoque vive nos FILHOS (20260930000163).
--
-- Patch por âncora sobre pg_get_functiondef, como 20261106011000 e
-- 20261106013000: a função acumula 7 costuras desde a definição integral
-- (20261020000150) e a versão verdadeira só existe no banco. Cada âncora é um
-- fragmento de UMA linha (não quebra se o corpo estiver em CRLF — o incidente
-- de 27/10) e precisa aparecer exatamente uma vez, senão nada é publicado.
--
-- Nenhuma permissão nova, nenhum índice novo: os ledgers são lidos por
-- pedido_id (idx_sup_consumo_pedido, idx_sup_tag_pedido), restritos aos
-- pedidos da empresa antes de agregar.
--
-- ROLLBACK: restaurar a definição anterior de sup_estoque_saudavel (a que
-- pg_get_functiondef devolve antes desta migration); sem DML.

-- guardiao-ok: inspeciona apenas a definição da função, sem consultar dados de negócio; âncora ausente ou repetida impede alteração parcial da RPC.
DO $migration$
DECLARE
  v_def     text;
  v_origem  text;
  v_destino text;
BEGIN
  SELECT pg_get_functiondef(
    'public.sup_estoque_saudavel(uuid,integer,uuid,text,uuid,integer)'::regprocedure
  ) INTO v_def;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'Função sup_estoque_saudavel não encontrada.';
  END IF;

  IF position('pendente_falta AS (' IN v_def) > 0 THEN
    RAISE NOTICE 'sup_estoque_saudavel já expõe pendentes por falta; nada a fazer.';
    RETURN;
  END IF;

  -- "Já em compra" soma as duas CTEs destas migrations; sem elas a conta nova
  -- não fecha.
  IF position('malote_aguardando_compra AS (' IN v_def) = 0
     OR position('recebido_por_item_compra AS (' IN v_def) = 0 THEN
    RAISE EXCEPTION 'sup_estoque_saudavel sem 20261106011000/20261106013000 aplicadas.';
  END IF;

  -- ── 1. CTEs novas, logo antes de `politica` ─────────────────────────
  -- Nesse ponto já existem atendimento, em_transito e malote_aguardando_compra.
  v_origem := '    politica AS (';
  IF (length(v_def) - length(replace(v_def, v_origem, ''))) / length(v_origem) <> 1 THEN
    RAISE EXCEPTION 'Âncora politica deveria aparecer uma vez em sup_estoque_saudavel.';
  END IF;
  v_destino := $trecho$    -- SIS-2026-0855 ───────────────────────────────────────────────────
    -- Pedidos que JÁ PASSARAM PELA SEPARAÇÃO e ainda podem ter peça faltando.
    -- Mesmos status e mesmo piso de `atendimento`, para "Já faltou" e
    -- "Pedidos pendentes" contarem o mesmo universo. Sem filtro de janela:
    -- pendência é posição de agora.
    pedidos_falta AS (
      SELECT pe.id, pe.status
        FROM public.sup_pedido pe
        LEFT JOIN public.contratos ct ON ct.id = pe.contrato_id
       WHERE pe.empresa_id = p_empresa_id
         AND v_corte_at IS NOT NULL
         AND pe.created_at >= v_corte_at
         AND pe.status IN ('AGUARDANDO ENVIO', 'AGUARDANDO COMPRA', 'DESPACHADO',
                           'RETIRADO PARA ENTREGA')
         AND (p_contrato_id IS NULL OR pe.contrato_id = p_contrato_id)
         AND (pe.contrato_id IS NULL OR ct.status = 'ativo')
    ),
    -- Cópia de entregue_por_pedido_item (20261110000100): o número tem de
    -- bater com Pedidos de Materiais e com o Dashboard de Compras.
    entregue_falta AS (
      SELECT x.pedido_item_id, sum(x.quantidade)::numeric AS entregue
        FROM (
          -- Etiqueta única sem linha de ledger: uma peça por etiqueta.
          SELECT t.pedido_item_id, 1::numeric AS quantidade
            FROM public.sup_estoque_tag t
           WHERE t.pedido_id IN (SELECT pf.id FROM pedidos_falta pf)
             AND t.tipo = 'unico'
             AND NOT EXISTS (
               SELECT 1 FROM public.sup_estoque_consumo c
                WHERE c.codigo = t.codigo AND c.pedido_id = t.pedido_id
             )
          UNION ALL
          -- Ledger: vale com ou sem o lote.
          SELECT c.pedido_item_id, c.quantidade::numeric
            FROM public.sup_estoque_consumo c
           WHERE c.pedido_id IN (SELECT pf.id FROM pedidos_falta pf)
        ) x
       WHERE x.pedido_item_id IS NOT NULL
       GROUP BY 1
    ),
    -- Peça já separada para o pedido não está em falta.
    reservado_falta AS (
      SELECT r.pedido_item_id, sum(r.quantidade)::numeric AS reservado
        FROM public.sup_estoque_reserva r
       WHERE r.pedido_id IN (SELECT pf.id FROM pedidos_falta pf)
         AND r.situacao = 'ATIVA'
         AND r.pedido_item_id IS NOT NULL
       GROUP BY 1
    ),
    -- Pedidos com alguma baixa registrada. DESPACHADO sem nenhuma não é
    -- pendência: o selo da tela diz entregue e não há registro por peça.
    -- Uma passada agregada, e não NOT EXISTS por pedido contra entregue_falta:
    -- CTE materializada não tem índice, e com ~2.900 despachados o NOT EXISTS
    -- custava ~100 ms a mais na função (medido em volume de produção).
    pedidos_com_baixa AS (
      SELECT DISTINCT pi.pedido_id
        FROM entregue_falta e
        JOIN public.sup_pedido_item pi ON pi.id = e.pedido_item_id
       WHERE e.entregue > 0
    ),
    falta_por_linha AS (
      SELECT pf.id AS pedido_id, pi.item_id, pi.tipo_item, pi.tamanho,
             GREATEST(pi.quantidade - COALESCE(e.entregue, 0)
                      - COALESCE(r.reservado, 0), 0)::numeric AS falta
        FROM pedidos_falta pf
        JOIN public.sup_pedido_item pi ON pi.pedido_id = pf.id
        LEFT JOIN entregue_falta e  ON e.pedido_item_id = pi.id
        LEFT JOIN reservado_falta r ON r.pedido_item_id = pi.id
       WHERE pf.status <> 'DESPACHADO'
          OR pf.id IN (SELECT pb.pedido_id FROM pedidos_com_baixa pb)
    ),
    pendente_falta AS (
      SELECT COALESCE(i.item_pai_id, i.id) AS base_id,
             COALESCE(public.sup_tamanho_da_variante(fl.tamanho),
                      public.sup_tamanho_da_variante(i.tamanho)) AS tamanho,
             sum(fl.falta)::numeric             AS quantidade,
             count(DISTINCT fl.pedido_id)::integer AS pedidos
        FROM falta_por_linha fl
        JOIN public.sup_item i ON i.id = fl.item_id
       WHERE fl.falta > 0
         AND (v_categoria IS NULL OR i.tipo = v_categoria)
       GROUP BY 1, 2
    ),
    -- Linha de pedido sem item de catálogo (nome livre, legado): não tem
    -- linha na tabela. Vai no total, para a tela avisar em vez de somar menos.
    pendente_falta_sem_vinculo AS (
      SELECT COALESCE(sum(fl.falta), 0)::numeric AS quantidade
        FROM falta_por_linha fl
       WHERE fl.item_id IS NULL
         AND (v_categoria IS NULL OR fl.tipo_item = v_categoria)
    ),
    -- O que SAIU de verdade do estoque para pedidos nos últimos 3 meses.
    -- Diferente de demanda_mensal, que é o que foi PEDIDO: enquanto o estoque
    -- estiver baixo, este número fica abaixo da demanda. Janela fixa, mesma
    -- resolução de item/tamanho da CTE `movimento`, só contrato ativo.
    -- Agrega pelo tamanho CRU antes de normalizar: sup_tamanho_da_variante
    -- roda em centenas de grupos em vez de em cada movimento (77 → 11 ms em
    -- volume de produção, mesmo resultado).
    giro_pedidos_3m AS (
      SELECT g.base_id,
             COALESCE(public.sup_tamanho_da_variante(g.tamanho_movimento),
                      public.sup_tamanho_da_variante(g.tamanho_item)) AS tamanho,
             sum(g.unidades)::numeric AS unidades
        FROM (
          SELECT COALESCE(i.item_pai_id, i.id) AS base_id,
                 m.tamanho AS tamanho_movimento, i.tamanho AS tamanho_item,
                 sum(abs(m.quantidade)) AS unidades
            FROM public.sup_estoque_movimento m
            LEFT JOIN public.sup_estoque_item ei ON ei.id = m.item_estoque_id
            JOIN public.sup_item i ON i.id = COALESCE(m.sup_item_id, ei.sup_item_id)
           WHERE m.empresa_id = p_empresa_id
             AND m.tipo = 'saida'
             AND m.pedido_id IS NOT NULL
             AND m.created_at >= (v_hoje - interval '3 months')::timestamptz
             AND (v_categoria IS NULL OR i.tipo = v_categoria)
             AND (p_almoxarifado_id IS NULL OR ei.almoxarifado_id = p_almoxarifado_id)
             AND EXISTS (
               SELECT 1
                 FROM public.sup_pedido pe
                 LEFT JOIN public.contratos ct ON ct.id = pe.contrato_id
                WHERE pe.id = m.pedido_id
                  AND (p_contrato_id IS NULL OR pe.contrato_id = p_contrato_id)
                  AND (pe.contrato_id IS NULL OR ct.status = 'ativo')
             )
           GROUP BY 1, 2, 3
        ) g
       GROUP BY 1, 2
    ),
    politica AS ($trecho$;
  v_def := replace(v_def, v_origem, v_destino);

  -- ── 2. Tamanho que só tem pedido parado ou só giro precisa de linha ──
  v_origem := '      UNION SELECT base_id, tamanho FROM malote_aguardando_compra WHERE base_id IS NOT NULL';
  IF (length(v_def) - length(replace(v_def, v_origem, ''))) / length(v_origem) <> 1 THEN
    RAISE EXCEPTION 'Âncora de chaves deveria aparecer uma vez em sup_estoque_saudavel.';
  END IF;
  v_destino := v_origem || E'\n' ||
    '      UNION SELECT base_id, tamanho FROM pendente_falta WHERE base_id IS NOT NULL' || E'\n' ||
    '      UNION SELECT base_id, tamanho FROM giro_pedidos_3m WHERE base_id IS NOT NULL';
  v_def := replace(v_def, v_origem, v_destino);

  -- ── 3. Colunas e junções em `base` ──────────────────────────────────
  -- `pf` já é preco_familia nesta CTE; por isso pfa e g3.
  v_origem := '             COALESCE(mc.quantidade, 0) AS aguardando_compra,';
  IF (length(v_def) - length(replace(v_def, v_origem, ''))) / length(v_origem) <> 1 THEN
    RAISE EXCEPTION 'Âncora de quantidade deveria aparecer uma vez em sup_estoque_saudavel.';
  END IF;
  v_destino := v_origem || E'\n' ||
    '             COALESCE(pfa.quantidade, 0) AS pendente_falta,' || E'\n' ||
    '             COALESCE(pfa.pedidos, 0)    AS pedidos_falta,' || E'\n' ||
    '             COALESCE(g3.unidades, 0)    AS giro_3m,';
  v_def := replace(v_def, v_origem, v_destino);

  v_origem := '        LEFT JOIN malote_aguardando_compra mc ON mc.base_id = k.base_id AND mc.tamanho IS NOT DISTINCT FROM k.tamanho';
  IF (length(v_def) - length(replace(v_def, v_origem, ''))) / length(v_origem) <> 1 THEN
    RAISE EXCEPTION 'Âncora de junção deveria aparecer uma vez em sup_estoque_saudavel.';
  END IF;
  v_destino := v_origem || E'\n' ||
    '        LEFT JOIN pendente_falta pfa ON pfa.base_id = k.base_id AND pfa.tamanho IS NOT DISTINCT FROM k.tamanho' || E'\n' ||
    '        LEFT JOIN giro_pedidos_3m g3 ON g3.base_id = k.base_id AND g3.tamanho IS NOT DISTINCT FROM k.tamanho';
  v_def := replace(v_def, v_origem, v_destino);

  -- ── 4. A conta ──────────────────────────────────────────────────────
  -- Cobertura, situação e ponto de pedido continuam olhando só o disponível.
  v_origem := '             ceil(GREATEST(l.alvo - l.disponivel - l.em_transito, 0))::integer AS comprar,';
  IF (length(v_def) - length(replace(v_def, v_origem, ''))) / length(v_origem) <> 1 THEN
    RAISE EXCEPTION 'Âncora de comprar deveria aparecer uma vez em sup_estoque_saudavel.';
  END IF;
  v_destino :=
    '             -- SIS-2026-0855: o que chega atende primeiro os pedidos parados, então' || E'\n' ||
    '             -- eles somam ao alvo; e o que já está em compra (pedido enviado ou' || E'\n' ||
    '             -- Malote em cotação) não é pedido de novo.' || E'\n' ||
    '             ceil(GREATEST(l.alvo + l.pendente_falta - l.disponivel' || E'\n' ||
    '                           - l.em_transito - l.aguardando_compra, 0))::integer AS comprar,';
  v_def := replace(v_def, v_origem, v_destino);

  -- ── 5. JSON do item ─────────────────────────────────────────────────
  -- Fecha o 2º jsonb_build_object logo depois de aguardando_compra e abre um
  -- 3º com as chaves novas seguidas do resto das que já existiam. O JSON
  -- continua achatado e nenhum bloco chega perto dos 50 pares.
  v_origem := '''aguardando_compra'', aguardando_compra,';
  IF (length(v_def) - length(replace(v_def, v_origem, ''))) / length(v_origem) <> 1 THEN
    RAISE EXCEPTION 'Âncora do JSON deveria aparecer uma vez em sup_estoque_saudavel.';
  END IF;
  v_destino := '''aguardando_compra'', aguardando_compra' || E'\n' ||
    '               )' || E'\n' ||
    '               || jsonb_build_object(' || E'\n' ||
    '                 ''pendente_falta'', pendente_falta, ''pedidos_falta'', pedidos_falta,' || E'\n' ||
    '                 ''giro_3m'', giro_3m,' || E'\n' ||
    '                 ''ja_em_compra'', em_transito + aguardando_compra,';
  v_def := replace(v_def, v_origem, v_destino);

  -- ── 6. Totais da coluna, no topo do payload ─────────────────────────
  v_origem := '      ''itens'', COALESCE((';
  IF (length(v_def) - length(replace(v_def, v_origem, ''))) / length(v_origem) <> 1 THEN
    RAISE EXCEPTION 'Âncora da lista de itens deveria aparecer uma vez em sup_estoque_saudavel.';
  END IF;
  v_destino := $trecho$      -- SIS-2026-0855: totais de "Pedidos pendentes" e a data de início do
      -- giro de 3 meses, que a tela escreve no cabeçalho.
      'pedidos_falta', jsonb_build_object(
        'unidades',    COALESCE((SELECT sum(quantidade) FROM pendente_falta), 0),
        'pedidos',     (SELECT count(DISTINCT fl.pedido_id)
                          FROM falta_por_linha fl
                          LEFT JOIN public.sup_item i ON i.id = fl.item_id
                         WHERE fl.falta > 0
                           AND (v_categoria IS NULL OR COALESCE(i.tipo, fl.tipo_item) = v_categoria)),
        'sem_vinculo', (SELECT quantidade FROM pendente_falta_sem_vinculo),
        'giro_desde',  (v_hoje - interval '3 months')::date
      ),
      'itens', COALESCE(($trecho$;
  v_def := replace(v_def, v_origem, v_destino);

  EXECUTE v_def;
END;
$migration$;

NOTIFY pgrst, 'reload schema';
