-- SIS-2026-0733: valor editado no Fluxo (financeiro_fluxo_caixa_ajuste.valor) em despesa RATEADA era aplicado inteiro a cada
-- cota do rateio: a DM-2026-1126 (parcela de R$ 906,66, 5 cotas) passou a mostrar R$ 4.533,30 (5 x 906,66). O ajuste de
-- valor vale para a linha toda e agora é repartido entre as cotas na proporção do rateio, então a soma volta a ser o valor
-- editado. Despesa sem rateio e sem ajuste: nada muda. Só recria a view (colunas, ordem e tipos iguais); a consolidada do
-- cartão lê dela.

CREATE OR REPLACE VIEW public.v_malote_pagamento_fluxo_caixa AS
WITH base AS (
  SELECT
    d.id AS despesa_id,
    d.numero AS id_malote,
    d.data_pagamento AS data_pagamento_orig,
    d.competencia AS competencia_orig,
    COALESCE(rl.empresa_id, d.empresa_id) AS empresa_id_orig,
    COALESCE(rl.contrato_id, d.contrato_id) AS contrato_id,
    COALESCE(rl.classificacao_id, d.classificacao_id) AS classificacao_id_orig,
    d.nome || CASE WHEN COALESCE(d.valor_juros, 0) > 0 THEN ' (inclui R$ ' || replace(to_char(d.valor_juros, 'FM999999990D00'), '.', ',') || ' de juros)' ELSE '' END AS descricao_orig,
    d.forma_pagamento AS forma_pagamento_orig,
    d.banco_id AS banco_id_orig,
    NULL::int AS numero_parcela,
    NULL::int AS numero_parcelas,
    -- SIS-2026-0733: valor = o que foi de fato pago = valor definitivo da despesa + juros informado no pagamento
    -- (valor_juros), dividido entre as cotas do rateio na mesma proporção.
    CASE WHEN rl.id IS NULL THEN d.valor_aprovado + COALESCE(d.valor_juros, 0)
         ELSE COALESCE(rl.valor * (COALESCE(d.valor_aprovado, d.valor_total) + COALESCE(d.valor_juros, 0)) / NULLIF(SUM(rl.valor) OVER (PARTITION BY d.id), 0), rl.valor + COALESCE(d.valor_juros, 0))
    END AS valor_orig,
    'saida'::text AS tipo_orig,
    'malote'::text AS origem
  FROM public.malote_despesa d
  LEFT JOIN public.malote_despesa_rateio_linha rl ON rl.despesa_id = d.id
  WHERE d.status = 'despesa_paga' AND NOT d.parcelado AND d.deleted_at IS NULL

  UNION ALL

  SELECT
    d.id AS despesa_id,
    d.numero AS id_malote,
    p.data_pagamento_real AS data_pagamento_orig,
    d.competencia AS competencia_orig,
    COALESCE(rl.empresa_id, d.empresa_id) AS empresa_id_orig,
    COALESCE(rl.contrato_id, d.contrato_id) AS contrato_id,
    COALESCE(rl.classificacao_id, d.classificacao_id) AS classificacao_id_orig,
    d.nome || CASE WHEN COALESCE(p.valor_juros, 0) > 0 THEN ' (inclui R$ ' || replace(to_char(p.valor_juros, 'FM999999990D00'), '.', ',') || ' de juros)' ELSE '' END AS descricao_orig,
    d.forma_pagamento AS forma_pagamento_orig,
    p.banco_id AS banco_id_orig,
    p.numero_parcela,
    d.numero_parcelas,
    (p.valor + COALESCE(p.valor_juros, 0)) * COALESCE(rl.valor / NULLIF(d.valor_total, 0), 1) AS valor_orig,
    'saida'::text AS tipo_orig,
    'malote'::text AS origem
  FROM public.malote_despesa d
  JOIN public.malote_despesa_parcela p ON p.despesa_id = d.id AND p.status = 'paga'
  LEFT JOIN public.malote_despesa_rateio_linha rl ON rl.despesa_id = d.id
  WHERE d.parcelado AND d.deleted_at IS NULL
)
SELECT
  b.despesa_id,
  b.id_malote,
  COALESCE(aj.data_pagamento, b.data_pagamento_orig) AS data_pagamento,
  COALESCE(aj.competencia, b.competencia_orig) AS competencia,
  COALESCE(aj.empresa_id, b.empresa_id_orig) AS empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  b.contrato_id,
  c.nome AS contrato_nome,
  COALESCE(aj.classificacao_id, b.classificacao_id_orig) AS classificacao_id,
  cl.nome AS classificacao_nome,
  COALESCE(aj.descricao, b.descricao_orig) AS descricao,
  COALESCE(aj.forma_pagamento, b.forma_pagamento_orig) AS forma_pagamento,
  COALESCE(aj.banco_id, b.banco_id_orig) AS banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  b.numero_parcela,
  b.numero_parcelas,
  -- SIS-2026-0733: o valor editado no Fluxo é o da LINHA (despesa/parcela inteira), mas a view tem 1 linha por cota do
  -- rateio. Antes cada cota recebia o valor editado inteiro (DM-2026-1126: 5 cotas x R$ 906,66 = R$ 4.533,30). Agora o
  -- valor editado é dividido entre as cotas na mesma proporção do rateio; sem rateio (1 linha) nada muda.
  COALESCE(
    aj.valor * b.valor_orig / NULLIF(SUM(b.valor_orig) OVER (PARTITION BY b.despesa_id, b.numero_parcela), 0),
    aj.valor,
    b.valor_orig
  ) AS valor,
  COALESCE(aj.tipo, b.tipo_orig) AS tipo,
  b.origem,
  (aj.id IS NOT NULL) AS ajustado
FROM base b
LEFT JOIN public.financeiro_fluxo_caixa_ajuste aj
  ON aj.origem = b.origem AND aj.despesa_id = b.despesa_id
 AND aj.numero_parcela IS NOT DISTINCT FROM b.numero_parcela
LEFT JOIN public.empresas e ON e.id = COALESCE(aj.empresa_id, b.empresa_id_orig)
LEFT JOIN public.contratos c ON c.id = b.contrato_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = COALESCE(aj.classificacao_id, b.classificacao_id_orig)
LEFT JOIN public.malote_cartao_banco cb ON cb.id = COALESCE(aj.banco_id, b.banco_id_orig);

ALTER VIEW public.v_malote_pagamento_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_malote_pagamento_fluxo_caixa TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK: reaplicar a definição de 20261029000020_fluxo_caixa_valor_pago_com_juros.sql (v_malote_pagamento_fluxo_caixa)
--   e NOTIFY pgrst, 'reload schema';
