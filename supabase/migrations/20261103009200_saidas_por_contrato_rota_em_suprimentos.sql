-- =========================================================================
-- Saídas por Contrato: rota em Suprimentos, fora de "relatórios" (03/11/2026)
--
-- A tela (SIS-2026-0769, mig 20261103001000) nasceu em
-- /app/suprimentos/relatorios/saidas-por-contrato. Pedido do Eduardo: ela
-- pertence ao módulo de Suprimentos, não a relatório — passa a morar em
-- /app/suprimentos/saidas-por-contrato. O código do menu NÃO muda
-- (sup_rel_saidas_contrato): as permissões semeadas e as dadas à mão em
-- Gerenciamento de Acesso continuam valendo, nada precisa ser refeito.
--
-- O front aceita as duas ordens de deploy: o endereço antigo é redirecionado
-- pelo RouteGuard (ROTAS_MOVIDAS em src/lib/acesso.ts) e o useAccessibleMenus
-- casa a rota nova pelo mesmo código mesmo antes desta migration.
-- =========================================================================

UPDATE public.app_menu
   SET rota = '/app/suprimentos/saidas-por-contrato'
 WHERE codigo = 'sup_rel_saidas_contrato'
   AND rota = '/app/suprimentos/relatorios/saidas-por-contrato';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- UPDATE public.app_menu SET rota = '/app/suprimentos/relatorios/saidas-por-contrato'
--  WHERE codigo = 'sup_rel_saidas_contrato';
