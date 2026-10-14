-- SIS-2026-0611: Fluxo de Caixa Projetado. Compromissos que ainda NÃO aconteceram (previstos),
-- no mesmo formato das views do Fluxo realizado, para a aba "Projetado" da tela.
--
-- Fontes (só leitura, nada é gravado nem copiado):
--   1. Malote não parcelado: despesa aprovada aguardando pagamento (aguardando_pagamento /
--      ajuste_pagamento), na data de pagamento prevista.
--   2. Malote parcelado: parcelas ainda 'pendente' dessas despesas, no vencimento da parcela.
--   3. Débito Automático com status 'pendente' (inclui as parcelas futuras), na data prevista.
--   4. Malote cancelado (despesa e parcelas pendentes) com situacao_base = 'cancelado': a tela só
--      mostra no filtro "Cancelado" e não soma nos totais.
-- Ficam de fora: despesas em aprovação, reprovadas, rascunho, sem data e as da lixeira.
--
-- Quando o pagamento é confirmado, a despesa/parcela/débito muda de status e passa a vir pelas
-- views do Realizado (v_malote_pagamento_fluxo_caixa etc.) — é o mesmo registro, então sai daqui
-- e entra lá sem duplicar. A situação (vencido / a vencer / previsto) é calculada na tela a
-- partir da data prevista; aqui só vai a situação-base ('aberto' | 'cancelado').
--
-- Migration leve (só cria uma view): pode rodar inteira de uma vez no SQL Editor.

CREATE OR REPLACE VIEW public.v_fluxo_caixa_previsto AS
WITH base AS (
  SELECT
    d.id AS despesa_id,
    d.numero AS id_malote,
    d.data_pagamento AS data_prevista,
    d.competencia,
    COALESCE(rl.empresa_id, d.empresa_id) AS empresa_id,
    COALESCE(rl.contrato_id, d.contrato_id) AS contrato_id,
    d.classificacao_id,
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
    d.classificacao_id,
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

-- ROLLBACK:
--   DROP VIEW IF EXISTS public.v_fluxo_caixa_previsto;
--   NOTIFY pgrst, 'reload schema';
