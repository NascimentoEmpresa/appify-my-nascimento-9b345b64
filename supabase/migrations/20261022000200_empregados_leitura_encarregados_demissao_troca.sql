-- =========================================================================
-- EMPREGADOS — leitura para quem SOLICITA DEMISSÃO e MUDANÇA DE FUNÇÃO
-- (encarregados) — 22/10/2026
--
-- SINTOMA: a encarregada CARLA ANDREA abria Encarregados › Solicitar
-- Demissão, marcava "Listar afastados", digitava "Mariana" e via "Ninguém
-- encontrado" — e a MARIANA EVANDRIELI (Atestado, 1109 - POLICIA CIVIL RS
-- LIMPEZA 066.2026) aparecia normal para o Pablo.
--
-- CAUSA: a busca do colaborador (src/components/demissao/BuscaColaborador.tsx)
-- lê public."EMPREGADOS" direto, e a policy erp_auth_read_empregados
-- (20260930000111) só libera a leitura para quem tem uma de 11 telas
-- (Colaboradores, Gestão Recrutamento, ASO, Minhas Solicitações…). As
-- próprias telas que usam a busca — encarregados_solicitar_demissao e
-- encarregados_troca_funcao — não estavam na lista: quem tinha só elas não
-- enxergava NINGUÉM (nem a busca por qualquer nome devolvia linha).
--
-- CORREÇÃO: as duas entram na lista. De quebra, cada checagem vai dentro de
-- (SELECT …): função crua em policy roda UMA VEZ POR LINHA (~13 mil linhas ×
-- 13 checagens a cada busca); em subquery o Postgres calcula uma vez por
-- consulta (InitPlan) — mesmo booleano, mesmo resultado (ver
-- 20261007000010_fluxo_caixa_importado_rls_can_access_escalar.sql).
-- Nada muda para quem já via.
-- =========================================================================

DROP POLICY IF EXISTS erp_auth_read_empregados ON public."EMPREGADOS";
CREATE POLICY erp_auth_read_empregados ON public."EMPREGADOS" FOR SELECT TO authenticated
USING (
  auth_user_id = (SELECT auth.uid())
  OR (SELECT public.has_screen_access(auth.uid(), 'colaboradores', 'visualizar'::app_acao))
  OR (SELECT public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao))
  OR (SELECT public.has_screen_access(auth.uid(), 'sst_aso', 'visualizar'::app_acao))
  OR (SELECT public.has_screen_access(auth.uid(), 'candidatos', 'visualizar'::app_acao))
  OR (SELECT public.has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar'::app_acao))
  OR (SELECT public.has_screen_access(auth.uid(), 'central_servicos_solicitacoes', 'visualizar'::app_acao))
  OR (SELECT public.has_screen_access(auth.uid(), 'processos', 'visualizar'::app_acao))
  OR (SELECT public.has_screen_access(auth.uid(), 'patrimonios', 'visualizar'::app_acao))
  OR (SELECT public.has_screen_access(auth.uid(), 'duvidas', 'visualizar'::app_acao))
  OR (SELECT public.has_screen_access(auth.uid(), 'central_servicos_formularios', 'visualizar'::app_acao))
  OR (SELECT public.has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar'::app_acao))
  -- 22/10/2026: as telas dos encarregados que buscam o colaborador.
  OR (SELECT public.has_screen_access(auth.uid(), 'encarregados_solicitar_demissao', 'visualizar'::app_acao))
  OR (SELECT public.has_screen_access(auth.uid(), 'encarregados_troca_funcao', 'visualizar'::app_acao))
);

NOTIFY pgrst, 'reload schema';

-- Conferência (logado como a encarregada): a busca da tela devolve gente.
--   SELECT count(*) FROM public."EMPREGADOS" WHERE "Nome" ILIKE '%MARIANA%';

-- ROLLBACK
-- DROP POLICY IF EXISTS erp_auth_read_empregados ON public."EMPREGADOS";
-- CREATE POLICY erp_auth_read_empregados ON public."EMPREGADOS" FOR SELECT TO authenticated
-- USING (
--   auth_user_id = auth.uid()
--   OR public.has_screen_access(auth.uid(), 'colaboradores', 'visualizar'::app_acao)
--   OR public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao)
--   OR public.has_screen_access(auth.uid(), 'sst_aso', 'visualizar'::app_acao)
--   OR public.has_screen_access(auth.uid(), 'candidatos', 'visualizar'::app_acao)
--   OR public.has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar'::app_acao)
--   OR public.has_screen_access(auth.uid(), 'central_servicos_solicitacoes', 'visualizar'::app_acao)
--   OR public.has_screen_access(auth.uid(), 'processos', 'visualizar'::app_acao)
--   OR public.has_screen_access(auth.uid(), 'patrimonios', 'visualizar'::app_acao)
--   OR public.has_screen_access(auth.uid(), 'duvidas', 'visualizar'::app_acao)
--   OR public.has_screen_access(auth.uid(), 'central_servicos_formularios', 'visualizar'::app_acao)
--   OR public.has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar'::app_acao)
-- );
-- NOTIFY pgrst, 'reload schema';
