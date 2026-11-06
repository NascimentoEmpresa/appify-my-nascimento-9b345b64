-- SIS-2026-0815 — Centro de custo na Movimentação Financeira do Débito Automático
-- ============================================================================
-- "Incluir Movimentação Financeira" gerava as duas linhas (saída e entrada) sem contrato, então o Fluxo de Caixa as mostrava com centro de
-- custo "—". O correto é MOVIMENTAÇÃO FINANCEIRA (o contrato da empresa de cada lado).
--
--   1. debito_automatico_criar_movimentacao ganha _contrato_saida_id e _contrato_entrada_id (opcionais): cada linha recebe o centro de custo
--      do próprio lado. A assinatura muda, então a antiga (10 argumentos) é removida; a tela nova é a única chamadora.
--   2. debito_automatico_editar passa a registrar a troca de centro de custo no histórico (a coluna já era editável via _campos).
--   3. Carga: as linhas de movimentação financeira que estão sem centro de custo recebem o contrato "MOVIMENTAÇÃO FINANCEIRA…" da empresa
--      da própria linha. Empresa sem esse contrato fica como está e aparece em NOTICE.
--
-- A view do Fluxo (v_debito_automatico_fluxo_caixa) já devolve contrato_id/contrato_nome da linha; não muda.
-- Idempotente: reexecutar não altera o que já tem centro de custo.

-- ── 1. Criar movimentação: um centro de custo por lado ─────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.debito_automatico_criar_movimentacao(date, date, uuid, uuid, uuid, text, numeric, text, uuid, uuid);

CREATE OR REPLACE FUNCTION public.debito_automatico_criar_movimentacao(
  _data_pagamento date, _competencia date,
  _empresa_saida_id uuid, _empresa_entrada_id uuid,
  _classificacao_id uuid, _descricao text, _valor numeric, _status text,
  _banco_saida_id uuid, _banco_entrada_id uuid,
  _contrato_saida_id uuid DEFAULT NULL, _contrato_entrada_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_numero text;
  v_id_saida uuid;
  v_id_entrada uuid;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para incluir Movimentação Financeira.';
  END IF;
  IF _status NOT IN ('pendente', 'pago') THEN
    RAISE EXCEPTION 'Status inválido: %', _status;
  END IF;
  IF _banco_saida_id IS NULL THEN
    RAISE EXCEPTION 'Informe o banco de saída.';
  END IF;
  IF _banco_entrada_id IS NULL THEN
    RAISE EXCEPTION 'Informe o banco de entrada.';
  END IF;
  IF _contrato_saida_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.contratos WHERE id = _contrato_saida_id) THEN
    RAISE EXCEPTION 'Centro de custo de saída inválido.';
  END IF;
  IF _contrato_entrada_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.contratos WHERE id = _contrato_entrada_id) THEN
    RAISE EXCEPTION 'Centro de custo de entrada inválido.';
  END IF;

  v_numero := 'DA-' || to_char(now(), 'YYYY') || '-' ||
    lpad(nextval('public.debito_automatico_numero_seq')::text, 4, '0');

  INSERT INTO public."DEBITO_AUTOMATICO" (
    numero, tipo_origem, tipo, data_pagamento, competencia, empresa_id, contrato_id,
    classificacao_id, descricao, forma_pagamento, valor, status, banco_id, created_by
  ) VALUES (
    v_numero, 'movimentacao_financeira', 'saida', _data_pagamento, _competencia, _empresa_saida_id, _contrato_saida_id,
    _classificacao_id, _descricao, 'Transferência Bancária', _valor, _status, _banco_saida_id, auth.uid()
  ) RETURNING id INTO v_id_saida;

  INSERT INTO public."DEBITO_AUTOMATICO" (
    numero, tipo_origem, tipo, data_pagamento, competencia, empresa_id, contrato_id,
    classificacao_id, descricao, forma_pagamento, valor, status, banco_id,
    movimentacao_par_id, created_by
  ) VALUES (
    v_numero, 'movimentacao_financeira', 'entrada', _data_pagamento, _competencia, _empresa_entrada_id, _contrato_entrada_id,
    _classificacao_id, _descricao, 'Transferência Bancária', _valor, _status, _banco_entrada_id,
    v_id_saida, auth.uid()
  ) RETURNING id INTO v_id_entrada;

  UPDATE public."DEBITO_AUTOMATICO" SET movimentacao_par_id = v_id_entrada WHERE id = v_id_saida;

  INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
  VALUES
    (v_id_saida, 'criacao', auth.uid(), 'Movimentação Financeira criada (linha de saída).'),
    (v_id_entrada, 'criacao', auth.uid(), 'Movimentação Financeira criada (linha de entrada).');

  RETURN v_id_saida;
END;
$$;

REVOKE ALL ON FUNCTION public.debito_automatico_criar_movimentacao(date, date, uuid, uuid, uuid, text, numeric, text, uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debito_automatico_criar_movimentacao(date, date, uuid, uuid, uuid, text, numeric, text, uuid, uuid, uuid, uuid) TO authenticated;

-- ── 2. Editar: mesma de 20261002000004 + a troca de centro de custo no histórico ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.debito_automatico_editar(_id uuid, _campos jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_antes public."DEBITO_AUTOMATICO"%ROWTYPE;
  v_diff text := '';
  v_nome_antes text;
  v_nome_depois text;
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
    data_vencimento   = COALESCE((_campos->>'data_vencimento')::date, data_vencimento),
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
  IF _campos ? 'data_vencimento' AND (_campos->>'data_vencimento')::date IS DISTINCT FROM v_antes.data_vencimento THEN
    v_diff := v_diff || format('Vencimento: %s → %s. ', v_antes.data_vencimento, _campos->>'data_vencimento');
  END IF;
  IF _campos ? 'descricao' AND (_campos->>'descricao') IS DISTINCT FROM v_antes.descricao THEN
    v_diff := v_diff || format('Descrição: "%s" → "%s". ', v_antes.descricao, _campos->>'descricao');
  END IF;
  IF _campos ? 'banco_id' AND (_campos->>'banco_id')::uuid IS DISTINCT FROM v_antes.banco_id THEN
    v_diff := v_diff || 'Banco alterado. ';
  END IF;
  IF _campos ? 'contrato_id' AND (_campos->>'contrato_id')::uuid IS DISTINCT FROM v_antes.contrato_id THEN
    SELECT nome INTO v_nome_antes FROM public.contratos WHERE id = v_antes.contrato_id;
    SELECT nome INTO v_nome_depois FROM public.contratos WHERE id = (_campos->>'contrato_id')::uuid;
    v_diff := v_diff || format('Centro de custo: %s → %s. ', coalesce(v_nome_antes, '—'), coalesce(v_nome_depois, '—'));
  END IF;

  INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
  VALUES (_id, 'edicao', auth.uid(), NULLIF(btrim(v_diff), ''));

  IF _campos ? 'status' AND (_campos->>'status') = 'pago' AND v_antes.status IS DISTINCT FROM 'pago' THEN
    INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
    VALUES (_id, 'pagamento', auth.uid(), 'Marcado como pago — enviado para o Fluxo de Caixa.');
  END IF;
END;
$$;

-- ── 3. Carga: centro de custo MOVIMENTAÇÃO FINANCEIRA da empresa de cada linha de movimentação ────────────────────────────────
DO $$
DECLARE
  r record;
  v_n int;
  v_tot int := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (c.empresa_id) c.empresa_id, c.id AS contrato_id, c.nome
      FROM public.contratos c
     WHERE upper(c.nome) LIKE 'MOVIMENTA%FINANCEIRA%'
     ORDER BY c.empresa_id, (c.status = 'ativo') DESC, c.created_at
  LOOP
    UPDATE public."DEBITO_AUTOMATICO"
       SET contrato_id = r.contrato_id
     WHERE tipo_origem = 'movimentacao_financeira' AND empresa_id = r.empresa_id AND contrato_id IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_tot := v_tot + v_n;
    RAISE NOTICE 'Centro de custo "%": % linha(s) de movimentação financeira.', r.nome, v_n;
  END LOOP;
  RAISE NOTICE 'Carga do centro de custo: % linha(s) preenchidas.', v_tot;
  RAISE NOTICE 'Movimentações ainda sem centro de custo (empresa sem contrato MOVIMENTAÇÃO FINANCEIRA): % linha(s).',
    (SELECT count(*) FROM public."DEBITO_AUTOMATICO" WHERE tipo_origem = 'movimentacao_financeira' AND contrato_id IS NULL);
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.debito_automatico_criar_movimentacao(date, date, uuid, uuid, uuid, text, numeric, text, uuid, uuid, uuid, uuid);
-- -- recriar debito_automatico_criar_movimentacao (10 argumentos) com o corpo de 20260930000058 e debito_automatico_editar com o de 20261002000004;
-- -- a carga do centro de custo não é desfeita (as linhas só passam a ter contrato_id).
