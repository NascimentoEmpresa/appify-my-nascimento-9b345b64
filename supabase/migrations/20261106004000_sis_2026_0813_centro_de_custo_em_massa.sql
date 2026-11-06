-- ============================================================================
-- SIS-2026-0813 (parte 2) — Centro de custo em massa na Aplicação Financeira (aplicações e resgates)
-- ============================================================================
-- Mesma ideia do "definir banco em massa" dos resgates: o Financeiro marca vários lançamentos e define o centro de custo de uma vez.
--
--   aplicacao_financeira_definir_centro_custo(_tipo, _ids, _contrato_id)
--     _tipo        'aplicacao' (linhas da Carteira) ou 'resgate' (Movimentações)
--     _ids         os lançamentos marcados (1 a 2000)
--     _contrato_id o centro de custo; NULO = o contrato MOVIMENTAÇÃO FINANCEIRA da empresa de CADA lançamento (o correto; serve quando a seleção
--                  mistura empresas). Com um contrato informado, todos os lançamentos marcados têm que ser da empresa dele.
--     devolve quantos mudaram (quem já estava com o centro de custo, ou empresa sem MOVIMENTAÇÃO FINANCEIRA, não conta)
--
-- Exige 'financeiro-aplicacao-financeira' › 'alterar'. A mudança entra no histórico: o trigger de 20261105010000 registra nos resgates
-- (Centro de custo: A → B) e a própria função registra um evento de edição em cada aplicação.
--
-- Migration leve (1 função). Idempotente.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.aplicacao_financeira_definir_centro_custo(text, uuid[], uuid);
--   NOTIFY pgrst, 'reload schema';

CREATE OR REPLACE FUNCTION public.aplicacao_financeira_definir_centro_custo(_tipo text, _ids uuid[], _contrato_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_qtd integer := 0;
  v_empresa_contrato uuid;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-aplicacao-financeira', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar a Aplicação Financeira.';
  END IF;
  IF _tipo NOT IN ('aplicacao', 'resgate') THEN
    RAISE EXCEPTION 'Tipo inválido.';
  END IF;
  IF COALESCE(array_length(_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos um lançamento.';
  END IF;
  IF array_length(_ids, 1) > 2000 THEN
    RAISE EXCEPTION 'Selecione no máximo 2000 lançamentos por vez.';
  END IF;

  IF _contrato_id IS NOT NULL THEN
    SELECT empresa_id INTO v_empresa_contrato FROM public.contratos WHERE id = _contrato_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Centro de custo não encontrado.'; END IF;
    IF _tipo = 'aplicacao' AND EXISTS (SELECT 1 FROM public."APLICACAO_FINANCEIRA" WHERE id = ANY (_ids) AND empresa_id <> v_empresa_contrato) THEN
      RAISE EXCEPTION 'O centro de custo escolhido é de outra empresa: marque só os lançamentos da empresa dele, ou use o centro de custo padrão de cada empresa.';
    END IF;
    IF _tipo = 'resgate' AND EXISTS (SELECT 1 FROM public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" WHERE id = ANY (_ids) AND empresa_id <> v_empresa_contrato) THEN
      RAISE EXCEPTION 'O centro de custo escolhido é de outra empresa: marque só os lançamentos da empresa dele, ou use o centro de custo padrão de cada empresa.';
    END IF;
  END IF;

  -- o MOVIMENTAÇÃO FINANCEIRA de cada empresa (o ativo primeiro), mesma regra da carga de 20261106003000
  IF _tipo = 'resgate' THEN
    WITH padrao AS (
      SELECT DISTINCT ON (c.empresa_id) c.empresa_id, c.id AS contrato_id
        FROM public.contratos c
       WHERE upper(c.nome) LIKE 'MOVIMENTA%FINANCEIRA%'
       ORDER BY c.empresa_id, (c.status = 'ativo') DESC, c.created_at
    ), alvo AS (
      SELECT r.id, COALESCE(_contrato_id, p.contrato_id) AS novo
        FROM public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" r
        LEFT JOIN padrao p ON p.empresa_id = r.empresa_id
       WHERE r.id = ANY (_ids)
    )
    UPDATE public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" r
       SET contrato_id = a.novo, updated_at = now(), updated_by = auth.uid()
      FROM alvo a
     WHERE r.id = a.id AND a.novo IS NOT NULL AND r.contrato_id IS DISTINCT FROM a.novo;
    GET DIAGNOSTICS v_qtd = ROW_COUNT;
  ELSE
    WITH padrao AS (
      SELECT DISTINCT ON (c.empresa_id) c.empresa_id, c.id AS contrato_id
        FROM public.contratos c
       WHERE upper(c.nome) LIKE 'MOVIMENTA%FINANCEIRA%'
       ORDER BY c.empresa_id, (c.status = 'ativo') DESC, c.created_at
    ), alvo AS (
      SELECT a.id, a.contrato_id AS antes, COALESCE(_contrato_id, p.contrato_id) AS novo
        FROM public."APLICACAO_FINANCEIRA" a
        LEFT JOIN padrao p ON p.empresa_id = a.empresa_id
       WHERE a.id = ANY (_ids)
    ), mud AS (
      SELECT * FROM alvo WHERE novo IS NOT NULL AND novo IS DISTINCT FROM antes
    ), upd AS (
      UPDATE public."APLICACAO_FINANCEIRA" a
         SET contrato_id = m.novo, updated_by = auth.uid()
        FROM mud m
       WHERE a.id = m.id
      RETURNING a.id
    ), ev AS (
      INSERT INTO public."APLICACAO_FINANCEIRA_EVENTO" (aplicacao_id, tipo_evento, ator_user_id, descricao)
      SELECT m.id, 'edicao', auth.uid(),
             'Centro de custo: ' || COALESCE(oc.nome, 'sem centro de custo') || ' → ' || nc.nome || ' (em massa).'
        FROM mud m
        JOIN upd u ON u.id = m.id
        JOIN public.contratos nc ON nc.id = m.novo
        LEFT JOIN public.contratos oc ON oc.id = m.antes
      RETURNING 1
    )
    SELECT count(*) INTO v_qtd FROM ev;
  END IF;

  RETURN v_qtd;
END;
$$;

REVOKE ALL ON FUNCTION public.aplicacao_financeira_definir_centro_custo(text, uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aplicacao_financeira_definir_centro_custo(text, uuid[], uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
