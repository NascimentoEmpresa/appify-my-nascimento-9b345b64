-- =========================================================================
-- "Dashboard de Pontos" — o painel da Conferência de Ponto no RH, no
-- Financeiro e no Operacional (30/09/2026)
--
-- PEDIDO (Pablo): "troca o nome disso pra DASHBOARD DE PONTOS e replica no
-- módulo financeiro também pra eles também conseguirem ver. e no módulo
-- OPERACIONAL tem que ter também o DASHBOARD DE PONTOS".
--
-- 1. rh_conferencia_ponto_painel (/app/rh/conferencia-ponto/painel) passa a
--    se chamar "Dashboard de Pontos" — no menu lateral havia DOIS itens
--    "Conferência de Ponto" no RH, um deles era o painel.
-- 2. Dois menus novos, a mesma tela em cada módulo (acesso é por menu, e cada
--    módulo libera o seu):
--      financeiro_dashboard_pontos  → /app/financeiro/dashboard-pontos
--      operacional_dashboard_pontos → /app/operacional/dashboard-pontos
--    Nascem com quem JÁ vê a Conferência de Ponto daquele módulo (exceções
--    individuais e perfis, só 'visualizar'): 6 pessoas no Financeiro e 9 no
--    Operacional em 30/09. O resto se ajusta em Acesso por Usuário.
-- 3. O painel lia "CONTRATOS" direto, e a RLS dela (contratos_gate) só deixa
--    quem tem Recrutamento/Colaboradores/Encarregados/etc. — o menu do painel
--    nunca esteve lá; funcionava para quem tinha um daqueles por acaso. Em vez
--    de abrir a tabela de contratos inteira para mais três menus, a RPC
--    ponto_painel_contratos() devolve SÓ o que o painel mostra (empresa,
--    filial e nomes dos contratos ativos) para quem tem um dos três menus.
--    SISTEMA_CONFERENCIA_PONTO já é legível por qualquer autenticado.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

-- ── 1. Nome ──────────────────────────────────────────────────────────────
UPDATE public.app_menu SET nome = 'Dashboard de Pontos'
 WHERE codigo = 'rh_conferencia_ponto_painel';

-- ── 2. Menus no Financeiro e no Operacional ──────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, x.codigo, 'Dashboard de Pontos', x.rota, x.ordem, true
  FROM (VALUES
    ('financeiro',  'financeiro_dashboard_pontos',  '/app/financeiro/dashboard-pontos',  172),
    ('operacional', 'operacional_dashboard_pontos', '/app/operacional/dashboard-pontos',  33)
  ) AS x(modulo, codigo, rota, ordem)
  JOIN public.app_modulo m ON m.codigo = x.modulo
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- Quem já vê a Conferência de Ponto do módulo passa a ver o Dashboard dele.
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id, motivo)
SELECT s.user_id, x.novo, 'visualizar'::app_acao, true, s.empresa_id,
       'Dashboard de Pontos (mig 274): herdado de ' || x.origem
  FROM (VALUES
    ('financeiro_conferencia_ponto',  'financeiro_dashboard_pontos'),
    ('operacional_conferencia_ponto', 'operacional_dashboard_pontos')
  ) AS x(origem, novo)
  JOIN public.screen_permission_user s
    ON s.menu_codigo = x.origem AND s.acao = 'visualizar'::app_acao AND s.allow
ON CONFLICT (user_id, menu_codigo, acao, empresa_id) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT p.perfil_id, x.novo, 'visualizar'::app_acao, true
  FROM (VALUES
    ('financeiro_conferencia_ponto',  'financeiro_dashboard_pontos'),
    ('operacional_conferencia_ponto', 'operacional_dashboard_pontos')
  ) AS x(origem, novo)
  JOIN public.perfil_acesso_permissao p
    ON p.menu_codigo = x.origem AND p.acao = 'visualizar'::app_acao AND p.allow
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- ── 3. Contratos do painel ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ponto_painel_contratos()
RETURNS TABLE (empresa text, filial integer, nome_empresa text, nome_contrato text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (public.can_access(auth.uid(), 'rh_conferencia_ponto_painel', 'visualizar'::app_acao)
       OR public.can_access(auth.uid(), 'financeiro_dashboard_pontos', 'visualizar'::app_acao)
       OR public.can_access(auth.uid(), 'operacional_dashboard_pontos', 'visualizar'::app_acao)
       OR public.can_access(auth.uid(), 'rh_conferencia_ponto', 'visualizar'::app_acao)) THEN
    RAISE EXCEPTION 'Sem acesso ao Dashboard de Pontos.';
  END IF;
  RETURN QUERY
  SELECT c."Empresa"::text, c."Filial"::integer, c."NOME EMPRESA"::text, c."NOME CONTRATO"::text
    FROM public."CONTRATOS" c
   WHERE c."ATIVO" = 'SIM';
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_painel_contratos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_painel_contratos() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.ponto_painel_contratos();
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo IN ('financeiro_dashboard_pontos','operacional_dashboard_pontos');
-- DELETE FROM public.screen_permission_user  WHERE menu_codigo IN ('financeiro_dashboard_pontos','operacional_dashboard_pontos');
-- DELETE FROM public.app_menu WHERE codigo IN ('financeiro_dashboard_pontos','operacional_dashboard_pontos');
-- UPDATE public.app_menu SET nome = 'Conferência de Ponto — Painel' WHERE codigo = 'rh_conferencia_ponto_painel';
-- NOTIFY pgrst, 'reload schema';
