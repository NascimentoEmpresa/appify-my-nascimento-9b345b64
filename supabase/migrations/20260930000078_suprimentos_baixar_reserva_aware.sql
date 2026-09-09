-- =====================================================================
-- Suprimentos — escritores cientes da reserva, parte 5 de 5
--
-- Depende de 20260930000074 a ...77.
--
-- As duas RPCs que baixam quantidade_massa passam a enxergar reserva. Sem
-- isto o trigger de invariante (sup_est_tag_guard_saldo_reservado) as
-- interromperia com uma exceção crua no meio do laço, matando a chamada
-- inteira em vez de recusar UM código com motivo legível.
--
-- Ambas são reproduções fiéis da definição vigente no banco, com as
-- edições marcadas por comentário. Nada mais foi tocado.
--
-- O QUE NÃO PRECISOU MUDAR, e por quê:
--
--   * sup_est_remover_tag — o trigger sup_est_tag_guard_reserva (parte 1)
--     já recusa apagar lote com reserva viva, com mensagem melhor do que
--     uma checagem dentro da RPC daria, e cobre também o SQL Editor.
--
--   * sup_pedido_editar — remover um item com reserva ativa NÃO corrompe
--     nada: o CASCADE apaga a reserva e o trigger
--     sup_reserva_liberacao_no_delete (parte 1) grava o movimento de
--     'liberacao', devolvendo o saldo com trilha. Bloquear a remoção
--     mudaria um comportamento que já está correto e auditado, então
--     ficou como está — decisão consciente, não esquecimento.
--
-- ROLLBACK: recriar as duas funções a partir de
--   20260930000058_correio_envio_e_rastreio.sql:44  (sup_est_baixar)
--   20260930000018_codigo_do_item_e_entrada_por_quantidade.sql:333
--                                                  (sup_est_baixar_quantidade)
-- =====================================================================

-- ── 1. sup_est_baixar ────────────────────────────────────────────────
-- Três edições: recusa pedido EM SEPARACAO; etiqueta única reservada para
-- outro pedido é rejeitada; e o limite da massa passa a ser o físico
-- MENOS o reservado para outros itens de pedido.

CREATE OR REPLACE FUNCTION public.sup_est_baixar(p_pedido_id uuid, p_status text, p_observacao text, p_baixas jsonb, p_envio jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid       uuid := auth.uid();
  v_nome      text := public.sup_est_nome_usuario();
  v_ped       record;
  b           jsonb;
  v_ok        int := 0;
  v_tent      int := 0;
  v_rej       jsonb := '[]'::jsonb;
  t           record;
  v_pi        record;
  v_existente int;
  v_delta     int;
  v_desejada  int;
  v_novo      int;
  v_mudou_st  boolean;
  v_tipo_envio text := upper(nullif(btrim(p_envio->>'tipo'), ''));
  v_rastreio   text := nullif(btrim(p_envio->>'rastreio'), '');
  v_mudou_envio boolean;
  v_res_outros int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_pedidos_materiais', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para atualizar pedidos';
  END IF;

  SELECT * INTO v_ped FROM public.sup_pedido p WHERE p.id = p_pedido_id FOR UPDATE;
  IF v_ped.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;

  -- Pedido EM SEPARACAO sai pelas RPCs sup_sep_*, não por aqui.
  --
  -- O motivo é real, não estético: esta função grava sup_estoque_consumo
  -- com o total ABSOLUTO (SET quantidade = excluded.quantidade), enquanto
  -- sup_sep_confirmar grava ADITIVO. Os dois caminhos sobre a mesma chave
  -- (codigo, pedido_item_id) se sobrescrevem em silêncio e corrompem o
  -- ledger. O modal antigo volta a valer quando o pedido chega em
  -- AGUARDANDO ENVIO.
  IF v_ped.status = 'EM SEPARACAO' THEN
    RAISE EXCEPTION 'Pedido % está em separação. Confirme ou libere a separação antes de baixar por aqui.',
      v_ped.pedido_id;
  END IF;

  -- A guarda precisa estar no banco: despacho também pode acontecer por
  -- script ou SQL Editor, e a tela não é uma fronteira de integridade.
  IF p_status = 'DESPACHADO' THEN
    IF v_tipo_envio IS NULL OR v_tipo_envio NOT IN ('SUPERVISOR', 'CORREIO') THEN
      RAISE EXCEPTION 'Informe o tipo de envio para despachar o pedido';
    END IF;
    IF v_tipo_envio = 'CORREIO' AND v_rastreio IS NULL THEN
      RAISE EXCEPTION 'Informe o ID de rastreio dos Correios';
    END IF;
  END IF;

  FOR b IN SELECT * FROM jsonb_array_elements(COALESCE(p_baixas, '[]'::jsonb)) LOOP
    v_tent := v_tent + 1;

    SELECT pi.id, pi.item_id, pi.nome_item INTO v_pi
      FROM public.sup_pedido_item pi
     WHERE pi.id = (b->>'pedido_item_id')::uuid AND pi.pedido_id = p_pedido_id;
    IF v_pi.id IS NULL THEN
      v_rej := v_rej || jsonb_build_object('codigo', b->>'codigo',
                 'motivo', 'Item não pertence a este pedido');
      CONTINUE;
    END IF;

    SELECT tg.*, ei.sup_item_id, ei.id AS ei_id, ei.empresa_id, i.nome AS material
      INTO t
      FROM public.sup_estoque_tag tg
      JOIN public.sup_estoque_item ei ON ei.id = tg.item_estoque_id
      JOIN public.sup_item i ON i.id = ei.sup_item_id
     WHERE tg.codigo = upper(trim(b->>'codigo'))
     FOR UPDATE OF tg;

    IF t.id IS NULL THEN
      v_rej := v_rej || jsonb_build_object('codigo', b->>'codigo',
                 'motivo', 'Não existe no estoque');
      CONTINUE;
    END IF;

    IF t.sup_item_id <> v_pi.item_id THEN
      v_rej := v_rej || jsonb_build_object('codigo', t.codigo,
                 'motivo', format('Etiqueta é de "%s", e o pedido é de "%s"', t.material, v_pi.nome_item));
      CONTINUE;
    END IF;

    IF t.tipo = 'unico' THEN
      IF t.usado AND t.pedido_id IS DISTINCT FROM p_pedido_id THEN
        v_rej := v_rej || jsonb_build_object('codigo', t.codigo,
                   'motivo', format('Já utilizada no pedido %s',
                     COALESCE((SELECT p2.pedido_id FROM public.sup_pedido p2 WHERE p2.id = t.pedido_id), '—')));
        CONTINUE;
      END IF;

      IF EXISTS (SELECT 1 FROM public.sup_estoque_reserva rr
                  WHERE rr.tag_id = t.id AND rr.situacao = 'ATIVA'
                    AND rr.pedido_item_id <> v_pi.id) THEN
        v_rej := v_rej || jsonb_build_object('codigo', t.codigo,
                   'motivo', 'Peça reservada para outro pedido em separação');
        CONTINUE;
      END IF;

      UPDATE public.sup_estoque_tag tg
         SET usado = true, pedido_id = p_pedido_id, pedido_item_id = v_pi.id,
             usado_em = now(), usado_por = v_uid, usado_por_nome = v_nome
       WHERE tg.id = t.id;

      INSERT INTO public.sup_estoque_movimento
        (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho,
         pedido_id, pedido_item_id, usuario_id, usuario_nome)
      VALUES (t.empresa_id, t.ei_id, t.codigo, 'saida', 1, t.tamanho,
              p_pedido_id, v_pi.id, v_uid, v_nome);
      v_ok := v_ok + 1;
    ELSE
      v_desejada := GREATEST(COALESCE((b->>'quantidade')::int, 1), 0);

      SELECT COALESCE(cs.quantidade, 0) INTO v_existente
        FROM public.sup_estoque_consumo cs
       WHERE cs.codigo = t.codigo AND cs.pedido_item_id = v_pi.id;
      v_existente := COALESCE(v_existente, 0);
      v_delta := v_desejada - v_existente;

      IF v_delta = 0 THEN CONTINUE; END IF;

      IF v_delta > 0 AND COALESCE(t.quantidade_massa, 0) <= 0 THEN
        v_rej := v_rej || jsonb_build_object('codigo', t.codigo, 'motivo', 'Etiqueta esgotada');
        CONTINUE;
      END IF;
      -- Consulta SEPARADA e já sob o lock da etiqueta: subquery de outra
      -- tabela dentro do WHERE que trava não é reavaliada pelo EvalPlanQual.
      SELECT COALESCE(SUM(rr.quantidade), 0) INTO v_res_outros
        FROM public.sup_estoque_reserva rr
       WHERE rr.tag_id = t.id AND rr.situacao = 'ATIVA'
         AND rr.pedido_item_id <> v_pi.id;

      IF v_delta > COALESCE(t.quantidade_massa, 0) - v_res_outros THEN
        v_rej := v_rej || jsonb_build_object('codigo', t.codigo,
                   'motivo', CASE WHEN v_res_outros > 0
                     THEN format('Quantidade adicional (%s) maior que a livre (%s): %s unidade(s) reservada(s) para outro pedido em separação',
                                 v_delta, COALESCE(t.quantidade_massa, 0) - v_res_outros, v_res_outros)
                     ELSE format('Quantidade adicional (%s) maior que a disponível (%s)',
                                 v_delta, COALESCE(t.quantidade_massa, 0)) END);
        CONTINUE;
      END IF;

      v_novo := COALESCE(t.quantidade_massa, 0) - v_delta;
      UPDATE public.sup_estoque_tag tg
         SET quantidade_massa = GREATEST(v_novo, 0),
             usado = (v_novo <= 0),
             pedido_id = CASE WHEN v_novo <= 0 THEN p_pedido_id ELSE tg.pedido_id END,
             pedido_item_id = CASE WHEN v_novo <= 0 THEN v_pi.id ELSE tg.pedido_item_id END,
             usado_em = CASE WHEN v_novo <= 0 THEN now() ELSE tg.usado_em END,
             usado_por = CASE WHEN v_novo <= 0 THEN v_uid ELSE tg.usado_por END,
             usado_por_nome = CASE WHEN v_novo <= 0 THEN v_nome ELSE tg.usado_por_nome END
       WHERE tg.id = t.id;

      IF v_desejada = 0 THEN
        DELETE FROM public.sup_estoque_consumo cs
         WHERE cs.codigo = t.codigo AND cs.pedido_item_id = v_pi.id;
      ELSE
        INSERT INTO public.sup_estoque_consumo
          (codigo, item_estoque_id, pedido_id, pedido_item_id, quantidade,
           consumido_por, consumido_por_nome)
        VALUES (t.codigo, t.ei_id, p_pedido_id, v_pi.id, v_desejada, v_uid, v_nome)
        ON CONFLICT (codigo, pedido_item_id) DO UPDATE
          SET quantidade = excluded.quantidade, consumido_em = now(),
              consumido_por = excluded.consumido_por,
              consumido_por_nome = excluded.consumido_por_nome;
      END IF;

      INSERT INTO public.sup_estoque_movimento
        (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho,
         pedido_id, pedido_item_id, usuario_id, usuario_nome, observacao)
      VALUES (t.empresa_id, t.ei_id, t.codigo,
              CASE WHEN v_delta > 0 THEN 'saida' ELSE 'devolucao' END,
              abs(v_delta), t.tamanho, p_pedido_id, v_pi.id, v_uid, v_nome,
              format('Ajuste de %s para %s', v_existente, v_desejada));
      v_ok := v_ok + 1;
    END IF;
  END LOOP;

  IF v_tent > 0 AND v_ok = 0 AND jsonb_array_length(v_rej) > 0 THEN
    RAISE EXCEPTION 'Nenhuma etiqueta pôde ser baixada: %',
      (SELECT string_agg(x->>'motivo', '; ') FROM jsonb_array_elements(v_rej) x);
  END IF;

  v_mudou_st := p_status IS NOT NULL AND p_status <> v_ped.status;
  v_mudou_envio := p_envio IS NOT NULL AND (
    v_tipo_envio IS DISTINCT FROM v_ped.envio_tipo
    OR v_rastreio IS DISTINCT FROM v_ped.envio_rastreio
  );

  IF v_mudou_st
     OR COALESCE(p_observacao, '') IS DISTINCT FROM COALESCE(v_ped.observacao, '')
     OR v_mudou_envio THEN
    UPDATE public.sup_pedido p
       SET status = COALESCE(p_status, p.status),
           observacao = nullif(p_observacao, ''),
           envio_tipo = CASE WHEN p_envio IS NULL THEN p.envio_tipo ELSE v_tipo_envio END,
           envio_rastreio = CASE WHEN p_envio IS NULL THEN p.envio_rastreio ELSE v_rastreio END
     WHERE p.id = p_pedido_id;

    INSERT INTO public.sup_pedido_historico
      (pedido_id, acao, status_anterior, status_novo, observacao, alterado_por, alterado_por_nome)
    VALUES (p_pedido_id,
            CASE WHEN NOT v_mudou_st THEN 'EDITADO'
                 WHEN p_status = 'CANCELADO' THEN 'CANCELADO' ELSE 'STATUS' END,
            CASE WHEN v_mudou_st THEN v_ped.status END,
            COALESCE(p_status, v_ped.status), nullif(p_observacao, ''), v_uid, v_nome);
  ELSIF v_ok > 0 THEN
    INSERT INTO public.sup_pedido_historico
      (pedido_id, acao, status_novo, observacao, alterado_por, alterado_por_nome)
    VALUES (p_pedido_id, 'EDITADO', v_ped.status,
            format('%s etiqueta(s) baixada(s) do estoque', v_ok), v_uid, v_nome);
  END IF;

  RETURN jsonb_build_object('baixadas', v_ok, 'rejeitadas', v_rej);
END $fn$;

-- ── 2. sup_est_baixar_quantidade ─────────────────────────────────────
-- Sem consumidor no front hoje, mas é o terceiro escritor de
-- quantidade_massa e escolhe lote sozinha. Uma edição: o que cada lote
-- oferece passa a ser o físico menos o reservado.

CREATE OR REPLACE FUNCTION public.sup_est_baixar_quantidade(p_pedido_id uuid, p_pedido_item_id uuid, p_quantidade integer, p_observacao text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_nome   text := public.sup_est_nome_usuario();
  v_pi     record;
  v_falta  int  := GREATEST(COALESCE(p_quantidade, 0), 0);
  v_tirar  int;
  v_livre  int;
  v_resta  int;
  v_lotes  jsonb := '[]'::jsonb;
  t        record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_pedidos_materiais', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para atualizar pedidos';
  END IF;
  IF v_falta <= 0 THEN RAISE EXCEPTION 'Informe uma quantidade maior que zero'; END IF;

  SELECT pi.id, pi.item_id, pi.nome_item, pi.tamanho INTO v_pi
    FROM public.sup_pedido_item pi
   WHERE pi.id = p_pedido_item_id AND pi.pedido_id = p_pedido_id;
  IF v_pi.id IS NULL THEN RAISE EXCEPTION 'Item não pertence a este pedido'; END IF;

  FOR t IN
    SELECT tg.id, tg.codigo, tg.quantidade_massa, tg.tamanho,
           ei.id AS ei_id, ei.empresa_id
      FROM public.sup_estoque_tag tg
      JOIN public.sup_estoque_item ei ON ei.id = tg.item_estoque_id
     WHERE ei.sup_item_id = v_pi.item_id
       AND tg.tipo = 'massa'
       AND NOT tg.usado
       AND COALESCE(tg.quantidade_massa, 0) > 0
       AND (v_pi.tamanho IS NULL OR tg.tamanho IS NOT DISTINCT FROM v_pi.tamanho)
     ORDER BY tg.ca_validade NULLS LAST, tg.created_at
     FOR UPDATE OF tg
  LOOP
    EXIT WHEN v_falta <= 0;
    -- Consulta separada e já sob o FOR UPDATE do lote: o reservado nunca
    -- entra no WHERE que trava, porque o EvalPlanQual não reavalia
    -- subquery de outra tabela.
    SELECT COALESCE(t.quantidade_massa, 0)
           - COALESCE((SELECT SUM(rr.quantidade) FROM public.sup_estoque_reserva rr
                        WHERE rr.tag_id = t.id AND rr.situacao = 'ATIVA'), 0)
      INTO v_livre;
    CONTINUE WHEN v_livre <= 0;

    v_tirar := LEAST(v_falta, v_livre);
    v_resta := t.quantidade_massa - v_tirar;

    UPDATE public.sup_estoque_tag tg
       SET quantidade_massa = v_resta,
           usado            = (v_resta <= 0),
           pedido_id        = CASE WHEN v_resta <= 0 THEN p_pedido_id ELSE tg.pedido_id END,
           pedido_item_id   = CASE WHEN v_resta <= 0 THEN v_pi.id     ELSE tg.pedido_item_id END,
           usado_em         = CASE WHEN v_resta <= 0 THEN now()       ELSE tg.usado_em END,
           usado_por        = CASE WHEN v_resta <= 0 THEN v_uid       ELSE tg.usado_por END,
           usado_por_nome   = CASE WHEN v_resta <= 0 THEN v_nome      ELSE tg.usado_por_nome END
     WHERE tg.id = t.id;

    -- O ledger guarda o TOTAL por (lote, item do pedido), não o delta.
    INSERT INTO public.sup_estoque_consumo
      (codigo, item_estoque_id, pedido_id, pedido_item_id, quantidade,
       consumido_por, consumido_por_nome)
    VALUES (t.codigo, t.ei_id, p_pedido_id, v_pi.id, v_tirar, v_uid, v_nome)
    ON CONFLICT (codigo, pedido_item_id) DO UPDATE
      SET quantidade         = public.sup_estoque_consumo.quantidade + excluded.quantidade,
          consumido_em       = now(),
          consumido_por      = excluded.consumido_por,
          consumido_por_nome = excluded.consumido_por_nome;

    INSERT INTO public.sup_estoque_movimento
      (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho,
       pedido_id, pedido_item_id, usuario_id, usuario_nome, observacao)
    VALUES (t.empresa_id, t.ei_id, t.codigo, 'saida', v_tirar, t.tamanho,
            p_pedido_id, v_pi.id, v_uid, v_nome, p_observacao);

    v_lotes := v_lotes || jsonb_build_object('lote', t.codigo, 'quantidade', v_tirar);
    v_falta := v_falta - v_tirar;
  END LOOP;

  IF v_falta > 0 THEN
    -- Sem saldo: desfaz tudo. Baixa pela metade seria pior que recusar.
    RAISE EXCEPTION 'Saldo insuficiente de "%": faltam % unidade(s)', v_pi.nome_item, v_falta;
  END IF;

  RETURN jsonb_build_object('baixado', p_quantidade, 'lotes', v_lotes);
END $fn$;

REVOKE ALL ON FUNCTION public.sup_est_baixar(uuid, text, text, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_est_baixar_quantidade(uuid, uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_est_baixar(uuid, text, text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_est_baixar_quantidade(uuid, uuid, integer, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
