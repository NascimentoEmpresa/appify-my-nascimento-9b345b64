-- =========================================================================
-- [SEM-CHAMADO] Chamados de Sistemas: "Gerente de Sistemas" vale como
-- Gestor de Sistemas (18/11/2026)
--
-- O PEDIDO (Pablo, olhando a tela do chamado entregue pelo merge da PR):
-- "se tiver a permissão Gerente de Sistemas então vai aparecer o botão ali
-- EM CIMA DE PARTE DO DESENVOLVEDOR CONCLUÍDA > CONCLUIR TAREFA".
--
-- A permissão "Gerente de Sistemas" (app_menu sistemas_gerente_sistemas,
-- das Solicitações ERP, mig 20260624000001) já existe em Acesso por Usuário.
-- Os Chamados de Sistemas só olhavam o menu fantasma
-- chamados_sistemas_gestor_sistemas (mig 20261110009000). Agora as duas
-- valem igual:
--   1. chamado_gestor_sistemas(): conclui/devolve/finaliza nas RPCs
--      (chamado_devolver_ao_dev, chamado_finalizar_gestao);
--   2. chamado_sistema_gestor(): conta como gestão — vê e escreve em todos os
--      chamados e chats (RLS de CHAMADO_SISTEMA/_EVENTO/_ANEXO), o que o
--      "Concluir tarefa" precisa para gravar o status;
--   3. avisos no sino ("Conclua o chamado #..." no merge/entrega e "Finalize o
--      chamado #..." na confirmação do solicitante) também vão para quem tem
--      Gerente de Sistemas.
-- Na tela: useChamadoPerms.canGestorSistemas com o mesmo OR.
--
-- Nenhuma permissão é dada a ninguém aqui: só passa a valer quem já tem (ou
-- receber) o "Gerente de Sistemas" em Administração › Acesso por Usuário.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================
SET lock_timeout = '5s';

-- ── 1. Quem é o Gestor de Sistemas ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_gestor_sistemas()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.tem_acesso_menu('chamados_sistemas_gestor_sistemas')
      OR public.tem_acesso_menu('sistemas_gerente_sistemas');
$$;
REVOKE ALL ON FUNCTION public.chamado_gestor_sistemas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_gestor_sistemas() TO authenticated;

-- ── 2. Gestão de chamados (corpo da mig 20261110009000 + Gerente) ────────
CREATE OR REPLACE FUNCTION public.chamado_sistema_gestor()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.tem_acesso_menu('chamados_sistemas_painel')
      OR public.tem_acesso_menu('chamados_sistemas_coordenar')
      OR public.tem_acesso_menu('chamados_sistemas_aprovar')
      OR public.tem_acesso_menu('chamados_sistemas_gestor_sistemas')
      OR public.tem_acesso_menu('sistemas_gerente_sistemas');
$$;
REVOKE ALL ON FUNCTION public.chamado_sistema_gestor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_sistema_gestor() TO authenticated;

-- ── 3. Sino: entrega do dev / merge → Gestor e Gerente de Sistemas ───────
-- Corpo da mig 20261117235500 com os dois menus.
CREATE OR REPLACE FUNCTION public.chamado_entregue_avisa_gestao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
    SELECT DISTINCT s.user_id,
           'Conclua o chamado #' || NEW.numero,
           left(NEW.assunto, 120) || ' — a PR foi mergeada. Confira a entrega e clique em Concluir chamado.',
           'chamado_concluir_gestao',
           '/app/sistemas/chamados/' || NEW.id
      FROM public.screen_permission_user s
     WHERE s.menu_codigo IN ('chamados_sistemas_gestor_sistemas', 'sistemas_gerente_sistemas')
       AND s.acao = 'visualizar' AND s.allow
       AND public.has_screen_access(s.user_id, s.menu_codigo, 'visualizar'::public.app_acao, NULL);
  EXCEPTION WHEN others THEN
    -- Aviso não pode derrubar a entrega.
    RAISE WARNING 'chamado_entregue_avisa_gestao (%): %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_entregue_avisa_gestao() FROM PUBLIC, anon, authenticated;

-- ── 4. Sino: solicitante confirmou → Gestor e Gerente de Sistemas ────────
-- Corpo da mig 20261110009000 com os dois menus.
CREATE OR REPLACE FUNCTION public.chamado_confirmado_avisa_gestao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
    SELECT DISTINCT s.user_id,
           'Finalize o chamado #' || NEW.numero,
           left(NEW.assunto, 120) || ' — o solicitante confirmou a conclusão. Confira e clique em Finalizar chamado.',
           'chamado_finalizar_gestao',
           '/app/sistemas/chamados/' || NEW.id
      FROM public.screen_permission_user s
     WHERE s.menu_codigo IN ('chamados_sistemas_gestor_sistemas', 'sistemas_gerente_sistemas')
       AND s.acao = 'visualizar' AND s.allow
       AND s.user_id IS DISTINCT FROM auth.uid()
       AND public.has_screen_access(s.user_id, s.menu_codigo, 'visualizar'::public.app_acao, NULL);
  EXCEPTION WHEN others THEN
    -- Aviso não pode derrubar a confirmação.
    RAISE WARNING 'chamado_confirmado_avisa_gestao (%): %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_confirmado_avisa_gestao() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Recriar chamado_gestor_sistemas(), chamado_sistema_gestor() e
-- chamado_confirmado_avisa_gestao() como na mig 20261110009000, e
-- chamado_entregue_avisa_gestao() como na mig 20261117235500 (sem o menu
-- sistemas_gerente_sistemas).
-- NOTIFY pgrst, 'reload schema';
