-- =====================================================================
-- RESTAURAÇÃO DO MÓDULO T.I (20/10/2026) — religa o módulo e os menus.
--
-- Desfaz a mig 20260930000084 (que desligou o módulo 'ti' e os menus dele
-- quando o Mapa 3D saiu da pablo). As concessões de acesso em
-- screen_permission_user nunca foram apagadas: quem tinha a permissão volta
-- a ter, sem ninguém precisar liberar de novo.
--
-- Os sete menus do módulo, como a branch `ti` usava:
--   telas:      ti_mapa_hardware (Mapa 3D), ti_construir, ti_inventario, ti_painel
--   fantasmas:  ti_mapa_editar, ti_ativo_gerenciar, ti_ativo_sensivel
-- (Os quatro primeiros e os três fantasmas são criados/atualizados pelas
-- migs 0130 e 0131 desta restauração — aqui só se garante ativo = true.)
-- =====================================================================

UPDATE public.app_modulo SET ativo = true WHERE codigo = 'ti' AND ativo IS DISTINCT FROM true;

UPDATE public.app_menu am
   SET ativo = true
  FROM public.app_modulo mo
 WHERE mo.id = am.modulo_id
   AND mo.codigo = 'ti'
   AND am.codigo IN ('ti_mapa_hardware', 'ti_construir', 'ti_inventario', 'ti_painel',
                     'ti_mapa_editar', 'ti_ativo_gerenciar', 'ti_ativo_sensivel')
   AND am.ativo IS DISTINCT FROM true;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reaplicar 20260930000084_ti_remover_modulo.sql (desliga módulo e menus,
-- mantendo as concessões).
