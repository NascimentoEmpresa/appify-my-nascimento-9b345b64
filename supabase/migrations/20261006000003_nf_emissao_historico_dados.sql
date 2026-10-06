-- ============================================================================
-- Histórico da NF — coluna `dados` (detalhe estruturado)
-- ============================================================================
-- SIS-2026-0592: o ajuste de valores de uma NF concluída (VA, VT, materiais e
-- descontos pós-emissão) precisa aparecer no Histórico de forma fácil de ler —
-- item a item, campo a campo, com o valor antes e depois e o motivo. `detalhe`
-- continua sendo o texto corrido (e o que as entradas antigas usam); `dados`
-- guarda o mesmo ajuste em JSON para a tela montar a tabela. Entradas antigas
-- ficam com dados NULL e continuam como estavam.
--
-- ROLLBACK:
--   ALTER TABLE public.nf_emissao_historico DROP COLUMN IF EXISTS dados;
--   NOTIFY pgrst, 'reload schema';

ALTER TABLE public.nf_emissao_historico
  ADD COLUMN IF NOT EXISTS dados jsonb;

NOTIFY pgrst, 'reload schema';
