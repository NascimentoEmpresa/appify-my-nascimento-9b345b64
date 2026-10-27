-- Fluxo de Caixa: despesa do Malote rateada mostrava a MESMA classificação em
-- todas as cotas (DM-2026-3116: 7 cotas, COMBUSTÍVEL e INSUMOS no Malote, tudo
-- COMBUSTÍVEL no Fluxo). As views liam d.classificacao_id (a da despesa),
-- ignorando malote_despesa_rateio_linha.classificacao_id, que é onde cada cota
-- guarda a sua. Agora a cota usa a própria classificação e só cai na da
-- despesa quando a linha do rateio não tem (despesa sem rateio / dado antigo).
-- O ajuste do Fluxo (financeiro_fluxo_caixa_ajuste) continua mandando por cima,
-- como antes. Só muda a expressão: colunas, ordem e tipos das views iguais.

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
    d.nome AS descricao_orig,
    d.forma_pagamento AS forma_pagamento_orig,
    d.banco_id AS banco_id_orig,
    NULL::int AS numero_parcela,
    NULL::int AS numero_parcelas,
    COALESCE(rl.valor, d.valor_aprovado) AS valor_orig,
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
    d.nome AS descricao_orig,
    d.forma_pagamento AS forma_pagamento_orig,
    p.banco_id AS banco_id_orig,
    p.numero_parcela,
    d.numero_parcelas,
    p.valor * COALESCE(rl.valor / NULLIF(d.valor_total, 0), 1) AS valor_orig,
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
  COALESCE(aj.valor, b.valor_orig) AS valor,
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

CREATE OR REPLACE VIEW public.v_fluxo_caixa_previsto AS
WITH base AS (
  SELECT
    d.id AS despesa_id,
    d.numero AS id_malote,
    d.data_pagamento AS data_prevista,
    d.competencia,
    COALESCE(rl.empresa_id, d.empresa_id) AS empresa_id,
    COALESCE(rl.contrato_id, d.contrato_id) AS contrato_id,
    COALESCE(rl.classificacao_id, d.classificacao_id) AS classificacao_id,
    d.nome AS descricao,
    d.forma_pagamento,
    d.banco_id,
    NULL::int AS numero_parcela,
    NULL::int AS numero_parcelas,
    COALESCE(rl.valor, d.valor_aprovado, d.valor_total) AS valor,
    'saida'::text AS tipo,
    'malote'::text AS origem,
    CASE WHEN d.status = 'cancelada' THEN 'cancelado' ELSE 'aberto' END AS situacao_base
  FROM public.malote_despesa d
  LEFT JOIN public.malote_despesa_rateio_linha rl ON rl.despesa_id = d.id
  WHERE d.status IN ('aguardando_pagamento', 'ajuste_pagamento', 'cancelada')
    AND NOT d.parcelado AND d.deleted_at IS NULL AND d.data_pagamento IS NOT NULL

  UNION ALL

  SELECT
    d.id,
    d.numero,
    p.data_vencimento,
    d.competencia,
    COALESCE(rl.empresa_id, d.empresa_id),
    COALESCE(rl.contrato_id, d.contrato_id),
    COALESCE(rl.classificacao_id, d.classificacao_id),
    d.nome,
    d.forma_pagamento,
    COALESCE(p.banco_id, d.banco_id),
    p.numero_parcela,
    d.numero_parcelas,
    p.valor * COALESCE(rl.valor / NULLIF(d.valor_total, 0), 1),
    'saida'::text,
    'malote'::text,
    CASE WHEN d.status = 'cancelada' THEN 'cancelado' ELSE 'aberto' END
  FROM public.malote_despesa d
  JOIN public.malote_despesa_parcela p ON p.despesa_id = d.id AND p.status = 'pendente'
  LEFT JOIN public.malote_despesa_rateio_linha rl ON rl.despesa_id = d.id
  WHERE d.parcelado AND d.deleted_at IS NULL
    AND d.status IN ('aguardando_pagamento', 'ajuste_pagamento', 'cancelada')

  UNION ALL

  SELECT
    da.id,
    da.numero,
    COALESCE(da.data_pagamento, da.data_vencimento),
    da.competencia,
    da.empresa_id,
    da.contrato_id,
    da.classificacao_id,
    da.descricao,
    da.forma_pagamento,
    da.banco_id,
    da.numero_parcela,
    da.total_parcelas,
    da.valor,
    da.tipo,
    'debito_automatico'::text,
    'aberto'::text
  FROM public."DEBITO_AUTOMATICO" da
  WHERE da.status = 'pendente' AND da.deleted_at IS NULL
)
SELECT
  b.despesa_id,
  b.id_malote,
  b.data_prevista AS data_pagamento,
  b.competencia,
  b.empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  b.contrato_id,
  c.nome AS contrato_nome,
  b.classificacao_id,
  cl.nome AS classificacao_nome,
  b.descricao,
  b.forma_pagamento,
  b.banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  b.numero_parcela,
  b.numero_parcelas,
  b.valor,
  b.tipo,
  b.origem,
  false AS ajustado,
  b.situacao_base
FROM base b
LEFT JOIN public.empresas e ON e.id = b.empresa_id
LEFT JOIN public.contratos c ON c.id = b.contrato_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = b.classificacao_id
LEFT JOIN public.malote_cartao_banco cb ON cb.id = b.banco_id;

ALTER VIEW public.v_fluxo_caixa_previsto SET (security_invoker = true);
GRANT SELECT ON public.v_fluxo_caixa_previsto TO authenticated;


NOTIFY pgrst, 'reload schema';

-- ROLLBACK: reaplicar as definições anteriores
--   v_malote_pagamento_fluxo_caixa: 20260930000222_financeiro_fluxo_caixa_ajuste_valor.sql
--   v_fluxo_caixa_previsto:         20261014000003_fluxo_caixa_previsto.sql
--   NOTIFY pgrst, 'reload schema';
