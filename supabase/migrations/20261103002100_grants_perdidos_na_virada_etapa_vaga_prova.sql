-- ============================================================================
-- GRANTs que não chegaram ao cluster (achado em 03/11/2026)
--
-- O selo de status detalhado das vagas (etapa do kanban) sumiu sem erro na
-- tela. useEtapasDasVagas lê SISTEMA_RECRUTAMENTO_ETAPA direto e, quando a
-- leitura falha, fica sem detalhe e mostra o status de sempre — então o
-- "permission denied" nunca apareceu para ninguém.
--
-- No cluster, authenticated não tinha SELECT na tabela, embora a migration
-- 20261008000008 tenha `GRANT SELECT ... TO authenticated`. A mesma falta em
-- TRN_PROVA_TENTATIVA (mig 20260930000205). As duas são de antes da virada de
-- 16/10: o schema chegou, o privilégio não. Procurei as tabelas com policy e
-- sem SELECT para authenticated; das cinco que apareceram, CANAL_DENUNCIA e
-- TV_DISPOSITIVO são de propósito (SELECT por coluna) e
-- financeiro_fluxo_caixa_evento só é lida por função SECURITY DEFINER.
--
-- A RLS segue a mesma: o GRANT só deixa a policy decidir, como foi desenhado.
--
-- ROLLBACK:
--   REVOKE SELECT ON TABLE public."SISTEMA_RECRUTAMENTO_ETAPA" FROM authenticated;
--   REVOKE SELECT ON TABLE public."TRN_PROVA_TENTATIVA" FROM authenticated;
-- ============================================================================

SET lock_timeout = '5s';

GRANT SELECT ON TABLE public."SISTEMA_RECRUTAMENTO_ETAPA" TO authenticated;
GRANT SELECT ON TABLE public."TRN_PROVA_TENTATIVA" TO authenticated;

NOTIFY pgrst, 'reload schema';
