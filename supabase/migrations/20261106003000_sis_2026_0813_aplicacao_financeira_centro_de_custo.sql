-- ============================================================================
-- SIS-2026-0813 — Centro de custo na Aplicação Financeira (aplicação e resgate)
-- ============================================================================
-- Os lançamentos da Aplicação Financeira (aplicação = saída, resgate = entrada) chegavam ao Fluxo de Caixa sem centro de custo ("—"): as views do Fluxo
-- devolviam contrato_id/contrato_nome nulos de propósito. E, como o lançamento vem da origem (a Aplicação), o Fluxo não deixa corrigir lá, e a tela
-- de Aplicações não tinha onde informar. O centro de custo correto é "MOVIMENTAÇÃO FINANCEIRA" (o da empresa).
--
--   1. APLICACAO_FINANCEIRA e APLICACAO_FINANCEIRA_RESGATE_CAIXA ganham contrato_id (FK contratos, o "centro de custo" do Fluxo).
--   2. Carga: o que já existe recebe o contrato "MOVIMENTAÇÃO FINANCEIRA…" da própria empresa (um por empresa; empresa sem esse contrato fica como está
--      e aparece em NOTICE para o Financeiro informar editando).
--   3. As views do Fluxo (aplicação e resgate) passam a devolver contrato_id/contrato_nome; a view da listagem ganha contrato_id/contrato_nome no fim.
--   4. RPCs: criar aplicação, registrar resgate e editar resgate recebem _contrato_id (opcional); editar aplicação aceita 'contrato_id' em _campos.
--      Na edição do resgate, nulo preserva o que já está gravado (mesmo critério do banco). A mudança de centro de custo entra no histórico
--      (evento da aplicação e evento do resgate, SIS-2026-0810).
--
-- Mesmas colunas, ordem e tipos nas views do Fluxo (contrato_id uuid, contrato_nome text), então Fluxo, Conciliação, Auditoria e as leituras
-- compactas continuam lendo igual. O que muda de verdade: essas linhas deixam de ser "sem centro de custo" nas telas que agrupam por contrato.
--
-- A tabela já foi alvo de deadlock ao aplicar ALTER TABLE com sessões paralelas (ver 20261008000003): o ALTER é o primeiro comando, com lock_timeout curto;
-- se desistir por lock, é só reexecutar (tudo é idempotente).
--
-- ROLLBACK:
--   (recriar as views v_aplicacao_financeira_fluxo_caixa e v_aplicacao_financeira_resgate_fluxo_caixa com NULL::uuid / NULL::text em contrato_id/contrato_nome:
--    20261008000001 e 20261104000700; recriar v_aplicacao_financeira_lista sem as 2 colunas finais: 20261008000002)
--   (recriar aplicacao_financeira_criar / aplicacao_financeira_resgatar_montante / aplicacao_financeira_resgate_editar sem _contrato_id e
--    aplicacao_financeira_editar e aplicacao_resgate_registrar_evento de 20260930000227 / 20261105010000)
--   ALTER TABLE public."APLICACAO_FINANCEIRA" DROP COLUMN IF EXISTS contrato_id;
--   ALTER TABLE public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" DROP COLUMN IF EXISTS contrato_id;
SET lock_timeout = '5s';

ALTER TABLE public."APLICACAO_FINANCEIRA" ADD COLUMN IF NOT EXISTS contrato_id uuid REFERENCES public.contratos(id);
ALTER TABLE public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" ADD COLUMN IF NOT EXISTS contrato_id uuid REFERENCES public.contratos(id);
CREATE INDEX IF NOT EXISTS idx_aplicacao_financeira_contrato ON public."APLICACAO_FINANCEIRA" (contrato_id);
CREATE INDEX IF NOT EXISTS idx_aplicacao_resgate_caixa_contrato ON public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" (contrato_id);

-- ── Carga: centro de custo "MOVIMENTAÇÃO FINANCEIRA" da empresa em tudo que está sem ──────────────────────────────────────────────
DO $$
DECLARE
  r record;
  v_a int;
  v_r int;
  v_tot_a int := 0;
  v_tot_r int := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (c.empresa_id) c.empresa_id, c.id AS contrato_id, c.nome
      FROM public.contratos c
     WHERE upper(c.nome) LIKE 'MOVIMENTA%FINANCEIRA%'
     ORDER BY c.empresa_id, (c.status = 'ativo') DESC, c.created_at
  LOOP
    UPDATE public."APLICACAO_FINANCEIRA" SET contrato_id = r.contrato_id WHERE empresa_id = r.empresa_id AND contrato_id IS NULL;
    GET DIAGNOSTICS v_a = ROW_COUNT;
    UPDATE public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" SET contrato_id = r.contrato_id WHERE empresa_id = r.empresa_id AND contrato_id IS NULL;
    GET DIAGNOSTICS v_r = ROW_COUNT;
    v_tot_a := v_tot_a + v_a;
    v_tot_r := v_tot_r + v_r;
    RAISE NOTICE 'Centro de custo "%": % aplicação(ões) e % resgate(s).', r.nome, v_a, v_r;
  END LOOP;
  RAISE NOTICE 'Carga do centro de custo: % aplicação(ões) e % resgate(s) preenchidos.', v_tot_a, v_tot_r;
  RAISE NOTICE 'Sem centro de custo (empresa sem contrato MOVIMENTAÇÃO FINANCEIRA): % aplicação(ões) e % resgate(s).',
    (SELECT count(*) FROM public."APLICACAO_FINANCEIRA" WHERE contrato_id IS NULL),
    (SELECT count(*) FROM public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" WHERE contrato_id IS NULL);
END;
$$;

-- ── Views do Fluxo: o centro de custo passa a vir da origem ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_aplicacao_financeira_fluxo_caixa AS
SELECT
  af.id AS despesa_id,
  af.numero AS id_malote,
  af.data_aplicacao AS data_pagamento,
  af.competencia,
  af.empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  af.contrato_id AS contrato_id,
  ct.nome::text AS contrato_nome,
  af.classificacao_id,
  cl.nome AS classificacao_nome,
  af.descricao,
  af.forma_pagamento,
  af.banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  NULL::int AS numero_parcela,
  NULL::int AS numero_parcelas,
  af.valor_aplicado AS valor,
  'saida'::text AS tipo,
  'aplicacao_financeira'::text AS origem,
  false AS ajustado
FROM public."APLICACAO_FINANCEIRA" af
LEFT JOIN public.empresas e ON e.id = af.empresa_id
LEFT JOIN public.contratos ct ON ct.id = af.contrato_id
LEFT JOIN public.malote_cartao_banco cb ON cb.id = af.banco_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = af.classificacao_id;

ALTER VIEW public.v_aplicacao_financeira_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_aplicacao_financeira_fluxo_caixa TO authenticated;

CREATE OR REPLACE VIEW public.v_aplicacao_financeira_resgate_fluxo_caixa AS
SELECT
  r.id AS despesa_id,
  r.numero AS id_malote,
  r.data_resgate AS data_pagamento,
  to_char(r.data_resgate, 'YYYY-MM-01')::date AS competencia,
  r.empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  r.contrato_id AS contrato_id,
  ct.nome::text AS contrato_nome,
  cl.id AS classificacao_id,
  cl.nome AS classificacao_nome,
  'Resgate de Aplicação Financeira' AS descricao,
  NULL::text AS forma_pagamento,
  r.banco_id AS banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  NULL::int AS numero_parcela,
  NULL::int AS numero_parcelas,
  r.valor_principal + r.valor_rendimento AS valor,
  'entrada'::text AS tipo,
  'aplicacao_financeira'::text AS origem,
  false AS ajustado
FROM public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" r
LEFT JOIN public.empresas e ON e.id = r.empresa_id
LEFT JOIN public.contratos ct ON ct.id = r.contrato_id
LEFT JOIN public.malote_cartao_banco cb ON cb.id = r.banco_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.nome_key = 'aplicação financeira';

ALTER VIEW public.v_aplicacao_financeira_resgate_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_aplicacao_financeira_resgate_fluxo_caixa TO authenticated;

-- ── View da listagem: contrato_id e contrato_nome no fim (CREATE OR REPLACE só acrescenta colunas no final) ────────────────────
CREATE OR REPLACE VIEW public.v_aplicacao_financeira_lista AS
SELECT
  af.id,
  af.numero,
  af.data_aplicacao,
  af.competencia,
  af.empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  af.banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  af.produto,
  af.tipo_aplicacao,
  af.classificacao_id,
  cl.nome AS classificacao_nome,
  af.forma_pagamento,
  af.descricao,
  af.valor_aplicado,
  af.indexador,
  af.taxa,
  af.data_vencimento,
  af.liquidez,
  af.rendimento_acumulado,
  0::numeric AS total_principal_resgatado,
  0::numeric AS total_rendimento_resgatado,
  af.valor_aplicado AS saldo_principal,
  af.valor_aplicado + af.rendimento_acumulado AS saldo_atual,
  af.status,
  CASE
    WHEN af.status = 'ativa' AND af.data_vencimento IS NOT NULL AND af.data_vencimento < CURRENT_DATE THEN 'vencida'
    ELSE af.status
  END AS status_exibicao,
  af.created_by,
  af.created_at,
  af.contrato_id,
  ct.nome::text AS contrato_nome
FROM public."APLICACAO_FINANCEIRA" af
LEFT JOIN public.empresas e ON e.id = af.empresa_id
LEFT JOIN public.malote_cartao_banco cb ON cb.id = af.banco_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = af.classificacao_id
LEFT JOIN public.contratos ct ON ct.id = af.contrato_id;

ALTER VIEW public.v_aplicacao_financeira_lista SET (security_invoker = true);
GRANT SELECT ON public.v_aplicacao_financeira_lista TO authenticated;

-- ── RPC: criar aplicação (com centro de custo) ──────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.aplicacao_financeira_criar(date, date, uuid, uuid, text, text, text, text, numeric, text, text, date, text);
CREATE OR REPLACE FUNCTION public.aplicacao_financeira_criar(
  _data_aplicacao date, _competencia date, _empresa_id uuid, _banco_id uuid,
  _produto text, _tipo_aplicacao text, _forma_pagamento text,
  _descricao text, _valor_aplicado numeric,
  _indexador text DEFAULT NULL, _taxa text DEFAULT NULL,
  _data_vencimento date DEFAULT NULL, _liquidez text DEFAULT NULL,
  _contrato_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
  v_classificacao_id uuid;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-aplicacao-financeira', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para incluir Aplicação Financeira.';
  END IF;
  IF _contrato_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.contratos WHERE id = _contrato_id) THEN
    RAISE EXCEPTION 'Centro de custo não encontrado.';
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
    indexador, taxa, data_vencimento, liquidez, contrato_id, created_by
  ) VALUES (
    _data_aplicacao, _competencia, _empresa_id, _banco_id, _produto, _tipo_aplicacao,
    v_classificacao_id, _forma_pagamento, _descricao, _valor_aplicado,
    _indexador, _taxa, _data_vencimento, _liquidez, _contrato_id, auth.uid()
  ) RETURNING id INTO v_id;

  INSERT INTO public."APLICACAO_FINANCEIRA_EVENTO" (aplicacao_id, tipo_evento, ator_user_id, descricao)
  VALUES (v_id, 'criacao', auth.uid(), 'Aplicação financeira registrada.');

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.aplicacao_financeira_criar(date, date, uuid, uuid, text, text, text, text, numeric, text, text, date, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aplicacao_financeira_criar(date, date, uuid, uuid, text, text, text, text, numeric, text, text, date, text, uuid) TO authenticated;

-- ── RPC: editar aplicação (aceita contrato_id em _campos; a mudança entra no histórico) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.aplicacao_financeira_editar(_id uuid, _campos jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_antes public."APLICACAO_FINANCEIRA"%ROWTYPE;
  v_diff text := '';
  v_novo_contrato uuid;
  v_nome_ant text;
  v_nome_novo text;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-aplicacao-financeira', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para editar Aplicação Financeira.';
  END IF;

  SELECT * INTO v_antes FROM public."APLICACAO_FINANCEIRA" WHERE id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro não encontrado: %', _id;
  END IF;

  IF _campos ? 'contrato_id' THEN
    v_novo_contrato := NULLIF(_campos->>'contrato_id', '')::uuid;
    IF v_novo_contrato IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.contratos WHERE id = v_novo_contrato) THEN
      RAISE EXCEPTION 'Centro de custo não encontrado.';
    END IF;
  ELSE
    v_novo_contrato := v_antes.contrato_id;
  END IF;

  UPDATE public."APLICACAO_FINANCEIRA" SET
    indexador         = CASE WHEN _campos ? 'indexador' THEN _campos->>'indexador' ELSE indexador END,
    taxa              = CASE WHEN _campos ? 'taxa' THEN _campos->>'taxa' ELSE taxa END,
    data_vencimento   = CASE WHEN _campos ? 'data_vencimento' THEN (_campos->>'data_vencimento')::date ELSE data_vencimento END,
    liquidez          = CASE WHEN _campos ? 'liquidez' THEN _campos->>'liquidez' ELSE liquidez END,
    descricao         = COALESCE(_campos->>'descricao', descricao),
    contrato_id       = v_novo_contrato,
    updated_by        = auth.uid()
  WHERE id = _id;

  IF _campos ? 'descricao' AND (_campos->>'descricao') IS DISTINCT FROM v_antes.descricao THEN
    v_diff := v_diff || format('Descrição: "%s" → "%s". ', v_antes.descricao, _campos->>'descricao');
  END IF;
  IF v_novo_contrato IS DISTINCT FROM v_antes.contrato_id THEN
    SELECT nome INTO v_nome_ant FROM public.contratos WHERE id = v_antes.contrato_id;
    SELECT nome INTO v_nome_novo FROM public.contratos WHERE id = v_novo_contrato;
    v_diff := v_diff || format('Centro de custo: %s → %s. ', COALESCE(v_nome_ant, 'sem centro de custo'), COALESCE(v_nome_novo, 'sem centro de custo'));
  END IF;

  INSERT INTO public."APLICACAO_FINANCEIRA_EVENTO" (aplicacao_id, tipo_evento, ator_user_id, descricao)
  VALUES (_id, 'edicao', auth.uid(), NULLIF(btrim(v_diff), ''));
END;
$$;

-- ── RPC: registrar resgate (com centro de custo) ────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.aplicacao_financeira_resgatar_montante(uuid, date, numeric, numeric, text, uuid);
CREATE OR REPLACE FUNCTION public.aplicacao_financeira_resgatar_montante(
  _empresa_id uuid, _data_resgate date, _valor_principal numeric,
  _valor_rendimento numeric DEFAULT 0, _observacao text DEFAULT NULL, _banco_id uuid DEFAULT NULL,
  _contrato_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_total_aplicado numeric;
  v_total_resgatado_principal numeric;
  v_saldo_principal numeric;
  v_id uuid;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-aplicacao-financeira', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para registrar resgate.';
  END IF;
  IF _valor_principal <= 0 THEN
    RAISE EXCEPTION 'Valor do principal resgatado deve ser positivo.';
  END IF;
  IF COALESCE(_valor_rendimento, 0) < 0 THEN
    RAISE EXCEPTION 'Valor de rendimento inválido.';
  END IF;
  IF _contrato_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.contratos WHERE id = _contrato_id) THEN
    RAISE EXCEPTION 'Centro de custo não encontrado.';
  END IF;

  SELECT COALESCE(SUM(valor_aplicado), 0) INTO v_total_aplicado
    FROM public."APLICACAO_FINANCEIRA" WHERE empresa_id = _empresa_id;
  SELECT COALESCE(SUM(valor_principal), 0) INTO v_total_resgatado_principal
    FROM public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" WHERE empresa_id = _empresa_id;
  v_saldo_principal := v_total_aplicado - v_total_resgatado_principal;

  IF _valor_principal > v_saldo_principal THEN
    RAISE EXCEPTION 'Valor do principal (R$ %) maior que o montante ativo disponível da empresa (R$ %).', _valor_principal, v_saldo_principal;
  END IF;

  INSERT INTO public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" (
    empresa_id, data_resgate, valor_principal, valor_rendimento, observacao, banco_id, contrato_id, created_by
  ) VALUES (
    _empresa_id, _data_resgate, _valor_principal, COALESCE(_valor_rendimento, 0), _observacao, _banco_id, _contrato_id, auth.uid()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.aplicacao_financeira_resgatar_montante(uuid, date, numeric, numeric, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aplicacao_financeira_resgatar_montante(uuid, date, numeric, numeric, text, uuid, uuid) TO authenticated;

-- ── RPC: editar resgate (centro de custo; nulo preserva o gravado, como o banco) ───────────────────────────────────────────
DROP FUNCTION IF EXISTS public.aplicacao_financeira_resgate_editar(uuid, date, numeric, numeric, text, uuid);
CREATE OR REPLACE FUNCTION public.aplicacao_financeira_resgate_editar(
  _id uuid, _data_resgate date, _valor_principal numeric,
  _valor_rendimento numeric DEFAULT 0, _observacao text DEFAULT NULL, _banco_id uuid DEFAULT NULL,
  _contrato_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_empresa uuid;
  v_aplicado numeric;
  v_outros numeric;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-aplicacao-financeira', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para editar resgate.';
  END IF;
  IF _valor_principal <= 0 THEN
    RAISE EXCEPTION 'Valor do principal resgatado deve ser positivo.';
  END IF;
  IF COALESCE(_valor_rendimento, 0) < 0 THEN
    RAISE EXCEPTION 'Valor de rendimento inválido.';
  END IF;
  IF _contrato_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.contratos WHERE id = _contrato_id) THEN
    RAISE EXCEPTION 'Centro de custo não encontrado.';
  END IF;

  SELECT empresa_id INTO v_empresa FROM public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" WHERE id = _id FOR UPDATE;
  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'Resgate não encontrado.';
  END IF;

  SELECT COALESCE(SUM(valor_aplicado), 0) INTO v_aplicado FROM public."APLICACAO_FINANCEIRA" WHERE empresa_id = v_empresa;
  SELECT COALESCE(SUM(valor_principal), 0) INTO v_outros
    FROM public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" WHERE empresa_id = v_empresa AND id <> _id;
  IF _valor_principal > v_aplicado - v_outros THEN
    RAISE EXCEPTION 'Valor do principal (R$ %) maior que o montante ativo disponível da empresa (R$ %).', _valor_principal, v_aplicado - v_outros;
  END IF;

  UPDATE public."APLICACAO_FINANCEIRA_RESGATE_CAIXA"
     SET data_resgate = _data_resgate, valor_principal = _valor_principal,
         valor_rendimento = COALESCE(_valor_rendimento, 0), observacao = _observacao,
         banco_id = COALESCE(_banco_id, banco_id),
         contrato_id = COALESCE(_contrato_id, contrato_id),
         updated_at = now(), updated_by = auth.uid()
   WHERE id = _id;
END;
$$;
REVOKE ALL ON FUNCTION public.aplicacao_financeira_resgate_editar(uuid, date, numeric, numeric, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aplicacao_financeira_resgate_editar(uuid, date, numeric, numeric, text, uuid, uuid) TO authenticated;

-- ── Histórico do resgate (trigger de 20261105010000): passa a registrar também o centro de custo ───────────────────────────────
CREATE OR REPLACE FUNCTION public.aplicacao_resgate_registrar_evento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_msgs text[] := ARRAY[]::text[];
  v_banco_ant text;
  v_banco_novo text;
  v_cc_ant text;
  v_cc_novo text;
  fmt text := 'FM999G999G990D00';
  v_atual text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public."APLICACAO_FINANCEIRA_RESGATE_EVENTO" (resgate_id, numero, tipo_evento, ator_user_id, descricao)
    VALUES (NEW.id, NEW.numero, 'criacao', COALESCE(auth.uid(), NEW.created_by),
            'Resgate registrado: principal R$ ' || to_char(NEW.valor_principal, fmt) || ' + rendimento R$ ' || to_char(COALESCE(NEW.valor_rendimento, 0), fmt)
            || ' em ' || to_char(NEW.data_resgate, 'DD/MM/YYYY')
            || COALESCE(' · ' || (SELECT nome FROM public.malote_cartao_banco WHERE id = NEW.banco_id), ' · sem banco informado')
            || COALESCE(' · centro de custo ' || (SELECT nome FROM public.contratos WHERE id = NEW.contrato_id), ''));
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    INSERT INTO public."APLICACAO_FINANCEIRA_RESGATE_EVENTO" (resgate_id, numero, tipo_evento, ator_user_id, descricao)
    VALUES (OLD.id, OLD.numero, 'exclusao', auth.uid(),
            'Resgate excluído: principal R$ ' || to_char(OLD.valor_principal, fmt) || ' + rendimento R$ ' || to_char(COALESCE(OLD.valor_rendimento, 0), fmt)
            || ' de ' || to_char(OLD.data_resgate, 'DD/MM/YYYY'));
    RETURN OLD;
  END IF;

  IF NEW.data_resgate IS DISTINCT FROM OLD.data_resgate THEN
    v_msgs := v_msgs || ('Data: ' || to_char(OLD.data_resgate, 'DD/MM/YYYY') || ' → ' || to_char(NEW.data_resgate, 'DD/MM/YYYY'));
  END IF;
  IF NEW.valor_principal IS DISTINCT FROM OLD.valor_principal THEN
    v_msgs := v_msgs || ('Principal: R$ ' || to_char(OLD.valor_principal, fmt) || ' → R$ ' || to_char(NEW.valor_principal, fmt));
  END IF;
  IF NEW.valor_rendimento IS DISTINCT FROM OLD.valor_rendimento THEN
    v_msgs := v_msgs || ('Rendimento: R$ ' || to_char(COALESCE(OLD.valor_rendimento, 0), fmt) || ' → R$ ' || to_char(COALESCE(NEW.valor_rendimento, 0), fmt));
  END IF;
  IF NEW.banco_id IS DISTINCT FROM OLD.banco_id THEN
    SELECT nome INTO v_banco_ant FROM public.malote_cartao_banco WHERE id = OLD.banco_id;
    SELECT nome INTO v_banco_novo FROM public.malote_cartao_banco WHERE id = NEW.banco_id;
    v_msgs := v_msgs || ('Banco: ' || COALESCE(v_banco_ant, 'sem banco') || ' → ' || COALESCE(v_banco_novo, 'sem banco'));
  END IF;
  IF NEW.contrato_id IS DISTINCT FROM OLD.contrato_id THEN
    SELECT nome INTO v_cc_ant FROM public.contratos WHERE id = OLD.contrato_id;
    SELECT nome INTO v_cc_novo FROM public.contratos WHERE id = NEW.contrato_id;
    v_msgs := v_msgs || ('Centro de custo: ' || COALESCE(v_cc_ant, 'sem centro de custo') || ' → ' || COALESCE(v_cc_novo, 'sem centro de custo'));
  END IF;
  IF NEW.observacao IS DISTINCT FROM OLD.observacao THEN
    v_msgs := v_msgs || ('Observação: ' || COALESCE(NULLIF(btrim(OLD.observacao), ''), '(vazia)') || ' → ' || COALESCE(NULLIF(btrim(NEW.observacao), ''), '(vazia)'));
  END IF;

  IF array_length(v_msgs, 1) IS NULL THEN RETURN NEW; END IF;
  v_atual := array_to_string(v_msgs, ' · ');
  INSERT INTO public."APLICACAO_FINANCEIRA_RESGATE_EVENTO" (resgate_id, numero, tipo_evento, ator_user_id, descricao)
  VALUES (NEW.id, NEW.numero, 'edicao', COALESCE(auth.uid(), NEW.updated_by), v_atual);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.aplicacao_resgate_registrar_evento() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
