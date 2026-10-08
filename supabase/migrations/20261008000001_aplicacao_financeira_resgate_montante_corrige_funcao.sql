-- ============================================================================
-- SIS-2026-0588 — resgate de Aplicação não aparecia na tela nem no Fluxo
-- ============================================================================
-- A migration 20260930000254 trocou o resgate por "montante da empresa"
-- (tabela APLICACAO_FINANCEIRA_RESGATE_CAIXA + view do Fluxo lendo dela), mas a
-- função aplicacao_financeira_resgatar_montante NÃO foi substituída em produção:
-- a 254 faz CREATE OR REPLACE mudando o tipo de retorno (jsonb -> uuid), e o
-- Postgres recusa ("cannot change return type of existing function"). O resto
-- da migration (tabela, policy, view) foi aplicado; a função ficou na 1ª versão,
-- que consome as aplicações em FIFO e grava em APLICACAO_FINANCEIRA_RESGATE
-- (tabela antiga). Resultado: o resgate lançado ia para a tabela que nem a tela
-- (KPI "Total Resgatado") nem a view do Fluxo leem mais.
--
-- Esta migration só troca a função: DROP da versão antiga + CREATE da versão
-- da 254 (grava em APLICACAO_FINANCEIRA_RESGATE_CAIXA, não mexe nas linhas).
--
-- A trava de rendimento (rendimento resgatado <= acumulado) saiu: o campo é
-- manual e vazio, e bloqueava resgate com rendimento real.
--
-- NÃO move os resgates que já estão na tabela antiga (decisão pendente).
--
-- ROLLBACK:
--   (recriar a função da migration 20260930000254 não é possível sem o corpo
--    antigo: ver o corpo FIFO em git, commit 46be3e56^ da 254 / este comentário)

DROP FUNCTION IF EXISTS public.aplicacao_financeira_resgatar_montante(uuid, date, numeric, numeric, text);

CREATE FUNCTION public.aplicacao_financeira_resgatar_montante(
  _empresa_id uuid, _data_resgate date, _valor_principal numeric,
  _valor_rendimento numeric DEFAULT 0, _observacao text DEFAULT NULL
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
  -- Rendimento resgatado NÃO é limitado pelo "rendimento acumulado" das linhas:
  -- esse campo é lançado à mão (hoje tudo zerado) e o banco paga o rendimento
  -- real no resgate. O que entra no caixa é principal + rendimento informado.

  INSERT INTO public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" (
    empresa_id, data_resgate, valor_principal, valor_rendimento, observacao, created_by
  ) VALUES (
    _empresa_id, _data_resgate, _valor_principal, COALESCE(_valor_rendimento, 0), _observacao, auth.uid()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.aplicacao_financeira_resgatar_montante(uuid, date, numeric, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aplicacao_financeira_resgatar_montante(uuid, date, numeric, numeric, text) TO authenticated;

-- As duas views de Aplicação no Fluxo nunca tiveram as colunas `origem` e
-- `ajustado` que as outras 4 têm (e que FluxoCaixaMaloteLinha declara): as
-- linhas chegavam à tela com origem indefinida (sem rótulo "Aplicação
-- Financeira", fora do filtro por origem, sem o "ver em Aplicações"). Colunas
-- novas só no FIM da view (CREATE OR REPLACE VIEW não permite mexer nas atuais).
CREATE OR REPLACE VIEW public.v_aplicacao_financeira_resgate_fluxo_caixa AS
SELECT
  r.id AS despesa_id,
  NULL::text AS id_malote,
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
  NULL::uuid AS banco_id,
  NULL::text AS banco_nome,
  NULL::text AS banco_logo_path,
  NULL::int AS numero_parcela,
  NULL::int AS numero_parcelas,
  r.valor_principal + r.valor_rendimento AS valor,
  'entrada'::text AS tipo,
  'aplicacao_financeira'::text AS origem,
  false AS ajustado
FROM public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" r
LEFT JOIN public.empresas e ON e.id = r.empresa_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.nome_key = 'aplicação financeira';

ALTER VIEW public.v_aplicacao_financeira_resgate_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_aplicacao_financeira_resgate_fluxo_caixa TO authenticated;

CREATE OR REPLACE VIEW public.v_aplicacao_financeira_fluxo_caixa AS
SELECT
  af.id AS despesa_id,
  af.numero AS id_malote,
  af.data_aplicacao AS data_pagamento,
  af.competencia,
  af.empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  NULL::uuid AS contrato_id,
  NULL::text AS contrato_nome,
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
LEFT JOIN public.malote_cartao_banco cb ON cb.id = af.banco_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = af.classificacao_id;

ALTER VIEW public.v_aplicacao_financeira_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_aplicacao_financeira_fluxo_caixa TO authenticated;

NOTIFY pgrst, 'reload schema';
