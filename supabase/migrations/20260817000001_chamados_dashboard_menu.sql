-- =====================================================================
-- CHAMADOS DE SISTEMAS — menu do "Dashboard de Chamados".
-- Tela nova (resumo por desenvolvedor: fila, prioridades, entregas e
-- avaliações). Só registra a rota em app_menu para ela aparecer em
-- Administração → Módulos & Menus → "Acesso por Usuário"; o conteúdo em si
-- já é protegido pela RLS de CHAMADO_SISTEMA (gestão) e pelo guard da tela.
-- Idempotente.
-- =====================================================================

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'chamados_sistemas_dashboard', 'Chamados — Dashboard de Chamados',
       '/app/sistemas/chamados/dashboard', 16
  FROM public.app_modulo m
 WHERE m.codigo = 'sistemas'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

NOTIFY pgrst, 'reload schema';
