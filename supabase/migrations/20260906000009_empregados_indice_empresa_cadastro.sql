-- =========================================================================
-- EMPREGADOS — indice em (Empresa, Cadastro)
--
-- A rh_sync_senior_empregados procura cada pessoa do lote por esse par.
-- Sem indice, cada busca era uma varredura completa da tabela: um lote de
-- 500 fazia 500 x 13.526 leituras, e a sincronizacao comecou a estourar o
-- statement_timeout no segundo lote.
--
-- NAO e UNIQUE de proposito: a tabela tem 264 pares repetidos de antes
-- desta integracao (e 83 linhas sem Cadastro). Um unique falharia na
-- criacao. A RPC ja lida com isso pegando o menor "ID" (ORDER BY ... LIMIT 1).
--
-- Idempotente.
-- ROLLBACK: DROP INDEX IF EXISTS public.empregados_empresa_cadastro_idx;
-- =========================================================================

CREATE INDEX IF NOT EXISTS empregados_empresa_cadastro_idx
  ON public."EMPREGADOS" ("Empresa", "Cadastro");

ANALYZE public."EMPREGADOS";

NOTIFY pgrst, 'reload schema';
