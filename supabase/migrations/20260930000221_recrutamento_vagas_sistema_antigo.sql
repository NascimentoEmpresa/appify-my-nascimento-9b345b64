-- =========================================================================
-- Recrutamento: marca das vagas importadas do sistema antigo (bot do
-- Discord) na SISTEMA_RECRUTAMENTO.
--
-- Pedido do Pablo (23/09/2026): migrar as 984 solicitações de vaga do
-- sistema antigo (export-vagas-completo.xlsx, jan–set/2026) para a Gestão
-- Recrutamento, todas encerradas — contratadas/em andamento como
-- "Concluído", reprovadas como "Reprovada" (a tela conta todo "Concluído…"
-- como contratação; reprovada virando "Concluído" inflaria esse número).
--
-- legado_chave = "<userId do Discord>|<data da solicitação>" — a chave
-- única do registro no bot. Serve para:
--   • saber o que veio de lá (e só isso tem a coluna preenchida);
--   • tornar a carga reexecutável: o INSERT dos arquivos de dados usa
--     ON CONFLICT (legado_chave) DO NOTHING.
--
-- OS DADOS NÃO ESTÃO AQUI. Têm nome e telefone de contratados, e não vão
-- para o git: são gerados por
--   migracao-sistema-antigo/vagas-discord/gerar-sql-vagas.mjs
-- a partir do xlsx, um arquivo por mês, para colar no SQL Editor DEPOIS
-- desta migration.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  ADD COLUMN IF NOT EXISTS legado_chave text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sistema_recrutamento_legado_chave
  ON public."SISTEMA_RECRUTAMENTO" (legado_chave);

COMMENT ON COLUMN public."SISTEMA_RECRUTAMENTO".legado_chave IS
  'Preenchida só nas vagas importadas do sistema antigo (bot do Discord): "<userId>|<data da solicitação>". Chave da carga reexecutável (mig 20260930000221).';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- (remove as vagas importadas e a coluna; o histórico delas cai junto pelo ON DELETE CASCADE)
-- DELETE FROM public."SISTEMA_RECRUTAMENTO" WHERE legado_chave IS NOT NULL;
-- DROP INDEX IF EXISTS public.uq_sistema_recrutamento_legado_chave;
-- ALTER TABLE public."SISTEMA_RECRUTAMENTO" DROP COLUMN IF EXISTS legado_chave;
-- NOTIFY pgrst, 'reload schema';
