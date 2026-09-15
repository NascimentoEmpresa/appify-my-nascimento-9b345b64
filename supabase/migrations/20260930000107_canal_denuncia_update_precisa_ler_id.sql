-- =========================================================================
-- Canal de Denúncias: "permission denied for table CANAL_DENUNCIA" ao SALVAR
--
-- SINTOMA (14/09/2026)
--   Salvar a ficha (FichaDenuncia.tsx) ou os blocos de apuração
--   (BlocosApuracao.tsx) falha com `permission denied for table
--   CANAL_DENUNCIA`. Conferido no banco: `authenticated` tem
--   INSERT,UPDATE,DELETE na tabela e SELECT em NENHUMA coluna.
--
-- CAUSA
--   A 20260914000002 revogou o SELECT da tabela (a leitura é pela visão
--   v_canal_denuncia, que mascara o denunciante) e deixou só o UPDATE. Só
--   que o Postgres exige SELECT em toda coluna que o UPDATE LÊ: o `WHERE id
--   = ...` lê `id`, e a policy canal_denuncia_update lê `empresa_id`. Sem
--   privilégio nessas duas colunas, o UPDATE morre antes de olhar a RLS.
--   (A 20260916000001 corrigiu o mesmo erro nas policies das tabelas
--   FILHAS — este é o irmão dele, na própria tabela.)
--
-- CORREÇÃO
--   GRANT SELECT por COLUNA, só em `id` e `empresa_id` — nada de identidade.
--   A visão continua sendo o único caminho de leitura do conteúdo: um
--   `select=*` direto na tabela segue negado (faltam as outras colunas).
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

GRANT SELECT (id, empresa_id) ON public."CANAL_DENUNCIA" TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Conferência: deve devolver id,empresa_id (e nada mais).
-- SELECT string_agg(column_name, ',') FROM information_schema.column_privileges
--  WHERE grantee = 'authenticated' AND table_name = 'CANAL_DENUNCIA' AND privilege_type = 'SELECT';

-- ROLLBACK
-- REVOKE SELECT (id, empresa_id) ON public."CANAL_DENUNCIA" FROM authenticated;
-- NOTIFY pgrst, 'reload schema';
