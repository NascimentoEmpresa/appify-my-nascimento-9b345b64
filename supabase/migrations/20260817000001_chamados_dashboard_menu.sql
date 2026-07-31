-- =====================================================================
-- CHAMADOS DE SISTEMAS — menu do "Dashboard de Chamados" (painel de TV).
-- Tela nova (resumo por desenvolvedor: fila, prioridades e estrelas). Só
-- registra a rota em app_menu para ela aparecer em Administração →
-- Módulos & Menus → "Acesso por Usuário"; o conteúdo em si já é protegido
-- pela RLS de CHAMADO_SISTEMA (gestão) e pelo guard da tela.
-- Idempotente.
-- =====================================================================

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'chamados_sistemas_dashboard', 'Chamados — Dashboard de Chamados',
       '/app/sistemas/chamados/dashboard-tv', 16
  FROM public.app_modulo m
 WHERE m.codigo = 'sistemas'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- A rota mudou depois da primeira versão desta migration: o ON CONFLICT acima
-- não corrige quem já rodou a anterior, então acerta explicitamente.
UPDATE public.app_menu a
   SET rota = '/app/sistemas/chamados/dashboard-tv'
  FROM public.app_modulo m
 WHERE a.modulo_id = m.id AND m.codigo = 'sistemas'
   AND a.codigo = 'chamados_sistemas_dashboard'
   AND a.rota IS DISTINCT FROM '/app/sistemas/chamados/dashboard-tv';

NOTIFY pgrst, 'reload schema';
