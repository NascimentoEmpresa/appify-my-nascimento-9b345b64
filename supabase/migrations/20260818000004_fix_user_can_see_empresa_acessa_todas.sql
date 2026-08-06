-- "Acessa todas as empresas do grupo" grava profiles.acessa_todas_empresas
-- certinho, mas na prática o usuário continuava só vendo as empresas que já
-- tinha em user_empresa. Causa: user_can_see_empresa (RLS de public.empresas,
-- inclusive o seletor de empresa da topbar) nunca checava essa flag — só
-- user_empresa e profiles.empresa_id. A função irmã user_pode_atuar_empresa
-- já tinha o branch certo; aqui só espelhamos o mesmo branch.
--
-- ROLLBACK: recriar sem o branch acessa_todas_empresas (versão de
-- 20260809000018_lote8g5d_seguranca_sessao.sql, linhas 19-36).

CREATE OR REPLACE FUNCTION public.user_can_see_empresa(_empresa_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.can_access(auth.uid(), 'administracao', 'alterar')
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.acessa_todas_empresas = true
        AND EXISTS (SELECT 1 FROM public.empresas e WHERE e.id = _empresa_id AND e.ativa = true)
    )
    OR EXISTS (
      SELECT 1 FROM public.user_empresa ue
      WHERE ue.user_id = auth.uid() AND ue.empresa_id = _empresa_id
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.empresa_id = _empresa_id
    );
$$;
