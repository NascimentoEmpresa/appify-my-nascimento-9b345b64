-- SIS-2026-0256 (Iury): novo submódulo "Débito Automático", abaixo de
-- Fluxo de Caixa (/app/financeiro/gestao-financeira/fluxo-caixa) — pra
-- lançar no Fluxo de Caixa itens que NÃO passam pelo Malote. 3 tipos de
-- lançamento numa listagem única:
--   1. Débito Automático  — entrada/saída avulsa (aluguel, energia, etc).
--   2. Movimentação Financeira — transferência entre empresas do grupo:
--      gera 2 linhas com o MESMO número visível (1 saída + 1 entrada),
--      ligadas por movimentacao_par_id, forma de pagamento sempre
--      "Transferência Bancária".
--   3. Nota Recebida — sempre Entrada, classificação sempre fixa
--      "Recebimento de Nota".
--
-- Recorrência (decisão do Iury): lançamento manual mês a mês, sem motor de
-- geração automática — "recorrente" é só a natureza da despesa.
--
-- Edição pós-pagamento (decisão do Iury, diferente do que os mockups
-- descrevem): item "pago" continua editável, mas toda edição fica
-- rastreada em "DEBITO_AUTOMATICO_EVENTO" (mesmo padrão de
-- malote_despesa_evento/registrarEventoDespesa do Malote).
--
-- ── 1. Tabela de domínio ────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.debito_automatico_numero_seq;

CREATE TABLE public."DEBITO_AUTOMATICO" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero text NOT NULL,
  tipo_origem text NOT NULL CHECK (tipo_origem IN (
    'debito_automatico', 'movimentacao_financeira', 'nota_recebida'
  )),
  tipo text NOT NULL CHECK (tipo IN ('entrada', 'saida')),
  data_pagamento date NOT NULL,
  competencia date NOT NULL,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  contrato_id uuid REFERENCES public.contratos(id),
  classificacao_id uuid NOT NULL REFERENCES public.planejamento_orcamentario_classificacao(id),
  descricao text NOT NULL,
  forma_pagamento text NOT NULL,
  valor numeric NOT NULL CHECK (valor > 0),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pago')),
  -- Movimentação Financeira: liga as 2 linhas (saída/entrada) da mesma
  -- transferência — mesmo "numero" visível, id interno diferente.
  movimentacao_par_id uuid REFERENCES public."DEBITO_AUTOMATICO"(id),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_debito_automatico_status ON public."DEBITO_AUTOMATICO"(status);
CREATE INDEX idx_debito_automatico_competencia ON public."DEBITO_AUTOMATICO"(competencia);
CREATE INDEX idx_debito_automatico_empresa ON public."DEBITO_AUTOMATICO"(empresa_id);
CREATE INDEX idx_debito_automatico_par ON public."DEBITO_AUTOMATICO"(movimentacao_par_id);

CREATE TRIGGER debito_automatico_set_updated BEFORE UPDATE ON public."DEBITO_AUTOMATICO"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Numeração automática (mesmo padrão de malote_despesa_gerar_numero,
-- 20260831000001) — DA-AAAA-NNNN. Movimentação Financeira gera o número
-- explicitamente na RPC (item 4) e passa pros 2 INSERTs, então o trigger
-- só entra `IF NEW.numero IS NULL`.
CREATE OR REPLACE FUNCTION public.debito_automatico_gerar_numero()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.numero IS NULL THEN
    NEW.numero := 'DA-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('public.debito_automatico_numero_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS debito_automatico_set_numero ON public."DEBITO_AUTOMATICO";
CREATE TRIGGER debito_automatico_set_numero BEFORE INSERT ON public."DEBITO_AUTOMATICO"
  FOR EACH ROW EXECUTE FUNCTION public.debito_automatico_gerar_numero();

-- ── 2. Histórico/eventos ────────────────────────────────────────────────
CREATE TABLE public."DEBITO_AUTOMATICO_EVENTO" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debito_id uuid NOT NULL REFERENCES public."DEBITO_AUTOMATICO"(id) ON DELETE CASCADE,
  tipo_evento text NOT NULL CHECK (tipo_evento IN ('criacao', 'edicao', 'pagamento', 'exclusao')),
  ator_user_id uuid REFERENCES auth.users(id),
  descricao text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_debito_automatico_evento ON public."DEBITO_AUTOMATICO_EVENTO"(debito_id, created_at);

-- ── 3. RLS ───────────────────────────────────────────────────────────────
-- Defesa em profundidade: o caminho oficial é sempre via RPC (abaixo,
-- SECURITY DEFINER), mas a tabela não fica aberta por trás. Sem recorte
-- por dono/empresa — é uma tela do Financeiro, gateada só por menu/ação,
-- igual ao restante do módulo (Fluxo de Caixa, Cartão de Crédito).
ALTER TABLE public."DEBITO_AUTOMATICO" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DEBITO_AUTOMATICO_EVENTO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS debito_automatico_select ON public."DEBITO_AUTOMATICO";
CREATE POLICY debito_automatico_select ON public."DEBITO_AUTOMATICO"
  FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'visualizar'));

DROP POLICY IF EXISTS debito_automatico_insert ON public."DEBITO_AUTOMATICO";
CREATE POLICY debito_automatico_insert ON public."DEBITO_AUTOMATICO"
  FOR INSERT TO authenticated
  WITH CHECK (public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'incluir'));

DROP POLICY IF EXISTS debito_automatico_update ON public."DEBITO_AUTOMATICO";
CREATE POLICY debito_automatico_update ON public."DEBITO_AUTOMATICO"
  FOR UPDATE TO authenticated
  USING (public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'alterar'))
  WITH CHECK (public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'alterar'));

DROP POLICY IF EXISTS debito_automatico_delete ON public."DEBITO_AUTOMATICO";
CREATE POLICY debito_automatico_delete ON public."DEBITO_AUTOMATICO"
  FOR DELETE TO authenticated
  USING (public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'excluir'));

DROP POLICY IF EXISTS debito_automatico_evento_select ON public."DEBITO_AUTOMATICO_EVENTO";
CREATE POLICY debito_automatico_evento_select ON public."DEBITO_AUTOMATICO_EVENTO"
  FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'visualizar'));

-- Sem policy de INSERT/UPDATE/DELETE direta em EVENTO — só as RPCs abaixo
-- (SECURITY DEFINER) escrevem histórico.

-- ── 4. RPCs ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.debito_automatico_criar_debito(
  _data_pagamento date, _competencia date, _tipo text,
  _empresa_id uuid, _contrato_id uuid, _classificacao_id uuid,
  _descricao text, _forma_pagamento text, _valor numeric
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para incluir Débito Automático.';
  END IF;

  INSERT INTO public."DEBITO_AUTOMATICO" (
    tipo_origem, tipo, data_pagamento, competencia, empresa_id, contrato_id,
    classificacao_id, descricao, forma_pagamento, valor, created_by
  ) VALUES (
    'debito_automatico', _tipo, _data_pagamento, _competencia, _empresa_id, _contrato_id,
    _classificacao_id, _descricao, _forma_pagamento, _valor, auth.uid()
  ) RETURNING id INTO v_id;

  INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
  VALUES (v_id, 'criacao', auth.uid(), 'Débito Automático criado.');

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.debito_automatico_criar_movimentacao(
  _data_pagamento date, _competencia date,
  _empresa_saida_id uuid, _empresa_entrada_id uuid,
  _classificacao_id uuid, _descricao text, _valor numeric,
  _status text DEFAULT 'pendente'
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

  v_numero := 'DA-' || to_char(now(), 'YYYY') || '-' ||
    lpad(nextval('public.debito_automatico_numero_seq')::text, 4, '0');

  INSERT INTO public."DEBITO_AUTOMATICO" (
    numero, tipo_origem, tipo, data_pagamento, competencia, empresa_id,
    classificacao_id, descricao, forma_pagamento, valor, status, created_by
  ) VALUES (
    v_numero, 'movimentacao_financeira', 'saida', _data_pagamento, _competencia, _empresa_saida_id,
    _classificacao_id, _descricao, 'Transferência Bancária', _valor, _status, auth.uid()
  ) RETURNING id INTO v_id_saida;

  INSERT INTO public."DEBITO_AUTOMATICO" (
    numero, tipo_origem, tipo, data_pagamento, competencia, empresa_id,
    classificacao_id, descricao, forma_pagamento, valor, status,
    movimentacao_par_id, created_by
  ) VALUES (
    v_numero, 'movimentacao_financeira', 'entrada', _data_pagamento, _competencia, _empresa_entrada_id,
    _classificacao_id, _descricao, 'Transferência Bancária', _valor, _status,
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

CREATE OR REPLACE FUNCTION public.debito_automatico_criar_nota(
  _data_pagamento date, _competencia date, _empresa_id uuid, _contrato_id uuid,
  _descricao text, _forma_pagamento text, _valor numeric, _status text DEFAULT 'pendente'
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

  SELECT id INTO v_classificacao_id
  FROM public.planejamento_orcamentario_classificacao
  WHERE nome_key = 'recebimento de nota';

  IF v_classificacao_id IS NULL THEN
    RAISE EXCEPTION 'Classificação "Recebimento de Nota" não encontrada — contate o suporte.';
  END IF;

  INSERT INTO public."DEBITO_AUTOMATICO" (
    tipo_origem, tipo, data_pagamento, competencia, empresa_id, contrato_id,
    classificacao_id, descricao, forma_pagamento, valor, status, created_by
  ) VALUES (
    'nota_recebida', 'entrada', _data_pagamento, _competencia, _empresa_id, _contrato_id,
    v_classificacao_id, _descricao, _forma_pagamento, _valor, _status, auth.uid()
  ) RETURNING id INTO v_id;

  INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
  VALUES (v_id, 'criacao', auth.uid(), 'Nota Recebida criada.');

  RETURN v_id;
END;
$$;

-- _campos: objeto jsonb só com os campos que mudaram, ex.
-- '{"valor": 150.00, "status": "pago"}'. Cada chave reconhecida vira um
-- UPDATE de coluna real; grava 1 evento 'edicao' com o diff em texto (e um
-- 'pagamento' extra se o status virar 'pago' nessa chamada). Pago continua
-- editável (decisão do Iury) — só a EXCLUSÃO de item pago é bloqueada
-- (função seguinte).
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

  INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
  VALUES (_id, 'edicao', auth.uid(), NULLIF(btrim(v_diff), ''));

  IF _campos ? 'status' AND (_campos->>'status') = 'pago' AND v_antes.status IS DISTINCT FROM 'pago' THEN
    INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
    VALUES (_id, 'pagamento', auth.uid(), 'Marcado como pago — enviado para o Fluxo de Caixa.');
  END IF;
END;
$$;

-- Exclusão continua bloqueada pra item "pago" (só a edição foi liberada).
-- Movimentação Financeira exclui o par junto (as 2 linhas da transferência
-- nascem e morrem juntas).
CREATE OR REPLACE FUNCTION public.debito_automatico_excluir(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row public."DEBITO_AUTOMATICO"%ROWTYPE;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'excluir') THEN
    RAISE EXCEPTION 'Sem permissão para excluir Débito Automático.';
  END IF;

  SELECT * INTO v_row FROM public."DEBITO_AUTOMATICO" WHERE id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro não encontrado: %', _id;
  END IF;
  IF v_row.status = 'pago' THEN
    RAISE EXCEPTION 'Registro pago não pode ser excluído.';
  END IF;

  IF v_row.movimentacao_par_id IS NOT NULL THEN
    -- As 2 linhas se referenciam mutuamente (movimentacao_par_id cruzado) —
    -- precisa zerar os dois ponteiros antes de deletar, senão a FK de uma
    -- trava a exclusão da outra.
    UPDATE public."DEBITO_AUTOMATICO" SET movimentacao_par_id = NULL
      WHERE id IN (_id, v_row.movimentacao_par_id);

    INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
    VALUES (v_row.movimentacao_par_id, 'exclusao', auth.uid(), 'Excluído junto com o par da Movimentação Financeira.');
    DELETE FROM public."DEBITO_AUTOMATICO" WHERE id = v_row.movimentacao_par_id;
  END IF;

  INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
  VALUES (_id, 'exclusao', auth.uid(), 'Registro excluído.');
  DELETE FROM public."DEBITO_AUTOMATICO" WHERE id = _id;
END;
$$;

REVOKE ALL ON FUNCTION public.debito_automatico_criar_debito FROM PUBLIC;
REVOKE ALL ON FUNCTION public.debito_automatico_criar_movimentacao FROM PUBLIC;
REVOKE ALL ON FUNCTION public.debito_automatico_criar_nota FROM PUBLIC;
REVOKE ALL ON FUNCTION public.debito_automatico_editar FROM PUBLIC;
REVOKE ALL ON FUNCTION public.debito_automatico_excluir FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.debito_automatico_criar_debito TO authenticated;
GRANT EXECUTE ON FUNCTION public.debito_automatico_criar_movimentacao TO authenticated;
GRANT EXECUTE ON FUNCTION public.debito_automatico_criar_nota TO authenticated;
GRANT EXECUTE ON FUNCTION public.debito_automatico_editar TO authenticated;
GRANT EXECUTE ON FUNCTION public.debito_automatico_excluir TO authenticated;

-- ── 5. View pro Fluxo de Caixa ───────────────────────────────────────────
-- Colunas alinhadas 1:1 com v_malote_pagamento_fluxo_caixa (banco/parcela
-- como NULL — Débito Automático não tem banco nem parcelamento) pra dar
-- pra unir as duas fontes no client sem transformação.
CREATE VIEW public.v_debito_automatico_fluxo_caixa AS
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
  NULL::uuid AS banco_id,
  NULL::text AS banco_nome,
  NULL::text AS banco_logo_path,
  NULL::int AS numero_parcela,
  NULL::int AS numero_parcelas,
  d.valor,
  d.tipo
FROM public."DEBITO_AUTOMATICO" d
LEFT JOIN public.empresas e ON e.id = d.empresa_id
LEFT JOIN public.contratos c ON c.id = d.contrato_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = d.classificacao_id
WHERE d.status = 'pago';

ALTER VIEW public.v_debito_automatico_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_debito_automatico_fluxo_caixa TO authenticated;

-- ── 6. Menu ──────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'financeiro-debito-automatico', 'Financeiro — Débito Automático',
  '/app/financeiro/gestao-financeira/debito-automatico', 34
FROM public.app_modulo m WHERE m.codigo = 'financeiro'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- ── 7. Seed da classificação fixa da Nota Recebida ──────────────────────
INSERT INTO public.planejamento_orcamentario_classificacao (nome)
VALUES ('Recebimento de Nota')
ON CONFLICT (nome_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DELETE FROM public.app_menu WHERE codigo = 'financeiro-debito-automatico';
--   DROP VIEW IF EXISTS public.v_debito_automatico_fluxo_caixa;
--   DROP FUNCTION IF EXISTS public.debito_automatico_excluir(uuid);
--   DROP FUNCTION IF EXISTS public.debito_automatico_editar(uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.debito_automatico_criar_nota(date, date, uuid, uuid, text, text, numeric, text);
--   DROP FUNCTION IF EXISTS public.debito_automatico_criar_movimentacao(date, date, uuid, uuid, uuid, text, numeric, text);
--   DROP FUNCTION IF EXISTS public.debito_automatico_criar_debito(date, date, text, uuid, uuid, uuid, text, text, numeric);
--   DROP TABLE IF EXISTS public."DEBITO_AUTOMATICO_EVENTO";
--   DROP TABLE IF EXISTS public."DEBITO_AUTOMATICO";
--   DROP FUNCTION IF EXISTS public.debito_automatico_gerar_numero();
--   DROP SEQUENCE IF EXISTS public.debito_automatico_numero_seq;
--   -- (a linha "Recebimento de Nota" em planejamento_orcamentario_classificacao
--   -- não é removida automaticamente — decisão manual se ainda tem uso)
-- =====================================================================
