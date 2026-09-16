-- =====================================================================
-- SIS-2026-0413 (complemento) — Editar dados de pagamento direto do
-- Fluxo de Caixa
--
-- Depois da lixeira (20260930000163), o usuário pediu também um botão de
-- Editar por linha do Fluxo de Caixa, pra corrigir campos "sutis, sem
-- grande impacto" sem precisar reabrir o fluxo de aprovação inteiro.
-- Decisão confirmada: Forma de Pagamento, Banco e Data de Pagamento —
-- nunca Valor/Empresa/Contrato/Classificação (esses já entraram no
-- cálculo de Orçamento Utilizado/DRE, mudar de lado agora descasaria
-- números já fechados).
--
-- Malote: hoje despesa 'despesa_paga' é tratada como terminal em
-- DespesaVisualizar.tsx (nenhum campo editável) — não existia nenhum
-- caminho de edição pós-pagamento. Esta RPC abre só esses 3 campos,
-- registrando o diff em malote_despesa_evento (mesmo padrão de
-- useSalvarEdicaoPosAprovacao).
--
-- Débito Automático: já tem debito_automatico_editar cobrindo isso (e
-- mais) — nada novo aqui, o botão Editar no Fluxo de Caixa só leva pra
-- tela própria.
--
-- Cartão de Crédito: achado ao implementar — forma_pagamento/banco_id
-- NÃO existem em malote_cartao_fatura_item, são propriedade do CARTÃO
-- (malote_cartao_credito), não do lançamento individual. Editar isso por
-- lançamento não faz sentido no modelo atual — só Data da Compra é
-- realmente por item. RPC abaixo cobre só esse campo.
--
-- Idempotente.
-- =====================================================================

-- ── Malote ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.malote_despesa_editar_pagamento(
  _id uuid, _forma_pagamento text, _banco_id uuid, _data_pagamento date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_origem text;
  v_menu text;
  v_antes public.malote_despesa%ROWTYPE;
  v_diff text := '';
BEGIN
  SELECT * INTO v_antes FROM public.malote_despesa WHERE id = _id;
  IF v_antes.id IS NULL THEN RAISE EXCEPTION 'Item não encontrado.'; END IF;
  v_origem := v_antes.origem;

  v_menu := CASE WHEN v_origem = 'solicitacao' THEN 'malote_solicitacao_visualizar' ELSE 'malote_despesa_visualizar' END;

  IF NOT public.can_access(auth.uid(), v_menu, 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para editar este item.';
  END IF;

  IF (v_antes.forma_pagamento IS DISTINCT FROM _forma_pagamento) THEN
    v_diff := v_diff || format('Forma de pagamento: %s → %s. ', COALESCE(v_antes.forma_pagamento, '—'), COALESCE(_forma_pagamento, '—'));
  END IF;
  IF (v_antes.banco_id IS DISTINCT FROM _banco_id) THEN
    v_diff := v_diff || 'Banco alterado. ';
  END IF;
  IF (v_antes.data_pagamento IS DISTINCT FROM _data_pagamento) THEN
    v_diff := v_diff || format('Data de pagamento: %s → %s. ', COALESCE(v_antes.data_pagamento::text, '—'), COALESCE(_data_pagamento::text, '—'));
  END IF;

  UPDATE public.malote_despesa
     SET forma_pagamento = _forma_pagamento,
         banco_id        = _banco_id,
         data_pagamento  = _data_pagamento
   WHERE id = _id;

  IF btrim(v_diff) <> '' THEN
    INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, ator_user_id, descricao)
    VALUES (_id, 'edicao', auth.uid(), btrim(v_diff));
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.malote_despesa_editar_pagamento(uuid, text, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.malote_despesa_editar_pagamento(uuid, text, uuid, date) TO authenticated;

-- ── Cartão de Crédito (só Data da Compra — forma_pagamento/banco são do
-- cartão, não do lançamento; ver comentário no topo) ─────────────────────
CREATE OR REPLACE FUNCTION public.cartao_fatura_item_editar_data(_id uuid, _data_compra date)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ok boolean;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-cartao-credito', 'alterar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para editar item de fatura.';
  END IF;

  UPDATE public.malote_cartao_fatura_item SET data_compra = _data_compra WHERE id = _id
  RETURNING true INTO v_ok;

  IF v_ok IS NULL THEN
    RAISE EXCEPTION 'Item não encontrado.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.cartao_fatura_item_editar_data(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cartao_fatura_item_editar_data(uuid, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.cartao_fatura_item_editar_data(uuid, date);
--   DROP FUNCTION IF EXISTS public.malote_despesa_editar_pagamento(uuid, text, uuid, date);
-- =====================================================================
