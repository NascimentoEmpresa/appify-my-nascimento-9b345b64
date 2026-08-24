-- SIS-2026-0212 (complemento, pedido do Iury): move o congelamento do
-- Rateio (Orçado/Utilizado por linha, 20260921000001) de "quando a despesa
-- é paga" pra "quando ela sai do fluxo de aprovação e vira aguardando_
-- pagamento" — o único ponto que faz essa transição é
-- malote_aprovar_despesa, quando não escala pro próximo nível.
--
-- malote_pagar_despesa continua recebendo o parâmetro e gravando o
-- snapshot, mas só como rede de segurança (WHERE congelado_em IS NULL) —
-- despesas que já congelaram na aprovação não são sobrescritas.
CREATE OR REPLACE FUNCTION public.malote_aprovar_despesa(
  _id uuid,
  _proximo_nivel_configurado boolean,
  _valor_aprovado numeric,
  _justificativa text,
  _forma_pagamento text,
  _informacoes_pagamento text,
  _data_pagamento date,
  _competencia date,
  _rateio_snapshot jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_nivel smallint;
  v_linha jsonb;
BEGIN
  SELECT status, nivel_aprovacao_atual INTO v_status, v_nivel FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;
  IF v_status <> 'pendente_aprovacao' THEN RAISE EXCEPTION 'Despesa não está pendente de aprovação.'; END IF;

  IF NOT (
    public.malote_pode('aprovar')
    AND (public.malote_aprovador_do_nivel(_id, v_nivel) = auth.uid()
         OR public.malote_supervisor_por_cargo(auth.uid())
         OR public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'Sem permissão para aprovar esta despesa.';
  END IF;

  UPDATE public.malote_despesa SET
    valor_aprovado = _valor_aprovado,
    justificativa_aprovacao = _justificativa,
    forma_pagamento = _forma_pagamento,
    informacoes_pagamento = _informacoes_pagamento,
    data_pagamento = _data_pagamento,
    competencia = _competencia,
    nivel_aprovacao_atual = CASE WHEN v_nivel < 3 AND _proximo_nivel_configurado THEN v_nivel + 1 ELSE nivel_aprovacao_atual END,
    status = CASE WHEN v_nivel < 3 AND _proximo_nivel_configurado THEN status ELSE 'aguardando_pagamento' END
  WHERE id = _id;

  -- Só congela quando a despesa realmente sai do fluxo de aprovação nesta
  -- chamada (não escalou) — se ainda vai pro próximo nível, o Orçado/
  -- Utilizado seguem ao vivo até o último aprovador decidir.
  IF NOT (v_nivel < 3 AND _proximo_nivel_configurado) THEN
    FOR v_linha IN SELECT * FROM jsonb_array_elements(_rateio_snapshot)
    LOOP
      UPDATE public.malote_despesa_rateio_linha
      SET orcado_snapshot = (v_linha->>'orcado')::numeric,
          utilizado_com_lancamento_snapshot = (v_linha->>'utilizado_com_lancamento')::numeric,
          congelado_em = now()
      WHERE id = (v_linha->>'linha_id')::uuid
        AND despesa_id = _id;
    END LOOP;
  END IF;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, nivel, ator_user_id)
  VALUES (_id, 'aprovacao_nivel', _justificativa, v_nivel, auth.uid());
END;
$$;

-- Rede de segurança: se por algum motivo a despesa chegou em pagamento
-- sem ter sido congelada na aprovação, ainda congela aqui — mas nunca
-- sobrescreve um snapshot que já existe.
CREATE OR REPLACE FUNCTION public.malote_pagar_despesa(
  _id uuid,
  _data_pagamento date,
  _comprovante_path text,
  _observacao text,
  _rateio_snapshot jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_linha jsonb;
BEGIN
  SELECT status INTO v_status FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;
  IF v_status NOT IN ('aguardando_pagamento', 'pronto_para_pagar') THEN
    RAISE EXCEPTION 'Despesa não está em uma etapa de pagamento válida.';
  END IF;
  IF _data_pagamento IS NULL THEN RAISE EXCEPTION 'Data do pagamento é obrigatória.'; END IF;
  IF _comprovante_path IS NULL OR btrim(_comprovante_path) = '' THEN
    RAISE EXCEPTION 'Comprovante de pagamento é obrigatório.';
  END IF;

  IF NOT (
    public.malote_pode_pagar()
    OR public.malote_supervisor_por_cargo(auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para pagar esta despesa.';
  END IF;

  UPDATE public.malote_despesa SET
    status = 'despesa_paga',
    data_pagamento = _data_pagamento,
    comprovante_pagamento_path = _comprovante_path,
    observacao_pagamento = _observacao,
    pago_em = now(),
    pago_por = auth.uid()
  WHERE id = _id;

  FOR v_linha IN SELECT * FROM jsonb_array_elements(_rateio_snapshot)
  LOOP
    UPDATE public.malote_despesa_rateio_linha
    SET orcado_snapshot = (v_linha->>'orcado')::numeric,
        utilizado_com_lancamento_snapshot = (v_linha->>'utilizado_com_lancamento')::numeric,
        congelado_em = now()
    WHERE id = (v_linha->>'linha_id')::uuid
      AND despesa_id = _id
      AND congelado_em IS NULL;
  END LOOP;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, ator_user_id)
  VALUES (_id, 'despesa_paga', _observacao, auth.uid());
END;
$$;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   Reverter malote_aprovar_despesa e malote_pagar_despesa pros
--   CREATE OR REPLACE de 20260921000001_malote_rateio_congela_no_pagamento.sql
--   (malote_pagar_despesa sem o "AND congelado_em IS NULL", e
--   malote_aprovar_despesa sem o parâmetro _rateio_snapshot nem o loop).
