-- Continuação da correção de "gerenciamento de acesso vazio": agora que os 20
-- perfis por módulo têm visualizar nas telas reais (20260906000001), este
-- passo acrescenta incluir/alterar/excluir/aprovar — mas só onde a RLS de
-- verdade EXIGE essas ações (não é achismo). Auditoria feita via regex em
-- cima de todas as policies (pg_policies) e funções (pg_get_functiondef) do
-- schema public procurando por can_access(..., '<menu>'::text,
-- '<ação>'::app_acao) com literal — ou seja, toda vez que uma tabela ou RPC
-- realmente checa aquela ação específica pra deixar escrever.
--
-- Segunda passada: a mesma busca no frontend (chamadas `can("<ação>", …,
-- "<menu>")` em src/), que revelou ações que a RLS não expõe com literal —
-- inclusive 3 módulos que a primeira varredura não tinha pegado (Jurídico,
-- Recrutamento e Seleção, SST). Total consolidado: 14 dos 20 módulos.
--
-- Os 6 restantes (Fiscal, Sistemas, Plano de Ações, BI, WhatsApp,
-- Operacional) ficam de fora DE PROPÓSITO, e não por falta de investigação:
-- eles não usam app_acao pra separar escrita — a ação está no próprio nome do
-- menu (chamados_sistemas_aprovar, chamados_sistemas_excluir,
-- sistemas_criar_solicitacao, criar_plano_de_ação...). Nesses, "visualizar"
-- no menu JÁ É a permissão de aprovar/excluir/criar, e isso a migration
-- 20260906000001 já concedeu.
--
-- ROLLBACK:
-- DELETE FROM public.perfil_acesso_permissao pap
--  USING public.perfil_acesso pa
--  WHERE pap.perfil_id = pa.id AND pap.acao <> 'visualizar'
--    AND pa.nome IN ('Administração','Central de Serviços','Comitê de Ética','Contábil','Contratos',
--                     'Controladoria & Orçamento','Financeiro','Licitações','Malote','RH','Suprimentos',
--                     'Jurídico','Recrutamento e Seleção','SST');

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, v.menu_codigo, v.acao::app_acao, true
FROM public.perfil_acesso pa
JOIN (VALUES
  ('Administração', 'administracao', 'alterar'), ('Administração', 'administracao', 'aprovar'),
  ('Administração', 'administracao', 'excluir'), ('Administração', 'administracao', 'incluir'),
  ('Administração', 'integracao', 'alterar'), ('Administração', 'integracao', 'excluir'), ('Administração', 'integracao', 'incluir'),

  ('Central de Serviços', 'central_servicos_formularios', 'alterar'),

  ('Comitê de Ética', 'central_servicos_denuncias', 'alterar'),

  ('Contábil', 'avancada', 'alterar'), ('Contábil', 'avancada', 'excluir'), ('Contábil', 'avancada', 'incluir'),
  ('Contábil', 'contabil_regras_contabilizacao', 'alterar'),
  ('Contábil', 'lancamentos', 'alterar'), ('Contábil', 'lancamentos', 'excluir'),

  ('Contratos', 'ativos', 'alterar'), ('Contratos', 'ativos', 'excluir'), ('Contratos', 'ativos', 'incluir'),
  ('Contratos', 'empenhos', 'alterar'),
  ('Contratos', 'implantacao', 'alterar'), ('Contratos', 'implantacao', 'incluir'), ('Contratos', 'implantacao', 'excluir'),
  ('Contratos', 'postos', 'alterar'),
  ('Contratos', 'reajustes', 'alterar'), ('Contratos', 'reajustes', 'excluir'), ('Contratos', 'reajustes', 'incluir'),

  ('Controladoria & Orçamento', 'cc', 'alterar'), ('Controladoria & Orçamento', 'cc', 'excluir'), ('Controladoria & Orçamento', 'cc', 'incluir'),
  ('Controladoria & Orçamento', 'classificadores', 'alterar'), ('Controladoria & Orçamento', 'classificadores', 'excluir'), ('Controladoria & Orçamento', 'classificadores', 'incluir'),
  ('Controladoria & Orçamento', 'dre', 'alterar'), ('Controladoria & Orçamento', 'dre', 'excluir'), ('Controladoria & Orçamento', 'dre', 'incluir'),
  ('Controladoria & Orçamento', 'empresas', 'alterar'), ('Controladoria & Orçamento', 'empresas', 'excluir'), ('Controladoria & Orçamento', 'empresas', 'incluir'),
  ('Controladoria & Orçamento', 'orcamento', 'alterar'), ('Controladoria & Orçamento', 'orcamento', 'excluir'), ('Controladoria & Orçamento', 'orcamento', 'incluir'),

  ('Financeiro', 'cobrancas', 'alterar'), ('Financeiro', 'cobrancas', 'aprovar'),
  ('Financeiro', 'fluxo', 'alterar'),
  ('Financeiro', 'programacao', 'alterar'), ('Financeiro', 'programacao', 'excluir'), ('Financeiro', 'programacao', 'incluir'),
  ('Financeiro', 'validacao', 'alterar'), ('Financeiro', 'validacao', 'aprovar'), ('Financeiro', 'validacao', 'incluir'),

  ('Licitações', 'editais', 'alterar'), ('Licitações', 'editais', 'excluir'), ('Licitações', 'editais', 'incluir'),
  ('Licitações', 'pipeline', 'alterar'), ('Licitações', 'pipeline', 'excluir'), ('Licitações', 'pipeline', 'incluir'),
  ('Licitações', 'composicao', 'alterar'), ('Licitações', 'composicao', 'aprovar'), ('Licitações', 'composicao', 'incluir'),
  ('Licitações', 'resultado', 'aprovar'),

  ('Malote', 'malote_pagamento', 'aprovar'),

  ('RH', 'colaboradores', 'alterar'),
  ('RH', 'folha', 'alterar'), ('RH', 'folha', 'excluir'), ('RH', 'folha', 'incluir'),

  -- Módulos que só a varredura do frontend revelou (a RLS deles não usa
  -- can_access com literal — a checagem fica na tela e/ou em RPC).
  ('Jurídico', 'candidatos', 'alterar'),
  ('Jurídico', 'duvidas', 'alterar'),

  ('Recrutamento e Seleção', 'recrutamento_gestao', 'alterar'),
  ('Recrutamento e Seleção', 'recrutamento_etapa_compras', 'aprovar'),
  ('Recrutamento e Seleção', 'recrutamento_etapa_juridico', 'aprovar'),
  ('Recrutamento e Seleção', 'recrutamento_etapa_sst', 'aprovar'),

  ('SST', 'sst_aso', 'alterar'),

  ('Suprimentos', 'almoxarifados', 'alterar'),
  ('Suprimentos', 'categorias', 'alterar'),
  ('Suprimentos', 'cotacoes', 'alterar'), ('Suprimentos', 'cotacoes', 'excluir'), ('Suprimentos', 'cotacoes', 'incluir'),
  ('Suprimentos', 'estoque', 'alterar'),
  ('Suprimentos', 'fornecedores', 'alterar'), ('Suprimentos', 'fornecedores', 'excluir'), ('Suprimentos', 'fornecedores', 'incluir'),
  ('Suprimentos', 'movimentos', 'incluir'),
  ('Suprimentos', 'pedidos', 'alterar'),
  ('Suprimentos', 'produtos', 'alterar'),
  ('Suprimentos', 'recebimentos', 'alterar'), ('Suprimentos', 'recebimentos', 'incluir'),
  ('Suprimentos', 'requisicoes', 'alterar'), ('Suprimentos', 'requisicoes', 'excluir'), ('Suprimentos', 'requisicoes', 'incluir'),
  ('Suprimentos', 'sup_catalogo', 'alterar'),
  ('Suprimentos', 'sup_cotacoes', 'alterar'),
  ('Suprimentos', 'sup_estoque', 'alterar'),
  ('Suprimentos', 'sup_epis_admissao', 'alterar'),
  ('Suprimentos', 'sup_manutencao', 'alterar'),
  ('Suprimentos', 'sup_patrimonio', 'alterar'), ('Suprimentos', 'sup_patrimonio', 'excluir'), ('Suprimentos', 'sup_patrimonio', 'incluir'),
  ('Suprimentos', 'sup_pedidos_materiais', 'alterar'), ('Suprimentos', 'sup_pedidos_materiais', 'excluir'),
  ('Suprimentos', 'suprimentos_aprovacoes', 'alterar'), ('Suprimentos', 'suprimentos_aprovacoes', 'aprovar'), ('Suprimentos', 'suprimentos_aprovacoes', 'incluir')
) AS v(perfil_nome, menu_codigo, acao) ON v.perfil_nome = pa.nome
WHERE pa.ativo = true AND pa.concede_tudo = false
ON CONFLICT DO NOTHING;
