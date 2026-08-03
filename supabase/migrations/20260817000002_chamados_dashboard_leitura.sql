-- =====================================================================
-- CHAMADOS DE SISTEMAS — quem tem só o Dashboard de Chamados (painel de TV)
-- precisa ENXERGAR os chamados.
--
-- O código novo `chamados_sistemas_dashboard` não fazia parte de
-- chamado_sistema_gestor() (painel OR coordenar OR aprovar), então liberar o
-- menu não bastava: a tela caía no "acesso negado" e, mesmo passando pelo
-- guard, a RLS devolveria lista vazia.
--
-- Não dá para simplesmente somar o código dentro de chamado_sistema_gestor():
-- essa função também governa UPDATE/DELETE, tarefas e coordenação — quem
-- assiste à TV ganharia permissão de ESCRITA junto.
--
-- Por isso entra uma segunda função, só de LEITURA:
--   chamado_sistema_pode_ver_todos() = gestor OR dashboard
-- usada apenas nas policies de SELECT e na RPC que lista os desenvolvedores.
-- Escrita continua exclusivamente com chamado_sistema_gestor().
--
-- Idempotente. Aplicar DEPOIS de 20260817000001.
-- =====================================================================

-- 1) Predicado de leitura ampla -----------------------------------------
CREATE OR REPLACE FUNCTION public.chamado_sistema_pode_ver_todos()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.chamado_sistema_gestor()
      OR public.tem_acesso_menu('chamados_sistemas_dashboard');
$$;
REVOKE ALL ON FUNCTION public.chamado_sistema_pode_ver_todos() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamado_sistema_pode_ver_todos() FROM anon;
GRANT EXECUTE ON FUNCTION public.chamado_sistema_pode_ver_todos() TO authenticated;

-- 2) SELECT dos chamados (só o SELECT; update/delete seguem com gestor) --
DROP POLICY IF EXISTS chamado_sistema_select ON public."CHAMADO_SISTEMA";
CREATE POLICY chamado_sistema_select ON public."CHAMADO_SISTEMA"
  FOR SELECT TO authenticated
  USING (
    solicitante_id = auth.uid()
    OR responsavel_id = auth.uid()
    OR public.chamado_sistema_pode_ver_todos()
    OR EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_TAREFA" t
               WHERE t.chamado_id = "CHAMADO_SISTEMA".id AND t.responsavel_id = auth.uid())
  );

-- 3) SELECT das avaliações (o painel mostra a média em estrelas) ---------
DROP POLICY IF EXISTS chamado_avaliacao_select ON public."CHAMADO_SISTEMA_AVALIACAO";
CREATE POLICY chamado_avaliacao_select ON public."CHAMADO_SISTEMA_AVALIACAO"
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id
                 AND (c.solicitante_id = auth.uid() OR c.responsavel_id = auth.uid()
                      OR public.chamado_sistema_pode_ver_todos())));

-- 4) Lista de desenvolvedores (um card por dev no painel) ----------------
-- Mesma definição de 20260802000003, trocando só o predicado de acesso.
CREATE OR REPLACE FUNCTION public.listar_desenvolvedores_chamados()
RETURNS TABLE(id uuid, display_name text, em_andamento int, abertos int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.display_name,
    (SELECT count(*) FROM public."CHAMADO_SISTEMA" c
       WHERE c.responsavel_id = p.id AND c.status = 'em_andamento')::int,
    (SELECT count(*) FROM public."CHAMADO_SISTEMA" c
       WHERE c.responsavel_id = p.id
         AND c.status IN ('aberto','em_andamento','aguardando_retorno'))::int
  FROM public.profiles p
  WHERE p.ativo = true
    AND public.chamado_sistema_pode_ver_todos()
    AND EXISTS (
      SELECT 1
        FROM unnest(ARRAY['chamados_sistemas_dev','sistemas_desenvolvedores']) AS cod
       WHERE COALESCE(
               -- exceção individual (Acesso por Usuário), a mais recente vence
               (SELECT s.allow
                  FROM public.screen_permission_user s
                 WHERE s.user_id = p.id
                   AND s.menu_codigo = cod
                   AND s.acao = 'visualizar'::public.app_acao
                 ORDER BY s.updated_at DESC
                 LIMIT 1),
               -- senão, união dos perfis de acesso do usuário
               EXISTS (SELECT 1
                         FROM public.usuario_perfil_acesso upa
                         JOIN public.perfil_acesso pa
                           ON pa.id = upa.perfil_id AND pa.ativo = true
                         JOIN public.perfil_acesso_permissao pap
                           ON pap.perfil_id = pa.id AND pap.allow = true
                        WHERE upa.user_id = p.id
                          AND pap.menu_codigo = cod
                          AND pap.acao = 'visualizar'::public.app_acao)
             ) IS TRUE
    )
  ORDER BY p.display_name;
$$;
REVOKE ALL ON FUNCTION public.listar_desenvolvedores_chamados() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.listar_desenvolvedores_chamados() FROM anon;
GRANT EXECUTE ON FUNCTION public.listar_desenvolvedores_chamados() TO authenticated;

NOTIFY pgrst, 'reload schema';
