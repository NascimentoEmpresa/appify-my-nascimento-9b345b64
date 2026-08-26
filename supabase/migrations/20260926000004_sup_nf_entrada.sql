-- =====================================================================
-- SIS-2026-0207 — NF de entrada no catálogo Supply e estoque por etiqueta
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_nf_item_propagar_sup_item ON public.nf_entrada_item;
--   DROP FUNCTION IF EXISTS public.nf_item_propagar_sup_item_recebimento();
--   DROP FUNCTION IF EXISTS public.sup_nf_confirmar_item(uuid);
--   DROP FUNCTION IF EXISTS public.sup_nf_vincular_item(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.sup_nf_cancelar(uuid);
--   DROP FUNCTION IF EXISTS public.sup_nf_validar(uuid);
--   DROP FUNCTION IF EXISTS public.sup_nf_criar_manual(jsonb);
--   ALTER TABLE public.nf_entrada_item DROP COLUMN IF EXISTS sup_item_id;
--   ALTER TABLE public.nf_entrada DROP COLUMN IF EXISTS sup_compra_pedido_id;
--   ALTER TABLE public.sup_item DROP COLUMN IF EXISTS codigo_barras;
-- =====================================================================

ALTER TABLE public.nf_entrada
  ADD COLUMN IF NOT EXISTS sup_compra_pedido_id uuid
    REFERENCES public.sup_compra_pedido(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_nf_entrada_sup_compra_pedido
  ON public.nf_entrada(sup_compra_pedido_id);

ALTER TABLE public.nf_entrada_item
  ADD COLUMN IF NOT EXISTS sup_item_id uuid REFERENCES public.sup_item(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_nf_entrada_item_sup_item
  ON public.nf_entrada_item(sup_item_id);

-- O catálogo não possuía GTIN/EAN. Sem esta coluna o fallback solicitado para
-- notas cujo fornecedor ainda não cadastrou o de-para seria apenas nominal.
ALTER TABLE public.sup_item
  ADD COLUMN IF NOT EXISTS codigo_barras text;
CREATE INDEX IF NOT EXISTS idx_sup_item_codigo_barras
  ON public.sup_item(codigo_barras) WHERE codigo_barras IS NOT NULL;

-- Quando um item pendente é vinculado manualmente, o espelho já criado para
-- o recebimento precisa receber o mesmo material; do contrário a conferência
-- o classificaria como "não pedido" mesmo após a revisão fiscal.
CREATE OR REPLACE FUNCTION public.nf_item_propagar_sup_item_recebimento()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_pedido_id uuid;
  v_pedido_item_id uuid;
BEGIN
  SELECT r.sup_compra_pedido_id INTO v_pedido_id
    FROM public.recebimento_nf_item ri
    JOIN public.recebimento_nf r ON r.id = ri.recebimento_id
   WHERE ri.nf_item_id = NEW.id;

  IF v_pedido_id IS NOT NULL AND NEW.sup_item_id IS NOT NULL THEN
    SELECT pi.id INTO v_pedido_item_id
      FROM public.sup_compra_pedido_item pi
     WHERE pi.pedido_id = v_pedido_id
       AND pi.sup_item_id = NEW.sup_item_id
     ORDER BY pi.ordem, pi.id
     LIMIT 1;
  END IF;

  UPDATE public.recebimento_nf_item ri
     SET sup_item_id = NEW.sup_item_id,
         sup_compra_pedido_item_id = v_pedido_item_id
   WHERE ri.nf_item_id = NEW.id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_nf_item_propagar_sup_item ON public.nf_entrada_item;
CREATE TRIGGER trg_nf_item_propagar_sup_item
  AFTER UPDATE OF sup_item_id ON public.nf_entrada_item
  FOR EACH ROW
  WHEN (OLD.sup_item_id IS DISTINCT FROM NEW.sup_item_id)
  EXECUTE FUNCTION public.nf_item_propagar_sup_item_recebimento();

-- A escrita de usuário passa exclusivamente pelas RPCs abaixo. A Edge
-- Function de XML usa service_role e continua responsável pela importação.
DROP POLICY IF EXISTS nfe_insert ON public.nf_entrada;
DROP POLICY IF EXISTS nfe_update ON public.nf_entrada;
DROP POLICY IF EXISTS nfe_delete ON public.nf_entrada;
DROP POLICY IF EXISTS nfi_write ON public.nf_entrada_item;

CREATE OR REPLACE FUNCTION public.nf_entrada_validar_manual()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_status text;
BEGIN
  IF NEW.origem = 'manual' THEN
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

DROP TRIGGER IF EXISTS trg_nf_entrada_validar_manual ON public.nf_entrada;
CREATE TRIGGER trg_nf_entrada_validar_manual
  BEFORE INSERT OR UPDATE ON public.nf_entrada
  FOR EACH ROW EXECUTE FUNCTION public.nf_entrada_validar_manual();

CREATE OR REPLACE FUNCTION public.sup_nf_criar_manual(p_dados jsonb)
RETURNS public.nf_entrada
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_pedido public.sup_compra_pedido;
  v_fornecedor public.fornecedor;
  v_nf public.nf_entrada;
  v_chave text;
BEGIN
  IF NOT public.can_access(auth.uid(), 'nf-entrada', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para criar NF';
  END IF;

  SELECT p.* INTO v_pedido
    FROM public.sup_compra_pedido p
   WHERE p.id = nullif(p_dados->>'sup_compra_pedido_id', '')::uuid;
  IF v_pedido.id IS NULL THEN RAISE EXCEPTION 'Selecione um pedido de compra'; END IF;

  SELECT f.* INTO v_fornecedor
    FROM public.fornecedor f
   WHERE f.id = COALESCE(nullif(p_dados->>'fornecedor_id', '')::uuid, v_pedido.fornecedor_id);
  IF v_fornecedor.id IS NULL THEN RAISE EXCEPTION 'Fornecedor não encontrado'; END IF;

  v_chave := COALESCE(nullif(regexp_replace(p_dados->>'chave_acesso', '[^0-9A-Za-z-]', '', 'g'), ''),
                      'MANUAL-' || replace(gen_random_uuid()::text, '-', ''));

  INSERT INTO public.nf_entrada (
    empresa_id, chave_acesso, numero, serie, data_emissao,
    fornecedor_id, fornecedor_cnpj, fornecedor_razao,
    valor_produtos, valor_total, status, destino, almoxarifado_id,
    sup_compra_pedido_id, origem, importado_por, lancada_manualmente_por,
    observacoes
  ) VALUES (
    v_pedido.empresa_id, v_chave, nullif(btrim(p_dados->>'numero'), ''),
    COALESCE(nullif(btrim(p_dados->>'serie'), ''), '1'),
    COALESCE(nullif(p_dados->>'data_emissao', '')::date, CURRENT_DATE),
    v_fornecedor.id, v_fornecedor.cnpj_cpf, v_fornecedor.razao_social,
    COALESCE(nullif(p_dados->>'valor_total', '')::numeric, v_pedido.valor_total),
    COALESCE(nullif(p_dados->>'valor_total', '')::numeric, v_pedido.valor_total),
    'importada', 'estoque', nullif(p_dados->>'almoxarifado_id', '')::uuid,
    v_pedido.id, 'manual', auth.uid(), auth.uid(),
    nullif(btrim(p_dados->>'observacoes'), '')
  ) RETURNING * INTO v_nf;

  INSERT INTO public.nf_entrada_item (
    nf_id, empresa_id, numero_item, sup_item_id, descricao_original,
    unidade, quantidade, valor_unitario, valor_total, status
  )
  SELECT v_nf.id, v_pedido.empresa_id,
         row_number() OVER (ORDER BY pi.ordem, pi.id)::integer,
         pi.sup_item_id, pi.nome_item, COALESCE(pi.unidade, 'UN'),
         pi.quantidade, COALESCE(pi.valor_unitario, 0),
         pi.quantidade * COALESCE(pi.valor_unitario, 0),
         CASE WHEN pi.sup_item_id IS NULL THEN 'pendente_revisao'::public.nf_item_status
              ELSE 'ok'::public.nf_item_status END
    FROM public.sup_compra_pedido_item pi
   WHERE pi.pedido_id = v_pedido.id
   ORDER BY pi.ordem, pi.id;

  RETURN v_nf;
END $$;

CREATE OR REPLACE FUNCTION public.sup_nf_vincular_item(p_nf_item_id uuid, p_sup_item_id uuid)
RETURNS public.nf_entrada_item
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_item public.nf_entrada_item;
BEGIN
  IF NOT public.can_access(auth.uid(), 'nf-entrada', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para revisar itens da NF';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sup_item i WHERE i.id = p_sup_item_id AND i.ativo) THEN
    RAISE EXCEPTION 'Material do catálogo não encontrado';
  END IF;

  UPDATE public.nf_entrada_item i
     SET sup_item_id = p_sup_item_id, status = 'ok', produto_criado_auto = false
   WHERE i.id = p_nf_item_id
  RETURNING * INTO v_item;
  IF v_item.id IS NULL THEN RAISE EXCEPTION 'Item da NF não encontrado'; END IF;
  RETURN v_item;
END $$;

CREATE OR REPLACE FUNCTION public.sup_nf_confirmar_item(p_nf_item_id uuid)
RETURNS public.nf_entrada_item
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_item public.nf_entrada_item;
BEGIN
  IF NOT public.can_access(auth.uid(), 'nf-entrada', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para revisar itens da NF';
  END IF;
  UPDATE public.nf_entrada_item i SET status = 'ok'
   WHERE i.id = p_nf_item_id AND i.sup_item_id IS NOT NULL
  RETURNING * INTO v_item;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'Vincule o item ao catálogo de materiais antes de confirmar';
  END IF;
  RETURN v_item;
END $$;

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
                 || ' — ' || v_nf.chave_acesso;

  FOR v_item IN
    SELECT i.*,
           COALESCE((
             SELECT ri.quantidade_conferida
               FROM public.recebimento_nf_item ri
              WHERE ri.nf_item_id = i.id
              LIMIT 1
           ), i.quantidade) AS quantidade_entrada
      FROM public.nf_entrada_item i
     WHERE i.nf_id = _nf_id
     ORDER BY i.numero_item
  LOOP
    v_quantidade := v_item.quantidade_entrada;
    CONTINUE WHEN COALESCE(v_quantidade, 0) <= 0;

    -- A RPC existente continua sendo a única dona da criação/reciclagem de
    -- etiquetas. A NF fornece um código determinístico por linha e usa tag em
    -- massa para representar a quantidade conferida daquela linha.
    v_resultado := public.sup_est_entrada(jsonb_build_object(
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
        'quantidade', GREATEST(ceil(v_quantidade)::integer, 1),
        'valor_unitario', v_item.valor_unitario
      ))
    ));

    IF jsonb_array_length(COALESCE(v_resultado->'rejeitadas', '[]'::jsonb)) > 0 THEN
      RAISE EXCEPTION 'Falha ao gerar etiqueta do item %: %',
        v_item.numero_item, v_resultado->'rejeitadas';
    END IF;

    v_item_estoque_id := (v_resultado->>'item_estoque_id')::uuid;

    -- O trigger do estoque já registra a mudança de preço como "entrada".
    -- Quando ele disparou nesta chamada, promovemos a linha para "nf" para não
    -- duplicar o histórico; se o preço era igual, criamos a referência da NF.
    SELECT p.id INTO v_preco_id
      FROM public.sup_item_preco p
     WHERE p.item_estoque_id = v_item_estoque_id
       AND p.origem = 'entrada'
       AND p.registrado_em >= v_inicio
     ORDER BY p.registrado_em DESC
     LIMIT 1;

    IF v_preco_id IS NOT NULL THEN
      UPDATE public.sup_item_preco p
         SET origem = 'nf', documento = v_documento,
             fornecedor_id = v_nf.fornecedor_id,
             fornecedor_nome = v_nf.fornecedor_razao
       WHERE p.id = v_preco_id;
    ELSE
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

CREATE OR REPLACE FUNCTION public.sup_nf_validar(p_nf_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'nf-entrada', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para validar NF';
  END IF;
  UPDATE public.nf_entrada n
     SET status = 'validada', validado_por = auth.uid(), validado_em = now()
   WHERE n.id = p_nf_id AND n.status = 'importada';
  IF NOT FOUND THEN RAISE EXCEPTION 'NF não encontrada ou não está importada'; END IF;

  -- Validar a nota conclui a entrada: a função vigente acima chama
  -- sup_est_entrada, que mantém em um só lugar a lógica das etiquetas.
  RETURN public.nf_lancar_estoque(p_nf_id);
END $$;

CREATE OR REPLACE FUNCTION public.sup_nf_cancelar(p_nf_id uuid)
RETURNS public.nf_entrada
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_nf public.nf_entrada;
BEGIN
  IF NOT public.can_access(auth.uid(), 'nf-entrada', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para cancelar NF';
  END IF;
  UPDATE public.nf_entrada n SET status = 'cancelada'
   WHERE n.id = p_nf_id AND n.status <> 'lancada_estoque'
  RETURNING * INTO v_nf;
  IF v_nf.id IS NULL THEN RAISE EXCEPTION 'NF não pode ser cancelada'; END IF;
  RETURN v_nf;
END $$;

REVOKE ALL ON FUNCTION public.sup_nf_criar_manual(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_nf_vincular_item(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_nf_confirmar_item(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nf_lancar_estoque(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_nf_validar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_nf_cancelar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_nf_criar_manual(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_nf_vincular_item(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_nf_confirmar_item(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_lancar_estoque(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_nf_validar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_nf_cancelar(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
