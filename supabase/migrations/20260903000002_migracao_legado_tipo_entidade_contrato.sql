-- =====================================================================
-- MIGRAÇÃO DO SISTEMA ANTIGO — passo 2: `contrato` como alvo de alteração
--
-- POR QUÊ
-- `sup_cat_alteracao.tipo_entidade` aceita hoje: posto, funcao, item,
-- opcoes, funcao_item. O sistema antigo registrou 32 alterações cujo alvo é o
-- próprio CONTRATO (criar/renomear contrato dentro do fluxo de aprovação do
-- catálogo). Não existe para onde mapear isso sem inventar um alvo falso:
-- não é posto nem função nem item.
--
-- Distribuição real na origem, em 4.258 alterações:
--   equipamento 3.429   opcoes 392   funcao 215   posto 190   contrato 32
-- ("equipamento" da origem é o que aqui se chama "item"; o de-para é feito na
--  carga, não aqui.)
--
-- Só AMPLIA o conjunto aceito. Nenhuma linha existente é afetada, e nada que
-- já passava passa a ser recusado.
-- =====================================================================

ALTER TABLE public.sup_cat_alteracao
  DROP CONSTRAINT IF EXISTS sup_cat_alteracao_tipo_entidade_check;

ALTER TABLE public.sup_cat_alteracao
  ADD CONSTRAINT sup_cat_alteracao_tipo_entidade_check
  CHECK (tipo_entidade IN ('posto', 'funcao', 'item', 'opcoes', 'funcao_item', 'contrato'));

COMMENT ON COLUMN public.sup_cat_alteracao.tipo_entidade IS
  'Que tipo de entidade a alteração mexe. "contrato" existe por causa do histórico do sistema antigo, onde o contrato era alterado dentro do mesmo fluxo de aprovação.';

-- ── Conferência ──────────────────────────────────────────────────────
SELECT pg_get_constraintdef(oid) AS check_atual
  FROM pg_constraint
 WHERE conname = 'sup_cat_alteracao_tipo_entidade_check';

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK (só depois de remover as linhas com tipo_entidade='contrato'):
--   ALTER TABLE public.sup_cat_alteracao DROP CONSTRAINT sup_cat_alteracao_tipo_entidade_check;
--   ALTER TABLE public.sup_cat_alteracao ADD CONSTRAINT sup_cat_alteracao_tipo_entidade_check
--     CHECK (tipo_entidade IN ('posto','funcao','item','opcoes','funcao_item'));
-- =====================================================================
