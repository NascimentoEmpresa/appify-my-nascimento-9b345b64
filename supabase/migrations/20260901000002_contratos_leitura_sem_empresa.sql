-- =====================================================================
-- CONTRATOS — leitura deixa de filtrar por empresa
--
-- POR QUE, E POR QUE URGENTE
-- A cascata do Catálogo de Materiais começa em `contratos`. Com a policy
-- atual, quem não tem linha em `user_empresa` enxerga ZERO contrato — e a
-- tela morre no primeiro passo com "Nenhum contrato", mesmo tendo todas as
-- permissões de Suprimentos.
--
-- Medido em produção: o CASSIO vê 0 de 64 contratos. E ele não é exceção:
-- 12 dos 66 usuários não têm nenhum vínculo em user_empresa.
--
-- A policy de SELECT de contratos é HOJE apenas:
--     empresa_id IN (SELECT ... FROM user_empresa WHERE user_id = auth.uid())
-- Sem can_access nenhum. Ou seja: a empresa não era um filtro a mais, era o
-- ÚNICO controle — e um controle que ninguém administra conscientemente.
--
-- O QUE MUDA, E O QUE NÃO MUDA
-- SELECT passa a ser aberto a `authenticated`. `contratos` é dado de
-- REFERÊNCIA: 16 tabelas apontam para ela (Suprimentos, Malote, Patrimônio,
-- Financeiro…), e o nome do contrato já aparece em tela em todos esses
-- módulos. Prender a leitura a um menu de Licitações quebraria justamente
-- quem usa contrato sem trabalhar com licitação.
--
-- INSERT/UPDATE/DELETE ficam COMO ESTÃO, de propósito. Trocar a regra de
-- escrita por can_access('contratos', ...) reduziria de 54 para 11 as pessoas
-- que conseguem cadastrar contrato — risco alto numa tabela que não é do
-- módulo de Suprimentos. Fica registrado para o dono de Licitações decidir.
--
-- ⚠️ TABELA DE OUTRO MÓDULO. Avise o responsável por Licitações.
-- =====================================================================

DROP POLICY IF EXISTS contratos_select ON public.contratos;
CREATE POLICY contratos_select ON public.contratos
  FOR SELECT TO authenticated
  USING (true);

COMMENT ON TABLE public.contratos IS
  'Dado de referência do ERP: leitura aberta a qualquer autenticado (16 tabelas dependem). Escrita segue restrita — ver policies de INSERT/UPDATE/DELETE.';

-- ── Conferência ──────────────────────────────────────────────────────
SELECT policyname, cmd,
       (coalesce(qual::text, '') || coalesce(with_check::text, '')) ILIKE '%empresa%' AS ainda_filtra_empresa
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'contratos'
 ORDER BY cmd;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP POLICY IF EXISTS contratos_select ON public.contratos;
--   CREATE POLICY contratos_select ON public.contratos FOR SELECT TO authenticated
--     USING (empresa_id IN (SELECT ue.empresa_id FROM public.user_empresa ue
--                            WHERE ue.user_id = auth.uid()));
-- =====================================================================