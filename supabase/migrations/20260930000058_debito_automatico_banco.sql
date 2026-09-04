-- SIS-2026-0256 (achado revisando com o usuário depois de implementar): o
-- Fluxo de Caixa ganhou coluna "Banco" no SIS-2026-0307, mas só o Malote
-- alimentava banco_id — Débito Automático ficava sempre "—" ali. Adiciona
-- banco_id (catálogo malote_cartao_banco, mesmo do Cartão de Crédito/
-- Malote) nos 3 tipos de lançamento, OBRIGATÓRIO (decisão do usuário —
-- diferente do banco do Malote, que é opcional).
--
-- Movimentação Financeira: cada linha (saída/entrada) tem seu PRÓPRIO
-- banco — a RPC recebe _banco_saida_id/_banco_entrada_id.
--
-- Tabela já tem 4 lançamentos de TESTE do usuário (DA-2026-0001 a 0003,
-- valor R$1, "teste ..." na descrição, criados testando a tela recém-
-- implementada) — adiciona a coluna nullable, faz backfill desses 4 com um
-- banco placeholder (primeiro do catálogo, por ordem alfabética) e só então
-- trava NOT NULL. Decisão do usuário: manter os registros de teste, não
-- excluir.
ALTER TABLE public."DEBITO_AUTOMATICO"
  ADD COLUMN banco_id uuid REFERENCES public.malote_cartao_banco(id);

UPDATE public."DEBITO_AUTOMATICO" SET banco_id = (
  SELECT id FROM public.malote_cartao_banco ORDER BY nome LIMIT 1
) WHERE banco_id IS NULL;

ALTER TABLE public."DEBITO_AUTOMATICO" ALTER COLUMN banco_id SET NOT NULL;

-- ── RLS extra em malote_cartao_banco pra quem só tem acesso ao Débito
-- Automático (sem ser aprovador de Malote nem ter financeiro-cartao-
-- credito) conseguir ver o catálogo no Select do modal ────────────────────
DROP POLICY IF EXISTS malote_cartao_banco_select_debito_automatico ON public.malote_cartao_banco;
CREATE POLICY malote_cartao_banco_select_debito_automatico ON public.malote_cartao_banco
  FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'visualizar'));

-- ── RPCs: DROP das assinaturas antigas (CREATE OR REPLACE com lista de
-- parâmetros diferente cria um overload novo em vez de substituir) ────────
DROP FUNCTION IF EXISTS public.debito_automatico_criar_debito(date, date, text, uuid, uuid, uuid, text, text, numeric);
DROP FUNCTION IF EXISTS public.debito_automatico_criar_movimentacao(date, date, uuid, uuid, uuid, text, numeric, text);
DROP FUNCTION IF EXISTS public.debito_automatico_criar_nota(date, date, uuid, uuid, text, text, numeric, text);

CREATE FUNCTION public.debito_automatico_criar_debito(
  _data_pagamento date, _competencia date, _tipo text,
  _empresa_id uuid, _contrato_id uuid, _classificacao_id uuid,
  _descricao text, _forma_pagamento text, _valor numeric, _banco_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para incluir Débito Automático.';
  END IF;
  IF _banco_id IS NULL THEN
    RAISE EXCEPTION 'Informe o banco.';
  END IF;

  INSERT INTO public."DEBITO_AUTOMATICO" (
    tipo_origem, tipo, data_pagamento, competencia, empresa_id, contrato_id,
    classificacao_id, descricao, forma_pagamento, valor, banco_id, created_by
  ) VALUES (
    'debito_automatico', _tipo, _data_pagamento, _competencia, _empresa_id, _contrato_id,
    _classificacao_id, _descricao, _forma_pagamento, _valor, _banco_id, auth.uid()
  ) RETURNING id INTO v_id;

  INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
  VALUES (v_id, 'criacao', auth.uid(), 'Débito Automático criado.');

  RETURN v_id;
END;
$$;

CREATE FUNCTION public.debito_automatico_criar_movimentacao(
  _data_pagamento date, _competencia date,
  _empresa_saida_id uuid, _empresa_entrada_id uuid,
  _classificacao_id uuid, _descricao text, _valor numeric, _status text,
  _banco_saida_id uuid, _banco_entrada_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_numero text;
  v_id_saida uuid;
  v_id_entrada uuid;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para incluir Movimentação Financeira.';
  END IF;
  IF _status NOT IN ('pendente', 'pago') THEN
    RAISE EXCEPTION 'Status inválido: %', _status;
  END IF;
  IF _banco_saida_id IS NULL THEN
    RAISE EXCEPTION 'Informe o banco de saída.';
  END IF;
  IF _banco_entrada_id IS NULL THEN
    RAISE EXCEPTION 'Informe o banco de entrada.';
  END IF;

  v_numero := 'DA-' || to_char(now(), 'YYYY') || '-' ||
    lpad(nextval('public.debito_automatico_numero_seq')::text, 4, '0');

  INSERT INTO public."DEBITO_AUTOMATICO" (
    numero, tipo_origem, tipo, data_pagamento, competencia, empresa_id,
    classificacao_id, descricao, forma_pagamento, valor, status, banco_id, created_by
  ) VALUES (
    v_numero, 'movimentacao_financeira', 'saida', _data_pagamento, _competencia, _empresa_saida_id,
    _classificacao_id, _descricao, 'Transferência Bancária', _valor, _status, _banco_saida_id, auth.uid()
  ) RETURNING id INTO v_id_saida;

  INSERT INTO public."DEBITO_AUTOMATICO" (
    numero, tipo_origem, tipo, data_pagamento, competencia, empresa_id,
    classificacao_id, descricao, forma_pagamento, valor, status, banco_id,
    movimentacao_par_id, created_by
  ) VALUES (
    v_numero, 'movimentacao_financeira', 'entrada', _data_pagamento, _competencia, _empresa_entrada_id,
    _classificacao_id, _descricao, 'Transferência Bancária', _valor, _status, _banco_entrada_id,
    v_id_saida, auth.uid()
  ) RETURNING id INTO v_id_entrada;

  UPDATE public."DEBITO_AUTOMATICO" SET movimentacao_par_id = v_id_entrada WHERE id = v_id_saida;

  INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
  VALUES
    (v_id_saida, 'criacao', auth.uid(), 'Movimentação Financeira criada (linha de saída).'),
    (v_id_entrada, 'criacao', auth.uid(), 'Movimentação Financeira criada (linha de entrada).');

  RETURN v_id_saida;
END;
$$;

CREATE FUNCTION public.debito_automatico_criar_nota(
  _data_pagamento date, _competencia date, _empresa_id uuid, _contrato_id uuid,
  _descricao text, _forma_pagamento text, _valor numeric, _status text, _banco_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
  v_classificacao_id uuid;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para incluir Nota Recebida.';
  END IF;
  IF _status NOT IN ('pendente', 'pago') THEN
    RAISE EXCEPTION 'Status inválido: %', _status;
  END IF;
  IF _banco_id IS NULL THEN
    RAISE EXCEPTION 'Informe o banco.';
  END IF;

  SELECT id INTO v_classificacao_id
  FROM public.planejamento_orcamentario_classificacao
  WHERE nome_key = 'recebimento de nota';

  IF v_classificacao_id IS NULL THEN
    RAISE EXCEPTION 'Classificação "Recebimento de Nota" não encontrada — contate o suporte.';
  END IF;

  INSERT INTO public."DEBITO_AUTOMATICO" (
    tipo_origem, tipo, data_pagamento, competencia, empresa_id, contrato_id,
    classificacao_id, descricao, forma_pagamento, valor, status, banco_id, created_by
  ) VALUES (
    'nota_recebida', 'entrada', _data_pagamento, _competencia, _empresa_id, _contrato_id,
    v_classificacao_id, _descricao, _forma_pagamento, _valor, _status, _banco_id, auth.uid()
  ) RETURNING id INTO v_id;

  INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
  VALUES (v_id, 'criacao', auth.uid(), 'Nota Recebida criada.');

  RETURN v_id;
END;
$$;

-- debito_automatico_editar: assinatura não muda (_id, _campos jsonb) — só o
-- corpo ganha banco_id no UPDATE (COALESCE, mesmo padrão dos outros campos).
CREATE OR REPLACE FUNCTION public.debito_automatico_editar(_id uuid, _campos jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_antes public."DEBITO_AUTOMATICO"%ROWTYPE;
  v_diff text := '';
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para editar Débito Automático.';
  END IF;

  SELECT * INTO v_antes FROM public."DEBITO_AUTOMATICO" WHERE id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro não encontrado: %', _id;
  END IF;

  UPDATE public."DEBITO_AUTOMATICO" SET
    data_pagamento    = COALESCE((_campos->>'data_pagamento')::date, data_pagamento),
    competencia       = COALESCE((_campos->>'competencia')::date, competencia),
    empresa_id        = COALESCE((_campos->>'empresa_id')::uuid, empresa_id),
    contrato_id       = CASE WHEN _campos ? 'contrato_id' THEN (_campos->>'contrato_id')::uuid ELSE contrato_id END,
    classificacao_id  = COALESCE((_campos->>'classificacao_id')::uuid, classificacao_id),
    descricao         = COALESCE(_campos->>'descricao', descricao),
    forma_pagamento   = COALESCE(_campos->>'forma_pagamento', forma_pagamento),
    valor             = COALESCE((_campos->>'valor')::numeric, valor),
    status            = COALESCE(_campos->>'status', status),
    banco_id          = COALESCE((_campos->>'banco_id')::uuid, banco_id),
    updated_by        = auth.uid()
  WHERE id = _id;

  IF _campos ? 'valor' AND (_campos->>'valor')::numeric IS DISTINCT FROM v_antes.valor THEN
    v_diff := v_diff || format('Valor: R$ %s → R$ %s. ', v_antes.valor, _campos->>'valor');
  END IF;
  IF _campos ? 'status' AND (_campos->>'status') IS DISTINCT FROM v_antes.status THEN
    v_diff := v_diff || format('Status: %s → %s. ', v_antes.status, _campos->>'status');
  END IF;
  IF _campos ? 'data_pagamento' AND (_campos->>'data_pagamento')::date IS DISTINCT FROM v_antes.data_pagamento THEN
    v_diff := v_diff || format('Data de pagamento: %s → %s. ', v_antes.data_pagamento, _campos->>'data_pagamento');
  END IF;
  IF _campos ? 'descricao' AND (_campos->>'descricao') IS DISTINCT FROM v_antes.descricao THEN
    v_diff := v_diff || format('Descrição: "%s" → "%s". ', v_antes.descricao, _campos->>'descricao');
  END IF;
  IF _campos ? 'banco_id' AND (_campos->>'banco_id')::uuid IS DISTINCT FROM v_antes.banco_id THEN
    v_diff := v_diff || 'Banco alterado. ';
  END IF;

  INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
  VALUES (_id, 'edicao', auth.uid(), NULLIF(btrim(v_diff), ''));

  IF _campos ? 'status' AND (_campos->>'status') = 'pago' AND v_antes.status IS DISTINCT FROM 'pago' THEN
    INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
    VALUES (_id, 'pagamento', auth.uid(), 'Marcado como pago — enviado para o Fluxo de Caixa.');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.debito_automatico_criar_debito FROM PUBLIC;
REVOKE ALL ON FUNCTION public.debito_automatico_criar_movimentacao FROM PUBLIC;
REVOKE ALL ON FUNCTION public.debito_automatico_criar_nota FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.debito_automatico_criar_debito TO authenticated;
GRANT EXECUTE ON FUNCTION public.debito_automatico_criar_movimentacao TO authenticated;
GRANT EXECUTE ON FUNCTION public.debito_automatico_criar_nota TO authenticated;

-- ── Views: banco_id/banco_nome/banco_logo_path passam a resolver de
-- verdade (antes eram NULL fixo em v_debito_automatico_fluxo_caixa, e nem
-- existiam em v_debito_automatico_lista). Mesma posição de colunas em
-- v_debito_automatico_fluxo_caixa (CREATE OR REPLACE aceita, já que o
-- tipo/ordem de saída não muda); v_debito_automatico_lista ganha as 3
-- colunas novas no FINAL da lista (CREATE OR REPLACE VIEW só aceita
-- acrescentar coluna no fim, não no meio).
CREATE OR REPLACE VIEW public.v_debito_automatico_fluxo_caixa AS
SELECT
  d.id AS despesa_id,
  d.numero AS id_malote,
  d.data_pagamento,
  d.competencia,
  d.empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  d.contrato_id,
  c.nome AS contrato_nome,
  d.classificacao_id,
  cl.nome AS classificacao_nome,
  d.descricao,
  d.forma_pagamento,
  d.banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  NULL::int AS numero_parcela,
  NULL::int AS numero_parcelas,
  d.valor,
  d.tipo
FROM public."DEBITO_AUTOMATICO" d
LEFT JOIN public.empresas e ON e.id = d.empresa_id
LEFT JOIN public.contratos c ON c.id = d.contrato_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = d.classificacao_id
LEFT JOIN public.malote_cartao_banco cb ON cb.id = d.banco_id
WHERE d.status = 'pago';

CREATE OR REPLACE VIEW public.v_debito_automatico_lista AS
SELECT
  d.id,
  d.numero,
  d.tipo_origem,
  d.tipo,
  d.data_pagamento,
  d.competencia,
  d.empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  d.contrato_id,
  c.nome AS contrato_nome,
  d.classificacao_id,
  cl.nome AS classificacao_nome,
  d.descricao,
  d.forma_pagamento,
  d.valor,
  d.status,
  d.movimentacao_par_id,
  d.created_by,
  d.created_at,
  d.updated_by,
  d.updated_at,
  d.banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path
FROM public."DEBITO_AUTOMATICO" d
LEFT JOIN public.empresas e ON e.id = d.empresa_id
LEFT JOIN public.contratos c ON c.id = d.contrato_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = d.classificacao_id
LEFT JOIN public.malote_cartao_banco cb ON cb.id = d.banco_id;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   -- recriar as 2 views sem banco_id/banco_nome/banco_logo_path
--   -- resolvidos (ver corpo de 20260930000056/57);
--   DROP FUNCTION IF EXISTS public.debito_automatico_criar_nota(date, date, uuid, uuid, text, text, numeric, text, uuid);
--   DROP FUNCTION IF EXISTS public.debito_automatico_criar_movimentacao(date, date, uuid, uuid, uuid, text, numeric, text, uuid, uuid);
--   DROP FUNCTION IF EXISTS public.debito_automatico_criar_debito(date, date, text, uuid, uuid, uuid, text, text, numeric, uuid);
--   -- (recriar as 3 funções com o corpo de 20260930000056, sem banco);
--   DROP POLICY IF EXISTS malote_cartao_banco_select_debito_automatico ON public.malote_cartao_banco;
--   ALTER TABLE public."DEBITO_AUTOMATICO" DROP COLUMN IF EXISTS banco_id;
--   -- (o backfill nos 4 registros de teste não precisa reversão — a coluna
--   -- some junto)
-- =====================================================================
