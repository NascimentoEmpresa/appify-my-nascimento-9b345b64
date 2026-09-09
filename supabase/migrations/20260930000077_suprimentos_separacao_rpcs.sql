-- =====================================================================
-- Suprimentos — RPCs da separação, parte 4 de 5
--
-- Depende de 20260930000074, ...75 e ...76.
--
-- O CICLO QUE ESTAS SEIS FUNÇÕES FECHAM
--
--   encarregado pede  →  sup_sep_sugerir (a supervisora abre e vê de
--   quais lotes tirar)  →  sup_sep_reservar (ela confirma: o pré-pedido
--   nasce e a mercadoria SAI DO SALDO sem sair da prateleira)  →  o
--   estoquista pega em sup_sep_fila  →  sup_sep_confirmar (a peça sai de
--   verdade) ou sup_sep_divergencia (não estava na doca)  →
--   sup_sep_liberar desfaz o pré-pedido se a supervisora mudar de ideia.
--
-- PROTOCOLO DE LOCK — igual nas que escrevem, sem exceção:
--
--   1. pg_advisory_xact_lock por material
--   2. SELECT ... FROM sup_pedido ... FOR UPDATE
--   3. etiquetas em ORDER BY ca_validade NULLS LAST, created_at, id
--      com FOR UPDATE OF tg
--   4. SÓ DEPOIS do lock: SUM das reservas ATIVAS daquela etiqueta
--   5. valida, escreve reserva, escreve etiqueta
--
-- O passo 4 é a sutileza que mata. Sob READ COMMITTED, FOR UPDATE
-- reavalia o WHERE sobre a versão nova da linha travada (EvalPlanQual) —
-- é o que protege `quantidade_massa > 0`. Mas ele NÃO reavalia subquery
-- em OUTRA tabela. Por isso a subtração de reserva nunca entra no WHERE
-- que trava: trava-se pela condição física, e o reservado é somado numa
-- segunda consulta, já sob o lock.
--
-- O advisory lock do passo 1 é o que resolve de verdade. Alocação de
-- estoque é ritmo humano — serializar por material custa nada e elimina
-- a classe inteira de bugs de ordenação e de deadlock cruzado.
--
-- VARREDURA DE INVARIANTE — rodar depois de cada deploy. As duas têm de
-- voltar VAZIAS; uma linha em qualquer delas é saldo negativo em produção:
--
--   SELECT t.codigo, t.tipo, t.quantidade_massa, t.usado, r.q AS reservado
--     FROM public.sup_estoque_tag t
--     JOIN (SELECT tag_id, SUM(quantidade) q FROM public.sup_estoque_reserva
--            WHERE situacao = 'ATIVA' GROUP BY 1) r ON r.tag_id = t.id
--    WHERE r.q > CASE WHEN t.tipo = 'massa' THEN COALESCE(t.quantidade_massa, 0)
--                     WHEN t.usado THEN 0 ELSE 1 END;
--
--   SELECT * FROM public.sup_estoque_saldo WHERE disponivel < 0;
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sup_sep_fila(integer, integer);
--   DROP FUNCTION IF EXISTS public.sup_sep_liberar(uuid, uuid, text);
--   DROP FUNCTION IF EXISTS public.sup_sep_divergencia(uuid, integer, text);
--   DROP FUNCTION IF EXISTS public.sup_sep_confirmar(uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.sup_sep_reservar(uuid, jsonb, text);
--   DROP FUNCTION IF EXISTS public.sup_sep_sugerir(uuid);
--   DROP FUNCTION IF EXISTS public.sup_sep_recalcular_status(uuid);
-- =====================================================================

-- ── 0. Auxiliar: para onde o pedido vai quando a separação acaba ─────

CREATE OR REPLACE FUNCTION public.sup_sep_recalcular_status(p_pedido_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_ativas integer; v_saiu integer; v_novo text; v_atual text;
BEGIN
  SELECT p.status INTO v_atual FROM public.sup_pedido p WHERE p.id = p_pedido_id;
  IF v_atual IS DISTINCT FROM 'EM SEPARACAO' THEN RETURN v_atual; END IF;

  SELECT count(*) INTO v_ativas FROM public.sup_estoque_reserva rr
   WHERE rr.pedido_id = p_pedido_id AND rr.situacao = 'ATIVA';
  IF v_ativas > 0 THEN RETURN v_atual; END IF;   -- ainda tem o que separar

  SELECT COALESCE(SUM(s.itens_atendidos), 0) INTO v_saiu
    FROM public.sup_pedido_situacao s WHERE s.pedido_id = p_pedido_id;

  -- Nada saiu: não há o que despachar, então o pedido vira necessidade de
  -- compra. Saiu alguma coisa: vai para a doca, e quem ficou pendente
  -- aparece como "parcialmente despachado" (derivado no front).
  v_novo := CASE WHEN v_saiu > 0 THEN 'AGUARDANDO ENVIO' ELSE 'AGUARDANDO COMPRA' END;
  UPDATE public.sup_pedido SET status = v_novo WHERE id = p_pedido_id;
  RETURN v_novo;
END $fn$;

-- ── 1. Sugerir de quais lotes tirar ──────────────────────────────────
--
-- STABLE: não trava e não reserva nada. Roda quando a supervisora ABRE o
-- pedido, e é por isso que a sugestão nunca fica obsoleta — ela é
-- recalculada a cada abertura, e só o clique dela cria a reserva.
--
-- A ordem é a mesma de sup_est_baixar_quantidade (20260930000018:326):
-- CA vencendo primeiro, depois entrada mais antiga. É o "primeiro que
-- vence, primeiro que sai" que o gerente descreveu como "aquela ação do
-- CA que está vencendo".

CREATE OR REPLACE FUNCTION public.sup_sep_sugerir(p_pedido_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_itens  jsonb := '[]'::jsonb;
  pi       record;
  t        record;
  v_falta  integer;
  v_pegar  integer;
  v_lotes  jsonb;
  v_ja     integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_pedidos_materiais', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para preparar pedidos';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sup_pedido p WHERE p.id = p_pedido_id) THEN
    RAISE EXCEPTION 'Pedido não encontrado';
  END IF;

  FOR pi IN
    SELECT x.id, x.item_id, x.nome_item, x.tamanho, x.quantidade
      FROM public.sup_pedido_item x
     WHERE x.pedido_id = p_pedido_id
     ORDER BY x.ordem NULLS LAST, x.created_at
  LOOP
    -- O que este item já resolveu: o que saiu de verdade mais o que já
    -- está reservado. Reabrir a tela não pode sugerir de novo o mesmo.
    SELECT COALESCE((SELECT SUM(cc.quantidade) FROM public.sup_estoque_consumo cc
                      WHERE cc.pedido_item_id = pi.id), 0)
         + COALESCE((SELECT count(*) FROM public.sup_estoque_tag tg
                      WHERE tg.pedido_item_id = pi.id AND tg.tipo = 'unico' AND tg.usado), 0)
         + COALESCE((SELECT SUM(rr.quantidade) FROM public.sup_estoque_reserva rr
                      WHERE rr.pedido_item_id = pi.id AND rr.situacao = 'ATIVA'), 0)
      INTO v_ja;

    v_falta := GREATEST(COALESCE(pi.quantidade, 0) - COALESCE(v_ja, 0), 0);
    v_lotes := '[]'::jsonb;

    IF pi.item_id IS NOT NULL AND v_falta > 0 THEN
      FOR t IN
        SELECT tg.id, tg.codigo, tg.tipo, tg.tamanho, tg.ca_numero, tg.ca_validade,
               tg.valor_unitario, tg.localizacao, ei.id AS ei_id,
               (CASE WHEN tg.tipo = 'massa' THEN COALESCE(tg.quantidade_massa, 0) ELSE 1 END)
               - COALESCE((SELECT SUM(rr.quantidade) FROM public.sup_estoque_reserva rr
                            WHERE rr.tag_id = tg.id AND rr.situacao = 'ATIVA'), 0) AS livre
          FROM public.sup_estoque_tag tg
          JOIN public.sup_estoque_item ei ON ei.id = tg.item_estoque_id
         WHERE ei.sup_item_id = pi.item_id
           AND NOT tg.usado
           AND (pi.tamanho IS NULL OR tg.tamanho IS NOT DISTINCT FROM pi.tamanho)
           -- Lote com contagem rotativa aberta fica de fora: se ele já deu
           -- divergência, sugerir de novo amanhã produz a mesma divergência.
           AND NOT EXISTS (SELECT 1 FROM public.sup_estoque_contagem_fila cf
                            WHERE cf.tag_id = tg.id AND cf.situacao = 'ABERTA')
         ORDER BY tg.ca_validade NULLS LAST, tg.created_at, tg.id
      LOOP
        EXIT WHEN v_falta <= 0;
        CONTINUE WHEN t.livre <= 0;

        v_pegar := LEAST(v_falta, t.livre);
        v_falta := v_falta - v_pegar;

        v_lotes := v_lotes || jsonb_build_object(
          'tag_id', t.id, 'codigo', t.codigo, 'tipo', t.tipo, 'tamanho', t.tamanho,
          'quantidade', v_pegar, 'livre', t.livre, 'localizacao', t.localizacao,
          'valor_unitario', t.valor_unitario,
          'ca_numero', t.ca_numero, 'ca_validade', t.ca_validade,
          -- Alerta, e NÃO exclusão: quem decide usar um lote com CA
          -- bloqueado é a pessoa. O trigger sst_ca_guard_baixa recusaria
          -- na confirmação, e é melhor a supervisora saber disso agora.
          'alerta', CASE WHEN t.ca_validade IS NOT NULL AND t.ca_validade < current_date
                         THEN 'CA vencido em ' || to_char(t.ca_validade, 'DD/MM/YYYY')
                         ELSE NULL END);
      END LOOP;
    END IF;

    v_itens := v_itens || jsonb_build_object(
      'pedido_item_id', pi.id, 'item_id', pi.item_id, 'nome_item', pi.nome_item,
      'tamanho', pi.tamanho, 'quantidade_pedida', pi.quantidade,
      'ja_resolvido', COALESCE(v_ja, 0), 'faltante', v_falta, 'lotes', v_lotes);
  END LOOP;

  RETURN jsonb_build_object('pedido_id', p_pedido_id, 'itens', v_itens);
END $fn$;

-- ── 2. Confirmar o pré-pedido: reservar ──────────────────────────────
--
-- p_reservas = [{"pedido_item_id":"...","lotes":[{"tag_id":"...","quantidade":3}]}]
--
-- NÃO levanta exceção por falta de saldo — divergente de
-- sup_est_baixar_quantidade de propósito. No fluxo que o gerente
-- descreveu, a supervisora confirma VENDO o que falta, e o que falta vira
-- necessidade de compra. Abortar tudo porque um item não tinha saldo
-- obrigaria a refazer a conferência inteira.

CREATE OR REPLACE FUNCTION public.sup_sep_reservar(
  p_pedido_id  uuid,
  p_reservas   jsonb,
  p_observacao text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_nome    text := public.sup_est_nome_usuario();
  v_ped     record;
  v_total   integer := 0;
  v_faltas  jsonb := '[]'::jsonb;
  v_rej     jsonb := '[]'::jsonb;
  it        record;
  lo        record;
  v_pi      record;
  v_tag     record;
  v_res_tag integer;
  v_livre   integer;
  v_dar     integer;
  v_pedido_falta integer;
  v_antes   text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_pedidos_materiais', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para preparar pedidos';
  END IF;

  SELECT p.id, p.status, p.pedido_id, p.empresa_id INTO v_ped
    FROM public.sup_pedido p WHERE p.id = p_pedido_id FOR UPDATE;
  IF v_ped.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;
  IF v_ped.status IN ('DESPACHADO','CANCELADO') THEN
    RAISE EXCEPTION 'Pedido % está % e não aceita separação.', v_ped.pedido_id, v_ped.status;
  END IF;
  v_antes := v_ped.status;

  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(p_reservas, '[]'::jsonb)) AS e(v)
  LOOP
    SELECT x.id, x.item_id, x.nome_item, x.tamanho, x.quantidade INTO v_pi
      FROM public.sup_pedido_item x
     WHERE x.id = (it.v->>'pedido_item_id')::uuid AND x.pedido_id = p_pedido_id;

    IF v_pi.id IS NULL THEN
      v_rej := v_rej || jsonb_build_object('pedido_item_id', it.v->>'pedido_item_id',
                                           'motivo', 'Item não pertence a este pedido');
      CONTINUE;
    END IF;

    v_pedido_falta := 0;

    FOR lo IN SELECT * FROM jsonb_array_elements(COALESCE(it.v->'lotes', '[]'::jsonb)) AS e(v)
    LOOP
      -- Passo 1 do protocolo: serializa por material.
      PERFORM pg_advisory_xact_lock(hashtext('sup_est_item:' || v_pi.item_id::text)::bigint);

      -- Passo 3: trava a etiqueta pela condição FÍSICA (nunca pela reserva).
      SELECT tg.id, tg.codigo, tg.tipo, tg.quantidade_massa, tg.usado, tg.tamanho,
             tg.item_estoque_id, ei.empresa_id, ei.sup_item_id
        INTO v_tag
        FROM public.sup_estoque_tag tg
        JOIN public.sup_estoque_item ei ON ei.id = tg.item_estoque_id
       WHERE tg.id = (lo.v->>'tag_id')::uuid
       FOR UPDATE OF tg;

      IF v_tag.id IS NULL THEN
        v_rej := v_rej || jsonb_build_object('tag_id', lo.v->>'tag_id',
                                             'motivo', 'Lote não existe');
        CONTINUE;
      END IF;
      IF v_tag.sup_item_id IS DISTINCT FROM v_pi.item_id THEN
        v_rej := v_rej || jsonb_build_object('codigo', v_tag.codigo,
                   'motivo', format('Lote é de outro material, não de %s', v_pi.nome_item));
        CONTINUE;
      END IF;
      IF v_tag.usado THEN
        v_rej := v_rej || jsonb_build_object('codigo', v_tag.codigo,
                                             'motivo', 'Lote já foi consumido');
        CONTINUE;
      END IF;

      -- Passo 4: só agora, e em consulta separada, o reservado.
      SELECT COALESCE(SUM(rr.quantidade), 0) INTO v_res_tag
        FROM public.sup_estoque_reserva rr
       WHERE rr.tag_id = v_tag.id AND rr.situacao = 'ATIVA';

      v_livre := (CASE WHEN v_tag.tipo = 'massa' THEN COALESCE(v_tag.quantidade_massa, 0) ELSE 1 END)
                 - v_res_tag;
      v_dar   := LEAST(GREATEST(COALESCE((lo.v->>'quantidade')::int, 0), 0), GREATEST(v_livre, 0));

      IF v_dar <= 0 THEN
        v_pedido_falta := v_pedido_falta + GREATEST(COALESCE((lo.v->>'quantidade')::int, 0), 0);
        v_rej := v_rej || jsonb_build_object('codigo', v_tag.codigo,
                   'motivo', 'Sem saldo livre neste lote (já reservado para outro pedido)');
        CONTINUE;
      END IF;

      v_pedido_falta := v_pedido_falta
                        + GREATEST(COALESCE((lo.v->>'quantidade')::int, 0) - v_dar, 0);

      INSERT INTO public.sup_estoque_reserva
        (empresa_id, tag_id, item_estoque_id, pedido_id, pedido_item_id, quantidade,
         reservado_por, reservado_por_nome)
      VALUES (v_tag.empresa_id, v_tag.id, v_tag.item_estoque_id, p_pedido_id, v_pi.id,
              v_dar, v_uid, v_nome)
      ON CONFLICT (tag_id, pedido_item_id) WHERE situacao = 'ATIVA'
      DO UPDATE SET quantidade   = public.sup_estoque_reserva.quantidade + excluded.quantidade,
                    reservado_em = now();

      INSERT INTO public.sup_estoque_movimento
        (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho,
         pedido_id, pedido_item_id, observacao, usuario_id, usuario_nome)
      VALUES (v_tag.empresa_id, v_tag.item_estoque_id, v_tag.codigo, 'reserva', v_dar,
              v_tag.tamanho, p_pedido_id, v_pi.id,
              format('Reservado para separação do pedido %s', v_ped.pedido_id), v_uid, v_nome);

      v_total := v_total + v_dar;
    END LOOP;

    IF v_pedido_falta > 0 THEN
      v_faltas := v_faltas || jsonb_build_object(
        'pedido_item_id', v_pi.id, 'nome_item', v_pi.nome_item,
        'tamanho', v_pi.tamanho, 'faltam', v_pedido_falta);
    END IF;
  END LOOP;

  IF v_total > 0 AND v_ped.status <> 'EM SEPARACAO' THEN
    UPDATE public.sup_pedido SET status = 'EM SEPARACAO' WHERE id = p_pedido_id;

    INSERT INTO public.sup_pedido_historico
      (pedido_id, acao, status_anterior, status_novo, observacao, alterado_por, alterado_por_nome)
    VALUES (p_pedido_id, 'STATUS', v_antes, 'EM SEPARACAO',
            nullif(btrim(COALESCE(p_observacao, '')), ''), v_uid, v_nome);
  END IF;

  IF v_total > 0 THEN
    INSERT INTO public.sup_pedido_historico
      (pedido_id, acao, observacao, alterado_por, alterado_por_nome)
    VALUES (p_pedido_id, 'SEPARACAO',
            format('Pré-pedido confirmado: %s unidade(s) reservada(s)%s',
                   v_total,
                   CASE WHEN jsonb_array_length(v_faltas) > 0
                        THEN format(' · %s item(ns) sem saldo', jsonb_array_length(v_faltas))
                        ELSE '' END),
            v_uid, v_nome);
  END IF;

  RETURN jsonb_build_object('reservadas', v_total, 'faltantes', v_faltas, 'rejeitadas', v_rej);
END $fn$;

-- ── 3. Confirmar a separação física ──────────────────────────────────
--
-- p_itens = [{"reserva_id":"...","quantidade":3}]
--
-- Em lote, porque o "confirmar tudo" do estoquista tem de ser UMA
-- transação: metade do pedido separado e metade não é um estado que
-- ninguém sabe consertar depois.
--
-- >>> ORDEM: fecha a reserva ANTES de mexer na etiqueta. O trigger
-- >>> sup_est_tag_guard_saldo_reservado recusaria o decremento se a
-- >>> reserva ainda estivesse ATIVA sobre o saldo já reduzido.

CREATE OR REPLACE FUNCTION public.sup_sep_confirmar(p_pedido_id uuid, p_itens jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_nome  text := public.sup_est_nome_usuario();
  v_ped   record;
  v_ok    integer := 0;
  v_rej   jsonb := '[]'::jsonb;
  it      record;
  r       record;
  v_qtd   integer;
  v_resta integer;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_separacao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para confirmar separação';
  END IF;

  SELECT p.id, p.status, p.pedido_id INTO v_ped
    FROM public.sup_pedido p WHERE p.id = p_pedido_id FOR UPDATE;
  IF v_ped.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;
  IF v_ped.status <> 'EM SEPARACAO' THEN
    RAISE EXCEPTION 'Pedido % não está em separação (status %).', v_ped.pedido_id, v_ped.status;
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(p_itens, '[]'::jsonb)) AS e(v)
  LOOP
    SELECT rr.id, rr.quantidade, rr.tag_id, rr.item_estoque_id, rr.pedido_item_id,
           rr.empresa_id, tg.codigo, tg.tipo, tg.quantidade_massa, tg.tamanho
      INTO r
      FROM public.sup_estoque_reserva rr
      JOIN public.sup_estoque_tag tg ON tg.id = rr.tag_id
     WHERE rr.id = (it.v->>'reserva_id')::uuid
       AND rr.pedido_id = p_pedido_id AND rr.situacao = 'ATIVA';

    IF r.id IS NULL THEN
      v_rej := v_rej || jsonb_build_object('reserva_id', it.v->>'reserva_id',
                                           'motivo', 'Reserva não está ativa neste pedido');
      CONTINUE;
    END IF;

    PERFORM pg_advisory_xact_lock(
      hashtext('sup_est_item:' || (SELECT ei.sup_item_id::text FROM public.sup_estoque_item ei
                                    WHERE ei.id = r.item_estoque_id))::bigint);
    PERFORM 1 FROM public.sup_estoque_tag WHERE id = r.tag_id FOR UPDATE;

    v_qtd := LEAST(GREATEST(COALESCE((it.v->>'quantidade')::int, r.quantidade), 0), r.quantidade);
    IF v_qtd <= 0 THEN
      v_rej := v_rej || jsonb_build_object('codigo', r.codigo,
                 'motivo', 'Quantidade zero — use "Divergência" para registrar o que não estava na doca');
      CONTINUE;
    END IF;

    -- 1) fecha a reserva PRIMEIRO
    UPDATE public.sup_estoque_reserva
       SET situacao = 'CONSUMIDA', quantidade = v_qtd, fechado_em = now(),
           fechado_por = v_uid, fechado_por_nome = v_nome
     WHERE id = r.id;

    -- Separou menos do que estava reservado: o resto vira divergência, para
    -- o item continuar amarrado ao pedido e entrar na contagem rotativa.
    IF v_qtd < r.quantidade THEN
      PERFORM public.sup_sep_divergencia_interno(
        r.id, r.quantidade - v_qtd,
        COALESCE(nullif(btrim(it.v->>'observacao'), ''), 'Quantidade menor na separação'),
        v_uid, v_nome, p_pedido_id, v_ped.pedido_id);
    END IF;

    -- 2) só então a etiqueta
    IF r.tipo = 'massa' THEN
      v_resta := GREATEST(COALESCE(r.quantidade_massa, 0) - v_qtd, 0);
      UPDATE public.sup_estoque_tag
         SET quantidade_massa = v_resta,
             usado            = (v_resta <= 0),
             pedido_id        = CASE WHEN v_resta <= 0 THEN p_pedido_id ELSE pedido_id END,
             pedido_item_id   = CASE WHEN v_resta <= 0 THEN r.pedido_item_id ELSE pedido_item_id END,
             usado_em         = CASE WHEN v_resta <= 0 THEN now() ELSE usado_em END,
             usado_por        = CASE WHEN v_resta <= 0 THEN v_uid ELSE usado_por END,
             usado_por_nome   = CASE WHEN v_resta <= 0 THEN v_nome ELSE usado_por_nome END
       WHERE id = r.tag_id;
    ELSE
      UPDATE public.sup_estoque_tag
         SET usado = true, pedido_id = p_pedido_id, pedido_item_id = r.pedido_item_id,
             usado_em = now(), usado_por = v_uid, usado_por_nome = v_nome
       WHERE id = r.tag_id;
    END IF;

    -- 3) ledger ADITIVO (o mesmo de sup_est_baixar_quantidade). sup_est_baixar
    --    grava ABSOLUTO na mesma chave — é por isso que a parte 5 proíbe aquela
    --    RPC de tocar em pedido EM SEPARACAO.
    INSERT INTO public.sup_estoque_consumo
      (codigo, item_estoque_id, pedido_id, pedido_item_id, quantidade,
       consumido_por, consumido_por_nome)
    VALUES (r.codigo, r.item_estoque_id, p_pedido_id, r.pedido_item_id, v_qtd, v_uid, v_nome)
    ON CONFLICT (codigo, pedido_item_id) DO UPDATE
      SET quantidade         = public.sup_estoque_consumo.quantidade + excluded.quantidade,
          consumido_em       = now(),
          consumido_por      = excluded.consumido_por,
          consumido_por_nome = excluded.consumido_por_nome;

    INSERT INTO public.sup_estoque_movimento
      (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho,
       pedido_id, pedido_item_id, observacao, usuario_id, usuario_nome)
    VALUES (r.empresa_id, r.item_estoque_id, r.codigo, 'saida', v_qtd, r.tamanho,
            p_pedido_id, r.pedido_item_id,
            format('Separação confirmada do pedido %s', v_ped.pedido_id), v_uid, v_nome);

    v_ok := v_ok + v_qtd;
  END LOOP;

  IF v_ok > 0 THEN
    INSERT INTO public.sup_pedido_historico
      (pedido_id, acao, observacao, alterado_por, alterado_por_nome)
    VALUES (p_pedido_id, 'SEPARACAO',
            format('%s unidade(s) separada(s) e baixada(s) do estoque', v_ok), v_uid, v_nome);
  END IF;

  v_status := public.sup_sep_recalcular_status(p_pedido_id);
  RETURN jsonb_build_object('separadas', v_ok, 'rejeitadas', v_rej, 'status', v_status);
END $fn$;

-- ── 4. Divergência ───────────────────────────────────────────────────
--
-- O miolo é interno para sup_sep_confirmar poder chamá-lo na separação
-- parcial sem repetir permissão nem procurar a reserva de novo.
--
-- NÃO TOCA EM quantidade_massa. É a mesma filosofia de sup_est_inventario
-- (20260907000003, bloco 2): quem decide o saldo real é a CONTAGEM, não a
-- palavra do separador no calor da separação. Mexer aqui destruiria a
-- prova de que a peça sumiu sem baixa — que é exatamente a investigação
-- que o gerente quer poder fazer depois, com câmera e relatório.

CREATE OR REPLACE FUNCTION public.sup_sep_divergencia_interno(
  p_reserva_id uuid, p_faltante integer, p_motivo text,
  p_uid uuid, p_nome text, p_pedido_id uuid, p_protocolo text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE r record; v_nova uuid;
BEGIN
  SELECT rr.id, rr.tag_id, rr.item_estoque_id, rr.pedido_item_id, rr.empresa_id,
         tg.codigo, tg.tamanho, ei.sup_item_id
    INTO r
    FROM public.sup_estoque_reserva rr
    JOIN public.sup_estoque_tag tg  ON tg.id = rr.tag_id
    JOIN public.sup_estoque_item ei ON ei.id = rr.item_estoque_id
   WHERE rr.id = p_reserva_id;
  IF r.id IS NULL THEN RETURN; END IF;

  INSERT INTO public.sup_estoque_reserva
    (empresa_id, tag_id, item_estoque_id, pedido_id, pedido_item_id, quantidade,
     situacao, motivo, reservado_por, reservado_por_nome, fechado_em, fechado_por, fechado_por_nome)
  VALUES (r.empresa_id, r.tag_id, r.item_estoque_id, p_pedido_id, r.pedido_item_id,
          p_faltante, 'DIVERGENTE', p_motivo, p_uid, p_nome, now(), p_uid, p_nome)
  RETURNING id INTO v_nova;

  INSERT INTO public.sup_estoque_movimento
    (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho,
     pedido_id, pedido_item_id, observacao, usuario_id, usuario_nome)
  VALUES (r.empresa_id, r.item_estoque_id, r.codigo, 'ajuste', p_faltante, r.tamanho,
          p_pedido_id, r.pedido_item_id,
          format('Divergência na separação do pedido %s: %s', p_protocolo, p_motivo),
          p_uid, p_nome);

  INSERT INTO public.sup_estoque_contagem_fila
    (empresa_id, item_estoque_id, sup_item_id, tag_id, codigo, tamanho, origem,
     reserva_id, pedido_id, pedido_item_id, quantidade_faltante, motivo,
     aberta_por, aberta_por_nome)
  VALUES (r.empresa_id, r.item_estoque_id, r.sup_item_id, r.tag_id, r.codigo, r.tamanho,
          'separacao', v_nova, p_pedido_id, r.pedido_item_id, p_faltante, p_motivo,
          p_uid, p_nome);

  INSERT INTO public.sup_pedido_historico
    (pedido_id, acao, observacao, alterado_por, alterado_por_nome)
  VALUES (p_pedido_id, 'DIVERGENCIA',
          format('Lote %s: faltaram %s unidade(s) na doca — %s', r.codigo, p_faltante, p_motivo),
          p_uid, p_nome);
END $fn$;

CREATE OR REPLACE FUNCTION public.sup_sep_divergencia(
  p_reserva_id uuid,
  p_faltante   integer,
  p_motivo     text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text := public.sup_est_nome_usuario();
  r      record;
  v_falta integer;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_separacao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para registrar divergência';
  END IF;
  IF btrim(COALESCE(p_motivo, '')) = '' THEN
    RAISE EXCEPTION 'A divergência exige um motivo: é o que o Estoque vai investigar depois.';
  END IF;

  SELECT rr.id, rr.quantidade, rr.pedido_id, p.pedido_id AS protocolo
    INTO r
    FROM public.sup_estoque_reserva rr
    JOIN public.sup_pedido p ON p.id = rr.pedido_id
   WHERE rr.id = p_reserva_id AND rr.situacao = 'ATIVA'
   FOR UPDATE OF rr;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Reserva não está ativa'; END IF;

  v_falta := LEAST(GREATEST(COALESCE(p_faltante, r.quantidade), 1), r.quantidade);

  IF v_falta >= r.quantidade THEN
    -- Nada foi achado: a reserva inteira vira divergência.
    UPDATE public.sup_estoque_reserva
       SET situacao = 'DIVERGENTE', motivo = p_motivo, fechado_em = now(),
           fechado_por = v_uid, fechado_por_nome = v_nome
     WHERE id = r.id;
    PERFORM public.sup_sep_divergencia_registrar(r.id, v_falta, p_motivo, v_uid, v_nome,
                                                 r.pedido_id, r.protocolo);
  ELSE
    -- Achou parte: o que existe continua reservado e ainda pode ser separado.
    UPDATE public.sup_estoque_reserva
       SET quantidade = quantidade - v_falta
     WHERE id = r.id;
    PERFORM public.sup_sep_divergencia_interno(r.id, v_falta, p_motivo, v_uid, v_nome,
                                               r.pedido_id, r.protocolo);
  END IF;

  v_status := public.sup_sep_recalcular_status(r.pedido_id);
  RETURN jsonb_build_object('faltante', v_falta, 'status', v_status);
END $fn$;

-- Variante para quando a própria reserva já virou DIVERGENTE: não cria
-- linha nova de reserva, só a trilha, a fila e o histórico.
CREATE OR REPLACE FUNCTION public.sup_sep_divergencia_registrar(
  p_reserva_id uuid, p_faltante integer, p_motivo text,
  p_uid uuid, p_nome text, p_pedido_id uuid, p_protocolo text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE r record;
BEGIN
  SELECT rr.id, rr.tag_id, rr.item_estoque_id, rr.pedido_item_id, rr.empresa_id,
         tg.codigo, tg.tamanho, ei.sup_item_id
    INTO r
    FROM public.sup_estoque_reserva rr
    JOIN public.sup_estoque_tag tg  ON tg.id = rr.tag_id
    JOIN public.sup_estoque_item ei ON ei.id = rr.item_estoque_id
   WHERE rr.id = p_reserva_id;
  IF r.id IS NULL THEN RETURN; END IF;

  INSERT INTO public.sup_estoque_movimento
    (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho,
     pedido_id, pedido_item_id, observacao, usuario_id, usuario_nome)
  VALUES (r.empresa_id, r.item_estoque_id, r.codigo, 'ajuste', p_faltante, r.tamanho,
          p_pedido_id, r.pedido_item_id,
          format('Divergência na separação do pedido %s: %s', p_protocolo, p_motivo),
          p_uid, p_nome);

  INSERT INTO public.sup_estoque_contagem_fila
    (empresa_id, item_estoque_id, sup_item_id, tag_id, codigo, tamanho, origem,
     reserva_id, pedido_id, pedido_item_id, quantidade_faltante, motivo,
     aberta_por, aberta_por_nome)
  VALUES (r.empresa_id, r.item_estoque_id, r.sup_item_id, r.tag_id, r.codigo, r.tamanho,
          'separacao', r.id, p_pedido_id, r.pedido_item_id, p_faltante, p_motivo,
          p_uid, p_nome);

  INSERT INTO public.sup_pedido_historico
    (pedido_id, acao, observacao, alterado_por, alterado_por_nome)
  VALUES (p_pedido_id, 'DIVERGENCIA',
          format('Lote %s: faltaram %s unidade(s) na doca — %s', r.codigo, p_faltante, p_motivo),
          p_uid, p_nome);
END $fn$;

-- ── 5. Liberar a reserva ─────────────────────────────────────────────
--
-- Permissão de PEDIDO, não de separação: desfazer o pré-pedido é ato da
-- supervisora. O estoquista registra o que encontrou; quem decide que o
-- pedido volta para a fila é quem o montou.

CREATE OR REPLACE FUNCTION public.sup_sep_liberar(
  p_pedido_id  uuid,
  p_reserva_id uuid DEFAULT NULL,
  p_motivo     text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_nome  text := public.sup_est_nome_usuario();
  v_ped   record;
  v_n     integer := 0;
  v_q     integer := 0;
  r       record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_pedidos_materiais', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para liberar reserva';
  END IF;

  SELECT p.id, p.status, p.pedido_id INTO v_ped
    FROM public.sup_pedido p WHERE p.id = p_pedido_id FOR UPDATE;
  IF v_ped.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;

  FOR r IN
    SELECT rr.id, rr.quantidade, rr.empresa_id, rr.item_estoque_id, rr.pedido_item_id,
           tg.codigo, tg.tamanho
      FROM public.sup_estoque_reserva rr
      JOIN public.sup_estoque_tag tg ON tg.id = rr.tag_id
     WHERE rr.pedido_id = p_pedido_id AND rr.situacao = 'ATIVA'
       AND (p_reserva_id IS NULL OR rr.id = p_reserva_id)
     FOR UPDATE OF rr
  LOOP
    UPDATE public.sup_estoque_reserva
       SET situacao = 'LIBERADA', motivo = COALESCE(p_motivo, motivo), fechado_em = now(),
           fechado_por = v_uid, fechado_por_nome = v_nome
     WHERE id = r.id;

    INSERT INTO public.sup_estoque_movimento
      (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho,
       pedido_id, pedido_item_id, observacao, usuario_id, usuario_nome)
    VALUES (r.empresa_id, r.item_estoque_id, r.codigo, 'liberacao', r.quantidade, r.tamanho,
            p_pedido_id, r.pedido_item_id,
            format('Reserva liberada do pedido %s%s', v_ped.pedido_id,
                   COALESCE(': ' || nullif(btrim(p_motivo), ''), '')),
            v_uid, v_nome);

    v_n := v_n + 1;
    v_q := v_q + r.quantidade;
  END LOOP;

  -- Sem nada reservado, o pedido volta para a fila da supervisora.
  IF v_n > 0
     AND v_ped.status = 'EM SEPARACAO'
     AND NOT EXISTS (SELECT 1 FROM public.sup_estoque_reserva rr
                      WHERE rr.pedido_id = p_pedido_id AND rr.situacao = 'ATIVA') THEN
    UPDATE public.sup_pedido SET status = 'EM PREPARACAO' WHERE id = p_pedido_id;
    INSERT INTO public.sup_pedido_historico
      (pedido_id, acao, status_anterior, status_novo, observacao, alterado_por, alterado_por_nome)
    VALUES (p_pedido_id, 'STATUS', 'EM SEPARACAO', 'EM PREPARACAO',
            format('%s reserva(s) liberada(s)%s', v_n,
                   COALESCE(' — ' || nullif(btrim(p_motivo), ''), '')),
            v_uid, v_nome);
  END IF;

  RETURN jsonb_build_object('liberadas', v_n, 'unidades', v_q);
END $fn$;

-- ── 6. A fila do estoquista ──────────────────────────────────────────
--
-- Existe para o separador NÃO precisar de SELECT em sup_pedido nem em
-- sup_estoque_tag — mesmo motivo pelo qual as sup_ext_* existem: dar a
-- tela de separação não pode implicar dar a fila comercial inteira.
--
-- Paginada desde o dia zero: RETURNS TABLE também respeita o db-max-rows
-- de 1.000 do PostgREST, o corte silencioso do SIS-2026-0201.

CREATE OR REPLACE FUNCTION public.sup_sep_fila(
  p_limite integer DEFAULT 200,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  pedido_id          uuid,
  protocolo          text,
  contrato_nome      text,
  posto_nome         text,
  funcao_nome        text,
  nome_colaborador   text,
  data_solicitacao   date,
  reserva_id         uuid,
  pedido_item_id     uuid,
  nome_item          text,
  item_tamanho       text,
  codigo             text,
  localizacao        text,
  quantidade         integer,
  reservado_em       timestamptz,
  reservado_por_nome text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(auth.uid(), 'sup_separacao', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para ver a fila de separação';
  END IF;

  RETURN QUERY
  SELECT p.id, p.pedido_id, p.contrato_nome, p.posto_nome, p.funcao_nome,
         p.nome_colaborador, p.data_solicitacao,
         rr.id, rr.pedido_item_id, pit.nome_item, pit.tamanho,
         tg.codigo, COALESCE(tg.localizacao, ei.localizacao),
         rr.quantidade, rr.reservado_em, rr.reservado_por_nome
    FROM public.sup_estoque_reserva rr
    JOIN public.sup_pedido p        ON p.id  = rr.pedido_id
    JOIN public.sup_pedido_item pit ON pit.id = rr.pedido_item_id
    JOIN public.sup_estoque_tag tg  ON tg.id = rr.tag_id
    JOIN public.sup_estoque_item ei ON ei.id = rr.item_estoque_id
   WHERE rr.situacao = 'ATIVA' AND p.status = 'EM SEPARACAO'
   ORDER BY p.data_solicitacao, p.pedido_id, pit.ordem NULLS LAST, tg.codigo
   LIMIT GREATEST(COALESCE(p_limite, 200), 1)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END $fn$;

REVOKE ALL ON FUNCTION public.sup_sep_recalcular_status(uuid)                              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_sep_sugerir(uuid)                                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_sep_reservar(uuid, jsonb, text)                          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_sep_confirmar(uuid, jsonb)                               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_sep_divergencia(uuid, integer, text)                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_sep_divergencia_interno(uuid, integer, text, uuid, text, uuid, text)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_sep_divergencia_registrar(uuid, integer, text, uuid, text, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_sep_liberar(uuid, uuid, text)                            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_sep_fila(integer, integer)                               FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.sup_sep_sugerir(uuid)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_sep_reservar(uuid, jsonb, text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_sep_confirmar(uuid, jsonb)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_sep_divergencia(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_sep_liberar(uuid, uuid, text)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_sep_fila(integer, integer)           TO authenticated;

NOTIFY pgrst, 'reload schema';
