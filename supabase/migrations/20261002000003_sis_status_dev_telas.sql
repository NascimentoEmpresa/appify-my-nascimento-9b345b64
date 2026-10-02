-- =========================================================================
-- Sistemas › Checklist de Módulos: STATUS DE DESENVOLVIMENTO EM TODA TELA
-- (02/10/2026)
--
-- Pedido do Pablo: o status de desenvolvimento que aparece no Controle de
-- Efetividade dos Módulos (Pronto / Em homologação / Em desenvolvimento /
-- Não iniciado / Pendente) aparece no canto superior direito de TODAS as
-- telas do ERP.
--
-- O SIS_CHECKLIST só é legível por quem tem a tela do checklist
-- (sis_ck_pode). Esta RPC expõe SÓ o status de desenvolvimento — de cada
-- tela (app_menu com rota) e de cada módulo — para qualquer usuário logado.
-- Nada de responsável, observação, uso ou bug. A conta "tela vazia → status
-- do módulo (marcado ou calculado pelas telas)" é feita no front, com as
-- mesmas regras da lib (src/lib/sistemas/checklistModulos.ts).
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.sis_status_dev_telas()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'telas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'codigo', a.codigo, 'modulo_id', a.modulo_id, 'ativo', a.ativo,
               'status_dev', c.status_dev))
        FROM public.app_menu a
        LEFT JOIN public."SIS_CHECKLIST" c ON c.menu_id = a.id
       WHERE a.rota IS NOT NULL), '[]'::jsonb),
    'modulos', coalesce((
      SELECT jsonb_agg(jsonb_build_object('modulo_id', c.modulo_id, 'status_dev', c.status_dev))
        FROM public."SIS_CHECKLIST" c
       WHERE c.menu_id IS NULL AND c.status_dev IS NOT NULL), '[]'::jsonb)
  )
  WHERE auth.uid() IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.sis_status_dev_telas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sis_status_dev_telas() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.sis_status_dev_telas();
-- NOTIFY pgrst, 'reload schema';
