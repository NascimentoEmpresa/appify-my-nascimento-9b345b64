-- =====================================================================
-- CHAMADOS DE SISTEMAS — a "Atribuição rápida" do Painel de Distribuição
-- não achava ninguém pra destinar o chamado.
--
-- listar_desenvolvedores_chamados exigia o código NOVO (chamados_sistemas_dev)
-- e ainda por cima só olhava a tabela de exceções por usuário, ignorando quem
-- recebe a capacidade por perfil de acesso. Quem está marcado como
-- "Desenvolvedores" (sistemas_desenvolvedores) no Acesso por Usuário — que é
-- o código que a equipe usa hoje — nunca entrava na lista.
--
-- Agora a própria função resolve os dois códigos do mesmo jeito que
-- has_screen_access resolve qualquer tela: exceção individual mais recente
-- vence, senão vale a união dos perfis de acesso. Perfil "concede tudo" não
-- entra — senão todo admin viraria opção de responsável na fila.
-- =====================================================================

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
    AND public.chamado_sistema_gestor()
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
GRANT EXECUTE ON FUNCTION public.listar_desenvolvedores_chamados() TO authenticated;

-- Limpeza: versão anterior deste arquivo criava uma função auxiliar separada.
DROP FUNCTION IF EXISTS public.chamado_dev_liberado(uuid);

NOTIFY pgrst, 'reload schema';
