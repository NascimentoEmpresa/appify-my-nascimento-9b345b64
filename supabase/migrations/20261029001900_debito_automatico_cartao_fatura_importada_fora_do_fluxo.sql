-- ============================================================================
-- SIS-2026-0751 — Débito Automático no cartão de FATURA IMPORTADA não vira linha própria no Fluxo
-- ============================================================================
-- Cartão com fatura importada (BB, Banrisul, Bradesco...): a fonte do Fluxo é o arquivo da fatura (1 linha por
-- fatura, no vencimento — migration 20261029001800). Um débito automático lançado com a forma de pagamento desse
-- cartão é uma cobrança que também consta no arquivo; se ele virasse linha própria seria contado duas vezes.
-- Decisão (caminho A): o débito segue cadastrado e visível em Débito Automático, mas NÃO gera linha no Fluxo
-- (nem no Utilizado do cartão) quando é SAÍDA com forma de pagamento de cartão de fatura importada.
-- Cartão com fatura consolidada (Sicredi 2719) não muda: o débito continua entrando na linha da fatura dele
-- (migration 20261015000011). Débito de ENTRADA e de outras formas de pagamento também não muda.
--
-- fn_formas_cartao_fatura_importada(): SECURITY DEFINER, como fn_cartoes_fatura_consolidada — a RLS de
-- malote_cartao_credito exige 'financeiro-cartao-credito', e sem a função o Fluxo filtraria só para quem tem esse
-- acesso (cada pessoa veria um Fluxo diferente).
--
-- Migration leve (uma função e uma view): pode rodar inteira de uma vez.
--
-- ROLLBACK: reaplicar a view de 20260930000222 (v_debito_automatico_fluxo_caixa) e
--   DROP FUNCTION IF EXISTS public.fn_formas_cartao_fatura_importada();

CREATE OR REPLACE FUNCTION public.fn_formas_cartao_fatura_importada()
RETURNS TABLE (tipo_forma_pagamento text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.tipo_forma_pagamento
    FROM public.malote_cartao_credito c
   WHERE c.ativo AND NOT c.fatura_consolidada_fluxo;
$$;
REVOKE ALL ON FUNCTION public.fn_formas_cartao_fatura_importada() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_formas_cartao_fatura_importada() TO authenticated;

CREATE OR REPLACE VIEW public.v_debito_automatico_fluxo_caixa AS
SELECT
  d.id AS despesa_id,
  d.numero AS id_malote,
  COALESCE(aj.data_pagamento, d.data_pagamento) AS data_pagamento,
  COALESCE(aj.competencia, d.competencia) AS competencia,
  COALESCE(aj.empresa_id, d.empresa_id) AS empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  d.contrato_id,
  c.nome AS contrato_nome,
  COALESCE(aj.classificacao_id, d.classificacao_id) AS classificacao_id,
  cl.nome AS classificacao_nome,
  COALESCE(aj.descricao, d.descricao) AS descricao,
  COALESCE(aj.forma_pagamento, d.forma_pagamento) AS forma_pagamento,
  COALESCE(aj.banco_id, d.banco_id) AS banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  NULL::int AS numero_parcela,
  NULL::int AS numero_parcelas,
  COALESCE(aj.valor, d.valor) AS valor,
  COALESCE(aj.tipo, d.tipo) AS tipo,
  'debito_automatico'::text AS origem,
  (aj.id IS NOT NULL) AS ajustado
FROM public."DEBITO_AUTOMATICO" d
LEFT JOIN public.financeiro_fluxo_caixa_ajuste aj
  ON aj.origem = 'debito_automatico' AND aj.despesa_id = d.id AND aj.numero_parcela IS NULL
LEFT JOIN public.empresas e ON e.id = COALESCE(aj.empresa_id, d.empresa_id)
LEFT JOIN public.contratos c ON c.id = d.contrato_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = COALESCE(aj.classificacao_id, d.classificacao_id)
LEFT JOIN public.malote_cartao_banco cb ON cb.id = COALESCE(aj.banco_id, d.banco_id)
WHERE d.status = 'pago' AND d.deleted_at IS NULL
  AND NOT (
    COALESCE(aj.tipo, d.tipo) = 'saida'
    AND COALESCE(aj.forma_pagamento, d.forma_pagamento) IN (SELECT f.tipo_forma_pagamento FROM public.fn_formas_cartao_fatura_importada() f)
  );

ALTER VIEW public.v_debito_automatico_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_debito_automatico_fluxo_caixa TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   Reaplicar o CREATE OR REPLACE VIEW public.v_debito_automatico_fluxo_caixa de
--   20260930000222_financeiro_fluxo_caixa_ajuste_valor.sql (sem o AND NOT (...) do WHERE) e:
--     DROP FUNCTION IF EXISTS public.fn_formas_cartao_fatura_importada();
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
