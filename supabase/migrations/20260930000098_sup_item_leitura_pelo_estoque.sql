-- =====================================================================
-- SUPRIMENTOS — quem vê o Estoque passa a ver o NOME do material
--
-- O QUE ACONTECIA (14/09/2026, Matheus Kuhn Labres)
-- Em /app/suprimentos/estoque-etiquetas as linhas apareciam com almoxarifado,
-- quantidades e custo, mas com Código e Material em branco ("—").
--
-- A tela lê sup_estoque_item (liberado por `sup_estoque`) e traz o material
-- por join em sup_item. Só que sup_item_select exigia `sup_catalogo` — e o
-- estoquista tem o Estoque sem ter o Catálogo. O PostgREST não dá erro quando
-- a RLS barra a tabela do join: devolve `sup_item: null` e a tela mostra o
-- traço. Mesmo tipo de bloqueio silencioso que 20260901000001 descreve.
--
-- O QUE MUDA
-- Só a LEITURA de sup_item passa a aceitar também `sup_estoque`/visualizar.
-- Escrita continua exigindo `sup_catalogo`/alterar — ver o nome de um material
-- não dá direito de cadastrar nem de editar o catálogo. O menu Catálogo
-- continua escondido para quem não tem a permissão dele.
--
-- ROLLBACK:
--   DROP POLICY IF EXISTS sup_item_select ON public.sup_item;
--   CREATE POLICY sup_item_select ON public.sup_item FOR SELECT TO authenticated
--     USING (public.can_access(auth.uid(), 'sup_catalogo', 'visualizar'));
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================

DROP POLICY IF EXISTS sup_item_select ON public.sup_item;
CREATE POLICY sup_item_select ON public.sup_item FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'sup_catalogo', 'visualizar')
      OR public.can_access(auth.uid(), 'sup_estoque',  'visualizar'));

-- ── Conferência: a policy que ficou valendo de verdade ───────────────
SELECT policyname, cmd, pg_get_expr(p.polqual, p.polrelid) AS regra
  FROM pg_policy p
  JOIN pg_policies pp ON pp.policyname = p.polname AND pp.tablename = 'sup_item'
 WHERE p.polrelid = 'public.sup_item'::regclass;

NOTIFY pgrst, 'reload schema';
