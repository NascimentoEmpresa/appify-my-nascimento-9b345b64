-- ============================================================================
-- Débito Automático no cartão: só some do Fluxo quando a fatura do período está mesmo importada
-- ============================================================================
-- A migration 20261029001900 (SIS-2026-0751) tirou do Fluxo todo débito de SAÍDA com forma de pagamento de cartão
-- de fatura importada, para não contar duas vezes a cobrança que já consta no arquivo da fatura. Só que a regra olhava
-- apenas o cartão, não se a fatura existe: cartão sem fatura importada (ex.: BANRI ANTONIO, sem nenhuma fatura
-- cadastrada) fazia o débito sumir do Fluxo sem nada no lugar — caso DA-2026-0821 (R$ 20.270,94, Retirada de Sócios).
--
-- Nova regra: o débito só deixa de ser linha do Fluxo quando o cartão (não consolidado) tem fatura com status
-- 'importada' na competência do débito ou na do mês do pagamento (a fatura "01" pode vencer em fevereiro). Sem fatura
-- importada no período, o débito entra no Fluxo normalmente. Entrada, outras formas de pagamento e cartão de fatura
-- consolidada (Sicredi 2719) continuam como estavam.
--
-- fn_debito_coberto_por_fatura_importada: SECURITY DEFINER, pelo mesmo motivo de fn_formas_cartao_fatura_importada — a RLS
-- de malote_cartao_credito/malote_cartao_fatura exige 'financeiro-cartao-credito', e sem a função o Fluxo mudaria de
-- pessoa para pessoa.
--
-- Migration leve (uma função e uma view): pode rodar inteira de uma vez.
--
-- ROLLBACK: reaplicar a view de 20261029001900 e
--   DROP FUNCTION IF EXISTS public.fn_debito_coberto_por_fatura_importada(text, date, date);

CREATE OR REPLACE FUNCTION public.fn_debito_coberto_por_fatura_importada(_forma text, _competencia date, _data_pagamento date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.malote_cartao_credito cc
      JOIN public.malote_cartao_fatura f ON f.cartao_id = cc.id AND f.status = 'importada'
     WHERE cc.ativo AND NOT cc.fatura_consolidada_fluxo
       AND cc.tipo_forma_pagamento = _forma
       AND f.competencia IN (
         date_trunc('month', _competencia)::date,
         date_trunc('month', _data_pagamento)::date
       )
  );
$$;
REVOKE ALL ON FUNCTION public.fn_debito_coberto_por_fatura_importada(text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_debito_coberto_por_fatura_importada(text, date, date) TO authenticated;

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
    AND public.fn_debito_coberto_por_fatura_importada(
      COALESCE(aj.forma_pagamento, d.forma_pagamento),
      COALESCE(aj.competencia, d.competencia)::date,
      COALESCE(aj.data_pagamento, d.data_pagamento)::date
    )
  );

ALTER VIEW public.v_debito_automatico_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_debito_automatico_fluxo_caixa TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   Reaplicar o CREATE OR REPLACE VIEW public.v_debito_automatico_fluxo_caixa de
--   20261029001900_debito_automatico_cartao_fatura_importada_fora_do_fluxo.sql e:
--     DROP FUNCTION IF EXISTS public.fn_debito_coberto_por_fatura_importada(text, date, date);
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
