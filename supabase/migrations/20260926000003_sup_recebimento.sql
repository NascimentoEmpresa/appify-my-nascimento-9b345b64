-- =====================================================================
-- SIS-2026-0207 — recebimento ligado ao novo pedido de compra
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sup_receb_itens(uuid);
--   DROP FUNCTION IF EXISTS public.sup_receb_tratar_ocorrencia(uuid, text, text);
--   DROP FUNCTION IF EXISTS public.sup_receb_recusar(uuid, text);
--   DROP FUNCTION IF EXISTS public.sup_receb_conferir(uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.sup_receb_iniciar(uuid);
--   ALTER TABLE public.recebimento_nf_item
--     DROP COLUMN IF EXISTS sup_compra_pedido_item_id,
--     DROP COLUMN IF EXISTS sup_item_id,
--     DROP COLUMN IF EXISTS divergencia,
--     DROP COLUMN IF EXISTS quantidade_conferida;
--   ALTER TABLE public.recebimento_nf DROP COLUMN IF EXISTS sup_compra_pedido_id;
-- =====================================================================

UPDATE public.app_menu am
   SET ativo = true
  FROM public.app_modulo m
 WHERE m.id = am.modulo_id
   AND m.codigo = 'suprimentos'
   AND am.codigo IN ('recebimentos', 'nf-entrada');

-- As colunas fiscais são criadas aqui também porque os triggers de espelho
-- abaixo já precisam delas. A migration da fase fiscal repete o DDL com
-- IF NOT EXISTS para continuar aplicável isoladamente em ambientes parciais.
ALTER TABLE public.nf_entrada
  ADD COLUMN IF NOT EXISTS sup_compra_pedido_id uuid
    REFERENCES public.sup_compra_pedido(id) ON DELETE SET NULL;
ALTER TABLE public.nf_entrada_item
  ADD COLUMN IF NOT EXISTS sup_item_id uuid REFERENCES public.sup_item(id) ON DELETE SET NULL;

ALTER TABLE public.recebimento_nf
  ADD COLUMN IF NOT EXISTS sup_compra_pedido_id uuid
    REFERENCES public.sup_compra_pedido(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_recebimento_sup_compra_pedido
  ON public.recebimento_nf(sup_compra_pedido_id);

ALTER TABLE public.recebimento_nf_item
  ADD COLUMN IF NOT EXISTS quantidade_conferida numeric(14,3),
  ADD COLUMN IF NOT EXISTS divergencia text
    CHECK (divergencia IS NULL OR divergencia IN ('igual', 'a_menos', 'a_mais', 'item_nao_pedido')),
  ADD COLUMN IF NOT EXISTS sup_item_id uuid REFERENCES public.sup_item(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sup_compra_pedido_item_id uuid
    REFERENCES public.sup_compra_pedido_item(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_recebimento_item_sup_item
  ON public.recebimento_nf_item(sup_item_id);
CREATE INDEX IF NOT EXISTS idx_recebimento_item_pedido_item
  ON public.recebimento_nf_item(sup_compra_pedido_item_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_recebimento_item_nf_item
  ON public.recebimento_nf_item(nf_item_id) WHERE nf_item_id IS NOT NULL;

-- A conferência começa zerada. Pré-preencher com a quantidade da nota induzia
-- o conferente a apenas confirmar o número exibido, exatamente o caso real que
-- motivou a conferência cega.
UPDATE public.recebimento_nf_item
   SET qtd_recebida = 0
 WHERE NOT conferido AND quantidade_conferida IS NULL;

CREATE OR REPLACE FUNCTION public.nf_criar_recebimento()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_receb_id uuid;
  v_almox uuid;
BEGIN
  v_almox := NEW.almoxarifado_id;
  IF v_almox IS NULL THEN
    SELECT a.id INTO v_almox
      FROM public.almoxarifado a
     WHERE a.empresa_id = NEW.empresa_id AND a.is_matriz
     LIMIT 1;
  END IF;

  INSERT INTO public.recebimento_nf (
    empresa_id, nf_id, almoxarifado_id, status, sup_compra_pedido_id
  ) VALUES (
    NEW.empresa_id, NEW.id, v_almox, 'aguardando', NEW.sup_compra_pedido_id
  )
  ON CONFLICT (nf_id) DO UPDATE
    SET sup_compra_pedido_id = COALESCE(
      public.recebimento_nf.sup_compra_pedido_id,
      EXCLUDED.sup_compra_pedido_id
    )
  RETURNING id INTO v_receb_id;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_nf_criar_recebimento ON public.nf_entrada;
CREATE TRIGGER trg_nf_criar_recebimento
  AFTER INSERT ON public.nf_entrada
  FOR EACH ROW EXECUTE FUNCTION public.nf_criar_recebimento();

CREATE OR REPLACE FUNCTION public.nf_item_espelhar_recebimento()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_receb_id uuid;
  v_pedido_id uuid;
  v_pedido_item_id uuid;
BEGIN
  SELECT r.id, r.sup_compra_pedido_id
    INTO v_receb_id, v_pedido_id
    FROM public.recebimento_nf r
   WHERE r.nf_id = NEW.nf_id;

  IF v_pedido_id IS NOT NULL AND NEW.sup_item_id IS NOT NULL THEN
    SELECT pi.id INTO v_pedido_item_id
      FROM public.sup_compra_pedido_item pi
     WHERE pi.pedido_id = v_pedido_id
       AND pi.sup_item_id = NEW.sup_item_id
       AND NOT EXISTS (
         SELECT 1 FROM public.recebimento_nf_item ri
          WHERE ri.recebimento_id = v_receb_id
            AND ri.sup_compra_pedido_item_id = pi.id
       )
     ORDER BY pi.ordem, pi.id
     LIMIT 1;
  END IF;

  IF v_receb_id IS NOT NULL THEN
    INSERT INTO public.recebimento_nf_item (
      recebimento_id, nf_item_id, produto_id, sup_item_id,
      sup_compra_pedido_item_id, qtd_nf, qtd_recebida, condicao, conferido
    ) VALUES (
      v_receb_id, NEW.id, NEW.produto_id, NEW.sup_item_id,
      v_pedido_item_id, NEW.quantidade, 0, 'ok', false
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_nf_item_espelhar_recebimento ON public.nf_entrada_item;
CREATE TRIGGER trg_nf_item_espelhar_recebimento
  AFTER INSERT ON public.nf_entrada_item
  FOR EACH ROW EXECUTE FUNCTION public.nf_item_espelhar_recebimento();

-- A partir desta migration, as telas não escrevem diretamente nessas tabelas.
DROP POLICY IF EXISTS receb_insert ON public.recebimento_nf;
DROP POLICY IF EXISTS receb_update ON public.recebimento_nf;
DROP POLICY IF EXISTS receb_item_all ON public.recebimento_nf_item;
DROP POLICY IF EXISTS receb_item_select ON public.recebimento_nf_item;
DROP POLICY IF EXISTS ocor_insert ON public.recebimento_ocorrencia;
DROP POLICY IF EXISTS ocor_update ON public.recebimento_ocorrencia;

CREATE OR REPLACE FUNCTION public.sup_receb_itens(p_recebimento_id uuid)
RETURNS TABLE (
  id uuid,
  descricao text,
  unidade text,
  quantidade_esperada numeric,
  quantidade_conferida numeric,
  condicao text,
  observacoes text,
  divergencia text,
  conferido boolean,
  created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'recebimentos', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para visualizar recebimentos';
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
         ri.quantidade_conferida,
         ri.condicao::text,
         ri.observacoes,
         ri.divergencia,
         ri.conferido,
         ri.created_at
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

  UPDATE public.recebimento_nf r
     SET status = 'em_conferencia', iniciado_em = COALESCE(r.iniciado_em, now()),
         recebido_por = auth.uid()
   WHERE r.id = p_recebimento_id AND r.status = 'aguardando'
  RETURNING * INTO v_recebimento;

  IF v_recebimento.id IS NULL THEN
    RAISE EXCEPTION 'Recebimento não encontrado ou já iniciado';
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
  IF v_recebimento.status <> 'em_conferencia' THEN
    RAISE EXCEPTION 'O recebimento não está em conferência';
  END IF;

  SELECT count(*) INTO v_total_itens
    FROM public.recebimento_nf_item ri
   WHERE ri.recebimento_id = p_recebimento_id;
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
      IF v_esperada IS NULL THEN
        v_divergencia := 'item_nao_pedido';
      ELSIF v_conferida = v_esperada THEN
        v_divergencia := 'igual';
      ELSIF v_conferida < v_esperada THEN
        v_divergencia := 'a_menos';
      ELSE
        v_divergencia := 'a_mais';
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
      observacoes = nullif(btrim(v_item->>'observacoes'), ''),
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
        END,
        auth.uid()
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

    UPDATE public.sup_compra_pedido p
       SET status = v_status_pedido
     WHERE p.id = v_recebimento.sup_compra_pedido_id
       AND p.status <> 'cancelado';
  END IF;

  RETURN jsonb_build_object(
    'status_recebimento', CASE WHEN v_tem_divergencia THEN 'recebido_com_ocorrencia' ELSE 'recebido' END,
    'status_pedido', v_status_pedido,
    'tem_divergencia', v_tem_divergencia
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
  IF nullif(btrim(p_motivo), '') IS NULL THEN RAISE EXCEPTION 'Informe o motivo da recusa'; END IF;

  UPDATE public.recebimento_nf r
     SET status = 'cancelado', finalizado_em = now(), recebido_por = auth.uid(),
         observacoes = concat_ws(E'\n', nullif(r.observacoes, ''), 'Recusa: ' || btrim(p_motivo))
   WHERE r.id = p_recebimento_id
     AND r.status IN ('aguardando', 'em_conferencia')
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
BEGIN
  IF NOT public.can_access(auth.uid(), 'recebimentos', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para tratar ocorrências';
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

  IF v_ocorrencia.id IS NULL THEN RAISE EXCEPTION 'Ocorrência não encontrada'; END IF;
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

NOTIFY pgrst, 'reload schema';
