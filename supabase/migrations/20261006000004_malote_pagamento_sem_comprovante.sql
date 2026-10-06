-- ============================================================================
-- Malote — pagar SEM comprovante ("Pago — aguardando comprovante")
-- ============================================================================
-- Pedido do Financeiro: o fornecedor às vezes demora a gerar o comprovante. Com
-- o anexo obrigatório, a despesa ficava pendente (aguardando pagamento) mesmo
-- já paga — e uma usuária pagou a mesma despesa duas vezes. Agora o pagamento
-- pode ser registrado SEM o arquivo: a despesa vai para `despesa_paga` (o
-- pagamento é real, e Fluxo de Caixa, Orçamento, juros etc. seguem como estão)
-- com a marca comprovante_pendente = true até quem pagou anexar o comprovante.
--
-- Decisão de desenho: NÃO existe status novo. 48 migrations referenciam
-- `despesa_paga` (Fluxo, Utilizado do Orçamento, juros, cartão, reembolso...);
-- um status extra obrigaria a incluí-lo em todos, e esquecer um faria a despesa
-- sumir de um relatório financeiro. A marca é uma coluna ao lado do status.
--
-- Quem anexa depois: o mesmo usuário que registrou o pagamento (pago_por) — e o
-- admin, como já acontece no pagar. O motivo de pagar sem comprovante é opcional.
--
-- ROLLBACK (comentado no fim).

-- ── 1. Colunas ──────────────────────────────────────────────────────────
ALTER TABLE public.malote_despesa
  ADD COLUMN IF NOT EXISTS comprovante_pendente        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS comprovante_pendente_motivo text,
  ADD COLUMN IF NOT EXISTS comprovante_anexado_em      timestamptz,
  ADD COLUMN IF NOT EXISTS comprovante_anexado_por     uuid REFERENCES auth.users(id);

ALTER TABLE public.malote_despesa_parcela
  ADD COLUMN IF NOT EXISTS comprovante_pendente        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS comprovante_pendente_motivo text,
  ADD COLUMN IF NOT EXISTS comprovante_anexado_em      timestamptz,
  ADD COLUMN IF NOT EXISTS comprovante_anexado_por     uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_malote_despesa_comprovante_pendente
  ON public.malote_despesa (pago_em) WHERE comprovante_pendente;
CREATE INDEX IF NOT EXISTS idx_malote_despesa_parcela_comprovante_pendente
  ON public.malote_despesa_parcela (pago_em) WHERE comprovante_pendente;

-- ── 2. Novo tipo de evento na timeline da despesa ───────────────────────
ALTER TABLE public.malote_despesa_evento DROP CONSTRAINT IF EXISTS malote_despesa_evento_tipo_evento_check;
ALTER TABLE public.malote_despesa_evento ADD CONSTRAINT malote_despesa_evento_tipo_evento_check CHECK (tipo_evento IN (
  'criacao', 'edicao', 'aguardando_cotacao', 'cotacao_realizada', 'cotacao_aprovada',
  'solicitacao_aprovada', 'solicitacao_reprovada', 'despesa_criada', 'aprovacao_nivel',
  'necessidade_de_ajuste', 'reenvio_aprovacao', 'aguardando_pagamento',
  'conferido_pagamento', 'ajuste_pagamento_solicitado',
  'despesa_paga', 'despesa_reprovada', 'cancelamento', 'exclusao', 'restauracao',
  'ajuste_administrativo', 'aprovacao_automatica_cotacao', 'ajuste_cotacao_solicitado',
  'cotacao_iniciada', 'cotacao_liberada', 'comprovante_anexado'
));

-- ── 3. malote_pagar_despesa: comprovante opcional ───────────────────────
-- A assinatura ganha _comprovante_motivo (DEFAULT NULL) — por isso a antiga é
-- removida antes: duas versões com argumentos nomeados iguais deixariam o
-- PostgREST sem saber qual chamar. Chamada antiga (8 args) continua valendo.
DROP FUNCTION IF EXISTS public.malote_pagar_despesa(uuid, date, text, text, jsonb, text, uuid, numeric);

CREATE OR REPLACE FUNCTION public.malote_pagar_despesa(
  _id uuid,
  _data_pagamento date,
  _comprovante_path text,
  _observacao text,
  _rateio_snapshot jsonb DEFAULT '[]'::jsonb,
  _forma_pagamento text DEFAULT NULL,
  _banco_id uuid DEFAULT NULL,
  _valor_juros numeric DEFAULT NULL,
  _comprovante_motivo text DEFAULT NULL
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
  v_sem_comprovante boolean := (_comprovante_path IS NULL OR btrim(_comprovante_path) = '');
BEGIN
  SELECT status, parcelado INTO v_status, v_parcelado FROM public.malote_despesa WHERE id = _id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;
  IF v_parcelado THEN RAISE EXCEPTION 'Despesa parcelada — pague cada parcela individualmente.'; END IF;
  IF v_status NOT IN ('aguardando_pagamento', 'pronto_para_pagar') THEN
    RAISE EXCEPTION 'Despesa não está em uma etapa de pagamento válida.';
  END IF;
  IF _data_pagamento IS NULL THEN RAISE EXCEPTION 'Data do pagamento é obrigatória.'; END IF;

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
    comprovante_pagamento_path = CASE WHEN v_sem_comprovante THEN NULL ELSE _comprovante_path END,
    comprovante_pendente = v_sem_comprovante,
    comprovante_pendente_motivo = CASE WHEN v_sem_comprovante THEN NULLIF(btrim(_comprovante_motivo), '') ELSE NULL END,
    observacao_pagamento = _observacao,
    pago_em = now(),
    pago_por = auth.uid(),
    forma_pagamento = COALESCE(_forma_pagamento, forma_pagamento),
    banco_id = _banco_id,
    valor_juros = _valor_juros,
    juros_status = CASE WHEN _valor_juros > 0 THEN 'pendente_cobrar' ELSE NULL END
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
  VALUES (
    _id,
    'despesa_paga',
    CASE WHEN v_sem_comprovante
      THEN coalesce(_observacao || ' — ', '') || 'Pago SEM comprovante (aguardando anexo)'
           || coalesce(': ' || NULLIF(btrim(_comprovante_motivo), ''), '.')
      ELSE _observacao
    END,
    auth.uid()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.malote_pagar_despesa(uuid, date, text, text, jsonb, text, uuid, numeric, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.malote_pagar_despesa(uuid, date, text, text, jsonb, text, uuid, numeric, text) TO authenticated;

-- ── 4. malote_pagar_parcela: comprovante opcional ───────────────────────
DROP FUNCTION IF EXISTS public.malote_pagar_parcela(uuid, uuid, date, text, text, jsonb, text, uuid, numeric);

CREATE OR REPLACE FUNCTION public.malote_pagar_parcela(
  _despesa_id uuid,
  _parcela_id uuid,
  _data_pagamento date,
  _comprovante_path text,
  _observacao text,
  _rateio_snapshot jsonb DEFAULT '[]'::jsonb,
  _forma_pagamento text DEFAULT NULL,
  _banco_id uuid DEFAULT NULL,
  _valor_juros numeric DEFAULT NULL,
  _comprovante_motivo text DEFAULT NULL
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
  v_pendentes int;
  v_sem_comprovante boolean := (_comprovante_path IS NULL OR btrim(_comprovante_path) = '');
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
    comprovante_pagamento_path = CASE WHEN v_sem_comprovante THEN NULL ELSE _comprovante_path END,
    comprovante_pendente = v_sem_comprovante,
    comprovante_pendente_motivo = CASE WHEN v_sem_comprovante THEN NULLIF(btrim(_comprovante_motivo), '') ELSE NULL END,
    observacao_pagamento = _observacao,
    pago_em = now(),
    pago_por = auth.uid(),
    banco_id = _banco_id,
    valor_juros = _valor_juros,
    juros_status = CASE WHEN _valor_juros > 0 THEN 'pendente_cobrar' ELSE NULL END
  WHERE id = _parcela_id;

  SELECT count(*) INTO v_restantes
  FROM public.malote_despesa_parcela WHERE despesa_id = _despesa_id AND status <> 'paga';

  SELECT count(*) INTO v_total_parcelas
  FROM public.malote_despesa_parcela WHERE despesa_id = _despesa_id;

  IF v_restantes = 0 THEN
    -- Última parcela: a despesa fica paga. Pendente se QUALQUER parcela ainda
    -- estiver sem comprovante; o caminho da despesa é o da última parcela paga
    -- (mesmo padrão de antes) — nulo quando ela foi paga sem comprovante.
    SELECT count(*) INTO v_pendentes
    FROM public.malote_despesa_parcela WHERE despesa_id = _despesa_id AND comprovante_pendente;

    UPDATE public.malote_despesa SET
      status = 'despesa_paga',
      data_pagamento = _data_pagamento,
      comprovante_pagamento_path = CASE WHEN v_sem_comprovante THEN NULL ELSE _comprovante_path END,
      comprovante_pendente = (v_pendentes > 0),
      observacao_pagamento = _observacao,
      pago_em = now(),
      pago_por = auth.uid(),
      forma_pagamento = COALESCE(_forma_pagamento, forma_pagamento),
      banco_id = _banco_id
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
    coalesce(_observacao || ' — ', '') || format('Parcela %s/%s paga', v_numero_parcela, v_total_parcelas)
      || CASE WHEN v_sem_comprovante
           THEN ' SEM comprovante (aguardando anexo)' || coalesce(': ' || NULLIF(btrim(_comprovante_motivo), ''), '')
           ELSE ''
         END
      || '.',
    auth.uid()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.malote_pagar_parcela(uuid, uuid, date, text, text, jsonb, text, uuid, numeric, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.malote_pagar_parcela(uuid, uuid, date, text, text, jsonb, text, uuid, numeric, text) TO authenticated;

-- ── 5. Anexar o comprovante depois ──────────────────────────────────────
-- Só quem registrou o pagamento (pago_por) ou admin. Sem _parcela_id = despesa
-- não parcelada; com _parcela_id = aquela parcela (e a marca da despesa é
-- recalculada: some quando nenhuma parcela estiver pendente).
CREATE OR REPLACE FUNCTION public.malote_anexar_comprovante(
  _despesa_id uuid,
  _comprovante_path text,
  _parcela_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_pendente boolean;
  v_pago_por uuid;
  v_numero_parcela int;
  v_restantes_pendentes int;
BEGIN
  IF _comprovante_path IS NULL OR btrim(_comprovante_path) = '' THEN
    RAISE EXCEPTION 'Anexe o arquivo do comprovante.';
  END IF;

  SELECT status INTO v_status FROM public.malote_despesa WHERE id = _despesa_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;

  IF _parcela_id IS NULL THEN
    SELECT comprovante_pendente, pago_por INTO v_pendente, v_pago_por FROM public.malote_despesa WHERE id = _despesa_id;
    IF v_status <> 'despesa_paga' OR NOT v_pendente THEN
      RAISE EXCEPTION 'Esta despesa não está aguardando comprovante.';
    END IF;
    IF NOT (v_pago_por = auth.uid() OR public.has_role(auth.uid(), 'admin')) THEN
      RAISE EXCEPTION 'Só quem registrou o pagamento pode anexar o comprovante.';
    END IF;

    UPDATE public.malote_despesa SET
      comprovante_pagamento_path = _comprovante_path,
      comprovante_pendente = false,
      comprovante_anexado_em = now(),
      comprovante_anexado_por = auth.uid()
    WHERE id = _despesa_id;

    INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, ator_user_id)
    VALUES (_despesa_id, 'comprovante_anexado', 'Comprovante de pagamento anexado.', auth.uid());
  ELSE
    SELECT comprovante_pendente, pago_por, numero_parcela INTO v_pendente, v_pago_por, v_numero_parcela
    FROM public.malote_despesa_parcela WHERE id = _parcela_id AND despesa_id = _despesa_id FOR UPDATE;
    IF v_pendente IS NULL THEN RAISE EXCEPTION 'Parcela não encontrada.'; END IF;
    IF NOT v_pendente THEN RAISE EXCEPTION 'Esta parcela não está aguardando comprovante.'; END IF;
    IF NOT (v_pago_por = auth.uid() OR public.has_role(auth.uid(), 'admin')) THEN
      RAISE EXCEPTION 'Só quem registrou o pagamento pode anexar o comprovante.';
    END IF;

    UPDATE public.malote_despesa_parcela SET
      comprovante_pagamento_path = _comprovante_path,
      comprovante_pendente = false,
      comprovante_anexado_em = now(),
      comprovante_anexado_por = auth.uid()
    WHERE id = _parcela_id;

    IF v_status = 'despesa_paga' THEN
      SELECT count(*) INTO v_restantes_pendentes
      FROM public.malote_despesa_parcela WHERE despesa_id = _despesa_id AND comprovante_pendente;
      UPDATE public.malote_despesa SET
        comprovante_pendente = (v_restantes_pendentes > 0),
        comprovante_pagamento_path = COALESCE(comprovante_pagamento_path, _comprovante_path)
      WHERE id = _despesa_id;
    END IF;

    INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, ator_user_id)
    VALUES (_despesa_id, 'comprovante_anexado', format('Comprovante da parcela %s anexado.', v_numero_parcela), auth.uid());
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.malote_anexar_comprovante(uuid, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.malote_anexar_comprovante(uuid, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.malote_anexar_comprovante(uuid, text, uuid);
--   DROP FUNCTION IF EXISTS public.malote_pagar_despesa(uuid, date, text, text, jsonb, text, uuid, numeric, text);
--   DROP FUNCTION IF EXISTS public.malote_pagar_parcela(uuid, uuid, date, text, text, jsonb, text, uuid, numeric, text);
--   (recriar as duas com a definição de 20260930000230_controle_juros_malote.sql — comprovante obrigatório)
--   -- antes, regularizar o que ficou pendente (a versão antiga exige comprovante em todo pago):
--   --   UPDATE public.malote_despesa SET comprovante_pendente = false WHERE comprovante_pendente;
--   ALTER TABLE public.malote_despesa_evento DROP CONSTRAINT IF EXISTS malote_despesa_evento_tipo_evento_check;
--   (recriar a CHECK sem 'comprovante_anexado', como em 20261005000012_malote_cotacao_iniciar.sql)
--   DROP INDEX IF EXISTS public.idx_malote_despesa_comprovante_pendente, public.idx_malote_despesa_parcela_comprovante_pendente;
--   ALTER TABLE public.malote_despesa DROP COLUMN comprovante_pendente, DROP COLUMN comprovante_pendente_motivo,
--     DROP COLUMN comprovante_anexado_em, DROP COLUMN comprovante_anexado_por;
--   ALTER TABLE public.malote_despesa_parcela DROP COLUMN comprovante_pendente, DROP COLUMN comprovante_pendente_motivo,
--     DROP COLUMN comprovante_anexado_em, DROP COLUMN comprovante_anexado_por;
--   NOTIFY pgrst, 'reload schema';
