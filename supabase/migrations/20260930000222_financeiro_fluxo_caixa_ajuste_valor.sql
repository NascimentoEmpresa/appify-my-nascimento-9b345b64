-- SIS-2026-0492 (Iury): a conciliação nova precisa poder corrigir o
-- VALOR de um lançamento do Fluxo de Caixa quando a divergência é isso
-- ("valores a mais ou até mesmo correções, poder agir a partir deles") —
-- a tabela de ajuste criada na 20260930000212 (SIS-2026-0489) cobria Data
-- de Pagamento/Tipo/Classificação/Descrição/Competência/Empresa/Banco/
-- Forma de Pagamento, mas não tinha campo pra sobrescrever o valor (não
-- fazia parte do pedido daquele chamado). Migration append-only (R4) —
-- não dá pra editar a 20260930000212, então isso vem como ALTER +
-- CREATE OR REPLACE das mesmas 3 views, só acrescentando
-- COALESCE(aj.valor, original) no campo que já existia.

ALTER TABLE public.financeiro_fluxo_caixa_ajuste ADD COLUMN IF NOT EXISTS valor numeric;

CREATE OR REPLACE VIEW public.v_malote_pagamento_fluxo_caixa AS
WITH base AS (
  SELECT
    d.id AS despesa_id,
    d.numero AS id_malote,
    d.data_pagamento AS data_pagamento_orig,
    d.competencia AS competencia_orig,
    COALESCE(rl.empresa_id, d.empresa_id) AS empresa_id_orig,
    COALESCE(rl.contrato_id, d.contrato_id) AS contrato_id,
    d.classificacao_id AS classificacao_id_orig,
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
    d.classificacao_id AS classificacao_id_orig,
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
WHERE d.status = 'pago' AND d.deleted_at IS NULL;

ALTER VIEW public.v_debito_automatico_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_debito_automatico_fluxo_caixa TO authenticated;

CREATE OR REPLACE VIEW public.v_cartao_fatura_fluxo_caixa AS
SELECT
  fi.id AS despesa_id,
  cc.nome_cartao || ' — ' || to_char(f.competencia, 'MM/YYYY') AS id_malote,
  COALESCE(aj.data_pagamento, fi.data_compra) AS data_pagamento,
  COALESCE(aj.competencia, f.competencia) AS competencia,
  COALESCE(aj.empresa_id, cc.empresa_id) AS empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  NULL::uuid AS contrato_id,
  NULL::text AS contrato_nome,
  aj.classificacao_id AS classificacao_id,
  COALESCE(cl.nome, 'Cartão de Crédito'::text) AS classificacao_nome,
  COALESCE(aj.descricao, fi.descricao) AS descricao,
  COALESCE(aj.forma_pagamento, cc.tipo_forma_pagamento) AS forma_pagamento,
  COALESCE(aj.banco_id, cc.banco_id) AS banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  fi.parcela_atual AS numero_parcela,
  fi.parcela_total AS numero_parcelas,
  COALESCE(aj.valor, fi.valor) AS valor,
  COALESCE(aj.tipo, 'saida'::text) AS tipo,
  'cartao_fatura'::text AS origem,
  (aj.id IS NOT NULL) AS ajustado
FROM public.malote_cartao_fatura_item fi
JOIN public.malote_cartao_fatura f ON f.id = fi.fatura_id
JOIN public.malote_cartao_credito cc ON cc.id = f.cartao_id
LEFT JOIN public.financeiro_fluxo_caixa_ajuste aj
  ON aj.origem = 'cartao_fatura' AND aj.despesa_id = fi.id
 AND aj.numero_parcela IS NOT DISTINCT FROM fi.parcela_atual
LEFT JOIN public.empresas e ON e.id = COALESCE(aj.empresa_id, cc.empresa_id)
LEFT JOIN public.malote_cartao_banco cb ON cb.id = COALESCE(aj.banco_id, cc.banco_id)
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = aj.classificacao_id
WHERE fi.status = 'confirmado' AND fi.deleted_at IS NULL;

ALTER VIEW public.v_cartao_fatura_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_cartao_fatura_fluxo_caixa TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
--   (recriar as 3 views com o corpo exato da 20260930000212, sem
--   COALESCE(aj.valor, ...))
--   ALTER TABLE public.financeiro_fluxo_caixa_ajuste DROP COLUMN IF EXISTS valor;
