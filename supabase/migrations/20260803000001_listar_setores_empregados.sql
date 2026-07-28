-- useSetoresEmpresa.ts fazia uma varredura paginada (1000 em 1000, até
-- offset 60000!) direto na tabela EMPREGADOS só pra montar a lista de
-- setores distintos do dropdown — isso rodava em segundo plano (React
-- Query não cancela ao trocar de tela) e chegou a estourar um 500 real do
-- Supabase em produção. Setor_ERP não é dado sensível (já exposto via
-- VW_EMPREGADOS_BASICO), então uma RPC SECURITY DEFINER com SELECT DISTINCT
-- resolve em uma query só, rápida, sem depender de paginação nenhuma.
CREATE OR REPLACE FUNCTION public.listar_setores_empregados()
RETURNS TABLE(setor text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT btrim("Setor_ERP") AS setor
  FROM public."EMPREGADOS"
  WHERE "Setor_ERP" IS NOT NULL AND btrim("Setor_ERP") <> '';
$$;
REVOKE ALL ON FUNCTION public.listar_setores_empregados() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_setores_empregados() TO authenticated;

NOTIFY pgrst, 'reload schema';
