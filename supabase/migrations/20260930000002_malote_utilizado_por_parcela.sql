-- SIS-2026-0223 (complemento, pedido do Iury): despesa parcelada estava
-- jogando o valor CHEIO em v_malote_utilizado_orcamento no mês de
-- despesa.competencia — errado, cada parcela deveria consumir o orçamento
-- do seu próprio mês de vencimento. Alinhado com o Iury: só a parcela 1
-- decide a alçada de aprovação (se ela estourar, escala N1->N2->N3; as
-- parcelas seguintes não são checadas de novo, o aprovador só precisa ter
-- ciência de que aprovar a despesa aprova todas as parcelas de uma vez —
-- já resolvido pelo modal de confirmação do 0223).
--
-- Despesa não parcelada: comportamento idêntico ao de antes. Despesa
-- parcelada: gera N linhas por parcela (rateio-linha x parcela, ou a
-- despesa x parcela se não tiver rateio), com competencia = mês da
-- parcela.data_vencimento e valor = valor da linha (ou da despesa) x
-- (parcela.valor / despesa.valor_total) — mesma fração que gerarParcelas
-- já usa em useMaloteDespesa.ts.
DROP VIEW IF EXISTS public.v_malote_utilizado_orcamento;
CREATE VIEW public.v_malote_utilizado_orcamento AS
SELECT
  d.id AS despesa_id,
  d.numero AS id_malote,
  d.nome AS descricao,
  d.status,
  CASE WHEN d.parcelado THEN date_trunc('month', p.data_vencimento)::date ELSE d.competencia END AS competencia,
  d.data_pagamento,
  d.forma_pagamento,
  d.classificacao_id,
  cl.nome AS classificacao_nome,
  COALESCE(rl.empresa_id, d.empresa_id) AS empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  COALESCE(rl.contrato_id, d.contrato_id) AS contrato_id,
  c.nome AS contrato_nome,
  CASE
    WHEN d.parcelado THEN COALESCE(rl.valor, d.valor_aprovado, d.valor_total) * (p.valor / NULLIF(d.valor_total, 0))
    ELSE COALESCE(rl.valor, d.valor_aprovado, d.valor_total)
  END AS valor
FROM public.malote_despesa d
LEFT JOIN public.malote_despesa_rateio_linha rl ON rl.despesa_id = d.id
LEFT JOIN public.malote_despesa_parcela p ON d.parcelado AND p.despesa_id = d.id
LEFT JOIN public.empresas e ON e.id = COALESCE(rl.empresa_id, d.empresa_id)
LEFT JOIN public.contratos c ON c.id = COALESCE(rl.contrato_id, d.contrato_id)
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = d.classificacao_id
WHERE d.status IN ('aguardando_pagamento', 'despesa_paga')
  AND (NOT d.parcelado OR p.id IS NOT NULL);

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP VIEW public.v_malote_utilizado_orcamento;
--   CREATE VIEW public.v_malote_utilizado_orcamento AS
--   SELECT d.id AS despesa_id, d.numero AS id_malote, d.nome AS descricao, d.status,
--          d.competencia, d.data_pagamento, d.forma_pagamento, d.classificacao_id,
--          cl.nome AS classificacao_nome,
--          COALESCE(rl.empresa_id, d.empresa_id) AS empresa_id,
--          COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
--          COALESCE(rl.contrato_id, d.contrato_id) AS contrato_id, c.nome AS contrato_nome,
--          COALESCE(rl.valor, d.valor_aprovado, d.valor_total) AS valor
--     FROM public.malote_despesa d
--     LEFT JOIN public.malote_despesa_rateio_linha rl ON rl.despesa_id = d.id
--     LEFT JOIN public.empresas e ON e.id = COALESCE(rl.empresa_id, d.empresa_id)
--     LEFT JOIN public.contratos c ON c.id = COALESCE(rl.contrato_id, d.contrato_id)
--     LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = d.classificacao_id
--    WHERE d.status IN ('aguardando_pagamento', 'despesa_paga');
