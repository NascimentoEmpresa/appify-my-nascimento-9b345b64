-- =====================================================================
-- SIS-2026-0322 — tipo de envio e rastreio no despacho
--
-- A assinatura de quatro argumentos continua existindo durante a janela em
-- que a migration já foi aplicada, mas o frontend novo ainda não foi
-- publicado. Ela é um wrapper; a regra de negócio vive somente na função de
-- cinco argumentos para não nascerem duas implementações divergentes.
-- =====================================================================

ALTER TABLE public.sup_pedido
  ADD COLUMN IF NOT EXISTS envio_tipo text
    CHECK (envio_tipo IN ('SUPERVISOR', 'CORREIO')),
  ADD COLUMN IF NOT EXISTS envio_rastreio text;

CREATE OR REPLACE FUNCTION public.sup_pedido_validar_envio_despacho()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  -- Além da RPC, esta barreira cobre UPDATE direto no SQL Editor e qualquer
  -- integração futura. Linhas históricas não são tocadas até que alguém tente
  -- mudar o status ou os próprios campos de envio.
  IF NEW.status = 'DESPACHADO'
     AND (
       TG_OP = 'INSERT'
       OR OLD.status IS DISTINCT FROM NEW.status
       OR OLD.envio_tipo IS DISTINCT FROM NEW.envio_tipo
       OR OLD.envio_rastreio IS DISTINCT FROM NEW.envio_rastreio
     ) THEN
    IF NEW.envio_tipo IS NULL OR NEW.envio_tipo NOT IN ('SUPERVISOR', 'CORREIO') THEN
      RAISE EXCEPTION 'Informe o tipo de envio para despachar o pedido';
    END IF;
    IF NEW.envio_tipo = 'CORREIO' AND nullif(btrim(NEW.envio_rastreio), '') IS NULL THEN
      RAISE EXCEPTION 'Informe o ID de rastreio dos Correios';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sup_pedido_validar_envio ON public.sup_pedido;
CREATE TRIGGER trg_sup_pedido_validar_envio
  BEFORE INSERT OR UPDATE ON public.sup_pedido
  FOR EACH ROW EXECUTE FUNCTION public.sup_pedido_validar_envio_despacho();

CREATE OR REPLACE FUNCTION public.sup_est_baixar(
  p_pedido_id uuid,
  p_status text,
  p_observacao text,
  p_baixas jsonb,
  p_envio jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_pedidos_materiais', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para atualizar pedidos';
  END IF;

  SELECT * INTO v_ped FROM public.sup_pedido p WHERE p.id = p_pedido_id FOR UPDATE;
  IF v_ped.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;

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
      IF v_delta > COALESCE(t.quantidade_massa, 0) THEN
        v_rej := v_rej || jsonb_build_object('codigo', t.codigo,
                   'motivo', format('Quantidade adicional (%s) maior que a disponível (%s)',
                                    v_delta, COALESCE(t.quantidade_massa, 0)));
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
END $$;

CREATE OR REPLACE FUNCTION public.sup_est_baixar(
  p_pedido_id uuid,
  p_status text,
  p_observacao text,
  p_baixas jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  -- Compatibilidade de implantação: o frontend antigo ainda resolve esta
  -- aridade enquanto o deploy da interface não acompanha a migration.
  -- O default SUPERVISOR existe somente nessa janela de deploy; a tela nova
  -- sempre envia explicitamente o tipo escolhido pelo operador.
  SELECT public.sup_est_baixar(
    p_pedido_id,
    p_status,
    p_observacao,
    p_baixas,
    CASE WHEN p_status = 'DESPACHADO'
      THEN jsonb_build_object('tipo', 'SUPERVISOR')
      ELSE NULL::jsonb
    END
  );
$$;

REVOKE ALL ON FUNCTION public.sup_est_baixar(uuid, text, text, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_est_baixar(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_est_baixar(uuid, text, text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_est_baixar(uuid, text, text, jsonb) TO authenticated;

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.sup_est_baixar(uuid, text, text, jsonb, jsonb);
-- DROP TRIGGER IF EXISTS trg_sup_pedido_validar_envio ON public.sup_pedido;
-- DROP FUNCTION IF EXISTS public.sup_pedido_validar_envio_despacho();
-- A assinatura de quatro argumentos deve ser restaurada a partir da migration
-- 20260820000002 antes de remover as colunas abaixo.
-- ALTER TABLE public.sup_pedido DROP COLUMN IF EXISTS envio_rastreio;
-- ALTER TABLE public.sup_pedido DROP COLUMN IF EXISTS envio_tipo;

NOTIFY pgrst, 'reload schema';
