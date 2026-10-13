-- SIS-2026-0644: poder trocar o comprovante de pagamento de um item do Malote já pago.
--
-- Hoje o comprovante só podia ser anexado uma vez (malote_anexar_comprovante exige a marca
-- "aguardando comprovante"); quem anexava o arquivo errado não tinha como corrigir.
--
-- malote_trocar_comprovante substitui o arquivo de uma despesa não parcelada ou de uma
-- parcela já paga que JÁ tem comprovante. Quem pode: quem registrou o pagamento ou quem
-- tem a permissão de pagar do Malote (malote_pode_pagar). O arquivo antigo NÃO é apagado do
-- storage e o nome dele fica na linha do tempo da despesa (mesmo tipo de evento
-- 'comprovante_anexado' — não mexe na CHECK da tabela de eventos).
--
-- Migrations não se auto-aplicam: rodar no SQL Editor.

CREATE OR REPLACE FUNCTION public.malote_trocar_comprovante(
  _despesa_id uuid,
  _comprovante_path text,
  _parcela_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_pago_por uuid;
  v_antigo text;
  v_numero_parcela int;
  v_status_parcela text;
BEGIN
  IF _comprovante_path IS NULL OR btrim(_comprovante_path) = '' THEN
    RAISE EXCEPTION 'Anexe o arquivo do comprovante.';
  END IF;

  SELECT status INTO v_status FROM public.malote_despesa WHERE id = _despesa_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;

  IF _parcela_id IS NULL THEN
    SELECT comprovante_pagamento_path, pago_por INTO v_antigo, v_pago_por
    FROM public.malote_despesa WHERE id = _despesa_id;
    IF v_status <> 'despesa_paga' THEN
      RAISE EXCEPTION 'Só dá para trocar o comprovante de uma despesa já paga.';
    END IF;
    IF v_antigo IS NULL THEN
      RAISE EXCEPTION 'Esta despesa ainda não tem comprovante — use "Anexar comprovante".';
    END IF;
    IF NOT (v_pago_por = auth.uid() OR public.malote_pode_pagar()) THEN
      RAISE EXCEPTION 'Só quem registrou o pagamento (ou quem tem permissão de pagar) pode trocar o comprovante.';
    END IF;

    UPDATE public.malote_despesa SET
      comprovante_pagamento_path = _comprovante_path,
      comprovante_anexado_em = now(),
      comprovante_anexado_por = auth.uid()
    WHERE id = _despesa_id;

    INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, ator_user_id)
    VALUES (_despesa_id, 'comprovante_anexado',
            format('Comprovante de pagamento substituído (arquivo anterior: %s).', regexp_replace(v_antigo, '^.*/', '')),
            auth.uid());
  ELSE
    SELECT status, comprovante_pagamento_path, pago_por, numero_parcela
      INTO v_status_parcela, v_antigo, v_pago_por, v_numero_parcela
    FROM public.malote_despesa_parcela WHERE id = _parcela_id AND despesa_id = _despesa_id FOR UPDATE;
    IF v_status_parcela IS NULL THEN RAISE EXCEPTION 'Parcela não encontrada.'; END IF;
    IF v_status_parcela <> 'paga' THEN
      RAISE EXCEPTION 'Só dá para trocar o comprovante de uma parcela já paga.';
    END IF;
    IF v_antigo IS NULL THEN
      RAISE EXCEPTION 'Esta parcela ainda não tem comprovante — use "Anexar".';
    END IF;
    IF NOT (v_pago_por = auth.uid() OR public.malote_pode_pagar()) THEN
      RAISE EXCEPTION 'Só quem registrou o pagamento (ou quem tem permissão de pagar) pode trocar o comprovante.';
    END IF;

    UPDATE public.malote_despesa_parcela SET
      comprovante_pagamento_path = _comprovante_path,
      comprovante_anexado_em = now(),
      comprovante_anexado_por = auth.uid()
    WHERE id = _parcela_id;

    -- O comprovante da despesa parcelada repete o da primeira parcela paga: mantém os dois iguais.
    UPDATE public.malote_despesa SET comprovante_pagamento_path = _comprovante_path
    WHERE id = _despesa_id AND comprovante_pagamento_path = v_antigo;

    INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, ator_user_id)
    VALUES (_despesa_id, 'comprovante_anexado',
            format('Comprovante da parcela %s substituído (arquivo anterior: %s).', v_numero_parcela, regexp_replace(v_antigo, '^.*/', '')),
            auth.uid());
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.malote_trocar_comprovante(uuid, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.malote_trocar_comprovante(uuid, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.malote_trocar_comprovante(uuid, text, uuid);
--   NOTIFY pgrst, 'reload schema';
