-- [SEM-CHAMADO] Nova ação 'visao_completa' no enum app_acao (Controle de Faturamento: quem vê as abas Visão Geral e Visão Anual)
-- ============================================================================
-- Pedido do Ruan: dar a alguns supervisores só a aba "NFs Não Emitidas" do Controle de Faturamento. O modelo de acesso é aditivo
-- (deny-by-default), então a ação nova é "ver as abas completas": quem não a tem vê só as NFs Não Emitidas.
--
-- Só adiciona o valor do enum. O uso dele (catálogo e concessão a quem já usa a tela) fica na migration seguinte,
-- 20261109000400: um valor novo de enum não pode ser usado na mesma transação que o criou — mesmo desenho de
-- 20260930000252 (fundamentar) e 20260930000217 (ajuste_administrativo). Idempotente.
--
-- ROLLBACK: o Postgres não remove valor de enum; fica sem uso (o rollback real está na migration 20261109000400).

ALTER TYPE public.app_acao ADD VALUE IF NOT EXISTS 'visao_completa';

NOTIFY pgrst, 'reload schema';
