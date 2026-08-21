-- SIS-2026-0212 (complemento, achado do Iury): o Rateio da Despesa
-- (Orçado/Utilizado/Status por linha) recalcula sempre ao vivo, contra o
-- estado atual de outras despesas -- então uma despesa já paga (ex.:
-- DM-2026-0040) podia passar a aparecer "fora do orçado" só porque uma
-- despesa nova (DM-2026-0041) foi lançada depois no mesmo orçamento/mês.
-- Nada "congelava" o que era verdade no momento do pagamento.
--
-- O cálculo de Orçado (useOrcadoClassificacao) só existe em TS -- soma
-- rubricas de contrato ou planejamento_orcamentario administrativo
-- vigente, com várias tabelas de apoio -- replicar em SQL seria um
-- trabalho grande à parte. Como não é dado de segurança (é só registro
-- histórico do que o aprovador/financeiro viu na hora), o client calcula
-- e manda pronto pra RPC gravar, mesmo padrão já usado aqui pra
-- valor_aprovado/justificativa.
alter table public.malote_despesa_rateio_linha
  add column if not exists orcado_snapshot numeric,
  add column if not exists utilizado_com_lancamento_snapshot numeric,
  add column if not exists congelado_em timestamptz;

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
      AND despesa_id = _id;
  END LOOP;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, ator_user_id)
  VALUES (_id, 'despesa_paga', _observacao, auth.uid());
END;
$$;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   CREATE OR REPLACE FUNCTION public.malote_pagar_despesa(_id uuid, _data_pagamento date, _comprovante_path text, _observacao text)
--   -- (corpo idêntico, sem o parâmetro _rateio_snapshot nem o loop de UPDATE)
--   ALTER TABLE public.malote_despesa_rateio_linha DROP COLUMN IF EXISTS orcado_snapshot;
--   ALTER TABLE public.malote_despesa_rateio_linha DROP COLUMN IF EXISTS utilizado_com_lancamento_snapshot;
--   ALTER TABLE public.malote_despesa_rateio_linha DROP COLUMN IF EXISTS congelado_em;
