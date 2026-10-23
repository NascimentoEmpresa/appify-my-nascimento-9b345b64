-- SIS-2026-0649 — Romaneio também para pedido com parte pendente de compra
--
-- Quando alguns itens já saíram do estoque e outros ficaram em compra, o
-- pedido continua em AGUARDANDO COMPRA. Ele precisa poder seguir no romaneio
-- com os itens disponíveis; a situação derivada continua mostrando-o nas
-- filas de compra e de parcialmente despachado.
--
-- ROLLBACK:
--   Recriar sup_romaneio_criar e sup_retirada_romaneio_confirmar com a
--   guarda de status limitada a 'AGUARDANDO ENVIO', como em
--   20260930000261_sup_romaneio_retirada.sql.

-- 1) Criação do romaneio -------------------------------------------------

CREATE OR REPLACE FUNCTION public.sup_romaneio_criar(
  p_pedido_ids uuid[],
  p_volumes integer,
  p_observacao text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid            uuid := auth.uid();
  v_nome           text;
  v_romaneio       public.sup_romaneio%ROWTYPE;
  v_total_esperado integer;
  v_total_encontrado integer;
  v_contratos      integer;
  v_contrato_id    uuid;
  v_contrato_nome  text;
  v_status_invalidos integer;
  v_com_romaneio   integer;
  v_sem_contrato   integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_romaneio', 'incluir') THEN
    RAISE EXCEPTION 'Seu usuário não pode criar romaneios. Peça a liberação de "Romaneio de Retirada" em Acesso por Usuário.';
  END IF;
  IF p_volumes IS NOT NULL AND p_volumes <= 0 THEN
    RAISE EXCEPTION 'A quantidade de volumes deve ser maior que zero.';
  END IF;

  SELECT count(DISTINCT ids.id) INTO v_total_esperado
    FROM unnest(COALESCE(p_pedido_ids, ARRAY[]::uuid[])) AS ids(id);
  IF v_total_esperado = 0 THEN
    RAISE EXCEPTION 'Selecione pelo menos um pedido para o romaneio.';
  END IF;

  PERFORM p.id
    FROM public.sup_pedido p
   WHERE p.id = ANY(p_pedido_ids)
   ORDER BY p.id
   FOR UPDATE;

  -- Pedido em AGUARDANDO COMPRA pode ter itens já separados para expedição.
  -- O vínculo com romaneio continua exclusivo enquanto ele estiver ABERTO.
  SELECT count(*), count(DISTINCT p.contrato_id), min(p.contrato_id::text)::uuid,
         min(p.contrato_nome),
         count(*) FILTER (WHERE p.status NOT IN ('AGUARDANDO ENVIO', 'AGUARDANDO COMPRA')),
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM public.sup_romaneio r
            WHERE r.id = p.romaneio_id AND r.status = 'ABERTO')),
         count(*) FILTER (WHERE p.contrato_id IS NULL)
    INTO v_total_encontrado, v_contratos, v_contrato_id, v_contrato_nome,
         v_status_invalidos, v_com_romaneio, v_sem_contrato
    FROM public.sup_pedido p
   WHERE p.id = ANY(p_pedido_ids);

  IF v_total_encontrado <> v_total_esperado THEN
    RAISE EXCEPTION 'Um ou mais pedidos selecionados não existem.';
  END IF;
  IF v_contrato_id IS NULL OR v_contratos <> 1 OR v_sem_contrato > 0 THEN
    RAISE EXCEPTION 'O romaneio só pode reunir pedidos do mesmo contrato.';
  END IF;
  IF v_status_invalidos > 0 THEN
    RAISE EXCEPTION 'Todos os pedidos do romaneio devem estar em Aguardando envio ou Aguardando compra.';
  END IF;
  IF v_com_romaneio > 0 THEN
    RAISE EXCEPTION 'Um ou mais pedidos já pertencem a outro romaneio.';
  END IF;

  v_nome := COALESCE(public.sup_est_nome_usuario(), auth.jwt()->>'email', 'Usuário');

  INSERT INTO public.sup_romaneio
    (contrato_id, contrato_nome, volumes, observacao, criado_por, criado_por_nome)
  VALUES
    (v_contrato_id, v_contrato_nome, p_volumes, nullif(btrim(p_observacao), ''), v_uid, v_nome)
  RETURNING * INTO v_romaneio;

  UPDATE public.sup_pedido p
     SET romaneio_id = v_romaneio.id
   WHERE p.id = ANY(p_pedido_ids);

  INSERT INTO public.sup_pedido_historico
    (pedido_id, acao, status_anterior, status_novo, observacao,
     alterado_por, alterado_por_nome)
  SELECT p.id, 'ROMANEIO', p.status, p.status,
         format('Pedido incluído no romaneio %s por %s.', v_romaneio.codigo, v_nome),
         v_uid, v_nome
    FROM public.sup_pedido p
   WHERE p.id = ANY(p_pedido_ids);

  RETURN jsonb_build_object(
    'id', v_romaneio.id,
    'codigo', v_romaneio.codigo,
    'contrato_id', v_romaneio.contrato_id,
    'contrato_nome', v_romaneio.contrato_nome,
    'status', v_romaneio.status,
    'volumes', v_romaneio.volumes,
    'observacao', v_romaneio.observacao,
    'created_at', v_romaneio.created_at
  );
END $fn$;

-- 2) Retirada do romaneio ------------------------------------------------

CREATE OR REPLACE FUNCTION public.sup_retirada_romaneio_confirmar(
  p_ref text,
  p_pedidos jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid       uuid := auth.uid();
  v_nome      text;
  v_id        uuid;
  v_romaneio  public.sup_romaneio%ROWTYPE;
  v_agora     timestamptz := now();
  v_pedido    record;
  v_resposta  record;
  v_retirados jsonb := '[]'::jsonb;
  v_removidos jsonb := '[]'::jsonb;
  v_pulados   jsonb := '[]'::jsonb;
  v_desconhecidos integer;
  v_duplicados integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF COALESCE((auth.jwt()->>'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'A retirada exige login com um usuário do sistema.';
  END IF;
  IF NOT public.can_access(v_uid, 'sup_retirada_entrega', 'incluir') THEN
    RAISE EXCEPTION 'Seu usuário não pode confirmar retirada. Peça a liberação de "Retirada para Entrega" em Acesso por Usuário.';
  END IF;
  IF p_pedidos IS NULL OR jsonb_typeof(p_pedidos) <> 'array' THEN
    RAISE EXCEPTION 'A lista de pedidos do romaneio é inválida.';
  END IF;

  v_id := public.sup_romaneio_localizar(p_ref);
  IF v_id IS NULL THEN RAISE EXCEPTION 'Romaneio não encontrado: %', p_ref; END IF;

  SELECT * INTO v_romaneio
    FROM public.sup_romaneio r
   WHERE r.id = v_id
   FOR UPDATE;

  IF v_romaneio.status = 'RETIRADO' THEN
    RETURN jsonb_build_object(
      'ja_retirado', true,
      'codigo', v_romaneio.codigo,
      'retirado_em', v_romaneio.retirado_em,
      'retirado_por_nome', v_romaneio.retirado_por_nome,
      'retirados', '[]'::jsonb,
      'removidos', '[]'::jsonb,
      'pulados', '[]'::jsonb
    );
  END IF;
  IF v_romaneio.status <> 'ABERTO' THEN
    RAISE EXCEPTION 'O romaneio % foi cancelado e não pode ser retirado.', v_romaneio.codigo;
  END IF;

  SELECT count(*) INTO v_desconhecidos
    FROM jsonb_to_recordset(p_pedidos) AS x(pedido_id uuid, retirado boolean,
      ficha_epi_fisica boolean, cracha_fisico boolean)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.sup_pedido p
      WHERE p.id = x.pedido_id AND p.romaneio_id = v_id
   );
  IF v_desconhecidos > 0 THEN
    RAISE EXCEPTION 'A confirmação contém pedido que não pertence ao romaneio.';
  END IF;

  SELECT count(*) - count(DISTINCT x.pedido_id) INTO v_duplicados
    FROM jsonb_to_recordset(p_pedidos) AS x(pedido_id uuid, retirado boolean,
      ficha_epi_fisica boolean, cracha_fisico boolean);
  IF v_duplicados > 0 THEN RAISE EXCEPTION 'A confirmação contém pedido duplicado.'; END IF;

  PERFORM p.id
    FROM public.sup_pedido p
   WHERE p.romaneio_id = v_id
   ORDER BY p.id
   FOR UPDATE;

  v_nome := COALESCE(public.sup_est_nome_usuario(), auth.jwt()->>'email', 'Usuário');

  FOR v_pedido IN
    SELECT p.id, p.pedido_id, p.status
      FROM public.sup_pedido p
     WHERE p.romaneio_id = v_id
     ORDER BY p.pedido_id
  LOOP
    SELECT x.* INTO v_resposta
      FROM jsonb_to_recordset(p_pedidos) AS x(pedido_id uuid, retirado boolean,
        ficha_epi_fisica boolean, cracha_fisico boolean)
     WHERE x.pedido_id = v_pedido.id;

    -- A compra pendente não bloqueia os itens já disponíveis do romaneio.
    -- Os demais estados representam alteração concorrente e são removidos.
    IF v_pedido.status NOT IN ('AGUARDANDO ENVIO', 'AGUARDANDO COMPRA') THEN
      UPDATE public.sup_pedido SET romaneio_id = NULL WHERE id = v_pedido.id;
      INSERT INTO public.sup_pedido_historico
        (pedido_id, acao, status_anterior, status_novo, observacao,
         alterado_por, alterado_por_nome, data_alteracao)
      VALUES
        (v_pedido.id, 'ROMANEIO', v_pedido.status, v_pedido.status,
         format('Pedido retirado do romaneio %s durante a conferência porque estava em %s.',
                v_romaneio.codigo, v_pedido.status),
         v_uid, v_nome, v_agora);
      v_pulados := v_pulados || jsonb_build_array(jsonb_build_object(
        'pedido_id', v_pedido.pedido_id,
        'motivo', format('Situação atual: %s', v_pedido.status)));
      CONTINUE;
    END IF;

    IF v_resposta.pedido_id IS NULL OR NOT COALESCE(v_resposta.retirado, false) THEN
      UPDATE public.sup_pedido SET romaneio_id = NULL WHERE id = v_pedido.id;
      INSERT INTO public.sup_pedido_historico
        (pedido_id, acao, status_anterior, status_novo, observacao,
         alterado_por, alterado_por_nome, data_alteracao)
      VALUES
        (v_pedido.id, 'ROMANEIO', v_pedido.status, v_pedido.status,
         format('Pedido desmarcado na conferência do romaneio %s por %s.', v_romaneio.codigo, v_nome),
         v_uid, v_nome, v_agora);
      v_removidos := v_removidos || jsonb_build_array(jsonb_build_object(
        'pedido_id', v_pedido.pedido_id, 'motivo', 'Desmarcado na conferência'));
      CONTINUE;
    END IF;

    IF v_resposta.ficha_epi_fisica IS NULL OR v_resposta.cracha_fisico IS NULL THEN
      RAISE EXCEPTION 'Informe Ficha de EPI física e Crachá físico para o pedido %.', v_pedido.pedido_id;
    END IF;

    PERFORM public.sup_retirada_registrar(
      v_pedido.id, v_uid, v_nome, v_agora,
      v_resposta.ficha_epi_fisica, v_resposta.cracha_fisico,
      v_romaneio.codigo
    );
    v_retirados := v_retirados || jsonb_build_array(jsonb_build_object(
      'pedido_id', v_pedido.pedido_id, 'status', 'RETIRADO PARA ENTREGA'));
  END LOOP;

  UPDATE public.sup_romaneio
     SET status = 'RETIRADO', retirado_em = v_agora,
         retirado_por = v_uid, retirado_por_nome = v_nome
   WHERE id = v_id;

  RETURN jsonb_build_object(
    'ja_retirado', false,
    'codigo', v_romaneio.codigo,
    'retirado_em', v_agora,
    'retirado_por_nome', v_nome,
    'retirados', v_retirados,
    'removidos', v_removidos,
    'pulados', v_pulados
  );
END $fn$;

NOTIFY pgrst, 'reload schema';
