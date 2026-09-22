-- =====================================================================
-- CHAMADOS DE SISTEMAS — permissão separada para inspecionar o Meu
-- Dashboard de QUALQUER desenvolvedor (não só o próprio).
--
-- Capacidade nova "chamados_sistemas_dev_dashboard_geral" (rota NULL = só
-- permissão, "menu fantasma" — liberada em Acesso por Usuário, nunca por
-- cargo). FECHADA por padrão, igual às outras de Chamados.
--
-- Reaproveita chamado_sistema_pode_ver_todos() (20260817000002) em vez de
-- escrever RLS nova: quem tiver essa capacidade passa a satisfazer o mesmo
-- predicado que já libera SELECT amplo em CHAMADO_SISTEMA/AVALIACAO e a RPC
-- listar_desenvolvedores_chamados() — é exatamente o acesso de leitura que
-- o seletor de "ver dashboard de outro dev" precisa, sem duplicar policy.
--
-- Continua só LEITURA: esta capacidade não entra em chamado_sistema_gestor(),
-- então não dá permissão nenhuma de escrita (mudar status, prioridade etc.).
-- =====================================================================

-- 1) Capacidade --------------------------------------------------------
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'chamados_sistemas_dev_dashboard_geral', 'Chamados — Ver Meu Dashboard de outros desenvolvedores', NULL, 22
  FROM public.app_modulo m WHERE m.codigo = 'sistemas'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- 2) Entra no predicado de leitura ampla --------------------------------
CREATE OR REPLACE FUNCTION public.chamado_sistema_pode_ver_todos()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.chamado_sistema_gestor()
      OR public.tem_acesso_menu('chamados_sistemas_dashboard')
      OR public.tem_acesso_menu('chamados_sistemas_dev_dashboard_geral');
$$;
REVOKE ALL ON FUNCTION public.chamado_sistema_pode_ver_todos() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamado_sistema_pode_ver_todos() FROM anon;
GRANT EXECUTE ON FUNCTION public.chamado_sistema_pode_ver_todos() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DELETE FROM public.app_menu WHERE codigo = 'chamados_sistemas_dev_dashboard_geral';
-- CREATE OR REPLACE FUNCTION public.chamado_sistema_pode_ver_todos()
-- RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
-- AS $$
--   SELECT public.chamado_sistema_gestor()
--       OR public.tem_acesso_menu('chamados_sistemas_dashboard');
-- $$;
-- NOTIFY pgrst, 'reload schema';
