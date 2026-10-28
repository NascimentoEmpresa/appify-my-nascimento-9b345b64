-- Convenções Coletivas: vincular postos pelos DOIS lados (28/10/2026).
--
-- Até a 20261027000930 o vínculo posto → CCT/decreto só nascia na Planilha
-- de Custo (coluna "CCT"). Pedido: no cadastro da convenção, marcar os postos
-- do contrato que seguem ela; e no detalhe do posto (Planilha de Custo),
-- escolher a convenção. A tabela continua uma só (LIC_POSTO_CONVENCAO, um
-- vínculo por contrato + posto) — os dois lados gravam a mesma linha.
--
-- 1) lic_postos_do_contrato: os postos do contrato saem da planilha_custo,
--    cuja RLS é por empresa do usuário (user_empresa). Quem cadastra
--    convenção nem sempre tem a empresa do contrato vinculada — por isso a
--    lista vem por RPC, gateada por lic_convencao_pode('visualizar').
-- 2) Escrita no vínculo: além de quem mexe na Planilha de Custo, quem pode
--    incluir/alterar convenção (licitacoes_convencoes).

CREATE OR REPLACE FUNCTION public.lic_postos_do_contrato(p_contrato_id uuid)
RETURNS TABLE (posto text, linhas integer, pessoas integer, convencao_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT min(btrim(pc.posto)) AS posto,
         count(*)::int AS linhas,
         coalesce(sum(pc.qt_postos), 0)::int AS pessoas,
         (SELECT v.convencao_id FROM public."LIC_POSTO_CONVENCAO" v
           WHERE v.contrato_id = p_contrato_id
             AND upper(btrim(v.posto)) = upper(btrim(min(pc.posto)))) AS convencao_id
    FROM public.planilha_custo pc
   WHERE public.lic_convencao_pode('visualizar')
     AND pc.contrato_id = p_contrato_id
     AND btrim(coalesce(pc.posto, '')) <> ''
   GROUP BY upper(btrim(pc.posto))
   ORDER BY 1
$$;
REVOKE ALL ON FUNCTION public.lic_postos_do_contrato(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lic_postos_do_contrato(uuid) TO authenticated;

-- Quem vincula: quem mexe na Planilha de Custo OU quem cadastra convenção.
DROP POLICY IF EXISTS lic_posto_convencao_write ON public."LIC_POSTO_CONVENCAO";
CREATE POLICY lic_posto_convencao_write ON public."LIC_POSTO_CONVENCAO" FOR ALL TO authenticated
  USING (public.has_screen_access(auth.uid(), 'planilha-custo', 'alterar'::public.app_acao)
         OR public.has_screen_access(auth.uid(), 'planilha-custo', 'incluir'::public.app_acao)
         OR public.lic_convencao_pode('incluir')
         OR public.lic_convencao_pode('alterar'))
  WITH CHECK (public.has_screen_access(auth.uid(), 'planilha-custo', 'alterar'::public.app_acao)
              OR public.has_screen_access(auth.uid(), 'planilha-custo', 'incluir'::public.app_acao)
              OR public.lic_convencao_pode('incluir')
              OR public.lic_convencao_pode('alterar'));

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.lic_postos_do_contrato(uuid);
-- DROP POLICY IF EXISTS lic_posto_convencao_write ON public."LIC_POSTO_CONVENCAO";
-- CREATE POLICY lic_posto_convencao_write ON public."LIC_POSTO_CONVENCAO" FOR ALL TO authenticated
--   USING (public.has_screen_access(auth.uid(), 'planilha-custo', 'alterar'::public.app_acao)
--          OR public.has_screen_access(auth.uid(), 'planilha-custo', 'incluir'::public.app_acao))
--   WITH CHECK (public.has_screen_access(auth.uid(), 'planilha-custo', 'alterar'::public.app_acao)
--               OR public.has_screen_access(auth.uid(), 'planilha-custo', 'incluir'::public.app_acao));
-- NOTIFY pgrst, 'reload schema';
