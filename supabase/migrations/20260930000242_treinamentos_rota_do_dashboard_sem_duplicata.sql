-- =========================================================================
-- Treinamentos: /app/treinamentos dava "Acesso negado" pra quem tinha o
-- Dashboard liberado
--
-- SINTOMA (25/09/2026): usuária com os 11 menus de Treinamentos ligados em
-- Acesso por Usuário abria /app/treinamentos e via "Acesso negado — Tela:
-- encarregados_treinamentos".
--
-- CAUSA: DOIS menus ativos com a mesma rota /app/treinamentos:
--   · treinamentos_dashboard (mig 191 — o Dashboard da plataforma);
--   · encarregados_treinamentos (mig 023 — de quando "Treinamentos ERP"
--     morava nessa rota; desde que foi pra /app/treinamentos/erp, com o menu
--     treinamentos_erp, nenhuma tela usa esse código).
-- O RouteGuard resolve UM menu por rota e pegava o antigo — valia a
-- permissão de um menu que não aparece mais para ninguém ligar.
--
-- CORREÇÃO: encarregados_treinamentos vira menu fantasma (rota NULL). As
-- exceções gravadas nele ficam (nada é apagado); a rota passa a ser só do
-- Dashboard. Efeito medido antes de aplicar: 1 pessoa passa a entrar (tinha
-- o Dashboard, não o antigo) e 2 deixam de entrar (tinham só o antigo — não
-- têm o Dashboard ligado no painel).
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

UPDATE public.app_menu
   SET rota = NULL
 WHERE codigo = 'encarregados_treinamentos'
   AND rota = '/app/treinamentos';

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- UPDATE public.app_menu SET rota = '/app/treinamentos' WHERE codigo = 'encarregados_treinamentos';
-- NOTIFY pgrst, 'reload schema';
