-- =====================================================================
-- MALOTE — Suprimentos passa a enxergar a solicitação que precisa cotar
--
-- O PROBLEMA
-- A tela /app/suprimentos/cotacoes-malote (SIS-2026-0112) lista solicitações
-- em `malote_despesa`. A policy de SELECT de lá é:
--
--   created_by = auth.uid()
--   OR has_role(auth.uid(), 'admin')
--   OR malote_supervisor_por_cargo(auth.uid())
--   OR empresa_id = get_user_empresa(auth.uid())
--
-- Um comprador não é o criador, não é admin, e malote_supervisor_por_cargo só
-- cobre Controladoria/Diretor/Sistemas/Presidência. Sobrava o ramo da empresa
-- — que falha quando a despesa está numa empresa diferente da do usuário.
--
-- Medido em produção com o CASSIO, que tem TODAS as permissões de Suprimentos:
-- enxerga 64 contratos, 1424 itens, 129 bens… e 0 das 16 solicitações do
-- Malote. A tela abre e mostra "Nenhuma solicitação para cotar", que é
-- exatamente o erro silencioso que essa sprint vem eliminando.
--
-- O QUE MUDA — E O QUE NÃO MUDA
-- NADA é removido da policy do outro dev. Só entra mais um ramo no OR: quem
-- tem `sup_cotacoes_malote` no Acesso por Usuário também lê. É estritamente
-- ADITIVO — ninguém que enxergava antes deixa de enxergar.
--
-- A ESCRITA não é tocada: continua sendo só pelo criador/admin/supervisor, e
-- Suprimentos segue escrevendo exclusivamente pelas RPCs sup_malote_*, que
-- são SECURITY DEFINER e já checam a permissão. Quem cota não ganha UPDATE
-- direto na tabela.
--
-- ⚠️ TABELA DE OUTRO MÓDULO. Avise o responsável pelo Malote.
-- =====================================================================

DROP POLICY IF EXISTS malote_despesa_select ON public.malote_despesa;
CREATE POLICY malote_despesa_select ON public.malote_despesa
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.malote_supervisor_por_cargo(auth.uid())
    OR empresa_id = public.get_user_empresa(auth.uid())
    -- ── novo: o comprador que precisa cotar ──
    OR public.can_access(auth.uid(), 'sup_cotacoes_malote', 'visualizar')
  );

-- O log da solicitação segue a mesma visibilidade: quem pode ver a despesa
-- precisa ver o histórico dela, senão a trilha de auditoria fica cega
-- justamente para quem age nela.
DROP POLICY IF EXISTS malote_evento_select ON public.malote_despesa_evento;
CREATE POLICY malote_evento_select ON public.malote_despesa_evento
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.malote_despesa d
                  WHERE d.id = malote_despesa_evento.despesa_id));

-- ── Conferência ──────────────────────────────────────────────────────
SELECT policyname, cmd FROM pg_policies
 WHERE schemaname = 'public' AND tablename IN ('malote_despesa', 'malote_despesa_evento')
 ORDER BY tablename, cmd;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK — recria a policy original, sem o ramo de Suprimentos:
--   DROP POLICY IF EXISTS malote_despesa_select ON public.malote_despesa;
--   CREATE POLICY malote_despesa_select ON public.malote_despesa
--     FOR SELECT TO authenticated
--     USING (created_by = auth.uid()
--         OR public.has_role(auth.uid(), 'admin'::public.app_role)
--         OR public.malote_supervisor_por_cargo(auth.uid())
--         OR empresa_id = public.get_user_empresa(auth.uid()));
-- =====================================================================
