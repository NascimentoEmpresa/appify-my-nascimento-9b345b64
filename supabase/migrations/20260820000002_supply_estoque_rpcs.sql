-- =====================================================================
-- SUPPLY / COMPRAS — Fase 2, parte 2 de 2: ALGORITMOS DO ESTOQUE
--
-- Todas SECURITY DEFINER: rodam POR FORA da RLS, então cada uma refaz a
-- autorização à mão com can_access().
--
-- ROLLBACK: DROP FUNCTION de cada sup_est_* abaixo.
-- =====================================================================

-- Helper: nome de exibição do usuário atual, para as trilhas.
CREATE OR REPLACE FUNCTION public.sup_est_nome_usuario()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.display_name FROM public.profiles p WHERE p.id = auth.uid();
$$;

-- ── 1. ENTRADA (recebimento por bipagem) ─────────────────────────────
--
-- Payload:
-- { almoxarifado_id, sup_item_id, valor_unitario, estoque_minimo,
--   fornecedor, validade,
--   unidades: [ { tamanho, tipo:'unico', codigos:[...], valor_unitario? },
--               { tamanho, tipo:'massa', codigo:'x', quantidade:100 } ] }
--
-- REGRA DE RECICLAGEM DE ETIQUETA (§6.4) — a mais sutil do subsistema:
--
--   o código já existe?
--   ├── está ATIVO (livre, ou massa com saldo) → ERRO, nomeando o item dono
--   └── já foi usado / massa zerada            → apaga o velho e RECICLA
--
-- A ideia de negócio: uma etiqueta física pode voltar ao estoque depois de
-- consumida (a peça foi devolvida, higienizada e reetiquetada), mas nunca
-- pode estar ativa em dois itens ao mesmo tempo. Nomear o item dono no erro
-- é o que torna a mensagem acionável para quem está no almoxarifado.
--
-- SUCESSO PARCIAL (§6.5): uma etiqueta rejeitada não invalida as demais.
-- Num almoxarifado é melhor gravar 19 de 20 e avisar sobre a que falhou do
-- que perder as 20.
CREATE OR REPLACE FUNCTION public.sup_est_entrada(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_nome    text := public.sup_est_nome_usuario();
  v_almox   uuid := (p_payload->>'almoxarifado_id')::uuid;
  v_mat     uuid := (p_payload->>'sup_item_id')::uuid;
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
  IF NOT public.can_access(v_uid, 'sup_estoque', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para dar entrada no estoque';
  END IF;

  SELECT a.empresa_id INTO v_empresa FROM public.almoxarifado a WHERE a.id = v_almox;
  IF v_empresa IS NULL THEN RAISE EXCEPTION 'Almoxarifado não encontrado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sup_item i WHERE i.id = v_mat AND i.empresa_id = v_empresa) THEN
    RAISE EXCEPTION 'Material não pertence à empresa deste almoxarifado';
  END IF;

  -- Um registro de estoque por (almoxarifado, material).
  INSERT INTO public.sup_estoque_item
    (empresa_id, almoxarifado_id, sup_item_id, valor_unitario, estoque_minimo, fornecedor, validade)
  VALUES (v_empresa, v_almox, v_mat,
          COALESCE((p_payload->>'valor_unitario')::numeric, 0),
          COALESCE((p_payload->>'estoque_minimo')::int, 0),
          nullif(p_payload->>'fornecedor', ''),
          nullif(p_payload->>'validade', '')::date)
  ON CONFLICT (almoxarifado_id, sup_item_id) DO UPDATE
    SET valor_unitario = COALESCE(nullif(excluded.valor_unitario, 0), public.sup_estoque_item.valor_unitario),
        estoque_minimo = GREATEST(excluded.estoque_minimo, public.sup_estoque_item.estoque_minimo),
        fornecedor     = COALESCE(excluded.fornecedor, public.sup_estoque_item.fornecedor),
        validade       = COALESCE(excluded.validade, public.sup_estoque_item.validade)
  RETURNING id INTO v_item;

  -- Maior sequência já usada no item, INCLUINDO as consumidas, para não colidir.
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
        -- Ativa = livre, ou massa com saldo. Nunca em dois itens ao mesmo tempo.
        IF NOT r_exist.usado
           AND (r_exist.tipo = 'unico' OR COALESCE(r_exist.quantidade_massa, 0) > 0) THEN
          v_rej := v_rej || jsonb_build_object(
            'codigo', cod,
            'motivo', format('Etiqueta já está ativa no material "%s"', r_exist.material));
          CONTINUE;
        END IF;
        -- Consumida: recicla o código.
        DELETE FROM public.sup_estoque_tag t WHERE t.id = r_exist.id;
      END IF;

      v_seq := v_seq + 1;
      INSERT INTO public.sup_estoque_tag
        (item_estoque_id, codigo, tamanho, sequencia, tipo,
         quantidade_massa, quantidade_original_massa, valor_unitario, estado)
      VALUES (v_item, cod, v_tam, v_seq, v_tipo,
              v_qtd, v_qtd, v_valor,
              COALESCE(nullif(u->>'estado', ''), 'novo'));

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

-- ── 2. VALIDAÇÃO (§6.8) ──────────────────────────────────────────────
--
-- Recebe uma lista de códigos e devolve, para cada um, se serve e por quê.
-- O frontend usa isso para abortar o fluxo inteiro ANTES de tocar o estoque.
--
-- Diferença em relação ao legado: aqui também confere se a etiqueta é do
-- MATERIAL certo. No legado nada impedia colar a etiqueta de uma camiseta
-- na linha da botina.
CREATE OR REPLACE FUNCTION public.sup_est_validar(
  p_codigos text[], p_pedido_id uuid DEFAULT NULL, p_pedido_item_id uuid DEFAULT NULL
) RETURNS TABLE (
  codigo text, valido boolean, motivo text, material text, tamanho text,
  tipo text, disponivel int, valor_unitario numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_mat_esperado uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT (public.can_access(v_uid, 'sup_estoque', 'visualizar')
       OR public.can_access(v_uid, 'sup_pedidos_materiais', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  IF p_pedido_item_id IS NOT NULL THEN
    SELECT pi.item_id INTO v_mat_esperado
      FROM public.sup_pedido_item pi WHERE pi.id = p_pedido_item_id;
  END IF;

  RETURN QUERY
  SELECT
    c.cod,
    CASE
      WHEN t.id IS NULL THEN false
      WHEN v_mat_esperado IS NOT NULL AND ei.sup_item_id <> v_mat_esperado THEN false
      WHEN t.usado AND t.pedido_id IS DISTINCT FROM p_pedido_id THEN false
      WHEN t.tipo = 'massa' AND COALESCE(t.quantidade_massa, 0) <= 0
           AND t.pedido_id IS DISTINCT FROM p_pedido_id THEN false
      ELSE true
    END,
    CASE
      WHEN t.id IS NULL THEN 'Não existe no estoque'
      WHEN v_mat_esperado IS NOT NULL AND ei.sup_item_id <> v_mat_esperado
        THEN format('Etiqueta é do material "%s", não do que foi pedido', i.nome)
      WHEN t.usado AND t.pedido_id IS DISTINCT FROM p_pedido_id
        THEN format('Já utilizada no pedido %s', COALESCE(pe.pedido_id, '—'))
      WHEN t.tipo = 'massa' AND COALESCE(t.quantidade_massa, 0) <= 0
           AND t.pedido_id IS DISTINCT FROM p_pedido_id THEN 'Etiqueta esgotada'
      ELSE NULL
    END,
    i.nome, t.tamanho, t.tipo,
    CASE WHEN t.tipo = 'massa' THEN COALESCE(t.quantidade_massa, 0)
         WHEN t.usado THEN 0 ELSE 1 END,
    COALESCE(t.valor_unitario, ei.valor_unitario)
  FROM unnest(p_codigos) AS c(cod)
  LEFT JOIN public.sup_estoque_tag  t  ON t.codigo = upper(trim(c.cod))
  LEFT JOIN public.sup_estoque_item ei ON ei.id = t.item_estoque_id
  LEFT JOIN public.sup_item         i  ON i.id = ei.sup_item_id
  LEFT JOIN public.sup_pedido       pe ON pe.id = t.pedido_id;
END $$;

-- ── 3. BAIXA — status + consumo NUMA TRANSAÇÃO SÓ ───────────────────
--
-- É a correção mais importante desta fase (§12.6). No legado, consumir as
-- etiquetas e mudar o status eram DUAS requisições: se a segunda falhasse,
-- as peças já tinham saído do estoque e o pedido ficava com o status antigo.
--
-- p_baixas: [ { pedido_item_id, codigo, tipo, quantidade } ]
--
-- CONTROLE POR DELTA para etiqueta em massa (§6.6):
--   existente = quanto já foi consumido por (código, pedido_item)
--   delta     = quantidade_desejada − existente
--   delta = 0        → nada muda
--   delta > saldo    → erro
--   senão            → saldo -= delta; zerou, marca usada
--                      UPSERT no ledger com o TOTAL, não com o delta
--
-- É o que permite reabrir o pedido e ajustar para mais OU PARA MENOS:
-- baixou 3, mudou para 5 → saem mais 2; mudou de 5 para 2 → VOLTAM 3.
CREATE OR REPLACE FUNCTION public.sup_est_baixar(
  p_pedido_id uuid, p_status text, p_observacao text, p_baixas jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_pedidos_materiais', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para atualizar pedidos';
  END IF;

  SELECT * INTO v_ped FROM public.sup_pedido p WHERE p.id = p_pedido_id FOR UPDATE;
  IF v_ped.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;

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

    -- Guarda que o legado não tem: a etiqueta precisa ser do material pedido.
    IF t.sup_item_id <> v_pi.item_id THEN
      v_rej := v_rej || jsonb_build_object('codigo', t.codigo,
                 'motivo', format('Etiqueta é de "%s", e o pedido é de "%s"', t.material, v_pi.nome_item));
      CONTINUE;
    END IF;

    IF t.tipo = 'unico' THEN
      -- Reatribuir dentro do MESMO pedido é permitido de propósito: cobre o
      -- operador que salvou como única e percebeu que era massa (§6.6).
      IF t.usado AND t.pedido_id IS DISTINCT FROM p_pedido_id THEN
        v_rej := v_rej || jsonb_build_object('codigo', t.codigo,
                   'motivo', format('Já utilizada no pedido %s',
                     COALESCE((SELECT p2.pedido_id FROM public.sup_pedido p2 WHERE p2.id = t.pedido_id), '—')));
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

    ELSE  -- massa: controle por delta
      v_desejada := GREATEST(COALESCE((b->>'quantidade')::int, 1), 0);

      SELECT COALESCE(cs.quantidade, 0) INTO v_existente
        FROM public.sup_estoque_consumo cs
       WHERE cs.codigo = t.codigo AND cs.pedido_item_id = v_pi.id;
      v_existente := COALESCE(v_existente, 0);
      v_delta := v_desejada - v_existente;

      IF v_delta = 0 THEN
        CONTINUE;  -- nada mudou nesta linha
      END IF;

      IF v_delta > 0 AND COALESCE(t.quantidade_massa, 0) <= 0 THEN
        v_rej := v_rej || jsonb_build_object('codigo', t.codigo, 'motivo', 'Etiqueta esgotada');
        CONTINUE;
      END IF;
      IF v_delta > COALESCE(t.quantidade_massa, 0) THEN
        v_rej := v_rej || jsonb_build_object('codigo', t.codigo,
                   'motivo', format('Quantidade adicional (%s) maior que a disponível (%s)',
                                    v_delta, COALESCE(t.quantidade_massa, 0)));
        CONTINUE;
      END IF;

      v_novo := COALESCE(t.quantidade_massa, 0) - v_delta;
      UPDATE public.sup_estoque_tag tg
         SET quantidade_massa = GREATEST(v_novo, 0),
             usado     = (v_novo <= 0),
             pedido_id = CASE WHEN v_novo <= 0 THEN p_pedido_id ELSE tg.pedido_id END,
             pedido_item_id = CASE WHEN v_novo <= 0 THEN v_pi.id ELSE tg.pedido_item_id END,
             usado_em  = CASE WHEN v_novo <= 0 THEN now() ELSE tg.usado_em END,
             usado_por = CASE WHEN v_novo <= 0 THEN v_uid ELSE tg.usado_por END,
             usado_por_nome = CASE WHEN v_novo <= 0 THEN v_nome ELSE tg.usado_por_nome END
       WHERE tg.id = t.id;

      -- Ledger guarda o TOTAL consumido, não o delta — é o que torna a
      -- próxima reabertura do pedido calculável.
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

  -- §6.6: ROLLBACK só se NENHUMA passar. Com ao menos uma boa, commita e
  -- devolve a lista de erros — sucesso parcial é preferível a perda total.
  IF v_tent > 0 AND v_ok = 0 AND jsonb_array_length(v_rej) > 0 THEN
    RAISE EXCEPTION 'Nenhuma etiqueta pôde ser baixada: %',
      (SELECT string_agg(x->>'motivo', '; ') FROM jsonb_array_elements(v_rej) x);
  END IF;

  -- Status e observação, na MESMA transação do consumo.
  v_mudou_st := p_status IS NOT NULL AND p_status <> v_ped.status;
  IF v_mudou_st OR COALESCE(p_observacao, '') IS DISTINCT FROM COALESCE(v_ped.observacao, '') THEN
    UPDATE public.sup_pedido p
       SET status = COALESCE(p_status, p.status), observacao = nullif(p_observacao, '')
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
END $$;

-- ── 4. TAGs de um pedido (§6.7) ──────────────────────────────────────
--
-- Precisa unir duas fontes, porque os dois tipos guardam o vínculo em
-- lugares diferentes: a etiqueta única na própria linha da tag, e a de
-- massa no ledger. O NOT EXISTS evita contar em dobro a que aparece nas duas.
CREATE OR REPLACE FUNCTION public.sup_est_tags_do_pedido(p_pedido_id uuid)
RETURNS TABLE (
  codigo text, pedido_item_id uuid, tipo text, quantidade int,
  tamanho text, material text, valor_unitario numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.codigo, t.pedido_item_id, t.tipo, 1,
         t.tamanho, i.nome, COALESCE(t.valor_unitario, ei.valor_unitario)
    FROM public.sup_estoque_tag t
    JOIN public.sup_estoque_item ei ON ei.id = t.item_estoque_id
    JOIN public.sup_item i ON i.id = ei.sup_item_id
   WHERE t.pedido_id = p_pedido_id
     AND t.tipo = 'unico'
     AND NOT EXISTS (
       SELECT 1 FROM public.sup_estoque_consumo c
        WHERE c.codigo = t.codigo AND c.pedido_id = p_pedido_id)
  UNION ALL
  SELECT c.codigo, c.pedido_item_id, 'massa', c.quantidade,
         t.tamanho, i.nome, COALESCE(t.valor_unitario, ei.valor_unitario)
    FROM public.sup_estoque_consumo c
    JOIN public.sup_estoque_tag t ON t.codigo = c.codigo
    JOIN public.sup_estoque_item ei ON ei.id = t.item_estoque_id
    JOIN public.sup_item i ON i.id = ei.sup_item_id
   WHERE c.pedido_id = p_pedido_id
   ORDER BY 2, 1;
$$;

-- ── 5. DEVOLUÇÃO ─────────────────────────────────────────────────────
--
-- A peça volta (colaborador desligado, troca) e é bipada de volta ao estoque,
-- opcionalmente marcada como higienizada.
--
-- Só aceita etiqueta ÚNICA de propósito. Etiqueta em massa é consumível e
-- não volta; pior, mexer no saldo dela por fora corromperia o cálculo de
-- delta do pedido que a consumiu. Para corrigir saldo de massa existe o
-- ajuste de estoque, que não passa por aqui.
CREATE OR REPLACE FUNCTION public.sup_est_devolver(
  p_codigos text[], p_estado text DEFAULT 'higienizado', p_observacao text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text := public.sup_est_nome_usuario();
  v_ok   int := 0;
  v_rej  jsonb := '[]'::jsonb;
  cod    text;
  t      record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_estoque', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para movimentar estoque';
  END IF;
  IF p_estado NOT IN ('novo','higienizado') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_estado;
  END IF;

  FOREACH cod IN ARRAY COALESCE(p_codigos, ARRAY[]::text[]) LOOP
    cod := upper(trim(cod));
    CONTINUE WHEN cod = '';

    SELECT tg.*, ei.id AS ei_id, ei.empresa_id INTO t
      FROM public.sup_estoque_tag tg
      JOIN public.sup_estoque_item ei ON ei.id = tg.item_estoque_id
     WHERE tg.codigo = cod FOR UPDATE OF tg;

    IF t.id IS NULL THEN
      v_rej := v_rej || jsonb_build_object('codigo', cod, 'motivo', 'Não existe no estoque');
      CONTINUE;
    END IF;
    IF t.tipo <> 'unico' THEN
      v_rej := v_rej || jsonb_build_object('codigo', cod,
                 'motivo', 'Etiqueta em massa não tem devolução; use ajuste de estoque');
      CONTINUE;
    END IF;
    IF NOT t.usado THEN
      v_rej := v_rej || jsonb_build_object('codigo', cod, 'motivo', 'Etiqueta já está disponível');
      CONTINUE;
    END IF;

    -- O vínculo com o pedido é limpo; quem guarda "esta peça esteve com
    -- fulano" é a trilha de movimento, que nunca é apagada.
    UPDATE public.sup_estoque_tag tg
       SET usado = false, pedido_id = NULL, pedido_item_id = NULL,
           usado_em = NULL, usado_por = NULL, usado_por_nome = NULL,
           estado = p_estado
     WHERE tg.id = t.id;

    INSERT INTO public.sup_estoque_movimento
      (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho,
       pedido_id, pedido_item_id, observacao, usuario_id, usuario_nome)
    VALUES (t.empresa_id, t.ei_id, cod, 'devolucao', 1, t.tamanho,
            t.pedido_id, t.pedido_item_id,
            COALESCE(p_observacao, '') || ' (' || p_estado || ')', v_uid, v_nome);
    v_ok := v_ok + 1;
  END LOOP;

  RETURN jsonb_build_object('devolvidas', v_ok, 'rejeitadas', v_rej);
END $$;

-- ── 6. REMOÇÃO DE ETIQUETA (§6.9) — três comportamentos ─────────────
--
--   massa com saldo > 1        → DECREMENTA em 1, não apaga
--   única, ou massa com saldo 1 → apaga a linha
--        └─ era a ÚLTIMA do item → apaga o item também
--        └─ senão                → RESEQUENCIA as restantes
CREATE OR REPLACE FUNCTION public.sup_est_remover_tag(p_codigo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text := public.sup_est_nome_usuario();
  t      record;
  v_rest int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_estoque', 'excluir') THEN
    RAISE EXCEPTION 'Sem permissão para remover etiqueta';
  END IF;

  SELECT tg.*, ei.id AS ei_id, ei.empresa_id INTO t
    FROM public.sup_estoque_tag tg
    JOIN public.sup_estoque_item ei ON ei.id = tg.item_estoque_id
   WHERE tg.codigo = upper(trim(p_codigo)) FOR UPDATE OF tg;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Etiqueta não encontrada'; END IF;

  INSERT INTO public.sup_estoque_movimento
    (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho, usuario_id, usuario_nome)
  VALUES (t.empresa_id, t.ei_id, t.codigo, 'remocao', 1, t.tamanho, v_uid, v_nome);

  IF t.tipo = 'massa' AND COALESCE(t.quantidade_massa, 0) > 1 THEN
    UPDATE public.sup_estoque_tag tg
       SET quantidade_massa = tg.quantidade_massa - 1 WHERE tg.id = t.id;
    RETURN jsonb_build_object('acao', 'decrementou',
             'saldo', COALESCE(t.quantidade_massa, 0) - 1);
  END IF;

  DELETE FROM public.sup_estoque_tag tg WHERE tg.id = t.id;

  SELECT count(*) INTO v_rest
    FROM public.sup_estoque_tag tg WHERE tg.item_estoque_id = t.ei_id;

  IF v_rest = 0 THEN
    DELETE FROM public.sup_estoque_item ei WHERE ei.id = t.ei_id;
    RETURN jsonb_build_object('acao', 'removeu_item');
  END IF;

  -- Resequencia as restantes para não ficar buraco na numeração exibida.
  WITH nova AS (
    SELECT tg.id, row_number() OVER (ORDER BY tg.sequencia, tg.created_at) AS n
      FROM public.sup_estoque_tag tg WHERE tg.item_estoque_id = t.ei_id
  )
  UPDATE public.sup_estoque_tag tg SET sequencia = nova.n
    FROM nova WHERE nova.id = tg.id;

  RETURN jsonb_build_object('acao', 'removeu', 'restantes', v_rest);
END $$;

-- ── Grants ───────────────────────────────────────────────────────────
-- Nenhuma é concedida a anon: estoque é operação interna.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.sup_est_nome_usuario()',
    'public.sup_est_entrada(jsonb)',
    'public.sup_est_validar(text[], uuid, uuid)',
    'public.sup_est_baixar(uuid, text, text, jsonb)',
    'public.sup_est_tags_do_pedido(uuid)',
    'public.sup_est_devolver(text[], text, text)',
    'public.sup_est_remover_tag(text)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
