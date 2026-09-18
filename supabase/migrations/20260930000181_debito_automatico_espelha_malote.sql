-- SIS-2026-0444 (Iury): "quando um débito automático for preenchido no
-- submódulo Débito Automático ele também vira uma linha no Malote, como se
-- tivesse sido lançado lá, aparecendo em Meus Itens/Aprovações/Pagamentos
-- Malote — em todas as rotas o status deve ser despesa paga."
--
-- Escopo confirmado com o usuário: SÓ o tipo "Débito Automático"
-- (tipo_origem = 'debito_automatico') — Movimentação Financeira e Nota
-- Recebida (os outros 2 tipos do mesmo submódulo, ver cabeçalho da
-- 20260930000056) ficam de fora.
--
-- Contexto que vale registrar: este submódulo nasceu (20260930000056)
-- justamente como o caminho pra lançar no Fluxo de Caixa "itens que NÃO
-- passam pelo Malote". Este chamado não desfaz isso — o Débito Automático
-- continua tendo vida própria no Fluxo de Caixa — só passa a ESPELHAR uma
-- cópia no Malote também, pra quem só olha Meus Itens/Aprovações/
-- Pagamentos enxergar o gasto sem precisar saber que ele nasceu em outro
-- lugar. A cópia já nasce "despesa_paga": não é um item que precisa de
-- aprovação no Malote, é só o registro de algo que já foi decidido e pago
-- via Débito Automático.
--
-- Padrão seguido: mesmo da 20260930000044 (Reembolso → Malote) — INSERT
-- direto em malote_despesa dentro da própria função SECURITY DEFINER que
-- já cria o Débito Automático, tudo numa transação só (se o Malote
-- recusar, o Débito Automático também não é criado). Idempotência/
-- rastreio via `DEBITO_AUTOMATICO.malote_despesa_id`, igual
-- `CS_REEMBOLSO.malote_despesa_id`.
--
-- Decisão do usuário sobre edição (diferente do precedente do Reembolso,
-- que só lança uma vez): editar um Débito Automático já lançado DEVE
-- propagar pra a linha do Malote — mas sempre registrando no histórico
-- (`malote_despesa_evento`), nunca em silêncio. Só os campos que a própria
-- `debito_automatico_editar` já aceita são sincronizados (ela nunca aceitou
-- editar `tipo`/entrada-saida, então isso não muda). O `status` do Malote
-- NUNCA muda por essa sincronização — fica sempre 'despesa_paga',
-- independente do Débito Automático estar 'pendente' ou 'pago' (esses dois
-- status são conceitos diferentes: um é do Fluxo de Caixa, o outro é do
-- Malote).
--
-- Exclusão: `debito_automatico_excluir` já bloqueia excluir item 'pago',
-- mas um item 'pendente' com Malote já lançado (lançamento acontece na
-- CRIAÇÃO, não faz média com o status pendente/pago) podia ficar como
-- "despesa paga" órfã no Malote depois de excluído. Cancela a despesa do
-- Malote junto (`status = 'cancelada'`, não DELETE — é histórico
-- financeiro), com evento registrado.

-- ── 1. Rastreio/idempotência ────────────────────────────────────────────
ALTER TABLE public."DEBITO_AUTOMATICO"
  ADD COLUMN IF NOT EXISTS malote_despesa_id uuid REFERENCES public.malote_despesa(id);

-- ── 2. Criação: espelha no Malote já como despesa paga ──────────────────
-- Mesma assinatura de 20260930000058 — CREATE OR REPLACE substitui no
-- lugar, sem criar overload.
CREATE OR REPLACE FUNCTION public.debito_automatico_criar_debito(
  _data_pagamento date, _competencia date, _tipo text,
  _empresa_id uuid, _contrato_id uuid, _classificacao_id uuid,
  _descricao text, _forma_pagamento text, _valor numeric, _banco_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
  v_malote_despesa_id uuid;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para incluir Débito Automático.';
  END IF;
  IF _banco_id IS NULL THEN
    RAISE EXCEPTION 'Informe o banco.';
  END IF;

  INSERT INTO public."DEBITO_AUTOMATICO" (
    tipo_origem, tipo, data_pagamento, competencia, empresa_id, contrato_id,
    classificacao_id, descricao, forma_pagamento, valor, banco_id, created_by
  ) VALUES (
    'debito_automatico', _tipo, _data_pagamento, _competencia, _empresa_id, _contrato_id,
    _classificacao_id, _descricao, _forma_pagamento, _valor, _banco_id, auth.uid()
  ) RETURNING id INTO v_id;

  INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
  VALUES (v_id, 'criacao', auth.uid(), 'Débito Automático criado.');

  -- SIS-2026-0444: espelha no Malote — mesmos campos do Débito Automático,
  -- `origem = 'despesa_unica'` (categoria única, igual ao Reembolso) e
  -- `status = 'despesa_paga'` fixo (decisão do chamado: já nasce como
  -- despesa paga em todas as telas do Malote).
  INSERT INTO public.malote_despesa (
    empresa_id, contrato_id, classificacao_id, origem, status, nome,
    valor_total, descricao, data_pagamento, competencia, forma_pagamento,
    banco_id, tipo_movimento, pago_em, pago_por, created_by
  ) VALUES (
    _empresa_id, _contrato_id, _classificacao_id, 'despesa_unica', 'despesa_paga', _descricao,
    _valor, 'Gerado automaticamente do Débito Automático — ver histórico do lançamento original.',
    _data_pagamento, _competencia, _forma_pagamento,
    _banco_id, _tipo, now(), auth.uid(), auth.uid()
  ) RETURNING id INTO v_malote_despesa_id;

  UPDATE public."DEBITO_AUTOMATICO" SET malote_despesa_id = v_malote_despesa_id WHERE id = v_id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, ator_user_id, descricao)
  VALUES (v_malote_despesa_id, 'despesa_criada', auth.uid(), 'Lançado automaticamente pelo Débito Automático.');

  RETURN v_id;
END;
$$;

-- ── 3. Edição: propaga pro Malote, sempre com evento no histórico ───────
-- Mesma assinatura de 20260930000058 (_id, _campos jsonb) — só o corpo
-- ganha o bloco de sincronização no final. `status` do jsonb continua
-- sendo o status do Débito Automático (pendente/pago) — NUNCA mexe no
-- status da despesa do Malote, que fica travado em 'despesa_paga'.
CREATE OR REPLACE FUNCTION public.debito_automatico_editar(_id uuid, _campos jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_antes public."DEBITO_AUTOMATICO"%ROWTYPE;
  v_diff text := '';
  v_diff_malote text := '';
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para editar Débito Automático.';
  END IF;

  SELECT * INTO v_antes FROM public."DEBITO_AUTOMATICO" WHERE id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro não encontrado: %', _id;
  END IF;

  UPDATE public."DEBITO_AUTOMATICO" SET
    data_pagamento    = COALESCE((_campos->>'data_pagamento')::date, data_pagamento),
    competencia       = COALESCE((_campos->>'competencia')::date, competencia),
    empresa_id        = COALESCE((_campos->>'empresa_id')::uuid, empresa_id),
    contrato_id       = CASE WHEN _campos ? 'contrato_id' THEN (_campos->>'contrato_id')::uuid ELSE contrato_id END,
    classificacao_id  = COALESCE((_campos->>'classificacao_id')::uuid, classificacao_id),
    descricao         = COALESCE(_campos->>'descricao', descricao),
    forma_pagamento   = COALESCE(_campos->>'forma_pagamento', forma_pagamento),
    valor             = COALESCE((_campos->>'valor')::numeric, valor),
    status            = COALESCE(_campos->>'status', status),
    banco_id          = COALESCE((_campos->>'banco_id')::uuid, banco_id),
    updated_by        = auth.uid()
  WHERE id = _id;

  IF _campos ? 'valor' AND (_campos->>'valor')::numeric IS DISTINCT FROM v_antes.valor THEN
    v_diff := v_diff || format('Valor: R$ %s → R$ %s. ', v_antes.valor, _campos->>'valor');
  END IF;
  IF _campos ? 'status' AND (_campos->>'status') IS DISTINCT FROM v_antes.status THEN
    v_diff := v_diff || format('Status: %s → %s. ', v_antes.status, _campos->>'status');
  END IF;
  IF _campos ? 'data_pagamento' AND (_campos->>'data_pagamento')::date IS DISTINCT FROM v_antes.data_pagamento THEN
    v_diff := v_diff || format('Data de pagamento: %s → %s. ', v_antes.data_pagamento, _campos->>'data_pagamento');
  END IF;
  IF _campos ? 'descricao' AND (_campos->>'descricao') IS DISTINCT FROM v_antes.descricao THEN
    v_diff := v_diff || format('Descrição: "%s" → "%s". ', v_antes.descricao, _campos->>'descricao');
  END IF;
  IF _campos ? 'banco_id' AND (_campos->>'banco_id')::uuid IS DISTINCT FROM v_antes.banco_id THEN
    v_diff := v_diff || 'Banco alterado. ';
  END IF;

  INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
  VALUES (_id, 'edicao', auth.uid(), NULLIF(btrim(v_diff), ''));

  IF _campos ? 'status' AND (_campos->>'status') = 'pago' AND v_antes.status IS DISTINCT FROM 'pago' THEN
    INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
    VALUES (_id, 'pagamento', auth.uid(), 'Marcado como pago — enviado para o Fluxo de Caixa.');
  END IF;

  -- SIS-2026-0444: propaga os mesmos campos pra despesa espelhada no
  -- Malote (se existir — só existe pra tipo_origem = 'debito_automatico').
  -- `status` do Malote fica de fora de propósito: continua 'despesa_paga'
  -- sempre, não segue o pendente/pago do Débito Automático.
  IF v_antes.malote_despesa_id IS NOT NULL THEN
    UPDATE public.malote_despesa SET
      data_pagamento    = COALESCE((_campos->>'data_pagamento')::date, data_pagamento),
      competencia       = COALESCE((_campos->>'competencia')::date, competencia),
      empresa_id        = COALESCE((_campos->>'empresa_id')::uuid, empresa_id),
      contrato_id       = CASE WHEN _campos ? 'contrato_id' THEN (_campos->>'contrato_id')::uuid ELSE contrato_id END,
      classificacao_id  = COALESCE((_campos->>'classificacao_id')::uuid, classificacao_id),
      nome              = COALESCE(_campos->>'descricao', nome),
      forma_pagamento   = COALESCE(_campos->>'forma_pagamento', forma_pagamento),
      valor_total       = COALESCE((_campos->>'valor')::numeric, valor_total),
      banco_id          = COALESCE((_campos->>'banco_id')::uuid, banco_id),
      updated_at        = now()
    WHERE id = v_antes.malote_despesa_id;

    IF _campos ? 'valor' AND (_campos->>'valor')::numeric IS DISTINCT FROM v_antes.valor THEN
      v_diff_malote := v_diff_malote || format('Valor: R$ %s → R$ %s. ', v_antes.valor, _campos->>'valor');
    END IF;
    IF _campos ? 'data_pagamento' AND (_campos->>'data_pagamento')::date IS DISTINCT FROM v_antes.data_pagamento THEN
      v_diff_malote := v_diff_malote || format('Data de pagamento: %s → %s. ', v_antes.data_pagamento, _campos->>'data_pagamento');
    END IF;
    IF _campos ? 'descricao' AND (_campos->>'descricao') IS DISTINCT FROM v_antes.descricao THEN
      v_diff_malote := v_diff_malote || format('Descrição: "%s" → "%s". ', v_antes.descricao, _campos->>'descricao');
    END IF;
    IF _campos ? 'banco_id' AND (_campos->>'banco_id')::uuid IS DISTINCT FROM v_antes.banco_id THEN
      v_diff_malote := v_diff_malote || 'Banco alterado. ';
    END IF;

    INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, ator_user_id, descricao)
    VALUES (
      v_antes.malote_despesa_id, 'edicao', auth.uid(),
      'Atualizado a partir da edição do Débito Automático. ' || NULLIF(btrim(v_diff_malote), '')
    );
  END IF;
END;
$$;

-- ── 4. Exclusão: cancela a despesa espelhada, não deixa órfã ────────────
CREATE OR REPLACE FUNCTION public.debito_automatico_excluir(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row public."DEBITO_AUTOMATICO"%ROWTYPE;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'excluir') THEN
    RAISE EXCEPTION 'Sem permissão para excluir Débito Automático.';
  END IF;

  SELECT * INTO v_row FROM public."DEBITO_AUTOMATICO" WHERE id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro não encontrado: %', _id;
  END IF;
  IF v_row.status = 'pago' THEN
    RAISE EXCEPTION 'Registro pago não pode ser excluído.';
  END IF;

  IF v_row.movimentacao_par_id IS NOT NULL THEN
    UPDATE public."DEBITO_AUTOMATICO" SET movimentacao_par_id = NULL
      WHERE id IN (_id, v_row.movimentacao_par_id);

    INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
    VALUES (v_row.movimentacao_par_id, 'exclusao', auth.uid(), 'Excluído junto com o par da Movimentação Financeira.');
    DELETE FROM public."DEBITO_AUTOMATICO" WHERE id = v_row.movimentacao_par_id;
  END IF;

  -- SIS-2026-0444: a despesa espelhada no Malote nasce "despesa_paga" já
  -- na criação (não espera o Débito Automático virar 'pago') — excluir um
  -- Débito Automático 'pendente' sem isso deixaria uma "despesa paga"
  -- órfã e fantasma no Malote. Cancela em vez de deletar: já pode ter
  -- entrado em relatório/orçamento, e cancelada continua rastreável.
  IF v_row.malote_despesa_id IS NOT NULL THEN
    UPDATE public.malote_despesa SET status = 'cancelada', updated_at = now()
      WHERE id = v_row.malote_despesa_id;
    INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, ator_user_id, descricao)
    VALUES (v_row.malote_despesa_id, 'cancelamento', auth.uid(), 'Débito Automático original foi excluído.');
  END IF;

  INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
  VALUES (_id, 'exclusao', auth.uid(), 'Registro excluído.');
  DELETE FROM public."DEBITO_AUTOMATICO" WHERE id = _id;
END;
$$;

REVOKE ALL ON FUNCTION public.debito_automatico_criar_debito FROM PUBLIC;
REVOKE ALL ON FUNCTION public.debito_automatico_editar FROM PUBLIC;
REVOKE ALL ON FUNCTION public.debito_automatico_excluir FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.debito_automatico_criar_debito TO authenticated;
GRANT EXECUTE ON FUNCTION public.debito_automatico_editar TO authenticated;
GRANT EXECUTE ON FUNCTION public.debito_automatico_excluir TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   -- (recriar as 3 funções com o corpo de 20260930000058, sem o espelho
--   -- no Malote);
--   ALTER TABLE public."DEBITO_AUTOMATICO" DROP COLUMN IF EXISTS malote_despesa_id;
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
