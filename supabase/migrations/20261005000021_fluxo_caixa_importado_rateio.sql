-- ============================================================================
-- Fluxo de Caixa — rateios da planilha importada (pedido do Iury, 05/10/2026)
-- ============================================================================
-- A carga da planilha (SIS-2026-0569) trouxe cada COTA de um rateio (Compras-N,
-- RH-N, Segurança-N) como uma linha solta, cada uma no seu contrato — o Fluxo
-- mostrava dezenas de linhas onde a planilha tem 1 lançamento rateado. Esta
-- migration só prepara o agrupamento:
--
--   1. fluxo_caixa_importado ganha o código do rateio e um id de grupo. O
--      script de carga (fora do repo) preenche essas colunas e ajusta valor/
--      data pelo lançamento principal (a aba "Fluxo de caixa" do Iury vale como
--      valor e data reais). O que ele alterar fica guardado em
--      rateio_valor_original / rateio_data_original (reversível).
--   2. A view passa a devolver as cotas do mesmo rateio com o MESMO despesa_id
--      (o id do grupo). A tela já agrupa por despesa_id e mostra "Rateio"
--      expansível (SIS-2026-0464/0537) — não precisa de mudança estrutural.
--   3. Valor de cota não é editável pelo ajuste (o ajuste é do grupo inteiro e
--      multiplicaria o total): nas linhas de rateio, o valor é sempre o da
--      cota. Os demais campos do ajuste (data, banco, forma...) valem p/ todas.
--
-- Nada muda para linhas sem rateio_grupo_id.
--
-- ROLLBACK:
--   (recriar a view com a definição de 20260930000283_fluxo_caixa_importado.sql)
--   UPDATE public.fluxo_caixa_importado
--      SET valor = COALESCE(rateio_valor_original, valor),
--          data_pagamento = COALESCE(rateio_data_original, data_pagamento)
--    WHERE rateio_grupo_id IS NOT NULL;
--   ALTER TABLE public.fluxo_caixa_importado
--     DROP COLUMN rateio_codigo, DROP COLUMN rateio_grupo_id,
--     DROP COLUMN rateio_valor_original, DROP COLUMN rateio_data_original;
--   NOTIFY pgrst, 'reload schema';

ALTER TABLE public.fluxo_caixa_importado
  ADD COLUMN IF NOT EXISTS rateio_codigo          text,
  ADD COLUMN IF NOT EXISTS rateio_grupo_id        uuid,
  ADD COLUMN IF NOT EXISTS rateio_valor_original  numeric(14,2),
  ADD COLUMN IF NOT EXISTS rateio_data_original   date;

CREATE INDEX IF NOT EXISTS idx_fluxo_caixa_importado_rateio_grupo
  ON public.fluxo_caixa_importado (rateio_grupo_id)
  WHERE rateio_grupo_id IS NOT NULL;

CREATE OR REPLACE VIEW public.v_fluxo_caixa_importado_fluxo_caixa AS
SELECT
  COALESCE(fi.rateio_grupo_id, fi.id) AS despesa_id,
  COALESCE(fi.rateio_codigo, fi.planilha_id_original, 'IMP-' || lpad(fi.planilha_linha::text, 5, '0')) AS id_malote,
  COALESCE(aj.data_pagamento, fi.data_pagamento) AS data_pagamento,
  COALESCE(aj.competencia, fi.competencia) AS competencia,
  COALESCE(aj.empresa_id, fi.empresa_id) AS empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  fi.contrato_id,
  -- Contrato não cadastrado (ex.: "ADMINISTRATIVO") aparece pelo texto da
  -- planilha dentro do rateio, em vez de sumir da abertura.
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
    fi.observacao_importacao
  ), '') AS inconsistencia
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
