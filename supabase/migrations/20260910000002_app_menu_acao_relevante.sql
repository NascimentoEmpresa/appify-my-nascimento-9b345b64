-- Hoje a tela "Acesso por Usuário" mostra os MESMOS 3 switches extras
-- (Excluir / Executar IA / Alterar DRE) em TODOS os menus, de todos os
-- módulos. Daí o absurdo de "Alterar DRE" aparecer no Suprimentos.
--
-- Pior: auditei as três fontes de verdade do sistema (RLS em pg_policies,
-- corpo das funções em pg_get_functiondef, e as chamadas can() no frontend) e
-- 'executar_ia' e 'alterar_dre' NÃO SÃO CHECADAS EM LUGAR NENHUM. Existem só
-- como valor do enum e declaração de tipo em TypeScript. Ligar ou desligar
-- esses dois switches nunca fez diferença nenhuma — são decorativos.
--
-- Esta tabela diz, por menu, quais ações realmente significam alguma coisa
-- ali. A tela passa a renderizar só essas, então todo switch visível controla
-- algo de verdade.
--
-- 'visualizar' fica de fora de propósito: é o switch principal da linha do
-- menu, não um extra.
--
-- ROLLBACK: DROP TABLE IF EXISTS public.app_menu_acao;

CREATE TABLE IF NOT EXISTS public.app_menu_acao (
  menu_codigo text NOT NULL,
  acao        public.app_acao NOT NULL,
  PRIMARY KEY (menu_codigo, acao)
);

COMMENT ON TABLE public.app_menu_acao IS
  'Ações que de fato são checadas em cada menu (RLS + funções + frontend). Fonte da verdade para quais switches a tela de Acesso por Usuário deve mostrar.';

ALTER TABLE public.app_menu_acao ENABLE ROW LEVEL SECURITY;

-- Leitura liberada a autenticado: é catálogo de UI, não dado sensível, e a
-- tela precisa disso pra decidir o que renderizar. Escrita só por migration.
DROP POLICY IF EXISTS app_menu_acao_select ON public.app_menu_acao;
CREATE POLICY app_menu_acao_select ON public.app_menu_acao
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('administracao', 'alterar'),
  ('administracao', 'aprovar'),
  ('administracao', 'excluir'),
  ('administracao', 'incluir'),
  ('almoxarifados', 'alterar'),
  ('ativos', 'alterar'),
  ('ativos', 'excluir'),
  ('ativos', 'incluir'),
  ('avancada', 'alterar'),
  ('avancada', 'excluir'),
  ('avancada', 'incluir'),
  ('candidatos', 'alterar'),
  ('cc', 'alterar'),
  ('cc', 'excluir'),
  ('cc', 'incluir'),
  ('central_servicos_denuncias', 'alterar'),
  ('central_servicos_formularios', 'alterar'),
  ('classificadores', 'alterar'),
  ('classificadores', 'excluir'),
  ('classificadores', 'incluir'),
  ('cobrancas', 'alterar'),
  ('cobrancas', 'aprovar'),
  ('colaboradores', 'alterar'),
  ('composicao', 'alterar'),
  ('composicao', 'aprovar'),
  ('composicao', 'incluir'),
  ('conciliacao-bancaria', 'alterar'),
  ('contabil_regras_contabilizacao', 'alterar'),
  ('contas-pagar', 'alterar'),
  ('contas-pagar', 'aprovar'),
  ('contas-pagar', 'incluir'),
  ('contas-receber', 'alterar'),
  ('contas-receber', 'incluir'),
  ('cotacoes-licitacao', 'alterar'),
  ('dre', 'alterar'),
  ('dre', 'excluir'),
  ('dre', 'incluir'),
  ('duvidas', 'alterar'),
  ('editais', 'alterar'),
  ('editais', 'excluir'),
  ('editais', 'incluir'),
  ('empenhos', 'alterar'),
  ('empresas', 'alterar'),
  ('empresas', 'excluir'),
  ('empresas', 'incluir'),
  ('encarregados_solicitar_materiais', 'incluir'),
  ('fiscal-principal', 'alterar'),
  ('fiscal-principal', 'incluir'),
  ('fluxo', 'alterar'),
  ('folha', 'alterar'),
  ('folha', 'excluir'),
  ('folha', 'incluir'),
  ('fornecedores', 'alterar'),
  ('fornecedores', 'excluir'),
  ('fornecedores', 'incluir'),
  ('implantacao', 'alterar'),
  ('implantacao', 'excluir'),
  ('implantacao', 'incluir'),
  ('integracao-aliases', 'alterar'),
  ('integracao-bancaria', 'alterar'),
  ('integracao-bancaria', 'aprovar'),
  ('integracao', 'alterar'),
  ('integracao', 'excluir'),
  ('integracao', 'incluir'),
  ('lancamentos', 'alterar'),
  ('lancamentos', 'excluir'),
  ('malote_configuracoes', 'alterar'),
  ('malote_pagamento', 'aprovar'),
  ('nf-emissao', 'excluir'),
  ('nf-emissao', 'incluir'),
  ('obz-versoes', 'alterar'),
  ('obz-versoes', 'incluir'),
  ('orcamento', 'alterar'),
  ('orcamento', 'excluir'),
  ('orcamento', 'incluir'),
  ('pipeline', 'alterar'),
  ('pipeline', 'excluir'),
  ('pipeline', 'incluir'),
  ('plano_acoes_lista', 'excluir'),
  ('plano-contas', 'incluir'),
  ('postos', 'alterar'),
  ('presidencia', 'excluir'),
  ('programacao', 'alterar'),
  ('programacao', 'aprovar'),
  ('programacao', 'excluir'),
  ('programacao', 'incluir'),
  ('reajustes', 'alterar'),
  ('reajustes', 'excluir'),
  ('reajustes', 'incluir'),
  ('recrutamento_etapa_compras', 'aprovar'),
  ('recrutamento_etapa_juridico', 'aprovar'),
  ('recrutamento_etapa_sst', 'aprovar'),
  ('recrutamento_gestao', 'alterar'),
  ('resultado', 'aprovar'),
  ('sst_aso', 'alterar'),
  ('sup_catalogo_aprovacao', 'alterar'),
  ('sup_catalogo', 'alterar'),
  ('sup_cotacoes', 'alterar'),
  ('sup_epis_admissao', 'alterar'),
  ('sup_estoque', 'alterar'),
  ('sup_estoque', 'excluir'),
  ('sup_manutencao', 'alterar'),
  ('sup_patrimonio', 'alterar'),
  ('sup_patrimonio', 'excluir'),
  ('sup_patrimonio', 'incluir'),
  ('sup_pedidos_materiais', 'alterar'),
  ('sup_pedidos_materiais', 'excluir'),
  ('validacao', 'alterar'),
  ('validacao', 'aprovar'),
  ('validacao', 'incluir'),
  -- Indireção: malote_pode(_acao) / sup_malote_pode(_acao) repassam a ação
  -- como VARIÁVEL para can_access, então nenhum regex de literal as encontra.
  -- Confirmado lendo as funções: são chamadas com alterar/aprovar/excluir.
  ('sup_cotacoes_malote', 'alterar'),
  ('sup_cotacoes_malote', 'aprovar'),
  ('sup_cotacoes_malote', 'excluir'),
  ('malote_despesa_visualizar', 'alterar'),
  ('malote_despesa_visualizar', 'aprovar'),
  ('malote_despesa_visualizar', 'excluir'),
  ('malote_solicitacao_visualizar', 'alterar'),
  ('malote_solicitacao_visualizar', 'aprovar'),
  ('malote_solicitacao_visualizar', 'excluir')
ON CONFLICT DO NOTHING;

-- Idempotente: rodar de novo não duplica nem apaga ajuste manual.
