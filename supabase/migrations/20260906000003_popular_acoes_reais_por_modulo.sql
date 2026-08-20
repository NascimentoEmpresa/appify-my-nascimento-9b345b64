-- Conclui o conserto do gerenciamento de acesso: concede aos 20 perfis por
-- módulo as AÇÕES DE ESCRITA que o código já exige (incluir/alterar/excluir/
-- aprovar), complementando a 20260906000001 que só concedeu "visualizar".
--
-- Sem isto, quem tem o perfil do módulo enxerga as telas mas apanha do
-- servidor na hora de agir — foi por isso que se recorreu a "Administrador
-- Geral" pra usuário final conseguir trabalhar.
--
-- COMO A LISTA FOI MONTADA (3 fontes, nada inventado):
--   1. RLS policies  — regex sobre pg_policies                      → 130 pares
--   2. Corpo das funções — regex sobre pg_get_functiondef            →  49 pares
--   3. Frontend — chamadas can("<ação>", …, "<menu>") em src/        →  31 pares
-- União: 177 pares únicos (menu, ação) → 108 grants faltando em 16 módulos.
--
-- A fonte (2) é a que uma versão anterior desta migration perdeu: o regex
-- exigia os casts ::text/::app_acao, que aparecem nas policies mas NÃO no
-- corpo das funções PL/pgSQL. Era justamente onde moram as ações de domínio
-- (sup_cot_responder, cotacao_fechar, programacao_decidir, malote_pode_pagar,
-- sup_est_entrada/baixar/inventario, nota_fiscal_emitir/autorizar/cancelar…),
-- e também o motivo de Fiscal e Plano de Ações terem sido descartados por
-- engano como "módulos sem ações".
--
-- DUAS EXCLUSÕES DELIBERADAS — pares que parecem permissão mas são sentinela
-- interna, e conceder seria dar acesso demais:
--   • presidencia|excluir      → em pres_caixa_status é v_bypass_tenant:
--                                 VER DADOS DE TODAS AS EMPRESAS. Concedido ao
--                                 perfil Licitações (onde o menu mora), furaria
--                                 o isolamento entre empresas.
--   • plano_acoes_lista|excluir → em plano_acao_can_access /
--                                 plano_acao_visible_by_user faz RETURN true /
--                                 RETURN v_all: "vê todos os planos", não
--                                 "pode excluir".
--
-- ROLLBACK:
-- DELETE FROM public.perfil_acesso_permissao pap
--  USING public.perfil_acesso pa, public.app_modulo mo, public.app_menu am
--  WHERE pap.perfil_id = pa.id AND pa.nome = mo.nome
--    AND am.modulo_id = mo.id AND am.codigo = pap.menu_codigo
--    AND pap.acao <> 'visualizar';

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, v.menu_codigo, v.acao::app_acao, true
FROM public.perfil_acesso pa
JOIN (VALUES
  ('Administração', 'administracao', 'alterar'),
  ('Administração', 'administracao', 'aprovar'),
  ('Administração', 'administracao', 'excluir'),
  ('Administração', 'administracao', 'incluir'),
  ('Administração', 'integracao', 'alterar'),
  ('Administração', 'integracao', 'excluir'),
  ('Administração', 'integracao', 'incluir'),
  ('Administração', 'integracao-aliases', 'alterar'),
  ('Central de Serviços', 'central_servicos_formularios', 'alterar'),
  ('Comitê de Ética', 'central_servicos_denuncias', 'alterar'),
  ('Contábil', 'avancada', 'alterar'),
  ('Contábil', 'avancada', 'excluir'),
  ('Contábil', 'avancada', 'incluir'),
  ('Contábil', 'contabil_regras_contabilizacao', 'alterar'),
  ('Contábil', 'lancamentos', 'alterar'),
  ('Contábil', 'lancamentos', 'excluir'),
  ('Contábil', 'plano-contas', 'incluir'),
  ('Contratos', 'ativos', 'alterar'),
  ('Contratos', 'ativos', 'excluir'),
  ('Contratos', 'ativos', 'incluir'),
  ('Contratos', 'empenhos', 'alterar'),
  ('Contratos', 'implantacao', 'alterar'),
  ('Contratos', 'implantacao', 'excluir'),
  ('Contratos', 'implantacao', 'incluir'),
  ('Contratos', 'postos', 'alterar'),
  ('Contratos', 'reajustes', 'alterar'),
  ('Contratos', 'reajustes', 'excluir'),
  ('Contratos', 'reajustes', 'incluir'),
  ('Controladoria & Orçamento', 'cc', 'alterar'),
  ('Controladoria & Orçamento', 'cc', 'excluir'),
  ('Controladoria & Orçamento', 'cc', 'incluir'),
  ('Controladoria & Orçamento', 'classificadores', 'alterar'),
  ('Controladoria & Orçamento', 'classificadores', 'excluir'),
  ('Controladoria & Orçamento', 'classificadores', 'incluir'),
  ('Controladoria & Orçamento', 'dre', 'alterar'),
  ('Controladoria & Orçamento', 'dre', 'excluir'),
  ('Controladoria & Orçamento', 'dre', 'incluir'),
  ('Controladoria & Orçamento', 'empresas', 'alterar'),
  ('Controladoria & Orçamento', 'empresas', 'excluir'),
  ('Controladoria & Orçamento', 'empresas', 'incluir'),
  ('Controladoria & Orçamento', 'obz-versoes', 'alterar'),
  ('Controladoria & Orçamento', 'obz-versoes', 'incluir'),
  ('Controladoria & Orçamento', 'orcamento', 'alterar'),
  ('Controladoria & Orçamento', 'orcamento', 'excluir'),
  ('Controladoria & Orçamento', 'orcamento', 'incluir'),
  ('Encarregados', 'encarregados_solicitar_materiais', 'incluir'),
  ('Financeiro', 'cobrancas', 'alterar'),
  ('Financeiro', 'cobrancas', 'aprovar'),
  ('Financeiro', 'conciliacao-bancaria', 'alterar'),
  ('Financeiro', 'contas-pagar', 'alterar'),
  ('Financeiro', 'contas-pagar', 'aprovar'),
  ('Financeiro', 'contas-pagar', 'incluir'),
  ('Financeiro', 'contas-receber', 'alterar'),
  ('Financeiro', 'contas-receber', 'incluir'),
  ('Financeiro', 'fluxo', 'alterar'),
  ('Financeiro', 'integracao-bancaria', 'alterar'),
  ('Financeiro', 'integracao-bancaria', 'aprovar'),
  ('Financeiro', 'nf-emissao', 'excluir'),
  ('Financeiro', 'nf-emissao', 'incluir'),
  ('Financeiro', 'programacao', 'alterar'),
  ('Financeiro', 'programacao', 'aprovar'),
  ('Financeiro', 'programacao', 'excluir'),
  ('Financeiro', 'programacao', 'incluir'),
  ('Financeiro', 'validacao', 'alterar'),
  ('Financeiro', 'validacao', 'aprovar'),
  ('Financeiro', 'validacao', 'incluir'),
  ('Fiscal', 'fiscal-principal', 'alterar'),
  ('Fiscal', 'fiscal-principal', 'incluir'),
  ('Jurídico', 'candidatos', 'alterar'),
  ('Jurídico', 'duvidas', 'alterar'),
  ('Licitações', 'composicao', 'alterar'),
  ('Licitações', 'composicao', 'aprovar'),
  ('Licitações', 'composicao', 'incluir'),
  ('Licitações', 'cotacoes-licitacao', 'alterar'),
  ('Licitações', 'editais', 'alterar'),
  ('Licitações', 'editais', 'excluir'),
  ('Licitações', 'editais', 'incluir'),
  ('Licitações', 'pipeline', 'alterar'),
  ('Licitações', 'pipeline', 'excluir'),
  ('Licitações', 'pipeline', 'incluir'),
  ('Licitações', 'resultado', 'aprovar'),
  ('Malote', 'malote_configuracoes', 'alterar'),
  ('Malote', 'malote_pagamento', 'aprovar'),
  -- Indireção: malote_pode(_acao) repassa a ação como VARIÁVEL pra can_access,
  -- então o regex de literal não pegava. Chamado com alterar/aprovar/excluir.
  ('Malote', 'malote_despesa_visualizar', 'alterar'),
  ('Malote', 'malote_despesa_visualizar', 'aprovar'),
  ('Malote', 'malote_despesa_visualizar', 'excluir'),
  ('Malote', 'malote_solicitacao_visualizar', 'alterar'),
  ('Malote', 'malote_solicitacao_visualizar', 'aprovar'),
  ('Malote', 'malote_solicitacao_visualizar', 'excluir'),
  ('Recrutamento e Seleção', 'recrutamento_etapa_compras', 'aprovar'),
  ('Recrutamento e Seleção', 'recrutamento_etapa_juridico', 'aprovar'),
  ('Recrutamento e Seleção', 'recrutamento_etapa_sst', 'aprovar'),
  ('Recrutamento e Seleção', 'recrutamento_gestao', 'alterar'),
  ('RH', 'colaboradores', 'alterar'),
  ('RH', 'folha', 'alterar'),
  ('RH', 'folha', 'excluir'),
  ('RH', 'folha', 'incluir'),
  ('SST', 'sst_aso', 'alterar'),
  ('Suprimentos', 'almoxarifados', 'alterar'),
  ('Suprimentos', 'fornecedores', 'alterar'),
  ('Suprimentos', 'fornecedores', 'excluir'),
  ('Suprimentos', 'fornecedores', 'incluir'),
  ('Suprimentos', 'sup_catalogo', 'alterar'),
  ('Suprimentos', 'sup_catalogo_aprovacao', 'alterar'),
  ('Suprimentos', 'sup_cotacoes', 'alterar'),
  -- Indireção via sup_malote_pode(_acao) / sup_malote_carregar(id, _acao):
  -- é o que protege enviar/aprovar/reprovar cotação do malote.
  ('Suprimentos', 'sup_cotacoes_malote', 'alterar'),
  ('Suprimentos', 'sup_cotacoes_malote', 'aprovar'),
  ('Suprimentos', 'sup_cotacoes_malote', 'excluir'),
  ('Suprimentos', 'sup_epis_admissao', 'alterar'),
  ('Suprimentos', 'sup_estoque', 'alterar'),
  ('Suprimentos', 'sup_estoque', 'excluir'),
  ('Suprimentos', 'sup_manutencao', 'alterar'),
  ('Suprimentos', 'sup_patrimonio', 'alterar'),
  ('Suprimentos', 'sup_patrimonio', 'excluir'),
  ('Suprimentos', 'sup_patrimonio', 'incluir'),
  ('Suprimentos', 'sup_pedidos_materiais', 'alterar'),
  ('Suprimentos', 'sup_pedidos_materiais', 'excluir')
) AS v(perfil_nome, menu_codigo, acao) ON v.perfil_nome = pa.nome
WHERE pa.ativo = true AND pa.concede_tudo = false
ON CONFLICT DO NOTHING;
