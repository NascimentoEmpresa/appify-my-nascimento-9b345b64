-- Achado real (Cálita, "Incluir Aplicação Financeira"): salvar sempre dava
-- 'Classificação "Aplicação Financeira" não encontrada — contate o suporte.'
--
-- A classificação existe (a migration 20260930000227 já a semeia, INSERT
-- confirmado em produção) — o bug é que a RPC procurava por
-- nome_key = 'aplicacao financeira' (sem acento), enquanto nome_key é
-- gerado como lower(btrim(nome)) — `lower()` não remove acento, então o
-- valor real é 'aplicação financeira' (com ç e ã). A busca nunca batia,
-- pra ninguém, em nenhuma empresa — não era ambiente, era o literal errado
-- na própria migration.

CREATE OR REPLACE FUNCTION public.aplicacao_financeira_criar(
  _data_aplicacao date, _competencia date, _empresa_id uuid, _banco_id uuid,
  _produto text, _tipo_aplicacao text, _forma_pagamento text,
  _descricao text, _valor_aplicado numeric,
  _indexador text DEFAULT NULL, _taxa text DEFAULT NULL,
  _data_vencimento date DEFAULT NULL, _liquidez text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
  v_classificacao_id uuid;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-aplicacao-financeira', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para incluir Aplicação Financeira.';
  END IF;

  SELECT id INTO v_classificacao_id
  FROM public.planejamento_orcamentario_classificacao
  WHERE nome_key = 'aplicação financeira';

  IF v_classificacao_id IS NULL THEN
    RAISE EXCEPTION 'Classificação "Aplicação Financeira" não encontrada — contate o suporte.';
  END IF;

  INSERT INTO public."APLICACAO_FINANCEIRA" (
    data_aplicacao, competencia, empresa_id, banco_id, produto, tipo_aplicacao,
    classificacao_id, forma_pagamento, descricao, valor_aplicado,
    indexador, taxa, data_vencimento, liquidez, created_by
  ) VALUES (
    _data_aplicacao, _competencia, _empresa_id, _banco_id, _produto, _tipo_aplicacao,
    v_classificacao_id, _forma_pagamento, _descricao, _valor_aplicado,
    _indexador, _taxa, _data_vencimento, _liquidez, auth.uid()
  ) RETURNING id INTO v_id;

  INSERT INTO public."APLICACAO_FINANCEIRA_EVENTO" (aplicacao_id, tipo_evento, ator_user_id, descricao)
  VALUES (v_id, 'criacao', auth.uid(), 'Aplicação financeira registrada.');

  RETURN v_id;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- (a função volta pro CREATE OR REPLACE de 20260930000227, com
-- nome_key = 'aplicacao financeira' sem acento — reintroduz o bug)
-- NOTIFY pgrst, 'reload schema';
