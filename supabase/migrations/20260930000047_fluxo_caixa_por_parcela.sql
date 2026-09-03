-- SIS-2026-0254 (Iury): "Lançamentos recebidos do Fluxo de Caixa" (Cartão
-- de Crédito) ganha coluna de parcela ("qual parcela está sendo paga" + nº
-- total de parcelas) + filtro de período na Data.
--
-- Achado explorando o código antes de implementar: pra "qual parcela"
-- fazer sentido de verdade, a view v_malote_pagamento_fluxo_caixa precisa
-- parar de tratar despesa parcelada como 1 evento só. Hoje ela só aparece
-- (WHERE status = 'despesa_paga') quando a ÚLTIMA parcela é paga, com o
-- VALOR TOTAL da despesa inteira na data da última parcela — uma despesa
-- de 4 parcelas pagas em 4 meses diferentes vira 1 lançamento só, no mês
-- da 4ª parcela, pelo valor cheio. Isso não é só "falta uma coluna": é uma
-- distorção real no Fluxo de Caixa e na Fatura do Mês de cada cartão
-- (calcularUtilizadoEFatura em CartaoCredito.tsx já usa esta mesma view).
--
-- Confirmado com o usuário antes de mexer (pedido explícito, não decisão
-- unilateral): virar 1 linha por PARCELA PAGA (mesmo padrão que Aprovações/
-- Meus Itens/Pagamento Malote já usam pra explodir despesa parcelada), cada
-- uma com a data e o valor REAIS daquela parcela. Despesa não parcelada
-- continua exatamente como está (1 linha, ao ficar despesa_paga).

-- ── 1. Policy de leitura em malote_despesa_parcela pra bater com
-- malote_despesa ────────────────────────────────────────────────────────
-- malote_parcela_all (20260830000001) é bem mais estreita que
-- malote_despesa_select hoje (criador/admin/supervisor por
-- cargo/mesma empresa — sem o OR de malote_pagamento:aprovar que já
-- existe na despesa). Com security_invoker=true na view, quem hoje já vê
-- o lançamento despesa-level (Financeiro, via malote_pagamento:aprovar)
-- ficaria sem ver as linhas novas por parcela. Policy ADITIVA (soma com a
-- existente, não substitui): "pode ler a parcela se pode ler a despesa
-- dona dela" — delega pra malote_despesa_select em vez de duplicar a
-- lista de condições (RLS do Postgres já aplica a policy de malote_despesa
-- dentro do EXISTS abaixo).
CREATE POLICY malote_parcela_select_despesa_visivel ON public.malote_despesa_parcela
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = despesa_id));

-- ── 2. View reescrita: UNION de (despesa não parcelada, como já era) +
-- (1 linha por parcela paga, despesa parcelada) ─────────────────────────
-- Peso por rateio: quando a despesa tem Rateio multi-contrato, cada linha
-- do rateio representa uma fração do valor_total (rl.valor / d.valor_total)
-- — aplicado sobre o valor REAL da parcela (p.valor), não sobre o valor
-- cheio da despesa, pra cada combinação (parcela × linha) ficar com o
-- valor certo e a soma de tudo continuar batendo com o total pago.
-- Despesa sem rateio (rl null via LEFT JOIN) usa o valor da parcela direto
-- (peso 1).
DROP VIEW IF EXISTS public.v_malote_pagamento_fluxo_caixa;
CREATE VIEW public.v_malote_pagamento_fluxo_caixa AS
SELECT
  d.id AS despesa_id,
  d.numero AS id_malote,
  d.data_pagamento,
  d.competencia,
  COALESCE(rl.empresa_id, d.empresa_id) AS empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  COALESCE(rl.contrato_id, d.contrato_id) AS contrato_id,
  c.nome AS contrato_nome,
  d.classificacao_id,
  cl.nome AS classificacao_nome,
  d.nome AS descricao,
  d.forma_pagamento,
  d.banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  NULL::int AS numero_parcela,
  NULL::int AS numero_parcelas,
  COALESCE(rl.valor, d.valor_aprovado) AS valor,
  'saida'::text AS tipo
FROM public.malote_despesa d
LEFT JOIN public.malote_despesa_rateio_linha rl ON rl.despesa_id = d.id
LEFT JOIN public.empresas e ON e.id = COALESCE(rl.empresa_id, d.empresa_id)
LEFT JOIN public.contratos c ON c.id = COALESCE(rl.contrato_id, d.contrato_id)
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = d.classificacao_id
LEFT JOIN public.malote_cartao_banco cb ON cb.id = d.banco_id
WHERE d.status = 'despesa_paga' AND NOT d.parcelado

UNION ALL

SELECT
  d.id AS despesa_id,
  d.numero AS id_malote,
  p.data_pagamento_real AS data_pagamento,
  d.competencia,
  COALESCE(rl.empresa_id, d.empresa_id) AS empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  COALESCE(rl.contrato_id, d.contrato_id) AS contrato_id,
  c.nome AS contrato_nome,
  d.classificacao_id,
  cl.nome AS classificacao_nome,
  d.nome AS descricao,
  d.forma_pagamento,
  p.banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  p.numero_parcela,
  d.numero_parcelas,
  p.valor * COALESCE(rl.valor / NULLIF(d.valor_total, 0), 1) AS valor,
  'saida'::text AS tipo
FROM public.malote_despesa d
JOIN public.malote_despesa_parcela p ON p.despesa_id = d.id AND p.status = 'paga'
LEFT JOIN public.malote_despesa_rateio_linha rl ON rl.despesa_id = d.id
LEFT JOIN public.empresas e ON e.id = COALESCE(rl.empresa_id, d.empresa_id)
LEFT JOIN public.contratos c ON c.id = COALESCE(rl.contrato_id, d.contrato_id)
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = d.classificacao_id
LEFT JOIN public.malote_cartao_banco cb ON cb.id = p.banco_id
WHERE d.parcelado;

ALTER VIEW public.v_malote_pagamento_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_malote_pagamento_fluxo_caixa TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP POLICY IF EXISTS malote_parcela_select_despesa_visivel ON public.malote_despesa_parcela;
--   DROP VIEW IF EXISTS public.v_malote_pagamento_fluxo_caixa;
--   -- (recriar com o corpo de 20260930000039_malote_pagamento_banco.sql,
--   -- sem numero_parcela/numero_parcelas e sem a metade "parcelada" do UNION)
--   ALTER VIEW public.v_malote_pagamento_fluxo_caixa SET (security_invoker = true);
--   GRANT SELECT ON public.v_malote_pagamento_fluxo_caixa TO authenticated;
-- =====================================================================
