-- [SEM-CHAMADO] (achado em produção, erro real ao lançar Débito
-- Automático): "Could not find the function
-- public.debito_automatico_criar_debito(_banco_id, _classificacao_id,
-- _competencia, _contrato_id, _data_pagamento, _descricao, _empresa_id,
-- _forma_pagamento, _status, _tipo, _valor) in the schema cache".
--
-- SIS-2026-0492 adicionou `status?: StatusDebito` em CriarDebitoInput
-- (useDebitoAutomatico.ts) e passou a mandar `_status` na chamada RPC —
-- mas só as RPCs irmãs (`debito_automatico_criar_movimentacao`,
-- `debito_automatico_criar_nota`, ambas em 20260930000056) ganharam o
-- parâmetro `_status text DEFAULT 'pendente'` na época. Esta aqui
-- (`debito_automatico_criar_debito`) nunca recebeu — nem na criação
-- (20260930000056) nem nas duas vezes que foi redefinida depois
-- (20260930000058 banco_id, 20260930000181 espelho no Malote). Front
-- manda `_status` desde então, função nunca aceitou.
--
-- Mesma assinatura de 20260930000181 (corpo integral preservado, incluindo
-- o espelho em malote_despesa) + `_status text DEFAULT 'pendente'`, com a
-- mesma validação que as RPCs irmãs já fazem.

CREATE OR REPLACE FUNCTION public.debito_automatico_criar_debito(
  _data_pagamento date, _competencia date, _tipo text,
  _empresa_id uuid, _contrato_id uuid, _classificacao_id uuid,
  _descricao text, _forma_pagamento text, _valor numeric, _banco_id uuid,
  _status text DEFAULT 'pendente'
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
  IF _status NOT IN ('pendente', 'pago') THEN
    RAISE EXCEPTION 'Status inválido: %', _status;
  END IF;

  INSERT INTO public."DEBITO_AUTOMATICO" (
    tipo_origem, tipo, data_pagamento, competencia, empresa_id, contrato_id,
    classificacao_id, descricao, forma_pagamento, valor, banco_id, status, created_by
  ) VALUES (
    'debito_automatico', _tipo, _data_pagamento, _competencia, _empresa_id, _contrato_id,
    _classificacao_id, _descricao, _forma_pagamento, _valor, _banco_id, _status, auth.uid()
  ) RETURNING id INTO v_id;

  INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
  VALUES (v_id, 'criacao', auth.uid(), 'Débito Automático criado.');

  -- SIS-2026-0444: espelha no Malote — mesmos campos do Débito Automático,
  -- `origem = 'despesa_unica'` (categoria única, igual ao Reembolso) e
  -- `status = 'despesa_paga'` fixo (decisão do chamado: já nasce como
  -- despesa paga em todas as telas do Malote, independente do status do
  -- Débito Automático em si ser pendente ou pago).
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

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- CREATE OR REPLACE FUNCTION public.debito_automatico_criar_debito(
--   _data_pagamento date, _competencia date, _tipo text,
--   _empresa_id uuid, _contrato_id uuid, _classificacao_id uuid,
--   _descricao text, _forma_pagamento text, _valor numeric, _banco_id uuid
-- ) RETURNS uuid
-- LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
-- -- corpo igual ao de 20260930000181, sem o parâmetro _status
-- $$;
-- NOTIFY pgrst, 'reload schema';
