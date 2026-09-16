-- =========================================================================
-- Advertências: sai do Operacional; só o Jurídico, com aprovador pelo
-- Acesso por Usuário
--
-- Pedido do Pablo em 16/09/2026: "tire as advertências pro Operacional,
-- deixa somente pro Jurídico, e lá vai ter quem pode aprovar também".
--
-- ANTES (117, 15/09) encarregado → "Aguardando Aprovação" (OPERACIONAL, em
--        /app/operacional/advertencias) → "Aguardando Jurídico" → Concluída
-- AGORA  encarregado → "Aguardando Aprovação" (quem tem a ação `aprovar` no
--        menu `advertencias`, na tela Jurídico › Advertências) →
--        "Aguardando Jurídico" (Jurídico conclui) → Concluída/Reprovada
--
-- Mesmo desenho do Parecer Jurídico (119): a ação entra no menu que já
-- existe, marcada em Administração › Acesso por Usuário. Sem menu novo.
--
-- Quem já tinha `alterar` em advertencias ganha `aprovar` — ninguém perde o
-- que podia. operacional_home sai das policies; eh_analista_advertencia()
-- fica (hotfix 3 vias), como estava antes da 117.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- 1) A ação no menu que já existe
INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('advertencias', 'aprovar'::app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- 2) Quem alterava passa a aprovar também
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT s.user_id, 'advertencias', 'aprovar'::app_acao, true,
       'Migração 20260930000124: tinha alterar em advertencias (aprovador antes era o Operacional)'
  FROM public.screen_permission_user s
 WHERE s.menu_codigo = 'advertencias' AND s.acao = 'alterar'::app_acao AND s.allow
   AND NOT EXISTS (
     SELECT 1 FROM public.screen_permission_user x
      WHERE x.user_id = s.user_id AND x.menu_codigo = 'advertencias' AND x.acao = 'aprovar'::app_acao);

-- 3) RLS sem o Operacional; aprovar entra no UPDATE
DROP POLICY IF EXISTS adv_select ON public."SISTEMA_SOLICITACOES_ADVERTENCIA";
CREATE POLICY adv_select ON public."SISTEMA_SOLICITACOES_ADVERTENCIA" FOR SELECT TO authenticated
USING (
  public.has_screen_access(auth.uid(), 'advertencias', 'visualizar'::app_acao)
  OR solicitante_email = auth.email()
  OR public.eh_analista_advertencia(contrato_id)
);

DROP POLICY IF EXISTS adv_update ON public."SISTEMA_SOLICITACOES_ADVERTENCIA";
CREATE POLICY adv_update ON public."SISTEMA_SOLICITACOES_ADVERTENCIA" FOR UPDATE TO authenticated
USING (
  public.has_screen_access(auth.uid(), 'advertencias', 'alterar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'advertencias', 'aprovar'::app_acao)
  OR public.eh_analista_advertencia(contrato_id)
)
WITH CHECK (
  public.has_screen_access(auth.uid(), 'advertencias', 'alterar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'advertencias', 'aprovar'::app_acao)
  OR public.eh_analista_advertencia(contrato_id)
);

NOTIFY pgrst, 'reload schema';

-- Conferência
-- SELECT p.email FROM public.screen_permission_user s JOIN public.profiles p ON p.id = s.user_id
--  WHERE s.menu_codigo = 'advertencias' AND s.acao = 'aprovar' AND s.allow;

-- ROLLBACK
-- Reaplicar as policies da 20260930000117 (com operacional_home);
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'advertencias' AND acao = 'aprovar' AND motivo LIKE 'Migração 20260930000124%';
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'advertencias' AND acao = 'aprovar';
