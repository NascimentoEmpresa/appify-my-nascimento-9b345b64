-- =====================================================================
-- SIS-2026-0842 - pedido formal direto, inclusive pela necessidade do estoque
--
-- O pedido de compra existente dependia de uma despesa/cotacao do Malote.
-- Isso impedia o Compras de formalizar diretamente uma negociacao feita com
-- o fornecedor a partir da coluna "Comprar" do Estoque Saudavel. Esta
-- migration conserva o fluxo existente e acrescenta uma segunda origem.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sup_compra_criar_pedido_direto(uuid, uuid, jsonb, jsonb);
--   DROP TRIGGER IF EXISTS trg_sup_compra_pedido_contexto ON public.sup_compra_pedido;
--   DROP FUNCTION IF EXISTS public.sup_compra_pedido_preencher_contexto();
--   ALTER TABLE public.sup_compra_pedido DROP COLUMN IF EXISTS origem,
--     DROP COLUMN IF EXISTS comprador_nome, DROP COLUMN IF EXISTS cotacao_em;
--   -- despesa_id so pode voltar a NOT NULL depois de excluir os pedidos diretos.
-- =====================================================================

ALTER TABLE public.sup_compra_pedido
  ALTER COLUMN despesa_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'cotacao_malote',
  ADD COLUMN IF NOT EXISTS comprador_nome text,
  ADD COLUMN IF NOT EXISTS cotacao_em timestamptz;

DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sup_compra_pedido_origem_check'
  ) THEN
    ALTER TABLE public.sup_compra_pedido
      ADD CONSTRAINT sup_compra_pedido_origem_check
      CHECK (origem IN ('cotacao_malote', 'estoque_saudavel', 'manual'));
  END IF;
END
$mig$;

COMMENT ON COLUMN public.sup_compra_pedido.origem IS
  'De onde nasceu o pedido: cotacao do Malote, sugestao do Estoque Saudavel ou inclusao manual.';
COMMENT ON COLUMN public.sup_compra_pedido.comprador_nome IS
  'Snapshot do comprador responsavel pela negociacao, exibido no documento formal.';
COMMENT ON COLUMN public.sup_compra_pedido.cotacao_em IS
  'Data e hora em que a negociacao/cotacao usada no pedido foi concluida.';

-- Preserva no documento dos pedidos antigos o que ja estava registrado na
-- cotacao. COALESCE evita reescrever qualquer preenchimento posterior.
UPDATE public.sup_compra_pedido p
   SET comprador_nome = COALESCE(p.comprador_nome, d.cotacao_decidida_por_nome, p.enviado_por_nome),
       cotacao_em      = COALESCE(p.cotacao_em, d.cotacao_decidida_em, p.created_at)
  FROM public.malote_despesa d
 WHERE d.id = p.despesa_id
   AND (p.comprador_nome IS NULL OR p.cotacao_em IS NULL);

-- O caminho antigo (Malote) continua criando o pedido pela RPC já existente.
-- O trigger garante que os novos campos também sejam preenchidos ali, sem
-- duplicar/redefinir toda a função histórica de geração.
CREATE OR REPLACE FUNCTION public.sup_compra_pedido_preencher_contexto()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_comprador text;
  v_cotacao   timestamptz;
BEGIN
  IF NEW.despesa_id IS NOT NULL AND (NEW.comprador_nome IS NULL OR NEW.cotacao_em IS NULL) THEN
    SELECT d.cotacao_decidida_por_nome, d.cotacao_decidida_em
      INTO v_comprador, v_cotacao
      FROM public.malote_despesa d
     WHERE d.id = NEW.despesa_id;
  END IF;

  IF NEW.comprador_nome IS NULL THEN
    SELECT COALESCE(p.display_name, p.email) INTO v_comprador
      FROM public.profiles p WHERE p.id = NEW.created_by;
  END IF;

  NEW.comprador_nome := COALESCE(NEW.comprador_nome, v_comprador, 'Compras');
  NEW.cotacao_em := COALESCE(NEW.cotacao_em, v_cotacao, now());
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_sup_compra_pedido_contexto ON public.sup_compra_pedido;
CREATE TRIGGER trg_sup_compra_pedido_contexto
  BEFORE INSERT ON public.sup_compra_pedido
  FOR EACH ROW EXECUTE FUNCTION public.sup_compra_pedido_preencher_contexto();

CREATE OR REPLACE FUNCTION public.sup_compra_criar_pedido_direto(
  p_empresa_id    uuid,
  p_fornecedor_id uuid,
  p_itens         jsonb,
  p_dados         jsonb DEFAULT '{}'::jsonb
) RETURNS public.sup_compra_pedido
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_pedido     public.sup_compra_pedido;
  v_fornecedor public.fornecedor;
  v_comprador  text;
  v_origem     text := COALESCE(NULLIF(p_dados->>'origem', ''), 'manual');
  v_prazo      integer;
  v_data       date;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access(v_uid, 'sup_compra_pedido', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissao para criar pedido de compra' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.empresas e WHERE e.id = p_empresa_id AND e.ativa) THEN
    RAISE EXCEPTION 'Empresa nao encontrada ou inativa';
  END IF;

  SELECT f.* INTO v_fornecedor
    FROM public.fornecedor f
   WHERE f.id = p_fornecedor_id AND f.ativo;
  IF v_fornecedor.id IS NULL THEN
    RAISE EXCEPTION 'Fornecedor nao encontrado ou inativo';
  END IF;

  IF v_origem NOT IN ('estoque_saudavel', 'manual') THEN
    RAISE EXCEPTION 'Origem invalida para pedido direto';
  END IF;
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'O pedido precisa ter ao menos um item';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_to_recordset(p_itens) AS x(sup_item_id uuid, quantidade numeric, valor_unitario numeric)
     WHERE x.sup_item_id IS NULL OR x.quantidade IS NULL OR x.quantidade <= 0
        OR x.valor_unitario IS NULL OR x.valor_unitario < 0
  ) THEN
    RAISE EXCEPTION 'Todo item precisa de material, quantidade positiva e valor negociado';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_to_recordset(p_itens) AS x(sup_item_id uuid)
      LEFT JOIN public.sup_item i ON i.id = x.sup_item_id
     WHERE i.id IS NULL OR i.empresa_id <> p_empresa_id OR NOT i.ativo OR NOT i.aprovado
  ) THEN
    RAISE EXCEPTION 'Ha item inexistente, inativo ou pertencente a outra empresa';
  END IF;

  SELECT COALESCE(NULLIF(btrim(p_dados->>'comprador_nome'), ''), p.display_name, p.email)
    INTO v_comprador
    FROM public.profiles p
   WHERE p.id = v_uid;
  v_comprador := COALESCE(v_comprador, 'Compras');

  v_data := NULLIF(p_dados->>'data_limite_entrega', '')::date;
  v_prazo := CASE WHEN v_data IS NULL THEN NULL ELSE GREATEST(v_data - CURRENT_DATE, 0) END;

  INSERT INTO public.sup_compra_pedido (
    numero, despesa_id, fornecedor_id, fornecedor_nome, empresa_id,
    valor_total, prazo_entrega_dias, data_limite_entrega, local_entrega,
    forma_pagamento, condicoes_negociadas, frete_incluso, observacoes,
    origem, comprador_nome, cotacao_em, created_by
  ) VALUES (
    NULL, NULL, v_fornecedor.id,
    COALESCE(NULLIF(v_fornecedor.nome_fantasia, ''), v_fornecedor.razao_social),
    p_empresa_id, 0, v_prazo, v_data,
    NULLIF(btrim(p_dados->>'local_entrega'), ''),
    NULLIF(btrim(p_dados->>'forma_pagamento'), ''),
    NULLIF(btrim(p_dados->>'condicoes_negociadas'), ''),
    COALESCE((p_dados->>'frete_incluso')::boolean, false),
    NULLIF(btrim(p_dados->>'observacoes'), ''),
    v_origem, v_comprador,
    COALESCE(NULLIF(p_dados->>'cotacao_em', '')::timestamptz, now()), v_uid
  ) RETURNING * INTO v_pedido;

  INSERT INTO public.sup_compra_pedido_item (
    pedido_id, sup_item_id, nome_item, quantidade, unidade, tamanho,
    valor_unitario, observacao, ordem, codigo_fornecedor,
    preco_referencia_valor, preco_referencia_em,
    preco_referencia_fornecedor_nome, preco_referencia_valido_ate
  )
  SELECT v_pedido.id, i.id, i.nome, round(x.quantidade, 3),
         COALESCE(NULLIF(btrim(x.unidade), ''), 'UN'), i.tamanho,
         round(x.valor_unitario, 2), NULLIF(btrim(x.observacao), ''), x.ordem,
         ref.codigo_fornecedor, preco.valor_unitario, preco.registrado_em,
         preco.fornecedor_nome, preco.valido_ate
    FROM jsonb_to_recordset(p_itens) AS x(
      sup_item_id uuid, quantidade numeric, unidade text,
      valor_unitario numeric, observacao text, ordem integer
    )
    JOIN public.sup_item i ON i.id = x.sup_item_id
    LEFT JOIN LATERAL (
      SELECT fi.codigo_fornecedor
        FROM public.sup_fornecedor_item fi
       WHERE fi.fornecedor_id = p_fornecedor_id AND fi.sup_item_id = i.id
       LIMIT 1
    ) ref ON true
    LEFT JOIN LATERAL (
      SELECT pr.valor_unitario, pr.registrado_em, pr.fornecedor_nome, pr.valido_ate
        FROM public.sup_item_preco pr
       WHERE pr.sup_item_id = i.id AND pr.empresa_id = p_empresa_id
       ORDER BY pr.registrado_em DESC, pr.id DESC
       LIMIT 1
    ) preco ON true
   ORDER BY x.ordem;

  UPDATE public.sup_compra_pedido p
     SET valor_total = COALESCE((
       SELECT round(sum(pi.quantidade * pi.valor_unitario), 2)
         FROM public.sup_compra_pedido_item pi
        WHERE pi.pedido_id = v_pedido.id
     ), 0)
   WHERE p.id = v_pedido.id
  RETURNING * INTO v_pedido;

  RETURN v_pedido;
END
$fn$;

REVOKE ALL ON FUNCTION public.sup_compra_criar_pedido_direto(uuid, uuid, jsonb, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_compra_criar_pedido_direto(uuid, uuid, jsonb, jsonb)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
