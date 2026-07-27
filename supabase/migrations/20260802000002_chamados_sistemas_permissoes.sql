-- =====================================================================
-- CHAMADOS DE SISTEMAS — matriz de permissões granular por usuário.
-- Registra cada AÇÃO como um código em app_menu (aparece em Administração →
-- Módulos & Menus → "Acesso por Usuário", um switch por ação) e amarra a RLS
-- + os guards a esses códigos. Capacidades:
--   chamados_sistemas_abrir      → solicitar (abrir chamado). ABERTO a todos
--                                  por padrão; vira restrito quando alguém é
--                                  configurado (mesma regra do resto do ERP).
--   chamados_sistemas_painel     → ver TODOS os chamados / Painel de Distribuição
--   chamados_sistemas_coordenar  → distribuir, atribuir responsável, editar o
--                                  chamado e gerenciar as tarefas
--   chamados_sistemas_aprovar    → aprovar / reprovar / encerrar
--   chamados_sistemas_dev        → desenvolvedor: Painel do Dev + executar tarefas
-- "Gestor" (para RLS) = tem painel OU coordenar OU aprovar.
-- Tabelas em MAIÚSCULAS/citadas: "CHAMADO_SISTEMA*".
-- =====================================================================

-- 1) Registrar as novas capacidades (rota NULL = só permissão) ----------
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, x.codigo, x.nome, NULL, x.ordem
  FROM (VALUES
    ('chamados_sistemas_abrir',     'Chamados — Abrir chamado (solicitar)',                 18),
    ('chamados_sistemas_coordenar', 'Chamados — Coordenar / distribuir / editar / tarefas',  19),
    ('chamados_sistemas_aprovar',   'Chamados — Aprovar / reprovar / encerrar',              20)
  ) AS x(codigo, nome, ordem)
  JOIN public.app_modulo m ON m.codigo = 'sistemas'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- Rótulos mais claros nas capacidades que já existiam (idempotente).
UPDATE public.app_menu SET nome = 'Chamados — Painel de Distribuição (ver todos)'
  WHERE codigo = 'chamados_sistemas_painel';
UPDATE public.app_menu SET nome = 'Chamados — Painel do Desenvolvedor (executar)'
  WHERE codigo = 'chamados_sistemas_dev';

-- 2) Helpers ------------------------------------------------------------
-- "Gestor" do chamado = qualquer papel de gestão.
CREATE OR REPLACE FUNCTION public.chamado_sistema_gestor()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.tem_acesso_menu('chamados_sistemas_painel')
      OR public.tem_acesso_menu('chamados_sistemas_coordenar')
      OR public.tem_acesso_menu('chamados_sistemas_aprovar');
$$;
REVOKE ALL ON FUNCTION public.chamado_sistema_gestor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chamado_sistema_gestor() TO authenticated;

-- "Pode abrir" = liberado explicitamente OU ninguém configurou o código ainda
-- (aberto por padrão, como as demais telas sem regra definida).
CREATE OR REPLACE FUNCTION public.chamado_pode_abrir()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.tem_acesso_menu('chamados_sistemas_abrir')
      OR NOT EXISTS (SELECT 1 FROM public.list_configured_menu_codes()
                     WHERE menu_codigo = 'chamados_sistemas_abrir');
$$;
REVOKE ALL ON FUNCTION public.chamado_pode_abrir() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chamado_pode_abrir() TO authenticated;

-- 3) RLS refeita por capacidade -----------------------------------------
-- CHAMADO_SISTEMA
DROP POLICY IF EXISTS chamado_sistema_select ON public."CHAMADO_SISTEMA";
CREATE POLICY chamado_sistema_select ON public."CHAMADO_SISTEMA"
  FOR SELECT TO authenticated
  USING (
    solicitante_id = auth.uid()
    OR responsavel_id = auth.uid()
    OR public.chamado_sistema_gestor()
    OR EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_TAREFA" t
               WHERE t.chamado_id = "CHAMADO_SISTEMA".id AND t.responsavel_id = auth.uid())
  );

DROP POLICY IF EXISTS chamado_sistema_insert ON public."CHAMADO_SISTEMA";
CREATE POLICY chamado_sistema_insert ON public."CHAMADO_SISTEMA"
  FOR INSERT TO authenticated
  WITH CHECK (
    public.chamado_pode_abrir()
    AND solicitante_id = auth.uid() AND status = 'aberto' AND responsavel_id IS NULL
  );

DROP POLICY IF EXISTS chamado_sistema_update ON public."CHAMADO_SISTEMA";
CREATE POLICY chamado_sistema_update ON public."CHAMADO_SISTEMA"
  FOR UPDATE TO authenticated
  USING (public.chamado_sistema_gestor() OR responsavel_id = auth.uid())
  WITH CHECK (public.chamado_sistema_gestor() OR responsavel_id = auth.uid());

-- CHAMADO_SISTEMA_TAREFA
DROP POLICY IF EXISTS chamado_sistema_tarefa_select ON public."CHAMADO_SISTEMA_TAREFA";
CREATE POLICY chamado_sistema_tarefa_select ON public."CHAMADO_SISTEMA_TAREFA"
  FOR SELECT TO authenticated
  USING (public.chamado_sistema_gestor() OR responsavel_id = auth.uid());

DROP POLICY IF EXISTS chamado_sistema_tarefa_insert ON public."CHAMADO_SISTEMA_TAREFA";
CREATE POLICY chamado_sistema_tarefa_insert ON public."CHAMADO_SISTEMA_TAREFA"
  FOR INSERT TO authenticated
  WITH CHECK (public.tem_acesso_menu('chamados_sistemas_coordenar'));

DROP POLICY IF EXISTS chamado_sistema_tarefa_update ON public."CHAMADO_SISTEMA_TAREFA";
CREATE POLICY chamado_sistema_tarefa_update ON public."CHAMADO_SISTEMA_TAREFA"
  FOR UPDATE TO authenticated
  USING (public.tem_acesso_menu('chamados_sistemas_coordenar') OR responsavel_id = auth.uid())
  WITH CHECK (public.tem_acesso_menu('chamados_sistemas_coordenar') OR responsavel_id = auth.uid());

DROP POLICY IF EXISTS chamado_sistema_tarefa_delete ON public."CHAMADO_SISTEMA_TAREFA";
CREATE POLICY chamado_sistema_tarefa_delete ON public."CHAMADO_SISTEMA_TAREFA"
  FOR DELETE TO authenticated
  USING (public.tem_acesso_menu('chamados_sistemas_coordenar'));

-- CHAMADO_SISTEMA_ANEXO
DROP POLICY IF EXISTS chamado_sistema_anexo_select ON public."CHAMADO_SISTEMA_ANEXO";
CREATE POLICY chamado_sistema_anexo_select ON public."CHAMADO_SISTEMA_ANEXO"
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id
                 AND (c.solicitante_id = auth.uid() OR c.responsavel_id = auth.uid()
                      OR public.chamado_sistema_gestor())));

DROP POLICY IF EXISTS chamado_sistema_anexo_insert ON public."CHAMADO_SISTEMA_ANEXO";
CREATE POLICY chamado_sistema_anexo_insert ON public."CHAMADO_SISTEMA_ANEXO"
  FOR INSERT TO authenticated
  WITH CHECK (autor_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id
    AND (c.solicitante_id = auth.uid() OR c.responsavel_id = auth.uid()
         OR public.chamado_sistema_gestor())));

-- CHAMADO_SISTEMA_EVENTO
DROP POLICY IF EXISTS chamado_sistema_evento_select ON public."CHAMADO_SISTEMA_EVENTO";
CREATE POLICY chamado_sistema_evento_select ON public."CHAMADO_SISTEMA_EVENTO"
  FOR SELECT TO authenticated
  USING (
    public.chamado_sistema_gestor()
    OR EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id
               AND (c.responsavel_id = auth.uid()
                    OR (c.solicitante_id = auth.uid() AND tipo <> 'observacao_interna')))
  );

DROP POLICY IF EXISTS chamado_sistema_evento_insert ON public."CHAMADO_SISTEMA_EVENTO";
CREATE POLICY chamado_sistema_evento_insert ON public."CHAMADO_SISTEMA_EVENTO"
  FOR INSERT TO authenticated
  WITH CHECK (autor_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id
    AND (public.chamado_sistema_gestor()
         OR c.responsavel_id = auth.uid()
         OR (c.solicitante_id = auth.uid() AND tipo IN ('comentario')))));

-- 4) Guards refeitos por capacidade -------------------------------------
CREATE OR REPLACE FUNCTION public.chamado_sistema_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_coord boolean := public.tem_acesso_menu('chamados_sistemas_coordenar');
  v_aprov boolean := public.tem_acesso_menu('chamados_sistemas_aprovar');
  v_resp  boolean := COALESCE(OLD.responsavel_id = auth.uid(), false);
BEGIN
  -- Campos de abertura + coordenação só mudam com "coordenar".
  IF NOT v_coord THEN
    IF NEW.assunto              IS DISTINCT FROM OLD.assunto
    OR NEW.categorias           IS DISTINCT FROM OLD.categorias
    OR NEW.tipo_solicitacao     IS DISTINCT FROM OLD.tipo_solicitacao
    OR NEW.prioridade           IS DISTINCT FROM OLD.prioridade
    OR NEW.descricao            IS DISTINCT FROM OLD.descricao
    OR NEW.impacto_trabalho     IS DISTINCT FROM OLD.impacto_trabalho
    OR NEW.urgencia             IS DISTINCT FROM OLD.urgencia
    OR NEW.modulo_sistema       IS DISTINCT FROM OLD.modulo_sistema
    OR NEW.modulo_sistema_outro IS DISTINCT FROM OLD.modulo_sistema_outro
    OR NEW.afeta_usuarios       IS DISTINCT FROM OLD.afeta_usuarios
    OR NEW.solicitante_id       IS DISTINCT FROM OLD.solicitante_id
    OR NEW.solicitante_nome     IS DISTINCT FROM OLD.solicitante_nome
    OR NEW.setor                IS DISTINCT FROM OLD.setor
    OR NEW.responsavel_id       IS DISTINCT FROM OLD.responsavel_id
    OR NEW.observacao_gerente   IS DISTINCT FROM OLD.observacao_gerente
    OR NEW.comentario_gerente   IS DISTINCT FROM OLD.comentario_gerente THEN
      RAISE EXCEPTION 'Sem permissão para coordenar/editar este chamado.';
    END IF;
  END IF;

  -- Reprovar/motivo só com "aprovar".
  IF (NEW.status = 'reprovado' AND OLD.status <> 'reprovado') AND NOT v_aprov THEN
    RAISE EXCEPTION 'Sem permissão para reprovar chamados.';
  END IF;
  IF NEW.motivo_reprovacao IS DISTINCT FROM OLD.motivo_reprovacao AND NOT v_aprov THEN
    RAISE EXCEPTION 'Sem permissão para reprovar chamados.';
  END IF;

  -- Demais mudanças de status: coordenar, aprovar OU o dev responsável.
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (v_coord OR v_aprov OR v_resp) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o status do chamado.';
  END IF;

  IF NEW.status = 'concluido' AND NEW.concluido_em IS NULL THEN NEW.concluido_em := now(); END IF;
  IF NEW.status <> 'concluido' THEN NEW.concluido_em := NULL; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.chamado_sistema_tarefa_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_coord boolean := public.tem_acesso_menu('chamados_sistemas_coordenar');
BEGIN
  IF NOT v_coord THEN
    IF NEW.titulo         IS DISTINCT FROM OLD.titulo
    OR NEW.descricao      IS DISTINCT FROM OLD.descricao
    OR NEW.prioridade     IS DISTINCT FROM OLD.prioridade
    OR NEW.ordem          IS DISTINCT FROM OLD.ordem
    OR NEW.responsavel_id IS DISTINCT FROM OLD.responsavel_id
    OR NEW.prazo          IS DISTINCT FROM OLD.prazo THEN
      RAISE EXCEPTION 'Sem permissão para alterar esta tarefa (apenas o status).';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 5) RPCs de gestão passam a liberar para qualquer GESTOR (não só painel) ---
CREATE OR REPLACE FUNCTION public.chamados_painel_stats()
RETURNS TABLE(total int, abertos int, em_andamento int, concluidos_mes int, atrasados int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE status = 'aberto')::int,
    count(*) FILTER (WHERE status = 'em_andamento')::int,
    count(*) FILTER (WHERE status = 'concluido'
                     AND concluido_em >= date_trunc('month', now()))::int,
    count(*) FILTER (WHERE prazo_previsto < current_date
                     AND status NOT IN ('concluido','reprovado'))::int
  FROM public."CHAMADO_SISTEMA"
  WHERE public.chamado_sistema_gestor();
$$;
REVOKE ALL ON FUNCTION public.chamados_painel_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chamados_painel_stats() TO authenticated;

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
    AND EXISTS (SELECT 1 FROM public.screen_permission_user s
                WHERE s.user_id = p.id AND s.menu_codigo = 'chamados_sistemas_dev'
                  AND s.acao = 'visualizar'::public.app_acao AND s.allow = true
                  AND s.empresa_id IS NULL)
  ORDER BY p.display_name;
$$;
REVOKE ALL ON FUNCTION public.listar_desenvolvedores_chamados() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_desenvolvedores_chamados() TO authenticated;

NOTIFY pgrst, 'reload schema';
