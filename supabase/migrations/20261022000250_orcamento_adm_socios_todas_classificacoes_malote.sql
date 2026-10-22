-- SIS-2026-0702 (Iury): o novo Orçamento Administrativo / Sócios lista TODAS as Classificações Malote ativas, inclusive as de tipo
-- Contrato (13º INTEGRAL, ÁGUA CANAÃ…). A carga anterior (…000240) tinha deixado de fora as de contrato; esta completa o que faltou.
-- Idempotente: não mexe em linha que já exista.

INSERT INTO public.orcamento_adm_socios_linha (tipo, classificacao_malote_id)
SELECT t.tipo, c.id
  FROM public.planejamento_orcamentario_classificacao c
 CROSS JOIN (VALUES ('administrativo'), ('socios')) AS t(tipo)
 WHERE c.ativo
ON CONFLICT (tipo, classificacao_malote_id) DO NOTHING;

-- =====================================================================
-- ROLLBACK (só apaga o que ainda está zerado, sem configuração)
--   DELETE FROM public.orcamento_adm_socios_linha
--    WHERE percentual = 0 AND descricao = '' AND origem_classificacao_ids = '{}' AND valor_manual = 0;
-- =====================================================================
