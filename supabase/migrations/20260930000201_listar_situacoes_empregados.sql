-- Plano de otimização do banco (docs/plano-otimizacao-banco.md), Fase 5,
-- item que ficou bloqueado por depender de migration: ExportarDados.tsx
-- buscava 13.279 linhas de EMPREGADOS (.limit(20000)) só pra montar a lista
-- de valores distintos de "Situação" do filtro de exportação — mesmo
-- anti-padrão do listar_setores_empregados (20260803000001), resolvido do
-- mesmo jeito: RPC SECURITY DEFINER com SELECT DISTINCT, uma query só.
CREATE OR REPLACE FUNCTION public.listar_situacoes_empregados()
RETURNS TABLE(situacao text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT btrim("Situação") AS situacao
  FROM public."EMPREGADOS"
  WHERE "Situação" IS NOT NULL AND btrim("Situação") <> '';
$$;
REVOKE ALL ON FUNCTION public.listar_situacoes_empregados() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_situacoes_empregados() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.listar_situacoes_empregados();
-- NOTIFY pgrst, 'reload schema';
