-- ============================================================================
-- [SEM-CHAMADO] Aplicações Financeiras — definir o BANCO de vários resgates de uma vez
-- ============================================================================
-- O resgate (APLICACAO_FINANCEIRA_RESGATE_CAIXA) ganhou banco_id na SIS-2026-0778, mas os resgates antigos ficaram sem banco e só dava para informar
-- um a um, editando. Esta RPC grava o banco em vários resgates numa chamada só (tela Aplicações Financeiras › Movimentações › selecionar › Definir banco).
--
-- Mesma permissão da edição individual (Aplicações Financeiras › alterar). Só mexe em banco_id (e no updated_at/updated_by): data, valores e
-- empresa do resgate não mudam. A view do Fluxo (v_aplicacao_financeira_resgate_fluxo_caixa) lê banco_id direto do resgate, então o Fluxo e a
-- Conciliação Bancária passam a enxergar o banco na hora. Devolve quantos resgates foram alterados (os que já estavam no banco pedido não contam).
--
-- Idempotente (CREATE FUNCTION precedido de DROP IF EXISTS); sem ALTER TABLE, nada de lock longo.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.aplicacao_financeira_resgate_definir_banco(uuid[], uuid);
SET lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.aplicacao_financeira_resgate_definir_banco(uuid[], uuid);

CREATE FUNCTION public.aplicacao_financeira_resgate_definir_banco(_ids uuid[], _banco_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_qtd integer;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-aplicacao-financeira', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar resgates.';
  END IF;
  IF _banco_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.malote_cartao_banco WHERE id = _banco_id) THEN
    RAISE EXCEPTION 'Banco inválido.';
  END IF;
  IF COALESCE(array_length(_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos um resgate.';
  END IF;
  IF array_length(_ids, 1) > 2000 THEN
    RAISE EXCEPTION 'Selecione no máximo 2000 resgates por vez.';
  END IF;

  UPDATE public."APLICACAO_FINANCEIRA_RESGATE_CAIXA"
     SET banco_id = _banco_id, updated_at = now(), updated_by = auth.uid()
   WHERE id = ANY(_ids) AND banco_id IS DISTINCT FROM _banco_id;
  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  RETURN v_qtd;
END;
$$;

REVOKE ALL ON FUNCTION public.aplicacao_financeira_resgate_definir_banco(uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aplicacao_financeira_resgate_definir_banco(uuid[], uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
