-- SIS-2026-0305 (achado do usuário testando, com print do sistema antigo):
-- simplifiquei demais achando que sol_itens.setor era sempre 'RH' — a
-- amostra de dado histórico que eu tinha só continha RH, mas a tela do
-- legado tem 8 abas de setor fixas nos filtros (Operacional, Jurídico,
-- Financeiro, Segurança, RH, Controladoria, Compras, Recrutamento & Sel.)
-- e o print mostrou itens reais com "RH" E "Financeiro" na mesma
-- solicitação. Corrige adicionando o campo de volta.
ALTER TABLE public."SOLICITACAO_AJUSTE_ITEM"
  ADD COLUMN IF NOT EXISTS setor text NOT NULL DEFAULT 'RH'
    CHECK (setor IN ('Operacional', 'Jurídico', 'Financeiro', 'Segurança', 'RH', 'Controladoria', 'Compras', 'Recrutamento e Seleção'));

-- RPC de criação passa a aceitar "setor" por item (default 'RH' se o
-- front antigo mandar sem, por segurança) e propagar o setor na
-- importação de itens da rodada anterior (reabertura).
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
  v_sol_ativa record;
  v_nova_id uuid;
  v_iteracao smallint := 1;
  v_anterior_id uuid := NULL;
  v_item jsonb;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-solicitacoes-ajuste', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para criar solicitação de ajuste.';
  END IF;

  SELECT id, status, iteracao INTO v_sol_ativa
    FROM public."SOLICITACAO_AJUSTE"
   WHERE contrato_id = _contrato_id AND competencia = _competencia AND status <> 'arquivada'
   LIMIT 1;

  IF v_sol_ativa.id IS NOT NULL THEN
    IF v_sol_ativa.status <> 'enviado' THEN
      RAISE EXCEPTION 'Já existe uma solicitação em conferência para este contrato e competência — conclua-a antes de criar outra.';
    END IF;
    UPDATE public."SOLICITACAO_AJUSTE" SET status = 'arquivada' WHERE id = v_sol_ativa.id;
    v_anterior_id := v_sol_ativa.id;
    v_iteracao := v_sol_ativa.iteracao + 1;
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
    INSERT INTO public."SOLICITACAO_AJUSTE_ITEM" (solicitacao_id, descricao, setor)
    VALUES (v_nova_id, v_item->>'descricao', COALESCE(v_item->>'setor', 'RH'));
  END LOOP;

  IF v_anterior_id IS NOT NULL AND _itens_importar_ids IS NOT NULL THEN
    INSERT INTO public."SOLICITACAO_AJUSTE_ITEM" (solicitacao_id, descricao, setor)
    SELECT v_nova_id, descricao, setor
      FROM public."SOLICITACAO_AJUSTE_ITEM"
     WHERE id = ANY(_itens_importar_ids) AND solicitacao_id = v_anterior_id;
  END IF;

  RETURN v_nova_id;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   (RPC volta pra versão da 20260930000090, sem setor)
--   ALTER TABLE public."SOLICITACAO_AJUSTE_ITEM" DROP COLUMN IF EXISTS setor;
-- =====================================================================
