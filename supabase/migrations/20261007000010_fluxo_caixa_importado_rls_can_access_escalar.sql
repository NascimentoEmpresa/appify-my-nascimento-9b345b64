-- ============================================================================
-- Fluxo de Caixa — RLS da tabela da importação: can_access() em subquery escalar
-- ============================================================================
-- SINTOMA (07/10/2026): o Fluxo de Caixa não carregava; as páginas da view
-- v_fluxo_caixa_importado_fluxo_caixa (~20,8 mil linhas, em páginas de 1.000)
-- voltavam 500 (estouro do tempo máximo da consulta) e a tela ficava vazia.
--
-- CAUSA: a policy fluxo_caixa_importado_select escrevia can_access(...) CRUA, e
-- função crua em policy é avaliada UMA VEZ POR LINHA (mesmo problema já medido e
-- corrigido nas mz_* em 20260930000265: 12,4 s contra 0,3 ms ao envolver em
-- subquery). Com a checagem de login bloqueado do Sistemas dentro de
-- has_screen_access (migs 20261006160000 / 20261007000007 / 09), cada chamada
-- ficou bem mais cara (~90 acessos a buffer por chamada, medido em
-- financeiro_fluxo_caixa_ajuste). Vezes 20,8 mil linhas, cada página passava dos
-- 7 s, e o ORDER BY da paginação obriga a avaliar a tabela inteira.
--
-- CORREÇÃO: (select can_access(...)) — o Postgres calcula UMA vez por consulta,
-- como InitPlan. NÃO muda quem vê o quê: X e (SELECT X) são o mesmo booleano para
-- função STABLE; muda só quantas vezes é calculado.
--
-- Escopo: só esta tabela (a única grande do Fluxo). Tabelas pequenas (ajuste,
-- bancos...) não ganham nada com a reescrita e ficam como estão.
--
-- ROLLBACK: recriar a policy com USING (public.can_access(auth.uid(),
--   'financeiro-fluxo-caixa-gestao', 'visualizar')) — como em 20260930000283.

SET lock_timeout = '5s';

DROP POLICY IF EXISTS fluxo_caixa_importado_select ON public.fluxo_caixa_importado;
CREATE POLICY fluxo_caixa_importado_select ON public.fluxo_caixa_importado
  FOR SELECT TO authenticated
  USING ((SELECT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'visualizar')));

NOTIFY pgrst, 'reload schema';
