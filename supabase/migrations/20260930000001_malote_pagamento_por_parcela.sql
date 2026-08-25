-- SIS-2026-0223 (Iury): despesa parcelada some do fluxo depois de criada —
-- Aprovações/Meus Itens/Pagamento do Malote mostram só a despesa-mãe, e o
-- pagamento (malote_pagar_despesa) grava um único comprovante/data pra
-- despesa inteira, ignorando malote_despesa_parcela. A partir de agora
-- cada parcela é paga individualmente, com comprovante e data próprios.
--
-- A APROVAÇÃO não muda de mecanismo: como só existe 1 despesa por baixo
-- (não N despesas separadas), malote_aprovar_despesa já é atômica — aprovar
-- a despesa já "aprova" as N parcelas implicitamente. Só o PAGAMENTO passa
-- a ser rastreado por parcela.
ALTER TABLE public.malote_despesa_parcela
  ADD COLUMN status text NOT NULL DEFAULT 'pendente',
  ADD COLUMN comprovante_pagamento_path text,
  ADD COLUMN observacao_pagamento text,
  ADD COLUMN data_pagamento_real date,
  ADD COLUMN pago_em timestamptz,
  ADD COLUMN pago_por uuid REFERENCES auth.users(id);

ALTER TABLE public.malote_despesa_parcela
  ADD CONSTRAINT malote_despesa_parcela_status_check CHECK (status IN ('pendente', 'paga'));

-- Só dois estados: os estágios intermediários do pagamento (conferência,
-- solicitar ajuste, reprovação) continuam sendo decisão sobre a despesa
-- inteira — não faz sentido "conferir" só 1 parcela.

CREATE OR REPLACE FUNCTION public.malote_pagar_parcela(
  _despesa_id uuid,
  _parcela_id uuid,
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
  v_status_despesa text;
  v_status_parcela text;
  v_parcela_despesa_id uuid;
  v_numero_parcela int;
  v_total_parcelas int;
  v_linha jsonb;
  v_restantes int;
BEGIN
  SELECT status INTO v_status_despesa FROM public.malote_despesa WHERE id = _despesa_id;
  IF v_status_despesa IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;
  IF v_status_despesa NOT IN ('aguardando_pagamento', 'pronto_para_pagar') THEN
    RAISE EXCEPTION 'Despesa não está em uma etapa de pagamento válida.';
  END IF;

  SELECT status, despesa_id, numero_parcela INTO v_status_parcela, v_parcela_despesa_id, v_numero_parcela
  FROM public.malote_despesa_parcela WHERE id = _parcela_id FOR UPDATE;
  IF v_status_parcela IS NULL THEN RAISE EXCEPTION 'Parcela não encontrada.'; END IF;
  IF v_parcela_despesa_id <> _despesa_id THEN RAISE EXCEPTION 'Parcela não pertence a esta despesa.'; END IF;
  IF v_status_parcela = 'paga' THEN RAISE EXCEPTION 'Parcela já está paga.'; END IF;

  IF _data_pagamento IS NULL THEN RAISE EXCEPTION 'Data do pagamento é obrigatória.'; END IF;
  IF _comprovante_path IS NULL OR btrim(_comprovante_path) = '' THEN
    RAISE EXCEPTION 'Comprovante de pagamento é obrigatório.';
  END IF;

  IF NOT (
    public.malote_pode_pagar()
    OR public.malote_supervisor_por_cargo(auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para pagar esta parcela.';
  END IF;

  UPDATE public.malote_despesa_parcela SET
    status = 'paga',
    data_pagamento_real = _data_pagamento,
    comprovante_pagamento_path = _comprovante_path,
    observacao_pagamento = _observacao,
    pago_em = now(),
    pago_por = auth.uid()
  WHERE id = _parcela_id;

  SELECT count(*) INTO v_restantes
  FROM public.malote_despesa_parcela WHERE despesa_id = _despesa_id AND status <> 'paga';

  SELECT count(*) INTO v_total_parcelas
  FROM public.malote_despesa_parcela WHERE despesa_id = _despesa_id;

  -- Congela o Rateio, mesma rede de segurança de malote_pagar_despesa —
  -- só na ÚLTIMA parcela paga (é quando a despesa some do "utilizado"
  -- pendente e vira gasto realizado de verdade).
  IF v_restantes = 0 THEN
    UPDATE public.malote_despesa SET
      status = 'despesa_paga',
      data_pagamento = _data_pagamento,
      comprovante_pagamento_path = _comprovante_path,
      observacao_pagamento = _observacao,
      pago_em = now(),
      pago_por = auth.uid()
    WHERE id = _despesa_id;

    FOR v_linha IN SELECT * FROM jsonb_array_elements(_rateio_snapshot)
    LOOP
      UPDATE public.malote_despesa_rateio_linha
      SET orcado_snapshot = (v_linha->>'orcado')::numeric,
          utilizado_com_lancamento_snapshot = (v_linha->>'utilizado_com_lancamento')::numeric,
          congelado_em = now()
      WHERE id = (v_linha->>'linha_id')::uuid
        AND despesa_id = _despesa_id
        AND congelado_em IS NULL;
    END LOOP;
  END IF;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, ator_user_id)
  VALUES (
    _despesa_id,
    'despesa_paga',
    coalesce(_observacao || ' — ', '') || format('Parcela %s/%s paga.', v_numero_parcela, v_total_parcelas),
    auth.uid()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.malote_pagar_parcela(uuid, uuid, date, text, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.malote_pagar_parcela(uuid, uuid, date, text, text, jsonb) TO authenticated;

-- Segurança em profundidade: essa RPC continua servindo só despesa NÃO
-- parcelada — despesa parcelada tem que passar por malote_pagar_parcela,
-- uma linha de cada vez.
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
  v_parcelado boolean;
  v_linha jsonb;
BEGIN
  SELECT status, parcelado INTO v_status, v_parcelado FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;
  IF v_parcelado THEN RAISE EXCEPTION 'Despesa parcelada — pague cada parcela individualmente.'; END IF;
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
-- Nota sobre RLS (não é lacuna, é decisão): malote_pagar_parcela é
-- SECURITY DEFINER, como toda RPC de ação no Malote — não passa pelo
-- WITH CHECK de malote_parcela_all (que só libera update direto de
-- malote_despesa_parcela pra dono/admin/supervisor por cargo, sem cobrir
-- o Financeiro). Nenhuma migration de policy nova é necessária: o
-- pagamento sempre passou por RPC, nunca por update direto client-side
-- (mesmo padrão de malote_pagar_despesa desde sempre).
--
-- ROLLBACK
--   Reverter malote_pagar_despesa pro CREATE OR REPLACE de
--   20260921000003_malote_rateio_congela_em_aguardando_pagamento.sql
--   (remove a checagem de v_parcelado).
--   DROP FUNCTION IF EXISTS public.malote_pagar_parcela(uuid, uuid, date, text, text, jsonb);
--   ALTER TABLE public.malote_despesa_parcela
--     DROP CONSTRAINT IF EXISTS malote_despesa_parcela_status_check,
--     DROP COLUMN IF EXISTS status,
--     DROP COLUMN IF EXISTS comprovante_pagamento_path,
--     DROP COLUMN IF EXISTS observacao_pagamento,
--     DROP COLUMN IF EXISTS data_pagamento_real,
--     DROP COLUMN IF EXISTS pago_em,
--     DROP COLUMN IF EXISTS pago_por;
