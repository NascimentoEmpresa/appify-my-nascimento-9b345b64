-- SIS-2026-0621: nova solicitação de ajuste no mesmo contrato + competência vira a próxima
-- iteração (2ª, 3ª...) INDEPENDENTE do status da anterior.
--
-- Antes (espelho do legado): só dava para criar uma nova se a anterior estivesse "Enviada"
-- (aí a anterior era arquivada); com a anterior em andamento, a função barrava com
-- "conclua-a antes de criar outra" — e a equipe recebe mais de um pedido do mesmo contrato no
-- mesmo mês, às vezes com o primeiro ainda sendo tratado.
--
-- Agora:
--   - iteração = maior iteração já usada no par contrato+competência (arquivadas incluídas) + 1;
--   - a solicitação "de referência" é a ativa (não arquivada) de maior iteração: dela vêm
--     sol_anterior_id e os itens importáveis;
--   - a de referência só é ARQUIVADA se estava "Enviada" (como hoje); se estava em andamento,
--     continua ativa ao lado da nova — nada some da fila de quem está tratando.
-- Mesma assinatura da função (CREATE OR REPLACE mantém as permissões).
--
-- Migrations não se auto-aplicam: rodar no SQL Editor.

CREATE OR REPLACE FUNCTION public.solicitacao_ajuste_criar(
  _contrato_id uuid,
  _competencia date,
  _quem_recebeu text,
  _prazo_resposta date,
  _doc_pedido_path text,
  _doc_pedido_nome text,
  _itens jsonb,
  _itens_importar_ids uuid[] DEFAULT NULL,
  _data_recebimento date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ref record;
  v_nova_id uuid;
  v_iteracao smallint;
  v_anterior_id uuid := NULL;
  v_item jsonb;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-solicitacoes-ajuste', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para criar solicitação de ajuste.';
  END IF;

  -- Evita duas criações simultâneas do mesmo par pegarem a mesma iteração.
  PERFORM pg_advisory_xact_lock(hashtext(_contrato_id::text || _competencia::text));

  SELECT COALESCE(max(iteracao), 0) + 1 INTO v_iteracao
    FROM public."SOLICITACAO_AJUSTE"
   WHERE contrato_id = _contrato_id AND competencia = _competencia;

  SELECT id, status INTO v_ref
    FROM public."SOLICITACAO_AJUSTE"
   WHERE contrato_id = _contrato_id AND competencia = _competencia AND status <> 'arquivada'
   ORDER BY iteracao DESC
   LIMIT 1;

  IF v_ref.id IS NOT NULL THEN
    v_anterior_id := v_ref.id;
    IF v_ref.status = 'enviado' THEN
      UPDATE public."SOLICITACAO_AJUSTE" SET status = 'arquivada' WHERE id = v_ref.id;
    END IF;
  END IF;

  INSERT INTO public."SOLICITACAO_AJUSTE" (
    contrato_id, competencia, iteracao, sol_anterior_id, quem_recebeu,
    data_recebimento, prazo_resposta, doc_pedido_path, doc_pedido_nome, created_by
  ) VALUES (
    _contrato_id, _competencia, v_iteracao, v_anterior_id, _quem_recebeu,
    COALESCE(_data_recebimento, current_date), _prazo_resposta, _doc_pedido_path, _doc_pedido_nome, auth.uid()
  ) RETURNING id INTO v_nova_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb))
  LOOP
    INSERT INTO public."SOLICITACAO_AJUSTE_ITEM" (solicitacao_id, descricao)
    VALUES (v_nova_id, v_item->>'descricao');
  END LOOP;

  IF v_anterior_id IS NOT NULL AND _itens_importar_ids IS NOT NULL THEN
    INSERT INTO public."SOLICITACAO_AJUSTE_ITEM" (solicitacao_id, descricao)
    SELECT v_nova_id, descricao
      FROM public."SOLICITACAO_AJUSTE_ITEM"
     WHERE id = ANY(_itens_importar_ids) AND solicitacao_id = v_anterior_id;
  END IF;

  RETURN v_nova_id;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK: recriar a função com a definição de 20260930000090_solicitacoes_ajuste.sql (seção 4).
