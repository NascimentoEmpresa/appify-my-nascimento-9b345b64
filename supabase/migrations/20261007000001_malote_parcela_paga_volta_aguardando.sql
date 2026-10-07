-- SIS-2026-0613 (complemento): parcela paga em despesa "pronto para pagar" deixava a
-- despesa presa nesse status (DM-2026-0924: parcela 1/2 paga em 22/09, "Valor pago" da
-- tela Pagamento Malote R$ 1.066,67 abaixo do Fluxo e da Auditoria).
--
-- Causa: malote_pagar_parcela aceita pagar de 'aguardando_pagamento' OU 'pronto_para_pagar'
-- (desde o SIS-2026-0223) mas só mudava o status da despesa na ÚLTIMA parcela.
--
-- 1) O trigger de notificação ganha uma condição de silêncio (setting local da transação), para
--    a correção de status não avisar "Despesa aprovada"/"Nova despesa para pagar" de novo.
-- 2) malote_pagar_parcela: ao pagar parcela que não é a última com a despesa conferida, a despesa
--    volta para 'aguardando_pagamento'. Resto da função idêntico ao da 20261006000004.
-- 3) Correção do dado: parceladas já presas em 'pronto_para_pagar' com parcela paga e outra pendente.
--
-- Migrations não se auto-aplicam: rodar no SQL Editor.

-- ── 1. Trigger de notificação com condição de silêncio ─────────────────────
DROP TRIGGER IF EXISTS malote_despesa_notificar_trg ON public.malote_despesa;
CREATE TRIGGER malote_despesa_notificar_trg
  AFTER INSERT OR UPDATE OF status, nivel_aprovacao_atual ON public.malote_despesa
  FOR EACH ROW
  WHEN (current_setting('malote.sem_notificacao', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION public.malote_despesa_notificar();

-- ── 2. malote_pagar_parcela ────────────────────────────────────────────────
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

  -- SIS-2026-0613 (achado na Auditoria da Controladoria, DM-2026-0924): a despesa
  -- conferida ("pronto para pagar") que recebe o pagamento de uma parcela que NÃO
  -- é a última voltava a ficar parada em "pronto para pagar" com parcela já paga —
  -- a tela Pagamento Malote e o Orçamento a tratavam como não paga. Parcela paga é
  -- progresso real: volta para "aguardando pagamento", como as demais parceladas.
  -- Sem notificação: a despesa não foi liberada de novo, só mudou de etapa.
  IF v_restantes > 0 AND v_status_despesa = 'pronto_para_pagar' THEN
    PERFORM set_config('malote.sem_notificacao', 'on', true);
    UPDATE public.malote_despesa SET status = 'aguardando_pagamento' WHERE id = _despesa_id;
    PERFORM set_config('malote.sem_notificacao', 'off', true);
  END IF;

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

-- ── 3. Correção do dado já gravado ─────────────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  PERFORM set_config('malote.sem_notificacao', 'on', true);
  FOR r IN
    SELECT d.id, d.numero
      FROM public.malote_despesa d
     WHERE d.parcelado
       AND d.deleted_at IS NULL
       AND d.status = 'pronto_para_pagar'
       AND EXISTS (SELECT 1 FROM public.malote_despesa_parcela p WHERE p.despesa_id = d.id AND p.status = 'paga')
       AND EXISTS (SELECT 1 FROM public.malote_despesa_parcela p WHERE p.despesa_id = d.id AND p.status <> 'paga')
  LOOP
    UPDATE public.malote_despesa SET status = 'aguardando_pagamento' WHERE id = r.id;
    INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, ator_user_id)
    VALUES (r.id, 'ajuste_administrativo', 'Status corrigido para aguardando pagamento: havia parcela paga com a despesa parada em "pronto para pagar".', NULL);
    RAISE NOTICE 'Despesa % corrigida', r.numero;
  END LOOP;
  PERFORM set_config('malote.sem_notificacao', 'off', true);
END $$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   DROP TRIGGER IF EXISTS malote_despesa_notificar_trg ON public.malote_despesa;
--   CREATE TRIGGER malote_despesa_notificar_trg
--     AFTER INSERT OR UPDATE OF status, nivel_aprovacao_atual ON public.malote_despesa
--     FOR EACH ROW EXECUTE FUNCTION public.malote_despesa_notificar();
--   -- malote_pagar_parcela: reaplicar o bloco "4." de 20261006000004_malote_pagamento_sem_comprovante.sql
--   NOTIFY pgrst, 'reload schema';
