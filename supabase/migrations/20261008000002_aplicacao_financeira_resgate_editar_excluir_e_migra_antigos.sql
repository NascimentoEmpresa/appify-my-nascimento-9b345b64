-- ============================================================================
-- SIS-2026-0588 (parte 2) — resgates: migrar os antigos + editar/excluir
-- ============================================================================
-- 1. Os resgates feitos pela 1ª versão da função (tabela antiga
--    APLICACAO_FINANCEIRA_RESGATE, por linha, em FIFO) nunca entraram no modelo
--    novo (APLICACAO_FINANCEIRA_RESGATE_CAIXA, por empresa): ficavam fora do
--    Fluxo, das Movimentações e da trava de saldo. Aqui eles são COPIADOS para a
--    tabela nova (1 linha nova por linha antiga, com a marca na observação) e as
--    linhas da carteira voltam a ser o que foram criadas (status 'ativa'), como o
--    modelo novo exige. A tabela antiga fica como arquivo (não é apagada), mas a
--    view da listagem deixa de descontá-la — senão o valor seria descontado 2x.
--    Fica de fora o resgate de teste de R$ 1,00 de 08/10/2026 (data_resgate >=
--    2026-10-01).
-- 2. RPCs para editar e excluir um resgate (antes só existia criar).
--
-- ROLLBACK (parcial):
--   DELETE FROM public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" WHERE observacao LIKE 'Migrado do resgate por linha %';
--   UPDATE public."APLICACAO_FINANCEIRA" SET status = 'resgatada' WHERE id IN (<AF-2026-0001, AF-2026-0002>);
--   (recriar v_aplicacao_financeira_lista com o LEFT JOIN da migration 20260930000227)
--   DROP FUNCTION public.aplicacao_financeira_resgate_editar(uuid, date, numeric, numeric, text);
--   DROP FUNCTION public.aplicacao_financeira_resgate_excluir(uuid);

ALTER TABLE public."APLICACAO_FINANCEIRA_RESGATE_CAIXA"
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

-- ── 1. migrar os resgates antigos ───────────────────────────────────────────
INSERT INTO public."APLICACAO_FINANCEIRA_RESGATE_CAIXA"
  (empresa_id, data_resgate, valor_principal, valor_rendimento, observacao, created_by, created_at)
SELECT af.empresa_id, r.data_resgate, r.valor_principal, r.valor_rendimento,
       'Migrado do resgate por linha ' || r.id::text || ' (' || af.numero || ')',
       r.created_by, r.created_at
FROM public."APLICACAO_FINANCEIRA_RESGATE" r
JOIN public."APLICACAO_FINANCEIRA" af ON af.id = r.aplicacao_id
WHERE r.data_resgate < DATE '2026-10-01'
  AND r.valor_principal > 0
  AND NOT EXISTS (
    SELECT 1 FROM public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" c
    WHERE c.observacao LIKE 'Migrado do resgate por linha ' || r.id::text || '%'
  );

-- A linha da carteira volta a ser a original (resgate não fecha linha).
UPDATE public."APLICACAO_FINANCEIRA" af
   SET status = 'ativa'
 WHERE af.status = 'resgatada'
   AND EXISTS (SELECT 1 FROM public."APLICACAO_FINANCEIRA_RESGATE" r WHERE r.aplicacao_id = af.id);

-- A listagem não desconta mais a tabela antiga (já copiada acima). Mesmas colunas,
-- mesma ordem; total_*_resgatado ficam 0 (o resgate agora é por empresa).
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
  af.created_at
FROM public."APLICACAO_FINANCEIRA" af
LEFT JOIN public.empresas e ON e.id = af.empresa_id
LEFT JOIN public.malote_cartao_banco cb ON cb.id = af.banco_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = af.classificacao_id;

ALTER VIEW public.v_aplicacao_financeira_lista SET (security_invoker = true);
GRANT SELECT ON public.v_aplicacao_financeira_lista TO authenticated;

-- ── 2. editar / excluir resgate ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.aplicacao_financeira_resgate_editar(
  _id uuid, _data_resgate date, _valor_principal numeric,
  _valor_rendimento numeric DEFAULT 0, _observacao text DEFAULT NULL
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
         updated_at = now(), updated_by = auth.uid()
   WHERE id = _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.aplicacao_financeira_resgate_excluir(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-aplicacao-financeira', 'excluir') THEN
    RAISE EXCEPTION 'Sem permissão para excluir resgate.';
  END IF;
  DELETE FROM public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" WHERE id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resgate não encontrado.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.aplicacao_financeira_resgate_editar(uuid, date, numeric, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aplicacao_financeira_resgate_excluir(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aplicacao_financeira_resgate_editar(uuid, date, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aplicacao_financeira_resgate_excluir(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
