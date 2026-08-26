-- =====================================================================
-- SIS-2026-0207 — correções da revisão e preço por item do pedido
--
-- ROLLBACK (restaura somente os objetos acrescentados nesta revisão):
--   DROP FUNCTION IF EXISTS public.sup_compra_atualizar_valor_item(uuid, numeric);
--   DROP FUNCTION IF EXISTS public.sup_receb_usuario_participa(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.sup_est_entrada_executar(jsonb);
--   DROP INDEX IF EXISTS public.uq_sup_compra_pedido_despesa_ativo;
--   ALTER TABLE public.sup_compra_pedido_item
--     DROP COLUMN IF EXISTS codigo_fornecedor,
--     DROP COLUMN IF EXISTS preco_referencia_valor,
--     DROP COLUMN IF EXISTS preco_referencia_em,
--     DROP COLUMN IF EXISTS preco_referencia_fornecedor_nome,
--     DROP COLUMN IF EXISTS preco_referencia_valido_ate;
--
-- Migration append-only: as migrations 00002–00004 permanecem intactas.
-- Não há filtro pelos vínculos de empresa do usuário: empresa só aparece onde é parte da
-- integridade do próprio documento/item.
-- =====================================================================

-- ── 1) Pedido: referência do último preço e regeração após cancelamento ──
ALTER TABLE public.sup_compra_pedido_item
  ADD COLUMN IF NOT EXISTS codigo_fornecedor text,
  ADD COLUMN IF NOT EXISTS preco_referencia_valor numeric(14,2),
  ADD COLUMN IF NOT EXISTS preco_referencia_em timestamptz,
  ADD COLUMN IF NOT EXISTS preco_referencia_fornecedor_nome text,
  ADD COLUMN IF NOT EXISTS preco_referencia_valido_ate date;

COMMENT ON COLUMN public.sup_compra_pedido_item.codigo_fornecedor IS
  'Referência do material no catálogo do fornecedor do pedido; snapshot usado no PDF.';
COMMENT ON COLUMN public.sup_compra_pedido_item.preco_referencia_valor IS
  'Último preço pago sugerido na geração do pedido, preservado mesmo após edição.';

-- Pedidos em rascunho criados pela rodada anterior também recebem a sugestão.
-- Valor já informado é preservado; apenas linha nula é preenchida.
WITH referencias AS (
  SELECT pi.id,
         preco.valor_unitario,
         preco.registrado_em,
         preco.fornecedor_nome,
         preco.valido_ate,
         ref.codigo_fornecedor
    FROM public.sup_compra_pedido_item pi
    JOIN public.sup_compra_pedido p ON p.id = pi.pedido_id
    LEFT JOIN LATERAL (
      SELECT h.valor_unitario, h.registrado_em, h.fornecedor_nome, h.valido_ate
        FROM public.sup_item_preco h
       WHERE h.sup_item_id = pi.sup_item_id
         AND h.empresa_id = p.empresa_id
       ORDER BY h.registrado_em DESC, h.id DESC
       LIMIT 1
    ) preco ON true
    LEFT JOIN LATERAL (
      SELECT fi.codigo_fornecedor
        FROM public.sup_fornecedor_item fi
       WHERE fi.fornecedor_id = p.fornecedor_id
         AND fi.sup_item_id = pi.sup_item_id
       LIMIT 1
    ) ref ON true
   WHERE p.status = 'rascunho'
)
UPDATE public.sup_compra_pedido_item pi
   SET valor_unitario = COALESCE(pi.valor_unitario, r.valor_unitario),
       codigo_fornecedor = COALESCE(pi.codigo_fornecedor, r.codigo_fornecedor),
       preco_referencia_valor = r.valor_unitario,
       preco_referencia_em = r.registrado_em,
       preco_referencia_fornecedor_nome = r.fornecedor_nome,
       preco_referencia_valido_ate = r.valido_ate
  FROM referencias r
 WHERE r.id = pi.id;

UPDATE public.sup_compra_pedido p
   SET valor_total = COALESCE((
     SELECT round(sum(pi.quantidade * COALESCE(pi.valor_unitario, 0)), 2)
       FROM public.sup_compra_pedido_item pi WHERE pi.pedido_id = p.id
   ), 0)
 WHERE p.status = 'rascunho';

-- A restrição original impedia uma nova tentativa mesmo quando o pedido
-- anterior havia sido cancelado. Mantemos unicidade somente entre pedidos ativos.
ALTER TABLE public.sup_compra_pedido
  DROP CONSTRAINT IF EXISTS sup_compra_pedido_despesa_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sup_compra_pedido_despesa_ativo
  ON public.sup_compra_pedido(despesa_id)
  WHERE status <> 'cancelado';

DROP POLICY IF EXISTS sup_compra_pedido_select ON public.sup_compra_pedido;
CREATE POLICY sup_compra_pedido_select ON public.sup_compra_pedido
  FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_cotacoes_malote', 'visualizar')
    OR public.can_access(auth.uid(), 'sup_compra_pedido', 'visualizar')
    OR public.can_access(auth.uid(), 'malote_pagamento', 'aprovar')
    OR created_by = auth.uid()
  );

DROP POLICY IF EXISTS sup_compra_pedido_item_select ON public.sup_compra_pedido_item;
CREATE POLICY sup_compra_pedido_item_select ON public.sup_compra_pedido_item
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
      FROM public.sup_compra_pedido p
     WHERE p.id = sup_compra_pedido_item.pedido_id
       AND (
         public.can_access(auth.uid(), 'sup_cotacoes_malote', 'visualizar')
         OR public.can_access(auth.uid(), 'sup_compra_pedido', 'visualizar')
         OR public.can_access(auth.uid(), 'malote_pagamento', 'aprovar')
         OR p.created_by = auth.uid()
       )
  ));

CREATE OR REPLACE FUNCTION public.sup_compra_gerar_pedido(p_despesa_id uuid)
RETURNS public.sup_compra_pedido
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid             uuid := auth.uid();
  v_despesa         public.malote_despesa;
  v_pedido          public.sup_compra_pedido;
  v_fornecedor_id   uuid;
  v_fornecedor_nome text;
  v_prazo_data      date;
  v_prazo_dias      integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF NOT (
    public.can_access(v_uid, 'sup_cotacoes_malote', 'alterar')
    OR public.can_access(v_uid, 'sup_compra_pedido', 'alterar')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para gerar pedido de compra';
  END IF;

  SELECT d.* INTO v_despesa
    FROM public.malote_despesa d
   WHERE d.id = p_despesa_id
   FOR UPDATE;

  IF v_despesa.id IS NULL THEN
    RAISE EXCEPTION 'Solicitação não encontrada';
  END IF;
  IF v_despesa.status <> 'cotacao_aprovada' THEN
    RAISE EXCEPTION 'A solicitação precisa estar com a cotação aprovada (status atual: %)', v_despesa.status;
  END IF;
  IF v_despesa.cotacao_vencedor_num IS NULL
     OR v_despesa.cotacao_vencedor_num NOT IN (1, 2, 3) THEN
    RAISE EXCEPTION 'Cotação vencedora não informada';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.sup_compra_pedido p
     WHERE p.despesa_id = p_despesa_id AND p.status <> 'cancelado'
  ) THEN
    RAISE EXCEPTION 'Já existe pedido de compra ativo para esta solicitação';
  END IF;

  v_fornecedor_id := CASE v_despesa.cotacao_vencedor_num
    WHEN 1 THEN v_despesa.cot1_fornecedor_id
    WHEN 2 THEN v_despesa.cot2_fornecedor_id
    WHEN 3 THEN v_despesa.cot3_fornecedor_id
  END;
  v_fornecedor_nome := CASE v_despesa.cotacao_vencedor_num
    WHEN 1 THEN v_despesa.cot1_fornecedor
    WHEN 2 THEN v_despesa.cot2_fornecedor
    WHEN 3 THEN v_despesa.cot3_fornecedor
  END;
  v_prazo_data := CASE v_despesa.cotacao_vencedor_num
    WHEN 1 THEN v_despesa.cot1_prazo
    WHEN 2 THEN v_despesa.cot2_prazo
    WHEN 3 THEN v_despesa.cot3_prazo
  END;
  v_prazo_dias := CASE WHEN v_prazo_data IS NULL THEN NULL
                       ELSE GREATEST(v_prazo_data - CURRENT_DATE, 0) END;

  INSERT INTO public.sup_compra_pedido (
    numero, despesa_id, fornecedor_id, fornecedor_nome, contrato_id, empresa_id,
    valor_total, prazo_entrega_dias, data_limite_entrega,
    forma_pagamento, condicoes_negociadas, created_by
  ) VALUES (
    NULL, v_despesa.id, v_fornecedor_id, v_fornecedor_nome,
    v_despesa.contrato_id, v_despesa.empresa_id, 0,
    v_prazo_dias,
    CASE WHEN v_prazo_dias IS NULL THEN NULL ELSE CURRENT_DATE + v_prazo_dias END,
    v_despesa.forma_pagamento, v_despesa.informacoes_pagamento, v_uid
  ) RETURNING * INTO v_pedido;

  INSERT INTO public.sup_compra_pedido_item (
    pedido_id, malote_item_id, sup_item_id, nome_item, quantidade,
    unidade, tamanho, valor_unitario, observacao, ordem,
    codigo_fornecedor, preco_referencia_valor, preco_referencia_em,
    preco_referencia_fornecedor_nome, preco_referencia_valido_ate
  )
  SELECT v_pedido.id, i.id, i.sup_item_id, i.nome_item, i.quantidade,
         i.unidade, i.tamanho, preco.valor_unitario, i.observacao, i.ordem,
         ref.codigo_fornecedor, preco.valor_unitario, preco.registrado_em,
         preco.fornecedor_nome, preco.valido_ate
    FROM public.malote_despesa_item i
    LEFT JOIN LATERAL (
      SELECT p.valor_unitario, p.registrado_em, p.fornecedor_nome, p.valido_ate
        FROM public.sup_item_preco p
       WHERE p.sup_item_id = i.sup_item_id
         AND p.empresa_id = v_despesa.empresa_id
       ORDER BY p.registrado_em DESC, p.id DESC
       LIMIT 1
    ) preco ON true
    LEFT JOIN LATERAL (
      SELECT fi.codigo_fornecedor
        FROM public.sup_fornecedor_item fi
       WHERE fi.fornecedor_id = v_fornecedor_id
         AND fi.sup_item_id = i.sup_item_id
       LIMIT 1
    ) ref ON true
   WHERE i.despesa_id = p_despesa_id
   ORDER BY i.ordem, i.created_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A solicitação não possui itens para gerar o pedido';
  END IF;

  UPDATE public.sup_compra_pedido p
     SET valor_total = COALESCE((
       SELECT round(sum(pi.quantidade * COALESCE(pi.valor_unitario, 0)), 2)
         FROM public.sup_compra_pedido_item pi
        WHERE pi.pedido_id = v_pedido.id
     ), 0)
   WHERE p.id = v_pedido.id
  RETURNING * INTO v_pedido;

  RETURN v_pedido;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Já existe pedido de compra ativo para esta solicitação';
END $$;

CREATE OR REPLACE FUNCTION public.sup_compra_atualizar_pedido(p_id uuid, p_dados jsonb)
RETURNS public.sup_compra_pedido
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_pedido public.sup_compra_pedido;
BEGIN
  IF NOT (
    public.can_access(auth.uid(), 'sup_cotacoes_malote', 'alterar')
    OR public.can_access(auth.uid(), 'sup_compra_pedido', 'alterar')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para alterar pedido de compra';
  END IF;

  SELECT p.* INTO v_pedido FROM public.sup_compra_pedido p WHERE p.id = p_id FOR UPDATE;
  IF v_pedido.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;
  IF v_pedido.status <> 'rascunho' THEN
    RAISE EXCEPTION 'Somente pedidos em rascunho podem ser alterados';
  END IF;

  UPDATE public.sup_compra_pedido p SET
    local_entrega        = CASE WHEN p_dados ? 'local_entrega' THEN nullif(btrim(p_dados->>'local_entrega'), '') ELSE p.local_entrega END,
    forma_pagamento      = CASE WHEN p_dados ? 'forma_pagamento' THEN nullif(btrim(p_dados->>'forma_pagamento'), '') ELSE p.forma_pagamento END,
    condicoes_negociadas = CASE WHEN p_dados ? 'condicoes_negociadas' THEN nullif(btrim(p_dados->>'condicoes_negociadas'), '') ELSE p.condicoes_negociadas END,
    frete_incluso        = CASE WHEN p_dados ? 'frete_incluso' THEN (p_dados->>'frete_incluso')::boolean ELSE p.frete_incluso END,
    observacoes          = CASE WHEN p_dados ? 'observacoes' THEN nullif(btrim(p_dados->>'observacoes'), '') ELSE p.observacoes END
  WHERE p.id = p_id
  RETURNING * INTO v_pedido;

  RETURN v_pedido;
END $$;

CREATE OR REPLACE FUNCTION public.sup_compra_atualizar_valor_item(
  p_item_id uuid, p_valor numeric
) RETURNS public.sup_compra_pedido_item
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_item public.sup_compra_pedido_item;
  v_pedido public.sup_compra_pedido;
BEGIN
  IF NOT (
    public.can_access(auth.uid(), 'sup_cotacoes_malote', 'alterar')
    OR public.can_access(auth.uid(), 'sup_compra_pedido', 'alterar')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para alterar valores do pedido de compra';
  END IF;
  IF p_valor IS NOT NULL AND p_valor < 0 THEN
    RAISE EXCEPTION 'O valor unitário não pode ser negativo';
  END IF;

  SELECT p.* INTO v_pedido
    FROM public.sup_compra_pedido_item pi
    JOIN public.sup_compra_pedido p ON p.id = pi.pedido_id
   WHERE pi.id = p_item_id
   FOR UPDATE OF p;
  IF v_pedido.id IS NULL THEN RAISE EXCEPTION 'Item do pedido não encontrado'; END IF;
  IF v_pedido.status <> 'rascunho' THEN
    RAISE EXCEPTION 'Os valores só podem ser alterados enquanto o pedido estiver em rascunho';
  END IF;

  UPDATE public.sup_compra_pedido_item pi
     SET valor_unitario = CASE WHEN p_valor IS NULL THEN NULL ELSE round(p_valor, 2) END
   WHERE pi.id = p_item_id
  RETURNING * INTO v_item;

  UPDATE public.sup_compra_pedido p
     SET valor_total = COALESCE((
       SELECT round(sum(pi.quantidade * COALESCE(pi.valor_unitario, 0)), 2)
         FROM public.sup_compra_pedido_item pi
        WHERE pi.pedido_id = v_pedido.id
     ), 0)
   WHERE p.id = v_pedido.id;

  RETURN v_item;
END $$;

CREATE OR REPLACE FUNCTION public.sup_compra_enviar_pedido(p_id uuid)
RETURNS public.sup_compra_pedido
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_pedido public.sup_compra_pedido;
  v_nome text;
BEGIN
  IF NOT (
    public.can_access(auth.uid(), 'sup_cotacoes_malote', 'alterar')
    OR public.can_access(auth.uid(), 'sup_compra_pedido', 'alterar')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para enviar pedido de compra';
  END IF;

  SELECT p.* INTO v_pedido FROM public.sup_compra_pedido p WHERE p.id = p_id FOR UPDATE;
  IF v_pedido.id IS NULL OR v_pedido.status <> 'rascunho' THEN
    RAISE EXCEPTION 'Pedido não encontrado ou não está em rascunho';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.sup_compra_pedido_item pi
     WHERE pi.pedido_id = p_id AND pi.valor_unitario IS NULL
  ) THEN
    RAISE EXCEPTION 'Informe o valor unitário de todos os itens antes de enviar o pedido';
  END IF;

  UPDATE public.sup_compra_pedido p
     SET valor_total = COALESCE((
           SELECT round(sum(pi.quantidade * COALESCE(pi.valor_unitario, 0)), 2)
             FROM public.sup_compra_pedido_item pi WHERE pi.pedido_id = p_id
         ), 0),
         status = 'enviado', enviado_em = now(), enviado_por = auth.uid(),
         enviado_por_nome = (SELECT pr.display_name FROM public.profiles pr WHERE pr.id = auth.uid())
   WHERE p.id = p_id
  RETURNING * INTO v_pedido;

  RETURN v_pedido;
END $$;

CREATE OR REPLACE FUNCTION public.sup_compra_cancelar_pedido(p_id uuid, p_motivo text)
RETURNS public.sup_compra_pedido
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_pedido public.sup_compra_pedido;
BEGIN
  IF NOT (
    public.can_access(auth.uid(), 'sup_cotacoes_malote', 'alterar')
    OR public.can_access(auth.uid(), 'sup_compra_pedido', 'alterar')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para cancelar pedido de compra';
  END IF;
  IF nullif(btrim(p_motivo), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento';
  END IF;

  UPDATE public.sup_compra_pedido p
     SET status = 'cancelado',
         observacoes = concat_ws(E'\n', nullif(p.observacoes, ''), 'Cancelamento: ' || btrim(p_motivo))
   WHERE p.id = p_id AND p.status NOT IN ('recebido', 'cancelado')
  RETURNING * INTO v_pedido;

  IF v_pedido.id IS NULL THEN
    RAISE EXCEPTION 'Pedido não encontrado ou não pode mais ser cancelado';
  END IF;
  RETURN v_pedido;
END $$;

REVOKE ALL ON FUNCTION public.sup_compra_gerar_pedido(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_compra_atualizar_pedido(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_compra_atualizar_valor_item(uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_compra_enviar_pedido(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_compra_cancelar_pedido(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_compra_gerar_pedido(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_compra_atualizar_pedido(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_compra_atualizar_valor_item(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_compra_enviar_pedido(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_compra_cancelar_pedido(uuid, text) TO authenticated;

-- ── 2) Estoque: núcleo interno reutilizado pela NF sem reexigir menu ─────
-- A função interna não é executável por clientes. A entrada normal continua
-- passando pela wrapper sup_est_entrada, que conserva seu gate original.
CREATE OR REPLACE FUNCTION public.sup_est_entrada_executar(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_nome    text := public.sup_est_nome_usuario();
  v_almox   uuid := (p_payload->>'almoxarifado_id')::uuid;
  v_mat     uuid := (p_payload->>'sup_item_id')::uuid;
  v_forn    uuid := nullif(p_payload->>'fornecedor_id', '')::uuid;
  v_empresa uuid;
  v_item    uuid;
  v_seq     int;
  v_criadas int := 0;
  v_rej     jsonb := '[]'::jsonb;
  u         jsonb;
  cod       text;
  v_tipo    text;
  v_qtd     int;
  v_tam     text;
  v_valor   numeric;
  r_exist   record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  SELECT a.empresa_id INTO v_empresa FROM public.almoxarifado a WHERE a.id = v_almox;
  IF v_empresa IS NULL THEN RAISE EXCEPTION 'Almoxarifado não encontrado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sup_item i WHERE i.id = v_mat AND i.empresa_id = v_empresa) THEN
    RAISE EXCEPTION 'Material não pertence à empresa deste almoxarifado';
  END IF;

  INSERT INTO public.sup_estoque_item
    (empresa_id, almoxarifado_id, sup_item_id, valor_unitario, estoque_minimo,
     fornecedor, fornecedor_id, validade)
  VALUES (v_empresa, v_almox, v_mat,
          COALESCE((p_payload->>'valor_unitario')::numeric, 0),
          COALESCE((p_payload->>'estoque_minimo')::int, 0),
          nullif(p_payload->>'fornecedor', ''), v_forn,
          nullif(p_payload->>'validade', '')::date)
  ON CONFLICT (almoxarifado_id, sup_item_id) DO UPDATE
    SET valor_unitario = COALESCE(nullif(excluded.valor_unitario, 0), public.sup_estoque_item.valor_unitario),
        estoque_minimo = GREATEST(excluded.estoque_minimo, public.sup_estoque_item.estoque_minimo),
        fornecedor     = COALESCE(excluded.fornecedor, public.sup_estoque_item.fornecedor),
        fornecedor_id  = COALESCE(excluded.fornecedor_id, public.sup_estoque_item.fornecedor_id),
        validade       = COALESCE(excluded.validade, public.sup_estoque_item.validade)
  RETURNING id INTO v_item;

  SELECT COALESCE(max(t.sequencia), 0) INTO v_seq
    FROM public.sup_estoque_tag t WHERE t.item_estoque_id = v_item;

  FOR u IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'unidades', '[]'::jsonb)) LOOP
    v_tipo  := COALESCE(u->>'tipo', 'unico');
    v_tam   := nullif(u->>'tamanho', '');
    v_valor := nullif(u->>'valor_unitario', '')::numeric;

    FOR cod IN
      SELECT CASE WHEN v_tipo = 'massa' THEN u->>'codigo' ELSE x END
        FROM jsonb_array_elements_text(
          CASE WHEN v_tipo = 'massa' THEN jsonb_build_array(u->>'codigo')
               ELSE COALESCE(u->'codigos', '[]'::jsonb) END) AS x
    LOOP
      cod := upper(trim(cod));
      CONTINUE WHEN cod IS NULL OR cod = '';
      v_qtd := CASE WHEN v_tipo = 'massa' THEN GREATEST(COALESCE((u->>'quantidade')::int, 1), 1) END;

      SELECT t.id, t.usado, t.tipo, t.quantidade_massa, i.nome AS material
        INTO r_exist
        FROM public.sup_estoque_tag t
        JOIN public.sup_estoque_item ei ON ei.id = t.item_estoque_id
        JOIN public.sup_item i ON i.id = ei.sup_item_id
       WHERE t.codigo = cod;

      IF FOUND THEN
        IF NOT r_exist.usado
           AND (r_exist.tipo = 'unico' OR COALESCE(r_exist.quantidade_massa, 0) > 0) THEN
          v_rej := v_rej || jsonb_build_object(
            'codigo', cod,
            'motivo', format('Etiqueta já está ativa no material "%s"', r_exist.material));
          CONTINUE;
        END IF;
        DELETE FROM public.sup_estoque_tag t WHERE t.id = r_exist.id;
      END IF;

      v_seq := v_seq + 1;
      INSERT INTO public.sup_estoque_tag
        (item_estoque_id, codigo, tamanho, sequencia, tipo,
         quantidade_massa, quantidade_original_massa, valor_unitario, estado)
      VALUES (v_item, cod, v_tam, v_seq, v_tipo,
              v_qtd, v_qtd, v_valor,
              COALESCE(nullif(u->>'estado', ''), 'novo'));

      -- A trilha vai para sup_estoque_movimento (modelo NOVO), e NÃO para o
      -- estoque_movimento do módulo aposentado, como a versão anterior desta
      -- função fazia.
      --
      -- É deliberado: as telas que leem estoque_movimento (Estoque.tsx,
      -- MovimentosEstoque.tsx) saíram da navegação em 20260821000001 e as
      -- tabelas estavam vazias. Escrever nas duas manteria vivo um modelo que
      -- o time decidiu aposentar, e criaria duas trilhas do mesmo fato — que é
      -- o erro que o legado cometeu com o saldo do estoque (REPLICAR §12.8).
      --
      -- Consequência assumida: se algum dia religarem aquelas telas, elas não
      -- verão as entradas feitas por aqui.
      INSERT INTO public.sup_estoque_movimento
        (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho,
         observacao, usuario_id, usuario_nome)
      VALUES (v_empresa, v_item, cod, 'entrada', COALESCE(v_qtd, 1), v_tam,
              nullif(p_payload->>'observacao', ''), v_uid, v_nome);

      v_criadas := v_criadas + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'item_estoque_id', v_item, 'criadas', v_criadas, 'rejeitadas', v_rej);
END $$;

REVOKE ALL ON FUNCTION public.sup_est_entrada_executar(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sup_est_entrada(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(auth.uid(), 'sup_estoque', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para dar entrada no estoque';
  END IF;
  RETURN public.sup_est_entrada_executar(p_payload);
END $$;

REVOKE ALL ON FUNCTION public.sup_est_entrada(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_est_entrada(jsonb) TO authenticated;

-- ── 3) Recebimento: escopo por participante/posse da conferência ─────────
CREATE OR REPLACE FUNCTION public.sup_receb_usuario_participa(
  p_recebimento_id uuid, p_user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.recebimento_nf r
      JOIN public.nf_entrada n ON n.id = r.nf_id
      LEFT JOIN public.sup_compra_pedido p ON p.id = r.sup_compra_pedido_id
      LEFT JOIN public.malote_despesa d ON d.id = p.despesa_id
      LEFT JOIN public.planejamento_orcamentario_classificacao c ON c.id = d.classificacao_id
     WHERE r.id = p_recebimento_id
       AND p_user_id IS NOT NULL
       AND (
         r.recebido_por = p_user_id
         OR n.importado_por = p_user_id
         OR n.lancada_manualmente_por = p_user_id
         OR p.created_by = p_user_id
         OR d.created_by = p_user_id
         OR d.cotacao_enviada_por = p_user_id
         OR d.cotacao_decidida_por = p_user_id
         OR c.aprovador_solicitacao_user_id = p_user_id
         OR c.aprovador1_user_id = p_user_id
         OR c.aprovador2_user_id = p_user_id
         OR c.aprovador3_user_id = p_user_id
         -- Recebimentos ainda não atribuídos formam a fila de trabalho. O
         -- primeiro usuário autorizado que inicia a conferência assume a linha.
         OR (r.status = 'aguardando' AND r.recebido_por IS NULL)
       )
  );
$$;

REVOKE ALL ON FUNCTION public.sup_receb_usuario_participa(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sup_receb_itens(p_recebimento_id uuid)
RETURNS TABLE (
  id uuid, descricao text, unidade text, quantidade_esperada numeric,
  quantidade_conferida numeric, condicao text, observacoes text,
  divergencia text, conferido boolean, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'recebimentos', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para visualizar recebimentos';
  END IF;
  IF NOT public.sup_receb_usuario_participa(p_recebimento_id, auth.uid()) THEN
    RAISE EXCEPTION 'Este recebimento está atribuído a outro participante';
  END IF;

  RETURN QUERY
  SELECT ri.id,
         COALESCE(si.nome, ni.descricao_original, pi.nome_item, 'Item sem descrição'),
         COALESCE(ni.unidade, pi.unidade, 'UN'),
         CASE
           WHEN r.status IN ('recebido', 'recebido_com_ocorrencia', 'cancelado')
             OR public.can_access(auth.uid(), 'recebimentos', 'aprovar')
           THEN COALESCE(pi.quantidade, ri.qtd_nf)
           ELSE NULL
         END,
         ri.quantidade_conferida, ri.condicao::text, ri.observacoes,
         ri.divergencia, ri.conferido, ri.created_at
    FROM public.recebimento_nf_item ri
    JOIN public.recebimento_nf r ON r.id = ri.recebimento_id
    LEFT JOIN public.nf_entrada_item ni ON ni.id = ri.nf_item_id
    LEFT JOIN public.sup_item si ON si.id = ri.sup_item_id
    LEFT JOIN public.sup_compra_pedido_item pi ON pi.id = ri.sup_compra_pedido_item_id
   WHERE ri.recebimento_id = p_recebimento_id
   ORDER BY ri.created_at, ri.id;
END $$;

CREATE OR REPLACE FUNCTION public.sup_receb_iniciar(p_recebimento_id uuid)
RETURNS public.recebimento_nf
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_recebimento public.recebimento_nf;
BEGIN
  IF NOT public.can_access(auth.uid(), 'recebimentos', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para iniciar o recebimento';
  END IF;
  IF NOT public.sup_receb_usuario_participa(p_recebimento_id, auth.uid()) THEN
    RAISE EXCEPTION 'Este recebimento está atribuído a outro participante';
  END IF;

  UPDATE public.recebimento_nf r
     SET status = 'em_conferencia', iniciado_em = COALESCE(r.iniciado_em, now()),
         recebido_por = auth.uid()
   WHERE r.id = p_recebimento_id AND r.status = 'aguardando'
     AND (r.recebido_por IS NULL OR r.recebido_por = auth.uid())
  RETURNING * INTO v_recebimento;

  IF v_recebimento.id IS NULL THEN
    RAISE EXCEPTION 'Recebimento não encontrado, já iniciado ou atribuído a outra pessoa';
  END IF;
  RETURN v_recebimento;
END $$;

CREATE OR REPLACE FUNCTION public.sup_receb_conferir(p_recebimento_id uuid, p_itens jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_recebimento public.recebimento_nf;
  v_item jsonb;
  v_item_atual public.recebimento_nf_item;
  v_esperada numeric(14,3);
  v_conferida numeric(14,3);
  v_divergencia text;
  v_tem_divergencia boolean := false;
  v_status_pedido text;
  v_total_itens integer;
  v_total_informados integer;
BEGIN
  IF NOT public.can_access(auth.uid(), 'recebimentos', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para conferir recebimento';
  END IF;
  IF jsonb_typeof(p_itens) <> 'array' THEN
    RAISE EXCEPTION 'A lista de itens da conferência é inválida';
  END IF;

  SELECT r.* INTO v_recebimento
    FROM public.recebimento_nf r
   WHERE r.id = p_recebimento_id
   FOR UPDATE;
  IF v_recebimento.id IS NULL THEN RAISE EXCEPTION 'Recebimento não encontrado'; END IF;
  IF NOT public.sup_receb_usuario_participa(p_recebimento_id, auth.uid())
     OR v_recebimento.recebido_por IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'A conferência pertence a outro participante';
  END IF;
  IF v_recebimento.status <> 'em_conferencia' THEN
    RAISE EXCEPTION 'O recebimento não está em conferência';
  END IF;

  SELECT count(*) INTO v_total_itens
    FROM public.recebimento_nf_item ri WHERE ri.recebimento_id = p_recebimento_id;
  SELECT count(DISTINCT x->>'id') INTO v_total_informados
    FROM jsonb_array_elements(p_itens) x;
  IF v_total_itens = 0 OR v_total_informados <> v_total_itens THEN
    RAISE EXCEPTION 'Informe a quantidade contada de todos os % item(ns)', v_total_itens;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
    v_conferida := nullif(v_item->>'quantidade_conferida', '')::numeric;
    IF v_conferida IS NULL OR v_conferida < 0 THEN
      RAISE EXCEPTION 'Quantidade conferida inválida';
    END IF;

    SELECT ri.* INTO v_item_atual
      FROM public.recebimento_nf_item ri
     WHERE ri.id = (v_item->>'id')::uuid
       AND ri.recebimento_id = p_recebimento_id
     FOR UPDATE;
    IF v_item_atual.id IS NULL THEN RAISE EXCEPTION 'Item de recebimento inválido'; END IF;

    IF v_recebimento.sup_compra_pedido_id IS NOT NULL THEN
      SELECT pi.quantidade INTO v_esperada
        FROM public.sup_compra_pedido_item pi
       WHERE pi.id = v_item_atual.sup_compra_pedido_item_id;
      IF v_esperada IS NULL THEN v_divergencia := 'item_nao_pedido';
      ELSIF v_conferida = v_esperada THEN v_divergencia := 'igual';
      ELSIF v_conferida < v_esperada THEN v_divergencia := 'a_menos';
      ELSE v_divergencia := 'a_mais';
      END IF;
    ELSE
      v_esperada := v_item_atual.qtd_nf;
      v_divergencia := CASE
        WHEN v_conferida = v_esperada THEN 'igual'
        WHEN v_conferida < v_esperada THEN 'a_menos'
        ELSE 'a_mais'
      END;
    END IF;

    UPDATE public.recebimento_nf_item ri SET
      quantidade_conferida = v_conferida,
      qtd_recebida = v_conferida,
      divergencia = v_divergencia,
      condicao = COALESCE(nullif(v_item->>'condicao', '')::public.recebimento_item_condicao, ri.condicao),
      observacoes = CASE WHEN v_item ? 'observacoes'
                        THEN nullif(btrim(v_item->>'observacoes'), '')
                        ELSE ri.observacoes END,
      conferido = true, conferido_em = now(), conferido_por = auth.uid()
    WHERE ri.id = v_item_atual.id;

    IF v_divergencia <> 'igual' THEN
      v_tem_divergencia := true;
      INSERT INTO public.recebimento_ocorrencia (
        empresa_id, recebimento_id, recebimento_item_id, tipo, descricao, aberta_por
      ) VALUES (
        v_recebimento.empresa_id, p_recebimento_id, v_item_atual.id, 'quantidade',
        CASE v_divergencia
          WHEN 'item_nao_pedido' THEN 'Item recebido não consta no pedido de compra.'
          WHEN 'a_menos' THEN format('Quantidade conferida (%s) abaixo da pedida (%s).', v_conferida, v_esperada)
          ELSE format('Quantidade conferida (%s) acima da pedida (%s).', v_conferida, v_esperada)
        END, auth.uid()
      );
    END IF;

    IF COALESCE(v_item->>'condicao', 'ok') <> 'ok' THEN
      v_tem_divergencia := true;
      INSERT INTO public.recebimento_ocorrencia (
        empresa_id, recebimento_id, recebimento_item_id, tipo, descricao, aberta_por
      ) VALUES (
        v_recebimento.empresa_id, p_recebimento_id, v_item_atual.id, 'qualidade',
        'Condição física informada: ' || (v_item->>'condicao') || '.', auth.uid()
      );
    END IF;
  END LOOP;

  UPDATE public.recebimento_nf r
     SET status = CASE WHEN v_tem_divergencia THEN 'recebido_com_ocorrencia' ELSE 'recebido' END,
         finalizado_em = now(), recebido_por = auth.uid()
   WHERE r.id = p_recebimento_id;

  IF v_recebimento.sup_compra_pedido_id IS NOT NULL THEN
    SELECT CASE WHEN EXISTS (
      SELECT 1
        FROM public.sup_compra_pedido_item pi
       WHERE pi.pedido_id = v_recebimento.sup_compra_pedido_id
         AND COALESCE((
           SELECT sum(ri.quantidade_conferida)
             FROM public.recebimento_nf_item ri
             JOIN public.recebimento_nf r ON r.id = ri.recebimento_id
            WHERE ri.sup_compra_pedido_item_id = pi.id
              AND r.status IN ('recebido', 'recebido_com_ocorrencia')
         ), 0) < pi.quantidade
    ) THEN 'entrega_parcial' ELSE 'recebido' END
    INTO v_status_pedido;

    UPDATE public.sup_compra_pedido p SET status = v_status_pedido
     WHERE p.id = v_recebimento.sup_compra_pedido_id AND p.status <> 'cancelado';
  END IF;

  RETURN jsonb_build_object(
    'status_recebimento', CASE WHEN v_tem_divergencia THEN 'recebido_com_ocorrencia' ELSE 'recebido' END,
    'status_pedido', v_status_pedido, 'tem_divergencia', v_tem_divergencia
  );
END $$;

CREATE OR REPLACE FUNCTION public.sup_receb_recusar(p_recebimento_id uuid, p_motivo text)
RETURNS public.recebimento_nf
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_recebimento public.recebimento_nf;
BEGIN
  IF NOT public.can_access(auth.uid(), 'recebimentos', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para recusar recebimento';
  END IF;
  IF NOT public.sup_receb_usuario_participa(p_recebimento_id, auth.uid()) THEN
    RAISE EXCEPTION 'Este recebimento está atribuído a outro participante';
  END IF;
  IF nullif(btrim(p_motivo), '') IS NULL THEN RAISE EXCEPTION 'Informe o motivo da recusa'; END IF;

  UPDATE public.recebimento_nf r
     SET status = 'cancelado', finalizado_em = now(), recebido_por = auth.uid(),
         observacoes = concat_ws(E'\n', nullif(r.observacoes, ''), 'Recusa: ' || btrim(p_motivo))
   WHERE r.id = p_recebimento_id
     AND r.status IN ('aguardando', 'em_conferencia')
     AND (r.recebido_por IS NULL OR r.recebido_por = auth.uid())
  RETURNING * INTO v_recebimento;

  IF v_recebimento.id IS NULL THEN RAISE EXCEPTION 'Recebimento não pode ser recusado'; END IF;
  INSERT INTO public.recebimento_ocorrencia (
    empresa_id, recebimento_id, tipo, descricao, aberta_por
  ) VALUES (
    v_recebimento.empresa_id, v_recebimento.id, 'outro',
    'Mercadoria recusada: ' || btrim(p_motivo), auth.uid()
  );
  RETURN v_recebimento;
END $$;

CREATE OR REPLACE FUNCTION public.sup_receb_tratar_ocorrencia(
  p_ocorrencia_id uuid, p_status text, p_tratativa text
) RETURNS public.recebimento_ocorrencia
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ocorrencia public.recebimento_ocorrencia;
  v_recebimento_id uuid;
BEGIN
  IF NOT public.can_access(auth.uid(), 'recebimentos', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para tratar ocorrências';
  END IF;
  SELECT o.recebimento_id INTO v_recebimento_id
    FROM public.recebimento_ocorrencia o WHERE o.id = p_ocorrencia_id;
  IF v_recebimento_id IS NULL THEN RAISE EXCEPTION 'Ocorrência não encontrada'; END IF;
  IF NOT public.sup_receb_usuario_participa(v_recebimento_id, auth.uid()) THEN
    RAISE EXCEPTION 'A ocorrência pertence a outro recebimento';
  END IF;
  IF p_status NOT IN ('em_tratativa', 'resolvida', 'cancelada') THEN
    RAISE EXCEPTION 'Status de ocorrência inválido';
  END IF;

  UPDATE public.recebimento_ocorrencia o SET
    status = p_status::public.recebimento_ocorrencia_status,
    tratativa = nullif(btrim(p_tratativa), ''),
    resolvida_por = CASE WHEN p_status = 'resolvida' THEN auth.uid() ELSE o.resolvida_por END,
    resolvida_em = CASE WHEN p_status = 'resolvida' THEN now() ELSE o.resolvida_em END
  WHERE o.id = p_ocorrencia_id
  RETURNING * INTO v_ocorrencia;

  RETURN v_ocorrencia;
END $$;

REVOKE ALL ON FUNCTION public.sup_receb_iniciar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_receb_itens(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_receb_conferir(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_receb_recusar(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_receb_tratar_ocorrencia(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_receb_iniciar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_receb_itens(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_receb_conferir(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_receb_recusar(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_receb_tratar_ocorrencia(uuid, text, text) TO authenticated;

-- ── 4) NF manual: vínculo validado somente quando nasce ou é trocado ─────
CREATE OR REPLACE FUNCTION public.nf_entrada_validar_manual()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_status text;
  v_validar_vinculo boolean;
BEGIN
  IF NEW.origem = 'manual' THEN
    IF TG_OP = 'INSERT' THEN
      v_validar_vinculo := true;
    ELSE
      v_validar_vinculo := OLD.origem IS DISTINCT FROM NEW.origem
        OR OLD.sup_compra_pedido_id IS DISTINCT FROM NEW.sup_compra_pedido_id
        OR OLD.pedido_compra_id IS DISTINCT FROM NEW.pedido_compra_id;
    END IF;

    IF v_validar_vinculo THEN
      IF NEW.sup_compra_pedido_id IS NULL AND NEW.pedido_compra_id IS NULL THEN
        RAISE EXCEPTION 'NF manual exige vínculo com Pedido de Compra (PC)';
      END IF;

      IF NEW.sup_compra_pedido_id IS NOT NULL THEN
        SELECT p.status INTO v_status
          FROM public.sup_compra_pedido p WHERE p.id = NEW.sup_compra_pedido_id;
        IF v_status IS NULL THEN RAISE EXCEPTION 'Pedido de compra vinculado não encontrado'; END IF;
        IF v_status NOT IN ('enviado', 'aguardando_entrega', 'entrega_parcial', 'recebido') THEN
          RAISE EXCEPTION 'Pedido de compra não está disponível para recebimento (status: %)', v_status;
        END IF;
      ELSE
        SELECT p.status INTO v_status
          FROM public.pedido_compra p WHERE p.id = NEW.pedido_compra_id;
        IF v_status IS NULL OR v_status NOT IN ('aprovado','enviado','recebido_parcial','recebido_total') THEN
          RAISE EXCEPTION 'Pedido de compra legado não está aprovado';
        END IF;
      END IF;
    END IF;

    IF TG_OP = 'INSERT' AND NEW.lancada_manualmente_por IS NULL THEN
      NEW.lancada_manualmente_por := auth.uid();
    END IF;
    IF TG_OP = 'INSERT' AND NOT public.can_access(auth.uid(), 'nf-entrada', 'incluir') THEN
      RAISE EXCEPTION 'Sem permissão para lançar NF manualmente';
    ELSIF TG_OP = 'UPDATE' AND NOT public.can_access(auth.uid(), 'nf-entrada', 'alterar') THEN
      RAISE EXCEPTION 'Sem permissão para alterar NF manual';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.sup_nf_vincular_item(p_nf_item_id uuid, p_sup_item_id uuid)
RETURNS public.nf_entrada_item
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_item public.nf_entrada_item;
  v_empresa_id uuid;
BEGIN
  IF NOT public.can_access(auth.uid(), 'nf-entrada', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para revisar itens da NF';
  END IF;
  SELECT n.empresa_id INTO v_empresa_id
    FROM public.nf_entrada_item ni
    JOIN public.nf_entrada n ON n.id = ni.nf_id
   WHERE ni.id = p_nf_item_id;
  IF v_empresa_id IS NULL THEN RAISE EXCEPTION 'Item da NF não encontrado'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sup_item i
     WHERE i.id = p_sup_item_id AND i.ativo AND i.empresa_id = v_empresa_id
  ) THEN
    RAISE EXCEPTION 'Material não pertence à empresa desta nota fiscal';
  END IF;

  UPDATE public.nf_entrada_item i
     SET sup_item_id = p_sup_item_id, status = 'ok', produto_criado_auto = false
   WHERE i.id = p_nf_item_id
  RETURNING * INTO v_item;
  RETURN v_item;
END $$;

-- ── 5) NF: entrada fiscal reutiliza o núcleo e recusa fração não etiquetável
CREATE OR REPLACE FUNCTION public.nf_lancar_estoque(_nf_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_nf public.nf_entrada;
  v_item record;
  v_almox uuid;
  v_quantidade numeric;
  v_resultado jsonb;
  v_item_estoque_id uuid;
  v_preco_id uuid;
  v_inicio timestamptz := clock_timestamp();
  v_count integer := 0;
  v_documento text;
BEGIN
  IF NOT public.can_access(auth.uid(), 'nf-entrada', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para lançar NF';
  END IF;
  SELECT n.* INTO v_nf FROM public.nf_entrada n WHERE n.id = _nf_id FOR UPDATE;
  IF v_nf.id IS NULL THEN RAISE EXCEPTION 'NF não encontrada'; END IF;
  IF v_nf.status = 'lancada_estoque' THEN RAISE EXCEPTION 'NF já lançada no estoque'; END IF;
  IF v_nf.status NOT IN ('importada', 'validada') THEN
    RAISE EXCEPTION 'NF com status % não pode ser lançada', v_nf.status;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.nf_entrada_item i
     WHERE i.nf_id = _nf_id
       AND (i.status IN ('pendente_revisao', 'produto_novo') OR i.sup_item_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'Existem itens pendentes de vínculo com o catálogo';
  END IF;
  IF v_nf.sup_compra_pedido_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.recebimento_nf r
     WHERE r.nf_id = _nf_id AND r.status IN ('recebido', 'recebido_com_ocorrencia')
  ) THEN
    RAISE EXCEPTION 'Conclua a conferência física antes de lançar a NF no estoque';
  END IF;

  v_almox := v_nf.almoxarifado_id;
  IF v_almox IS NULL THEN
    SELECT a.id INTO v_almox FROM public.almoxarifado a
     WHERE a.empresa_id = v_nf.empresa_id AND a.is_matriz LIMIT 1;
  END IF;
  IF v_almox IS NULL THEN RAISE EXCEPTION 'Almoxarifado não definido e Matriz não encontrada'; END IF;

  v_documento := 'NF ' || v_nf.numero || '/' || COALESCE(v_nf.serie, '1')
                 || ' - ' || v_nf.chave_acesso;

  FOR v_item IN
    SELECT i.*,
           COALESCE((
             SELECT ri.quantidade_conferida
               FROM public.recebimento_nf_item ri
              WHERE ri.nf_item_id = i.id LIMIT 1
           ), i.quantidade) AS quantidade_entrada
      FROM public.nf_entrada_item i
     WHERE i.nf_id = _nf_id
     ORDER BY i.numero_item
  LOOP
    v_quantidade := v_item.quantidade_entrada;
    CONTINUE WHEN COALESCE(v_quantidade, 0) <= 0;
    IF v_quantidade <> trunc(v_quantidade) THEN
      RAISE EXCEPTION
        'O item % tem quantidade fracionada (%). A etiqueta de estoque aceita apenas quantidade inteira; faça o tratamento manual antes de lançar a NF.',
        v_item.numero_item, v_quantidade;
    END IF;

    v_resultado := public.sup_est_entrada_executar(jsonb_build_object(
      'almoxarifado_id', v_almox,
      'sup_item_id', v_item.sup_item_id,
      'valor_unitario', v_item.valor_unitario,
      'fornecedor_id', v_nf.fornecedor_id,
      'fornecedor', v_nf.fornecedor_razao,
      'observacao', v_documento,
      'unidades', jsonb_build_array(jsonb_build_object(
        'tipo', 'massa',
        'codigo', 'NFE-' || regexp_replace(v_nf.chave_acesso, '[^0-9A-Za-z]', '', 'g')
                  || '-' || lpad(v_item.numero_item::text, 3, '0'),
        'quantidade', v_quantidade::integer,
        'valor_unitario', v_item.valor_unitario
      ))
    ));

    IF jsonb_array_length(COALESCE(v_resultado->'rejeitadas', '[]'::jsonb)) > 0 THEN
      RAISE EXCEPTION 'Falha ao gerar etiqueta do item %: %',
        v_item.numero_item, v_resultado->'rejeitadas';
    END IF;

    v_item_estoque_id := (v_resultado->>'item_estoque_id')::uuid;
    v_preco_id := NULL;
    SELECT p.id INTO v_preco_id
      FROM public.sup_item_preco p
     WHERE p.item_estoque_id = v_item_estoque_id
       AND p.origem = 'entrada'
       AND p.registrado_em >= v_inicio
     ORDER BY p.registrado_em DESC LIMIT 1;

    IF v_preco_id IS NOT NULL THEN
      UPDATE public.sup_item_preco p
         SET origem = 'nf', documento = v_documento,
             fornecedor_id = v_nf.fornecedor_id,
             fornecedor_nome = v_nf.fornecedor_razao
       WHERE p.id = v_preco_id;
    ELSIF COALESCE(v_item.valor_unitario, 0) > 0 THEN
      INSERT INTO public.sup_item_preco (
        empresa_id, sup_item_id, item_estoque_id, almoxarifado_id,
        valor_unitario, origem, fornecedor_id, fornecedor_nome, documento,
        registrado_por, registrado_por_nome
      ) VALUES (
        v_nf.empresa_id, v_item.sup_item_id, v_item_estoque_id, v_almox,
        v_item.valor_unitario, 'nf', v_nf.fornecedor_id, v_nf.fornecedor_razao,
        v_documento, auth.uid(), public.sup_est_nome_usuario()
      );
    END IF;
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.nf_entrada n SET
    status = 'lancada_estoque', lancado_por = auth.uid(), lancado_em = now(),
    validado_por = COALESCE(n.validado_por, auth.uid()),
    validado_em = COALESCE(n.validado_em, now()), almoxarifado_id = v_almox
  WHERE n.id = _nf_id;

  INSERT INTO public.nf_entrada_log (nf_id, empresa_id, evento, detalhes, user_id)
  VALUES (_nf_id, v_nf.empresa_id, 'lancada_estoque',
          jsonb_build_object('itens_lancados', v_count, 'almoxarifado_id', v_almox,
                             'estoque_supply', true), auth.uid());

  RETURN jsonb_build_object('itens_lancados', v_count, 'almoxarifado_id', v_almox,
                            'nf_id', _nf_id);
END $$;

REVOKE ALL ON FUNCTION public.sup_nf_vincular_item(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nf_lancar_estoque(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_nf_vincular_item(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_lancar_estoque(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
