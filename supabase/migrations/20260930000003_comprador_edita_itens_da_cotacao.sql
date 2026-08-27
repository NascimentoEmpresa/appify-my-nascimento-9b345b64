-- =========================================================================
-- O comprador passa a poder montar os itens da solicitação que está cotando
--
-- O BECO SEM SAÍDA QUE ISTO RESOLVE
-- O Pedido de Compra exige itens. Só que a policy de escrita de
-- `malote_despesa_item` (20260926000001) é do SOLICITANTE — "só quem criou a
-- solicitação edita", pela mesma regra do Rateio. E o botão que gera o pedido
-- fica no Suprimentos, usado pelo COMPRADOR.
--
-- Resultado: solicitação criada sem itens nunca vira pedido de compra, e
-- ninguém no Suprimentos consegue destravar. Pior, quando a solicitação chega
-- em `cotacao_aprovada` ela já passou pela aprovação, e o solicitante
-- normalmente não volta nela.
--
-- Encontrado em 27/08/2026, testando o fluxo de ponta a ponta: o botão dizia
-- "sem itens", o solicitante não estava por perto, e não havia caminho.
--
-- POR QUE O COMPRADOR, E NÃO "QUALQUER UM"
-- Quem está negociando é quem sabe o que está sendo cotado — o fornecedor
-- manda a proposta item a item, e é o comprador que lê. Dar essa escrita a ele
-- é reconhecer o que já acontece na prática.
--
-- A policy do solicitante NÃO muda. O comprador entra por RPC, como todo o
-- resto do módulo: a tela não escreve na tabela, e a permissão vive em
-- `sup_cotacoes_malote`, controlável por usuário em Acesso por Usuário.
--
-- SÓ ENQUANTO ESTÁ EM COTAÇÃO
-- Depois que a solicitação vira Despesa e segue para pagamento, mexer nos
-- itens seria reescrever o que já foi aprovado. Os status permitidos abaixo
-- são exatamente a fase em que o Suprimentos tem a bola.
--
-- Idempotente.
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sup_malote_definir_itens(uuid, jsonb);
-- =========================================================================

CREATE OR REPLACE FUNCTION public.sup_malote_definir_itens(
  p_despesa_id uuid,
  p_itens      jsonb
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_status text;
  v_item   jsonb;
  v_ordem  integer := 0;
  v_nome   text;
  v_qtd    numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_cotacoes_malote', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para editar os itens da cotação';
  END IF;

  SELECT status INTO v_status FROM public.malote_despesa WHERE id = p_despesa_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Solicitação não encontrada';
  END IF;

  IF v_status NOT IN ('aguardando_cotacao', 'cotacao_realizada', 'cotacao_aprovada') THEN
    RAISE EXCEPTION
      'Os itens só podem ser ajustados enquanto a solicitação está em cotação (status atual: %)',
      v_status;
  END IF;

  -- Apaga e regrava, mesma estratégia do rateio e do próprio solicitante: a
  -- lista é pequena e pertence inteira à solicitação, então reconciliar linha
  -- a linha só traria complexidade sem ganho.
  DELETE FROM public.malote_despesa_item WHERE despesa_id = p_despesa_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_itens, '[]'::jsonb))
  LOOP
    v_nome := btrim(COALESCE(v_item->>'nome_item', ''));
    -- Item sem nome não vira linha: apareceria em branco no PDF que vai para o
    -- fornecedor, e ninguém saberia o que foi pedido.
    CONTINUE WHEN v_nome = '';

    v_qtd := COALESCE(NULLIF(v_item->>'quantidade', '')::numeric, 1);
    CONTINUE WHEN v_qtd <= 0;

    INSERT INTO public.malote_despesa_item
      (despesa_id, sup_item_id, nome_item, tipo_item, quantidade, unidade,
       tamanho, observacao, ordem)
    VALUES (
      p_despesa_id,
      NULLIF(v_item->>'sup_item_id', '')::uuid,
      v_nome,
      NULLIF(btrim(COALESCE(v_item->>'tipo_item', '')), ''),
      v_qtd,
      COALESCE(NULLIF(btrim(COALESCE(v_item->>'unidade', '')), ''), 'UN'),
      NULLIF(btrim(COALESCE(v_item->>'tamanho', '')), ''),
      NULLIF(btrim(COALESCE(v_item->>'observacao', '')), ''),
      v_ordem
    );
    v_ordem := v_ordem + 1;
  END LOOP;

  RETURN v_ordem;
END;
$fn$;

REVOKE ALL ON FUNCTION public.sup_malote_definir_itens(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_malote_definir_itens(uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
