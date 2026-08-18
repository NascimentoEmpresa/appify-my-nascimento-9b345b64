-- SIS-2026-0168: Orçamento Geral passa a comparar Orçado x Utilizado por
-- Classificação/Contrato/período — "Utilizado" vem dos lançamentos reais
-- do Malote (status Aguardando Pagamento ou Despesa Paga), não mais do
-- valor Executado da Planilha de Custo.
--
-- Mesmo padrão de view "hand-off" de v_malote_pagamento_fluxo_caixa
-- (20260907000002), mas: (1) inclui 'aguardando_pagamento' além de
-- 'despesa_paga' — a regra do Anexo 1 pede as duas; (2) traz
-- descricao/status/forma_pagamento, que a tabela "Itens Lançados" do
-- Detalhe Orçamento (Anexo 4) precisa exibir por linha.
CREATE OR REPLACE VIEW public.v_malote_utilizado_orcamento AS
SELECT
  d.id AS despesa_id,
  d.numero AS id_malote,
  d.nome AS descricao,
  d.status,
  d.competencia,
  d.data_pagamento,
  d.forma_pagamento,
  d.classificacao_id,
  cl.nome AS classificacao_nome,
  COALESCE(rl.empresa_id, d.empresa_id) AS empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  COALESCE(rl.contrato_id, d.contrato_id) AS contrato_id,
  c.nome AS contrato_nome,
  COALESCE(rl.valor, d.valor_aprovado, d.valor_total) AS valor
FROM public.malote_despesa d
LEFT JOIN public.malote_despesa_rateio_linha rl ON rl.despesa_id = d.id
LEFT JOIN public.empresas e ON e.id = COALESCE(rl.empresa_id, d.empresa_id)
LEFT JOIN public.contratos c ON c.id = COALESCE(rl.contrato_id, d.contrato_id)
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = d.classificacao_id
WHERE d.status IN ('aguardando_pagamento', 'despesa_paga');

ALTER VIEW public.v_malote_utilizado_orcamento SET (security_invoker = true);
GRANT SELECT ON public.v_malote_utilizado_orcamento TO authenticated;

-- Tela nova "Detalhe Orçamento" (Anexo 4) — alcançada só pelo botão "Ver
-- detalhes" do Orçamento Geral (sem item na sidebar), mas ainda precisa
-- estar no gerenciador de acesso, mesmo padrão fechado-por-padrão de
-- 20260901000005_malote_classificacao_orcamento_menus.sql.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'malote_detalhe_orcamento', 'Malote — Detalhe Orçamento', '/app/malote/detalhe-orcamento', 25
FROM public.app_modulo m
WHERE m.codigo = 'malote'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'malote_detalhe_orcamento', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
    ('visualizar'::public.app_acao),
    ('incluir'::public.app_acao),
    ('alterar'::public.app_acao),
    ('excluir'::public.app_acao)
 ) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP VIEW IF EXISTS public.v_malote_utilizado_orcamento;
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'malote_detalhe_orcamento';
--   DELETE FROM public.app_menu WHERE codigo = 'malote_detalhe_orcamento';
-- =====================================================================
