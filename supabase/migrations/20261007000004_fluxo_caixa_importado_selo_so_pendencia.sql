-- ============================================================================
-- Fluxo de Caixa — selo "revisar" só para pendência de verdade
-- ============================================================================
-- A view da importação concatenava SEMPRE fi.observacao_importacao no motivo do
-- selo. Só que esse campo também guarda anotação de auditoria das cargas
-- ("Carga complementar…", "Reabilitada em…"): 1.240 linhas ganharam selo
-- vermelho sem ter pendência nenhuma, e o filtro "só revisar" ficou inútil.
--
-- Agora a observação só vira motivo quando exige ação:
--   • conferencia = 'possivel_duplicidade'  (decidir se é duplicada)
--   • "Rateio … sem cotas…"                 (aguardando a divisão do Iury)
-- As anotações de carga continuam gravadas, só não geram selo.
-- Mesmas colunas e mesma ordem da definição de 20261006000002.
--
-- ROLLBACK:
--   (recriar a view com a definição de 20261006000002_fluxo_caixa_importado_linha_id.sql)
--   NOTIFY pgrst, 'reload schema';

CREATE OR REPLACE VIEW public.v_fluxo_caixa_importado_fluxo_caixa AS
SELECT
  COALESCE(fi.rateio_grupo_id, fi.id) AS despesa_id,
  COALESCE(fi.rateio_codigo, fi.planilha_id_original, 'IMP-' || lpad(fi.planilha_linha::text, 5, '0')) AS id_malote,
  COALESCE(aj.data_pagamento, fi.data_pagamento) AS data_pagamento,
  COALESCE(aj.competencia, fi.competencia) AS competencia,
  COALESCE(aj.empresa_id, fi.empresa_id) AS empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  fi.contrato_id,
  COALESCE(c.nome, CASE WHEN fi.rateio_grupo_id IS NOT NULL THEN NULLIF(fi.contrato_texto, '') END) AS contrato_nome,
  COALESCE(aj.classificacao_id, fi.classificacao_id) AS classificacao_id,
  cl.nome AS classificacao_nome,
  COALESCE(aj.descricao, fi.descricao) AS descricao,
  COALESCE(aj.forma_pagamento, fi.forma_pagamento) AS forma_pagamento,
  COALESCE(aj.banco_id, fi.banco_id) AS banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  NULL::int AS numero_parcela,
  NULL::int AS numero_parcelas,
  CASE WHEN fi.rateio_grupo_id IS NOT NULL THEN fi.valor ELSE COALESCE(aj.valor, fi.valor) END AS valor,
  COALESCE(aj.tipo, fi.tipo) AS tipo,
  'importacao_historica'::text AS origem,
  (aj.id IS NOT NULL) AS ajustado,
  NULLIF(concat_ws(' · ',
    CASE WHEN fi.contrato_id IS NULL AND fi.rateio_grupo_id IS NULL
      THEN 'Contrato não mapeado (planilha: ' || COALESCE(NULLIF(fi.contrato_texto, ''), '—') || ')' END,
    CASE WHEN COALESCE(aj.classificacao_id, fi.classificacao_id) IS NULL
      THEN 'Classificação não mapeada (planilha: ' || COALESCE(NULLIF(fi.classificacao_texto, ''), '—') || ')' END,
    CASE WHEN fi.conferencia = 'possivel_duplicidade' OR fi.observacao_importacao LIKE 'Rateio % sem cotas%'
      THEN fi.observacao_importacao END
  ), '') AS inconsistencia,
  fi.id AS linha_id
FROM public.fluxo_caixa_importado fi
LEFT JOIN public.financeiro_fluxo_caixa_ajuste aj
  ON aj.origem = 'importacao_historica' AND aj.despesa_id = COALESCE(fi.rateio_grupo_id, fi.id) AND aj.numero_parcela IS NULL
LEFT JOIN public.empresas e ON e.id = COALESCE(aj.empresa_id, fi.empresa_id)
LEFT JOIN public.contratos c ON c.id = fi.contrato_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = COALESCE(aj.classificacao_id, fi.classificacao_id)
LEFT JOIN public.malote_cartao_banco cb ON cb.id = COALESCE(aj.banco_id, fi.banco_id)
WHERE fi.deleted_at IS NULL AND fi.conferencia <> 'ja_existe_no_erp';

ALTER VIEW public.v_fluxo_caixa_importado_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_fluxo_caixa_importado_fluxo_caixa TO authenticated;

NOTIFY pgrst, 'reload schema';
