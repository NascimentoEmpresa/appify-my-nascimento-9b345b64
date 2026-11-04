-- ============================================================================
-- SIS-2026-0798 (parte 2) — lançamentos "histórico" da Conta Garantida
-- ============================================================================
-- O passado (jan/2026 em diante) já está no Fluxo de Caixa, vindo da planilha importada. Trazê-lo para a Conta Garantida (saldo, gráficos,
-- movimentações) sem criar uma segunda linha no Fluxo exige uma marca: movimento com historico = true conta na Conta Garantida e NÃO entra na
-- v_conta_garantida_fluxo_caixa. Lançamento novo feito pela tela nasce com historico = false (default), como antes.
--
-- Migration leve (1 coluna com default constante + view): pode rodar inteira.
--
-- ROLLBACK:
--   (recriar v_conta_garantida_fluxo_caixa de 20261104004000, sem o filtro NOT m.historico)
--   ALTER TABLE public.financeiro_conta_garantida_movimento DROP COLUMN IF EXISTS historico;
SET lock_timeout = '5s';

ALTER TABLE public.financeiro_conta_garantida_movimento
  ADD COLUMN IF NOT EXISTS historico boolean NOT NULL DEFAULT false;

CREATE OR REPLACE VIEW public.v_conta_garantida_fluxo_caixa AS
SELECT
  m.id AS despesa_id,
  m.numero AS id_malote,
  m.data_movimento AS data_pagamento,
  to_char(m.data_movimento, 'YYYY-MM-01')::date AS competencia,
  cg.empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  NULL::uuid AS contrato_id,
  NULL::text AS contrato_nome,
  m.classificacao_id,
  cl.nome AS classificacao_nome,
  (CASE m.tipo WHEN 'resgate' THEN 'Resgate de Conta Garantida' WHEN 'amortizacao' THEN 'Amortização de Conta Garantida' ELSE 'Juros de Conta Garantida' END
    || ' — ' || COALESCE(cb.nome, '') || ' ' || cg.conta
    || COALESCE(' · ' || NULLIF(btrim(m.observacao), ''), '')) AS descricao,
  NULL::text AS forma_pagamento,
  cg.banco_id AS banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  NULL::int AS numero_parcela,
  NULL::int AS numero_parcelas,
  m.valor AS valor,
  (CASE m.tipo WHEN 'resgate' THEN 'entrada' ELSE 'saida' END)::text AS tipo,
  'conta_garantida'::text AS origem,
  false AS ajustado
FROM public.financeiro_conta_garantida_movimento m
JOIN public.financeiro_conta_garantida cg ON cg.id = m.conta_garantida_id
LEFT JOIN public.empresas e ON e.id = cg.empresa_id
LEFT JOIN public.malote_cartao_banco cb ON cb.id = cg.banco_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = m.classificacao_id
WHERE m.cancelado_em IS NULL AND NOT m.historico;

ALTER VIEW public.v_conta_garantida_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_conta_garantida_fluxo_caixa TO authenticated;

NOTIFY pgrst, 'reload schema';
