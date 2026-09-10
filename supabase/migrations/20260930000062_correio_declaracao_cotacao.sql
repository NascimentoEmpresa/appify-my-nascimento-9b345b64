-- =====================================================================
-- Cotação de frete e prazo na Declaração de Conteúdo
--
-- Hoje o Compras só descobre quanto custou quando o cupom imprime no balcão
-- da agência — o dinheiro já saiu. A cotação dos Correios é uma SIMULAÇÃO:
-- não exige objeto postado, só CEP de origem/destino, peso e dimensões.
--
-- A declaração é o lugar certo porque é onde esses dados já são preenchidos,
-- antes de sair da sala. Faltavam as dimensões.
--
-- Validado contra a API em 04/09/2026, reproduzindo o cupom do objeto
-- AD867127447BR (4,1 kg, 36x38x38, Triunfo->Realeza, declarado R$ 450):
--   pcBaseGeral 125,23 + adicional 019 de 4,24 = pcFinal 129,47
-- os três idênticos ao impresso na agência.
-- =====================================================================

ALTER TABLE public.sup_correio_declaracao
  ADD COLUMN IF NOT EXISTS comprimento_cm   numeric,
  ADD COLUMN IF NOT EXISTS largura_cm       numeric,
  ADD COLUMN IF NOT EXISTS altura_cm        numeric,
  -- Todo envio da empresa usa Valor Declarado (serviço adicional 019), que é
  -- cobrado à parte e muda o preço final. Sem esta coluna a cotação erraria
  -- para menos em 100% dos casos reais.
  ADD COLUMN IF NOT EXISTS valor_declarado  numeric,
  -- Resultado da última cotação. Guardado para virar o "esperado" contra o
  -- qual a fatura dos Correios pode ser conferida depois — sem isso a
  -- simulação some da tela e não sobra registro de nada.
  ADD COLUMN IF NOT EXISTS frete_cotado       numeric,
  ADD COLUMN IF NOT EXISTS prazo_cotado_dias  integer,
  ADD COLUMN IF NOT EXISTS cotado_em          timestamptz;

COMMENT ON COLUMN public.sup_correio_declaracao.frete_cotado IS
  'pcFinal devolvido pela API de Preço dos Correios (produto + adicionais). Simulação, não é o valor faturado.';

-- ── A RPC de salvar precisa conhecer os campos novos ─────────────────
--
-- Mesma assinatura de 20260930000059, então CREATE OR REPLACE substitui de
-- verdade (não cria sobrecarga). O corpo é o de lá, acrescido das colunas
-- acima no INSERT e no UPDATE.
CREATE OR REPLACE FUNCTION public.sup_correio_declaracao_salvar(p_payload jsonb)
RETURNS public.sup_correio_declaracao
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid := nullif(p_payload->>'id', '')::uuid;
  v_empresa_id uuid := nullif(p_payload->>'empresa_id', '')::uuid;
  v_pedido_id uuid := nullif(p_payload->>'pedido_id', '')::uuid;
  v_pedido_protocolo text := nullif(p_payload->>'pedido_protocolo', '');
  v_declaracao public.sup_correio_declaracao;
  v_item jsonb;
  v_ordem integer := 0;
  v_nome text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF v_empresa_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_empresa ue
     WHERE ue.user_id = v_uid AND ue.empresa_id = v_empresa_id
  ) THEN
    RAISE EXCEPTION 'Empresa inválida ou sem acesso';
  END IF;
  IF NOT public.can_access(
    v_uid,
    'sup_correio_declaracao',
    CASE WHEN v_id IS NULL
      THEN 'incluir'::public.app_acao
      ELSE 'alterar'::public.app_acao
    END
  ) THEN
    RAISE EXCEPTION 'Sem permissão para salvar a declaração';
  END IF;
  IF v_pedido_id IS NOT NULL THEN
    SELECT p.pedido_id INTO v_pedido_protocolo
      FROM public.sup_pedido p
     WHERE p.id = v_pedido_id AND p.empresa_id = v_empresa_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Pedido não pertence à empresa da declaração';
    END IF;
  END IF;

  SELECT COALESCE(p.display_name, auth.jwt()->>'email', 'Usuário')
    INTO v_nome FROM public.profiles p WHERE p.id = v_uid;
  v_nome := COALESCE(v_nome, auth.jwt()->>'email', 'Usuário');

  IF v_id IS NULL THEN
    INSERT INTO public.sup_correio_declaracao (
      empresa_id, pedido_id, pedido_protocolo,
      rem_nome, rem_cnpj, rem_endereco, rem_complemento, rem_bairro,
      rem_cidade, rem_uf, rem_cep, rem_caixa_postal,
      dest_nome, dest_cnpj, dest_endereco, dest_complemento, dest_bairro,
      dest_cidade, dest_uf, dest_cep, peso_total_kg,
      comprimento_cm, largura_cm, altura_cm, valor_declarado,
      frete_cotado, prazo_cotado_dias, cotado_em,
      assinatura_cidade, assinatura_data, criado_por, criado_por_nome
    ) VALUES (
      v_empresa_id, v_pedido_id, v_pedido_protocolo,
      nullif(p_payload->>'rem_nome', ''), nullif(p_payload->>'rem_cnpj', ''), nullif(p_payload->>'rem_endereco', ''), nullif(p_payload->>'rem_complemento', ''), nullif(p_payload->>'rem_bairro', ''),
      nullif(p_payload->>'rem_cidade', ''), nullif(p_payload->>'rem_uf', ''), nullif(p_payload->>'rem_cep', ''), nullif(p_payload->>'rem_caixa_postal', ''),
      nullif(p_payload->>'dest_nome', ''), nullif(p_payload->>'dest_cnpj', ''), nullif(p_payload->>'dest_endereco', ''), nullif(p_payload->>'dest_complemento', ''), nullif(p_payload->>'dest_bairro', ''),
      nullif(p_payload->>'dest_cidade', ''), nullif(p_payload->>'dest_uf', ''), nullif(p_payload->>'dest_cep', ''), nullif(p_payload->>'peso_total_kg', '')::numeric,
      nullif(p_payload->>'comprimento_cm', '')::numeric, nullif(p_payload->>'largura_cm', '')::numeric,
      nullif(p_payload->>'altura_cm', '')::numeric, nullif(p_payload->>'valor_declarado', '')::numeric,
      nullif(p_payload->>'frete_cotado', '')::numeric, nullif(p_payload->>'prazo_cotado_dias', '')::integer,
      nullif(p_payload->>'cotado_em', '')::timestamptz,
      nullif(p_payload->>'assinatura_cidade', ''), nullif(p_payload->>'assinatura_data', '')::date, v_uid, v_nome
    ) RETURNING * INTO v_declaracao;
  ELSE
    UPDATE public.sup_correio_declaracao d SET
      pedido_id = v_pedido_id,
      pedido_protocolo = v_pedido_protocolo,
      rem_nome = nullif(p_payload->>'rem_nome', ''), rem_cnpj = nullif(p_payload->>'rem_cnpj', ''),
      rem_endereco = nullif(p_payload->>'rem_endereco', ''), rem_complemento = nullif(p_payload->>'rem_complemento', ''),
      rem_bairro = nullif(p_payload->>'rem_bairro', ''), rem_cidade = nullif(p_payload->>'rem_cidade', ''),
      rem_uf = nullif(p_payload->>'rem_uf', ''), rem_cep = nullif(p_payload->>'rem_cep', ''),
      rem_caixa_postal = nullif(p_payload->>'rem_caixa_postal', ''),
      dest_nome = nullif(p_payload->>'dest_nome', ''), dest_cnpj = nullif(p_payload->>'dest_cnpj', ''),
      dest_endereco = nullif(p_payload->>'dest_endereco', ''), dest_complemento = nullif(p_payload->>'dest_complemento', ''),
      dest_bairro = nullif(p_payload->>'dest_bairro', ''), dest_cidade = nullif(p_payload->>'dest_cidade', ''),
      dest_uf = nullif(p_payload->>'dest_uf', ''), dest_cep = nullif(p_payload->>'dest_cep', ''),
      peso_total_kg = nullif(p_payload->>'peso_total_kg', '')::numeric,
      comprimento_cm = nullif(p_payload->>'comprimento_cm', '')::numeric,
      largura_cm = nullif(p_payload->>'largura_cm', '')::numeric,
      altura_cm = nullif(p_payload->>'altura_cm', '')::numeric,
      valor_declarado = nullif(p_payload->>'valor_declarado', '')::numeric,
      frete_cotado = nullif(p_payload->>'frete_cotado', '')::numeric,
      prazo_cotado_dias = nullif(p_payload->>'prazo_cotado_dias', '')::integer,
      cotado_em = nullif(p_payload->>'cotado_em', '')::timestamptz,
      assinatura_cidade = nullif(p_payload->>'assinatura_cidade', ''),
      assinatura_data = nullif(p_payload->>'assinatura_data', '')::date
    WHERE d.id = v_id AND d.empresa_id = v_empresa_id
    RETURNING d.* INTO v_declaracao;
    IF NOT FOUND THEN RAISE EXCEPTION 'Declaração não encontrada ou sem acesso'; END IF;
  END IF;

  DELETE FROM public.sup_correio_declaracao_item i
   WHERE i.declaracao_id = v_declaracao.id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'itens', '[]'::jsonb)) LOOP
    IF nullif(btrim(v_item->>'conteudo'), '') IS NOT NULL THEN
      INSERT INTO public.sup_correio_declaracao_item
        (declaracao_id, ordem, conteudo, quantidade, valor)
      VALUES (
        v_declaracao.id, v_ordem, btrim(v_item->>'conteudo'),
        GREATEST(COALESCE((v_item->>'quantidade')::integer, 1), 1),
        nullif(v_item->>'valor', '')::numeric
      );
      v_ordem := v_ordem + 1;
    END IF;
  END LOOP;
  IF v_ordem = 0 THEN RAISE EXCEPTION 'Informe pelo menos um item na declaração'; END IF;

  RETURN v_declaracao;
END $$;

-- =====================================================================
-- ROLLBACK
--   -- restaurar sup_correio_declaracao_salvar a partir de
--   -- 20260930000059_correio_declaracao.sql, e então:
--   ALTER TABLE public.sup_correio_declaracao
--     DROP COLUMN IF EXISTS cotado_em,
--     DROP COLUMN IF EXISTS prazo_cotado_dias,
--     DROP COLUMN IF EXISTS frete_cotado,
--     DROP COLUMN IF EXISTS valor_declarado,
--     DROP COLUMN IF EXISTS altura_cm,
--     DROP COLUMN IF EXISTS largura_cm,
--     DROP COLUMN IF EXISTS comprimento_cm;
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================

NOTIFY pgrst, 'reload schema';
