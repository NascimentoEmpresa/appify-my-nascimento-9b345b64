-- =====================================================================
-- CHAMADOS DE SISTEMAS — remoção do recurso de Tarefas
-- ---------------------------------------------------------------------
-- O fluxo de tarefas (criação na coordenação + execução pelo dev) foi
-- retirado das telas. Esta migration remove a tabela CHAMADO_SISTEMA_TAREFA
-- e tudo que dependia dela.
--
-- Antes de dropar a tabela é preciso recriar a policy de SELECT de
-- CHAMADO_SISTEMA, que a referenciava num sub-EXISTS. O acesso do dev ao
-- chamado continua garantido por `responsavel_id = auth.uid()`, então
-- nenhuma visibilidade é perdida (as tarefas sempre herdavam o mesmo
-- responsável do chamado).
-- =====================================================================

-- 1) Recria a SELECT de CHAMADO_SISTEMA sem depender de TAREFA -----------
DROP POLICY IF EXISTS chamado_sistema_select ON public."CHAMADO_SISTEMA";
CREATE POLICY chamado_sistema_select ON public."CHAMADO_SISTEMA"
  FOR SELECT TO authenticated
  USING (
    solicitante_id = auth.uid()
    OR responsavel_id = auth.uid()
    OR public.chamado_sistema_gestor()
  );

-- 2) Remove a tabela (policies, triggers e índices caem via CASCADE) -----
-- Busca no catálogo independente do case do nome (em bancos onde a tabela
-- ficou como chamado_sistema_tarefa minúsculo, o DROP com aspas não bate).
DO $$
DECLARE r regclass;
BEGIN
  SELECT c.oid::regclass INTO r
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND lower(c.relname) = 'chamado_sistema_tarefa'
     AND c.relkind = 'r';
  IF r IS NOT NULL THEN
    EXECUTE 'DROP TABLE ' || r::text || ' CASCADE';
  END IF;
END $$;

-- 3) Função de guard era exclusiva das tarefas (CASCADE remove trigger órfão)
DROP FUNCTION IF EXISTS public.chamado_sistema_tarefa_guard() CASCADE;

-- 4) Recarrega o schema no PostgREST ------------------------------------
NOTIFY pgrst, 'reload schema';
