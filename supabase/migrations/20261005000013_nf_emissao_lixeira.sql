-- ============================================================================
-- nf_emissao: Lixeira (soft-delete) para o Relatório Geral do Relatório de Serviços
-- ============================================================================
-- Pedido do Ruan/Financeiro: excluir NFs que sobraram no Relatório Geral, mas
-- passando antes por uma lixeira (dentro da própria tela) e só depois a exclusão
-- definitiva.
--
-- * deleted_at/deleted_by: NF na lixeira quando deleted_at IS NOT NULL. O front
--   filtra `deleted_at IS NULL` em todas as listagens (única leitura em lote é
--   buscarTodasNfsEmissao) — NF na lixeira some de relatório, dashboard,
--   controle de faturamento e totais.
-- * Quem envia para a lixeira / restaura: o UPDATE de deleted_at/deleted_by NÃO
--   está nos campos livres do guard (nf_emissao_guard_enviada), então em NF
--   concluída/cancelada exige a ação 'excluir' em nf-emissao (Nível D) — a mesma
--   da exclusão definitiva. Nenhuma policy/trigger nova.
-- ============================================================================

ALTER TABLE public.nf_emissao
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

CREATE INDEX IF NOT EXISTS idx_nf_emissao_deleted_at
  ON public.nf_emissao (deleted_at)
  WHERE deleted_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
-- DROP INDEX IF EXISTS public.idx_nf_emissao_deleted_at;
-- ALTER TABLE public.nf_emissao DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deleted_at;
-- NOTIFY pgrst, 'reload schema';
