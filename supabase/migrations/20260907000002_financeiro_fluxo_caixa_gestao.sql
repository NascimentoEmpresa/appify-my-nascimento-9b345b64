-- SIS-2026-0160: início do Fluxo de Caixa (Financeiro > Gestão Financeira),
-- consumindo a view v_malote_pagamento_fluxo_caixa criada em
-- 20260907000001_malote_pagamento.sql.
--
-- 1. Reescreve a view pra já entregar os nomes prontos (empresa/contrato/
--    classificação) — evita a tela ter que fazer 3 joins client-side pra
--    algo que só serve de leitura.
-- 2. Registra a tela nova em app_menu, dentro do módulo Financeiro (mesmo
--    padrão de relatorio-servicos: sem grant explícito de perfil_acesso_
--    permissao, porque concede_tudo já libera por hierarquia — ver
--    20260717200003_rewrite_gate_functions_perfil_acesso.sql).
--
-- Nota: a permissão de VER a tela (app_menu) é independente da permissão
-- de VER os dados (RLS de malote_despesa, já resolvida em
-- 20260907000001 via 'malote_pagamento'/'aprovar'). Quem tem acesso à
-- tela mas não a essa permissão simplesmente vê a lista vazia — esperado
-- por enquanto, dado que ainda não existe outra fonte de dado.

-- CREATE OR REPLACE exige manter a ordem das colunas já existentes; como
-- os nomes novos entram entre colunas antigas, precisa recriar do zero.
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
  COALESCE(rl.valor, d.valor_aprovado) AS valor,
  'saida'::text AS tipo
FROM public.malote_despesa d
LEFT JOIN public.malote_despesa_rateio_linha rl ON rl.despesa_id = d.id
LEFT JOIN public.empresas e ON e.id = COALESCE(rl.empresa_id, d.empresa_id)
LEFT JOIN public.contratos c ON c.id = COALESCE(rl.contrato_id, d.contrato_id)
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = d.classificacao_id
WHERE d.status = 'despesa_paga';

ALTER VIEW public.v_malote_pagamento_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_malote_pagamento_fluxo_caixa TO authenticated;

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'financeiro-fluxo-caixa-gestao', 'Financeiro — Fluxo de Caixa (Gestão)', '/app/financeiro/gestao-financeira/fluxo-caixa', 33
FROM public.app_modulo m
WHERE m.codigo = 'financeiro'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DELETE FROM public.app_menu WHERE codigo = 'financeiro-fluxo-caixa-gestao';
--   (recriar a view na forma anterior, sem os joins de nome, ver 20260907000001)
-- =====================================================================
