-- ============================================================================
-- RLS: can_access() + auth.uid() em subquery escalar — lote 3 (policies MISTAS)
-- ============================================================================
--
-- Continua as 20260930000265 (mz_*) e 20260930000267 (puras fora do mz_).
-- Aqui as policies MISTAS: filtro do tipo `user_id = auth.uid() OR can_access(...)`.
-- Alem do can_access por linha, o auth.uid() cru da comparacao tambem e avaliado
-- por linha, entao os DOIS sao envelopados em (select ...).
--
-- MEDIDO EM PRODUCAO (30/09/2026), como role authenticated:
--   notificacoes (13,5 mil linhas): scan puro 5 ms; com a policy crua 1.580 ms.
--   sessoes_ativas: 92 -> 258 ms. screen_permission_user: 21 -> 64 ms.
--
-- POR QUE E SEGURO
-- Envelopar can_access(...) e auth.uid() em (select ...) nao muda o booleano
-- (ambos STABLE) — muda so a frequencia de avaliacao. O auth.uid() de DENTRO do
-- can_access nao e tocado (fica no InitPlan do proprio can_access). Provado por
-- wrap+unwrap: remover os (select ...) devolve o texto ORIGINAL byte a byte
-- (9 expressoes, 0 divergencias).
-- Verificacao de visibilidade por perfil em docs/verificacao-rls-lote3.sql.
--
-- SISTEMA_NOVIDADES_LIDAS ficou de fora de proposito: sua policy e so
-- `user_id = auth.uid()` (sem can_access), e ali a RLS ja FILTRA linhas — medido,
-- a RLS ate acelera (2 ms vs 12 ms do scan puro). Nao ha ganho em mexer.
-- ============================================================================

-- notificacoes.criar notificacoes admin (INSERT)
DROP POLICY IF EXISTS "criar notificacoes admin" ON public."notificacoes";
CREATE POLICY "criar notificacoes admin" ON public."notificacoes"
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)) OR (user_id = (select auth.uid()))));

-- notificacoes.ver minhas notificacoes (SELECT)
DROP POLICY IF EXISTS "ver minhas notificacoes" ON public."notificacoes";
CREATE POLICY "ver minhas notificacoes" ON public."notificacoes"
  AS PERMISSIVE FOR SELECT TO public
  USING (((user_id = (select auth.uid())) OR (select can_access(auth.uid(), 'administracao'::text, 'visualizar'::app_acao))));

-- notificacoes.marcar minhas notificacoes (UPDATE)
DROP POLICY IF EXISTS "marcar minhas notificacoes" ON public."notificacoes";
CREATE POLICY "marcar minhas notificacoes" ON public."notificacoes"
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((user_id = (select auth.uid())) OR (select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))))
  WITH CHECK (((user_id = (select auth.uid())) OR (select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))));

-- screen_permission_user.spu_select (SELECT)
DROP POLICY IF EXISTS "spu_select" ON public."screen_permission_user";
CREATE POLICY "spu_select" ON public."screen_permission_user"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = (select auth.uid())) OR (select can_access(auth.uid(), 'administracao'::text, 'visualizar'::app_acao))));

-- sessoes_ativas.ver minhas sessoes (SELECT)
DROP POLICY IF EXISTS "ver minhas sessoes" ON public."sessoes_ativas";
CREATE POLICY "ver minhas sessoes" ON public."sessoes_ativas"
  AS PERMISSIVE FOR SELECT TO public
  USING (((user_id = (select auth.uid())) OR (select can_access(auth.uid(), 'administracao'::text, 'visualizar'::app_acao))));

-- sessoes_ativas.atualizar minhas sessoes (UPDATE)
DROP POLICY IF EXISTS "atualizar minhas sessoes" ON public."sessoes_ativas";
CREATE POLICY "atualizar minhas sessoes" ON public."sessoes_ativas"
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((user_id = (select auth.uid())) OR (select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))))
  WITH CHECK (((user_id = (select auth.uid())) OR (select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))));

-- sup_pedido.sup_pedido_insert (INSERT)
DROP POLICY IF EXISTS "sup_pedido_insert" ON public."sup_pedido";
CREATE POLICY "sup_pedido_insert" ON public."sup_pedido"
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((((select can_access(auth.uid(), 'encarregados_solicitar_materiais'::text, 'incluir'::app_acao)) OR (select can_access(auth.uid(), 'sup_pedidos_materiais'::text, 'alterar'::app_acao))) AND (criado_por = (select auth.uid()))));
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (volta cada policy a forma crua original)
-- ============================================================================
-- DROP POLICY IF EXISTS "criar notificacoes admin" ON public."notificacoes";
-- CREATE POLICY "criar notificacoes admin" ON public."notificacoes"
--   AS PERMISSIVE FOR INSERT TO public
--   WITH CHECK ((can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao) OR (user_id = auth.uid())));
-- DROP POLICY IF EXISTS "ver minhas notificacoes" ON public."notificacoes";
-- CREATE POLICY "ver minhas notificacoes" ON public."notificacoes"
--   AS PERMISSIVE FOR SELECT TO public
--   USING (((user_id = auth.uid()) OR can_access(auth.uid(), 'administracao'::text, 'visualizar'::app_acao)));
-- DROP POLICY IF EXISTS "marcar minhas notificacoes" ON public."notificacoes";
-- CREATE POLICY "marcar minhas notificacoes" ON public."notificacoes"
--   AS PERMISSIVE FOR UPDATE TO authenticated
--   USING (((user_id = auth.uid()) OR can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
--   WITH CHECK (((user_id = auth.uid()) OR can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));
-- DROP POLICY IF EXISTS "spu_select" ON public."screen_permission_user";
-- CREATE POLICY "spu_select" ON public."screen_permission_user"
--   AS PERMISSIVE FOR SELECT TO authenticated
--   USING (((user_id = auth.uid()) OR can_access(auth.uid(), 'administracao'::text, 'visualizar'::app_acao)));
-- DROP POLICY IF EXISTS "ver minhas sessoes" ON public."sessoes_ativas";
-- CREATE POLICY "ver minhas sessoes" ON public."sessoes_ativas"
--   AS PERMISSIVE FOR SELECT TO public
--   USING (((user_id = auth.uid()) OR can_access(auth.uid(), 'administracao'::text, 'visualizar'::app_acao)));
-- DROP POLICY IF EXISTS "atualizar minhas sessoes" ON public."sessoes_ativas";
-- CREATE POLICY "atualizar minhas sessoes" ON public."sessoes_ativas"
--   AS PERMISSIVE FOR UPDATE TO authenticated
--   USING (((user_id = auth.uid()) OR can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
--   WITH CHECK (((user_id = auth.uid()) OR can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));
-- DROP POLICY IF EXISTS "sup_pedido_insert" ON public."sup_pedido";
-- CREATE POLICY "sup_pedido_insert" ON public."sup_pedido"
--   AS PERMISSIVE FOR INSERT TO authenticated
--   WITH CHECK (((can_access(auth.uid(), 'encarregados_solicitar_materiais'::text, 'incluir'::app_acao) OR can_access(auth.uid(), 'sup_pedidos_materiais'::text, 'alterar'::app_acao)) AND (criado_por = auth.uid())));
-- NOTIFY pgrst, 'reload schema';
