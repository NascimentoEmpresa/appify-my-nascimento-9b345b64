-- =====================================================================
-- SIS-2026-0477 — Documentos físicos na retirada para entrega
--
-- A ficha de EPI e o crachá físico saem do almoxarifado junto do pedido,
-- mas não retornam a ele. A confirmação de retirada é, portanto, o ponto
-- em que o almoxarifado consegue registrar que cada documento foi entregue
-- à pessoa responsável pelo transporte.
--
-- A resposta fica na observação do evento RETIRADA de propósito: é uma
-- evidência daquele momento, não uma propriedade permanente do pedido.
-- Assim, o histórico continua sendo a fonte de verdade e uma reimpressão
-- futura da ficha não altera o que foi efetivamente retirado neste envio.
--
-- A RPC antiga é preservada para não interromper uma aba já aberta durante
-- a publicação. A nova tela chama a RPC abaixo, que exige as duas respostas.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sup_retirada_confirmar_com_documentos(text, boolean, boolean);
-- =====================================================================

CREATE OR REPLACE FUNCTION public.sup_retirada_confirmar_com_documentos(
  p_ref text,
  p_possui_ficha_epi_fisica boolean,
  p_possui_cracha_fisico boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_nome  text;
  v_id    uuid;
  v_ped   record;
  v_agora timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF COALESCE((auth.jwt()->>'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'A retirada exige login com um usuário do sistema.';
  END IF;
  IF NOT public.can_access(v_uid, 'sup_retirada_entrega', 'incluir') THEN
    RAISE EXCEPTION 'Seu usuário não pode confirmar retirada. Peça a liberação de "Retirada para Entrega" em Acesso por Usuário.';
  END IF;
  IF p_possui_ficha_epi_fisica IS NULL OR p_possui_cracha_fisico IS NULL THEN
    RAISE EXCEPTION 'Informe se o pedido possui Ficha de EPI física e Crachá físico.';
  END IF;

  v_id := public.sup_retirada_localizar(p_ref);
  IF v_id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado: %', p_ref; END IF;

  SELECT p.id, p.pedido_id, p.status, p.retirado_em, p.retirado_por_nome
    INTO v_ped
    FROM public.sup_pedido p
   WHERE p.id = v_id
     FOR UPDATE;

  IF v_ped.status = 'RETIRADO PARA ENTREGA' THEN
    RETURN jsonb_build_object(
      'ja_retirado', true, 'pedido_id', v_ped.pedido_id,
      'retirado_em', v_ped.retirado_em, 'retirado_por_nome', v_ped.retirado_por_nome);
  END IF;

  IF v_ped.status <> 'AGUARDANDO ENVIO' THEN
    RAISE EXCEPTION '%', CASE v_ped.status
      WHEN 'DESPACHADO' THEN format('O pedido %s já consta como despachado.', v_ped.pedido_id)
      WHEN 'CANCELADO'  THEN format('O pedido %s foi cancelado. Não leve este volume e avise o Suprimentos.', v_ped.pedido_id)
      ELSE format('O pedido %s ainda não está liberado para retirada (situação: %s). Confirme com o Suprimentos antes de levar.',
                  v_ped.pedido_id, v_ped.status)
    END;
  END IF;

  v_nome := COALESCE(public.sup_est_nome_usuario(), auth.jwt()->>'email', 'Usuário');

  UPDATE public.sup_pedido p
     SET status            = 'RETIRADO PARA ENTREGA',
         retirado_em       = v_agora,
         retirado_por      = v_uid,
         retirado_por_nome = v_nome
   WHERE p.id = v_id;

  INSERT INTO public.sup_pedido_historico
    (pedido_id, acao, status_anterior, status_novo, observacao,
     alterado_por, alterado_por_nome, data_alteracao)
  VALUES
    (v_id, 'RETIRADA', v_ped.status, 'RETIRADO PARA ENTREGA',
     format('%s retirou para entrega o pedido %s em %s. Ficha de EPI física: %s. Crachá físico: %s.',
            v_nome, v_ped.pedido_id,
            to_char(v_agora AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI'),
            CASE WHEN p_possui_ficha_epi_fisica THEN 'Sim' ELSE 'Não' END,
            CASE WHEN p_possui_cracha_fisico THEN 'Sim' ELSE 'Não' END),
     v_uid, v_nome, v_agora);

  RETURN jsonb_build_object(
    'ja_retirado', false, 'pedido_id', v_ped.pedido_id,
    'retirado_em', v_agora, 'retirado_por_nome', v_nome);
END $fn$;

REVOKE ALL ON FUNCTION public.sup_retirada_confirmar_com_documentos(text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_retirada_confirmar_com_documentos(text, boolean, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
