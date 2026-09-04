-- SIS-2026-0256: view de leitura pra listagem do Débito Automático — resolve
-- empresa/contrato/classificação sem join no client (mesmo padrão de
-- v_malote_pagamento_fluxo_caixa/v_debito_automatico_fluxo_caixa, mas sem
-- filtro de status: aqui entram pendente e pago, é a fonte da tela
-- /app/financeiro/gestao-financeira/debito-automatico, não do Fluxo de Caixa).
CREATE VIEW public.v_debito_automatico_lista AS
SELECT
  d.id,
  d.numero,
  d.tipo_origem,
  d.tipo,
  d.data_pagamento,
  d.competencia,
  d.empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  d.contrato_id,
  c.nome AS contrato_nome,
  d.classificacao_id,
  cl.nome AS classificacao_nome,
  d.descricao,
  d.forma_pagamento,
  d.valor,
  d.status,
  d.movimentacao_par_id,
  d.created_by,
  d.created_at,
  d.updated_by,
  d.updated_at
FROM public."DEBITO_AUTOMATICO" d
LEFT JOIN public.empresas e ON e.id = d.empresa_id
LEFT JOIN public.contratos c ON c.id = d.contrato_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = d.classificacao_id;

ALTER VIEW public.v_debito_automatico_lista SET (security_invoker = true);
GRANT SELECT ON public.v_debito_automatico_lista TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP VIEW IF EXISTS public.v_debito_automatico_lista;
-- =====================================================================
