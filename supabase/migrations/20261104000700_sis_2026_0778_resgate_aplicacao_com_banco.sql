-- ============================================================================
-- SIS-2026-0778 — Conciliação bancária não reconhecia os resgates de Aplicação Financeira
-- ============================================================================
-- O resgate (APLICACAO_FINANCEIRA_RESGATE_CAIXA) nunca guardou o BANCO em que o dinheiro entrou: a view do Fluxo
-- (v_aplicacao_financeira_resgate_fluxo_caixa) devolvia banco_id = NULL. A Conciliação Bancária compara o extrato OFX de UM banco com os lançamentos
-- do Fluxo DAQUELE banco (banco_id = banco escolhido), então o resgate aparecia no Fluxo e no extrato, mas nunca do lado do Fluxo da conciliação:
-- o crédito do extrato ficava como divergência ("consta no extrato, sem Fluxo").
--
-- Esta migration:
--   1) APLICACAO_FINANCEIRA_RESGATE_CAIXA ganha banco_id (catálogo malote_cartao_banco, o mesmo da aplicação e do Fluxo). Nulo nos resgates que já
--      existem: a Controladoria/Financeiro informa o banco editando o resgate em Aplicações Financeiras (a edição passa a ter o campo Banco).
--   2) as RPCs de registrar e de editar o resgate recebem _banco_id (opcional; na edição, nulo preserva o que já está gravado);
--   3) a view do Fluxo passa a devolver o banco do resgate (banco_id, banco_nome, banco_logo_path), mesmas colunas e tipos de antes.
--
-- Sem o banco informado nada muda para o resgate (continua no Fluxo sem banco). Com ele, o resgate entra na conciliação do banco e, com as contas
-- do banco (SIS-2026-0777), também pode ser ligado à conta certa.
--
-- Migration leve, mas a tabela de resgates já foi alvo de deadlock com sessões paralelas ao aplicar ALTER TABLE (ver 20261008000003): o ALTER é o
-- primeiro comando, com lock_timeout curto; se desistir por lock, é só reexecutar a migration (tudo é idempotente).
--
-- ROLLBACK:
--   (recriar a view de 20261008000003 com banco_id/banco_nome/banco_logo_path NULL e as RPCs de 20261008000001 / 20261008000002 sem _banco_id)
--   ALTER TABLE public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" DROP COLUMN IF EXISTS banco_id;
SET lock_timeout = '5s';

ALTER TABLE public."APLICACAO_FINANCEIRA_RESGATE_CAIXA"
  ADD COLUMN IF NOT EXISTS banco_id uuid REFERENCES public.malote_cartao_banco(id);

-- ── RPC: registrar resgate (com banco) ──────────────────────────────────────
DROP FUNCTION IF EXISTS public.aplicacao_financeira_resgatar_montante(uuid, date, numeric, numeric, text);
DROP FUNCTION IF EXISTS public.aplicacao_financeira_resgatar_montante(uuid, date, numeric, numeric, text, uuid);

CREATE FUNCTION public.aplicacao_financeira_resgatar_montante(
  _empresa_id uuid, _data_resgate date, _valor_principal numeric,
  _valor_rendimento numeric DEFAULT 0, _observacao text DEFAULT NULL, _banco_id uuid DEFAULT NULL
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

  SELECT COALESCE(SUM(valor_aplicado), 0)
    INTO v_total_aplicado
  FROM public."APLICACAO_FINANCEIRA" WHERE empresa_id = _empresa_id;

  SELECT COALESCE(SUM(valor_principal), 0)
    INTO v_total_resgatado_principal
  FROM public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" WHERE empresa_id = _empresa_id;

  v_saldo_principal := v_total_aplicado - v_total_resgatado_principal;

  IF _valor_principal > v_saldo_principal THEN
    RAISE EXCEPTION 'Valor do principal (R$ %) maior que o montante ativo disponível da empresa (R$ %).', _valor_principal, v_saldo_principal;
  END IF;

  INSERT INTO public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" (
    empresa_id, data_resgate, valor_principal, valor_rendimento, observacao, banco_id, created_by
  ) VALUES (
    _empresa_id, _data_resgate, _valor_principal, COALESCE(_valor_rendimento, 0), _observacao, _banco_id, auth.uid()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.aplicacao_financeira_resgatar_montante(uuid, date, numeric, numeric, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aplicacao_financeira_resgatar_montante(uuid, date, numeric, numeric, text, uuid) TO authenticated;

-- ── RPC: editar resgate (com banco; nulo preserva o banco já gravado) ───────
DROP FUNCTION IF EXISTS public.aplicacao_financeira_resgate_editar(uuid, date, numeric, numeric, text);
DROP FUNCTION IF EXISTS public.aplicacao_financeira_resgate_editar(uuid, date, numeric, numeric, text, uuid);

CREATE FUNCTION public.aplicacao_financeira_resgate_editar(
  _id uuid, _data_resgate date, _valor_principal numeric,
  _valor_rendimento numeric DEFAULT 0, _observacao text DEFAULT NULL, _banco_id uuid DEFAULT NULL
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
         updated_at = now(), updated_by = auth.uid()
   WHERE id = _id;
END;
$$;

REVOKE ALL ON FUNCTION public.aplicacao_financeira_resgate_editar(uuid, date, numeric, numeric, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aplicacao_financeira_resgate_editar(uuid, date, numeric, numeric, text, uuid) TO authenticated;

-- ── View do Fluxo: o resgate passa a ter banco ──────────────────────────────
-- Mesmas colunas, ordem e tipos da versão de 20261008000003. banco_id vem direto do resgate (não do join): quem lê o Fluxo sem acesso ao catálogo
-- de bancos continua com o banco_id (e só o nome some, como já acontece na aplicação).
CREATE OR REPLACE VIEW public.v_aplicacao_financeira_resgate_fluxo_caixa AS
SELECT
  r.id AS despesa_id,
  r.numero AS id_malote,
  r.data_resgate AS data_pagamento,
  to_char(r.data_resgate, 'YYYY-MM-01')::date AS competencia,
  r.empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  NULL::uuid AS contrato_id,
  NULL::text AS contrato_nome,
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
LEFT JOIN public.malote_cartao_banco cb ON cb.id = r.banco_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.nome_key = 'aplicação financeira';

ALTER VIEW public.v_aplicacao_financeira_resgate_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_aplicacao_financeira_resgate_fluxo_caixa TO authenticated;

NOTIFY pgrst, 'reload schema';
