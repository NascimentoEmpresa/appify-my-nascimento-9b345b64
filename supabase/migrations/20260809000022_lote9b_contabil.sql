-- Lote 9b: módulo Contábil — conta_contabil, lancamento_contabil/_partida,
-- realizado_lancamentos/_lotes. Confirmado via auditoria ao vivo que ainda
-- tinham has_role; a migration 20260718100003_fase3_contabil_fiscal.sql já
-- continha a correção pretendida pra essas tabelas, mas nunca foi rodada em
-- produção (mesmo padrão já visto nesta sessão com 20260802000005). NÃO
-- rodo esse arquivo inteiro: ele também recria plano_contas_solicitacao
-- (menu 'plano-contas') e stg_aprovacao_contas/stg_sugestoes_novas_contas
-- (menu 'aprovacao-contas'), que eu MESMO já migrei nos Lotes 8g-1/8g-4 pro
-- menu 'administracao', com grants reais já confirmados funcionando —
-- rodar o arquivo original de novo reverteria essas duas pra menus sem
-- nenhum grant e travaria todo mundo. Esta migration extrai só as 5
-- tabelas abaixo, usando os MESMOS menus/ações que o arquivo original já
-- desenhava (menus já existem em app_menu, com rota própria: 'lancamentos'
-- = /app/contabil/lancamentos, 'plano-contas' = /app/contabil/plano-contas,
-- 'avancada' = /app/contabil/avancada).
--
-- Texto USING/WITH CHECK copiado verbatim do estado AO VIVO (auditoria em
-- pg_policies desta sessão) — só troca has_role(...) por can_access(...).
-- Convenção: has_role(admin) sozinho (bypass total) -> 'excluir'; cargo
-- restrito (controladoria, às vezes +diretor_adm) combinado com tenant
-- scope -> 'alterar' (update/delete) ou 'incluir' (insert, quando o cargo
-- original incluía diretor_adm e update/delete não).
--
-- ROLLBACK: recriar cada policy com has_role() nas combinações originais
-- (ver auditoria ao vivo desta sessão, ou 20260718100003 seção
-- lancamento_contabil/lancamento_partida/conta_contabil/realizado_*).

-- ── conta_contabil (menu 'plano-contas') ────────────────────────────────
DROP POLICY IF EXISTS cc_cont_select ON public.conta_contabil;
CREATE POLICY cc_cont_select ON public.conta_contabil FOR SELECT TO authenticated
  USING (
    public.user_pode_atuar_empresa(auth.uid(), empresa_id)
    OR public.can_access(auth.uid(), 'plano-contas', 'excluir')
  );

DROP POLICY IF EXISTS cc_cont_insert ON public.conta_contabil;
CREATE POLICY cc_cont_insert ON public.conta_contabil FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access(auth.uid(), 'plano-contas', 'excluir')
    OR (public.can_access(auth.uid(), 'plano-contas', 'alterar') AND public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  );

DROP POLICY IF EXISTS cc_cont_update ON public.conta_contabil;
CREATE POLICY cc_cont_update ON public.conta_contabil FOR UPDATE TO authenticated
  USING (
    public.can_access(auth.uid(), 'plano-contas', 'excluir')
    OR (public.can_access(auth.uid(), 'plano-contas', 'alterar') AND public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  );

DROP POLICY IF EXISTS cc_cont_delete ON public.conta_contabil;
CREATE POLICY cc_cont_delete ON public.conta_contabil FOR DELETE TO authenticated
  USING (
    public.can_access(auth.uid(), 'plano-contas', 'excluir')
    OR (public.can_access(auth.uid(), 'plano-contas', 'alterar') AND public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  );

-- ── lancamento_contabil (menu 'lancamentos') ────────────────────────────
DROP POLICY IF EXISTS lc_select ON public.lancamento_contabil;
CREATE POLICY lc_select ON public.lancamento_contabil FOR SELECT TO authenticated
  USING (
    public.user_pode_atuar_empresa(auth.uid(), empresa_id)
    OR public.can_access(auth.uid(), 'lancamentos', 'excluir')
  );

DROP POLICY IF EXISTS lc_write ON public.lancamento_contabil;
CREATE POLICY lc_write ON public.lancamento_contabil FOR ALL TO authenticated
  USING (
    public.can_access(auth.uid(), 'lancamentos', 'excluir')
    OR (public.can_access(auth.uid(), 'lancamentos', 'alterar') AND public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  )
  WITH CHECK (
    public.can_access(auth.uid(), 'lancamentos', 'excluir')
    OR (public.can_access(auth.uid(), 'lancamentos', 'alterar') AND public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  );

-- ── lancamento_partida (espelha lancamento_contabil via EXISTS, mesmo menu) ─
DROP POLICY IF EXISTS lp_select ON public.lancamento_partida;
CREATE POLICY lp_select ON public.lancamento_partida FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.lancamento_contabil l
    WHERE l.id = lancamento_partida.lancamento_id
      AND (
        public.user_pode_atuar_empresa(auth.uid(), l.empresa_id)
        OR public.can_access(auth.uid(), 'lancamentos', 'excluir')
      )
  ));

DROP POLICY IF EXISTS lp_write ON public.lancamento_partida;
CREATE POLICY lp_write ON public.lancamento_partida FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.lancamento_contabil l
    WHERE l.id = lancamento_partida.lancamento_id
      AND (
        public.can_access(auth.uid(), 'lancamentos', 'excluir')
        OR (public.can_access(auth.uid(), 'lancamentos', 'alterar') AND public.user_pode_atuar_empresa(auth.uid(), l.empresa_id))
      )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.lancamento_contabil l
    WHERE l.id = lancamento_partida.lancamento_id
      AND (
        public.can_access(auth.uid(), 'lancamentos', 'excluir')
        OR (public.can_access(auth.uid(), 'lancamentos', 'alterar') AND public.user_pode_atuar_empresa(auth.uid(), l.empresa_id))
      )
  ));

-- ── realizado_lancamentos (menu 'avancada') — insert tinha diretor_adm,
--    update/delete não; preserva com 'incluir' (mais largo) vs 'alterar'. ──
DROP POLICY IF EXISTS rlanc_select ON public.realizado_lancamentos;
CREATE POLICY rlanc_select ON public.realizado_lancamentos FOR SELECT TO authenticated
  USING (
    public.user_pode_atuar_empresa(auth.uid(), empresa_id)
    OR public.can_access(auth.uid(), 'avancada', 'excluir')
  );

DROP POLICY IF EXISTS rlanc_insert ON public.realizado_lancamentos;
CREATE POLICY rlanc_insert ON public.realizado_lancamentos FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access(auth.uid(), 'avancada', 'excluir')
    OR (public.can_access(auth.uid(), 'avancada', 'incluir') AND public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  );

DROP POLICY IF EXISTS rlanc_update ON public.realizado_lancamentos;
CREATE POLICY rlanc_update ON public.realizado_lancamentos FOR UPDATE TO authenticated
  USING (
    public.can_access(auth.uid(), 'avancada', 'excluir')
    OR (public.can_access(auth.uid(), 'avancada', 'alterar') AND public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  );

DROP POLICY IF EXISTS rlanc_delete ON public.realizado_lancamentos;
CREATE POLICY rlanc_delete ON public.realizado_lancamentos FOR DELETE TO authenticated
  USING (
    public.can_access(auth.uid(), 'avancada', 'excluir')
    OR (public.can_access(auth.uid(), 'avancada', 'alterar') AND public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  );

-- ── realizado_lotes (menu 'avancada', FOR ALL já incluía diretor_adm) ────
DROP POLICY IF EXISTS rlot_select ON public.realizado_lotes;
CREATE POLICY rlot_select ON public.realizado_lotes FOR SELECT TO authenticated
  USING (
    public.user_pode_atuar_empresa(auth.uid(), empresa_id)
    OR public.can_access(auth.uid(), 'avancada', 'excluir')
  );

DROP POLICY IF EXISTS rlot_write ON public.realizado_lotes;
CREATE POLICY rlot_write ON public.realizado_lotes FOR ALL TO authenticated
  USING (
    public.can_access(auth.uid(), 'avancada', 'excluir')
    OR (public.can_access(auth.uid(), 'avancada', 'incluir') AND public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  )
  WITH CHECK (
    public.can_access(auth.uid(), 'avancada', 'excluir')
    OR (public.can_access(auth.uid(), 'avancada', 'incluir') AND public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  );

NOTIFY pgrst, 'reload schema';
