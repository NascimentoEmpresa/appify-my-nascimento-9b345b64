-- SIS-2026-0702 (pedido do Iury): o novo Orçamento Administrativo / Sócios já nasce com TODAS as Classificações Administrativo ativas
-- (IPTU, cheque especial, água, aluguel…). Origem, descrição e % do orçamento ficam para o time preencher na tela.
-- Idempotente: não mexe em linha que já exista (quem já configurou uma classificação não perde nada).

INSERT INTO public.orcamento_adm_socios_linha (tipo, classificacao_administrativa_id)
SELECT t.tipo, c.id
  FROM public.malote_classificacao_administrativo c
 CROSS JOIN (VALUES ('administrativo'), ('socios')) AS t(tipo)
 WHERE c.ativo
ON CONFLICT (tipo, classificacao_administrativa_id) DO NOTHING;

-- =====================================================================
-- ROLLBACK (só apaga o que ainda está zerado, sem configuração)
--   DELETE FROM public.orcamento_adm_socios_linha
--    WHERE percentual = 0 AND descricao = '' AND origem_classificacao_ids = '{}' AND valor_manual = 0;
-- =====================================================================
