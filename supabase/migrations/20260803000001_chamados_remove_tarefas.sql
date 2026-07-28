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
DROP TABLE IF EXISTS public."CHAMADO_SISTEMA_TAREFA" CASCADE;

-- 3) Função de guard era exclusiva das tarefas --------------------------
DROP FUNCTION IF EXISTS public.chamado_sistema_tarefa_guard();

-- 4) Recarrega o schema no PostgREST ------------------------------------
NOTIFY pgrst, 'reload schema';
