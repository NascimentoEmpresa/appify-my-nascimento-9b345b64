-- SIS-2026-0821: fichas digitais do pedido para a tela de Pedidos de Materiais.
-- Retorna somente o necessario para consulta e impressao; IP, dispositivo e CPF
-- da confirmacao nao sao expostos por esta RPC.
CREATE OR REPLACE FUNCTION public.sup_epi_fichas_do_pedido(p_pedido uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE v_fichas jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_access(auth.uid(), 'sup_pedidos_materiais', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissao para consultar fichas de EPI do pedido' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.registrado_em DESC, f.id), '[]'::jsonb)
    INTO v_fichas
    FROM (
      SELECT e.id, e.pedido_id, e.protocolo, e.colaborador_nome, e.matricula,
             e.empresa_nome, e.contrato_nome, e.posto_nome, e.funcao_nome,
             e.entregador_nome, e.itens, e.registrado_em, e.confirmado_em,
             e.confirmacao_hash, e.declaracao_versao
        FROM public."EPI_ENTREGA" e
       WHERE e.pedido_id = p_pedido AND e.modo = 'eletronico'
    ) f;
  RETURN v_fichas;
END $fn$;
REVOKE ALL ON FUNCTION public.sup_epi_fichas_do_pedido(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_epi_fichas_do_pedido(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK: DROP FUNCTION IF EXISTS public.sup_epi_fichas_do_pedido(uuid);
