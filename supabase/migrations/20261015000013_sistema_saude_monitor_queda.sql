-- MONITOR DE QUEDA: teste de saúde que passa pelo BANCO (15/10/2026)
--
-- O monitor (src/lib/monitorDeQueda.ts) confirmava a queda com GET /rest/v1/
-- e considerava "de pé" qualquer status < 500. A Supabase passou a responder
-- esse endereço com 401 "Only the service_role API key can be used for this
-- endpoint" — na própria API, sem tocar no Postgres. Resultado: com o banco
-- caído o teste dizia "respondendo", toda suspeita era descartada e o ERP
-- ficava na tela de início vazia em vez de "Sistema temporariamente
-- indisponível" (relato do Pablo, 15/10/2026).
--
-- sistema_saude() é o menor caminho que obriga o PostgREST a pegar uma conexão
-- e rodar SQL: banco fora/lotado → 503/504, que o monitor reconhece.
-- Público (anon) de propósito: o teste roda antes do login e na página /404.
-- Não lê tabela nenhuma nem devolve dado.

CREATE OR REPLACE FUNCTION public.sistema_saude()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$ SELECT true $$;

REVOKE ALL ON FUNCTION public.sistema_saude() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sistema_saude() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.sistema_saude();
-- NOTIFY pgrst, 'reload schema';
