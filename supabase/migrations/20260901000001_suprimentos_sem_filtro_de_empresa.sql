-- =====================================================================
-- SUPRIMENTOS — empresa deixa de filtrar dado
--
-- DECISÃO DE PRODUTO (Eduardo, 13/08/2026)
-- A empresa do usuário é informação VISUAL. Ela não governa acesso: quem
-- governa é o Acesso por Usuário (can_access). Qualquer empresa enxerga
-- qualquer dado do módulo.
--
-- O QUE ESTAVA ACONTECENDO
-- Todas as 28 policies do módulo eram
--     can_access(...) AND empresa_id IN (SELECT ... FROM user_empresa ...)
-- e a segunda metade filtrava pelas empresas VINCULADAS ao usuário — não pela
-- empresa escolhida na topbar, o que já é confuso por si só. Pior: quem não
-- tem nenhuma linha em `user_empresa` casa com conjunto vazio e enxerga ZERO.
--
-- Medido em produção com o CASSIO, que tem todas as permissões de Suprimentos
-- e nenhum vínculo em user_empresa:
--     sup_item        0 de 1424
--     sup_posto       0 de 444
--     sup_patrimonio  0 de 129
--     malote_despesa  0 de 16
-- Telas vazias, sem erro nenhum na cara do usuário. É o pior tipo de bloqueio.
--
-- O QUE MUDA
-- Sai só a metade da empresa. Fica o `can_access` — mesma exigência de
-- permissão de antes, nem mais nem menos.
--
-- ESCOPO: só o módulo de Suprimentos e as cotações. As outras ~131 policies
-- do ERP que filtram por empresa (plano_*, nf_*, bdi_*, financeiro…) são de
-- outros módulos e NÃO foram tocadas — mexer nelas sem o dono é irresponsável.
-- =====================================================================

-- ── Catálogo ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS sup_posto_select ON public.sup_posto;
CREATE POLICY sup_posto_select ON public.sup_posto FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'sup_catalogo', 'visualizar'));

DROP POLICY IF EXISTS sup_posto_write ON public.sup_posto;
CREATE POLICY sup_posto_write ON public.sup_posto FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'sup_catalogo', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'sup_catalogo', 'alterar'));

DROP POLICY IF EXISTS sup_funcao_select ON public.sup_funcao;
CREATE POLICY sup_funcao_select ON public.sup_funcao FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'sup_catalogo', 'visualizar'));

DROP POLICY IF EXISTS sup_funcao_write ON public.sup_funcao;
CREATE POLICY sup_funcao_write ON public.sup_funcao FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'sup_catalogo', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'sup_catalogo', 'alterar'));

DROP POLICY IF EXISTS sup_item_select ON public.sup_item;
CREATE POLICY sup_item_select ON public.sup_item FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'sup_catalogo', 'visualizar'));

DROP POLICY IF EXISTS sup_item_write ON public.sup_item;
CREATE POLICY sup_item_write ON public.sup_item FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'sup_catalogo', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'sup_catalogo', 'alterar'));

DROP POLICY IF EXISTS sup_item_opcao_select ON public.sup_item_opcao;
CREATE POLICY sup_item_opcao_select ON public.sup_item_opcao FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'sup_catalogo', 'visualizar'));

DROP POLICY IF EXISTS sup_item_opcao_write ON public.sup_item_opcao;
CREATE POLICY sup_item_opcao_write ON public.sup_item_opcao FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'sup_catalogo', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'sup_catalogo', 'alterar'));

DROP POLICY IF EXISTS sup_funcao_item_select ON public.sup_funcao_item;
CREATE POLICY sup_funcao_item_select ON public.sup_funcao_item FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'sup_catalogo', 'visualizar'));

DROP POLICY IF EXISTS sup_funcao_item_write ON public.sup_funcao_item;
CREATE POLICY sup_funcao_item_write ON public.sup_funcao_item FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'sup_catalogo', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'sup_catalogo', 'alterar'));

-- ── Aprovação de catálogo ────────────────────────────────────────────
DROP POLICY IF EXISTS sup_cat_alteracao_select ON public.sup_cat_alteracao;
CREATE POLICY sup_cat_alteracao_select ON public.sup_cat_alteracao FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'sup_catalogo', 'visualizar')
      OR public.can_access(auth.uid(), 'sup_catalogo_aprovacao', 'visualizar'));

DROP POLICY IF EXISTS sup_cat_alteracao_write ON public.sup_cat_alteracao;
CREATE POLICY sup_cat_alteracao_write ON public.sup_cat_alteracao FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'sup_catalogo', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'sup_catalogo', 'alterar'));

DROP POLICY IF EXISTS sup_cat_lote_select ON public.sup_cat_lote;
CREATE POLICY sup_cat_lote_select ON public.sup_cat_lote FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'sup_catalogo', 'visualizar')
      OR public.can_access(auth.uid(), 'sup_catalogo_aprovacao', 'visualizar'));

-- ── Estoque ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS sup_estoque_item_select ON public.sup_estoque_item;
CREATE POLICY sup_estoque_item_select ON public.sup_estoque_item FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'sup_estoque', 'visualizar'));

DROP POLICY IF EXISTS sup_estoque_item_write ON public.sup_estoque_item;
CREATE POLICY sup_estoque_item_write ON public.sup_estoque_item FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'sup_estoque', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'sup_estoque', 'alterar'));

DROP POLICY IF EXISTS sup_estoque_mov_select ON public.sup_estoque_movimento;
CREATE POLICY sup_estoque_mov_select ON public.sup_estoque_movimento FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'sup_estoque', 'visualizar'));

-- ── Patrimônio ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS sup_patrimonio_select ON public.sup_patrimonio;
CREATE POLICY sup_patrimonio_select ON public.sup_patrimonio FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'sup_patrimonio', 'visualizar')
      OR public.can_access(auth.uid(), 'sup_manutencao', 'visualizar'));

DROP POLICY IF EXISTS sup_patrimonio_insert ON public.sup_patrimonio;
CREATE POLICY sup_patrimonio_insert ON public.sup_patrimonio FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'sup_patrimonio', 'incluir'));

DROP POLICY IF EXISTS sup_patrimonio_update ON public.sup_patrimonio;
CREATE POLICY sup_patrimonio_update ON public.sup_patrimonio FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'sup_patrimonio', 'alterar')
      OR public.can_access(auth.uid(), 'sup_manutencao', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'sup_patrimonio', 'alterar')
           OR public.can_access(auth.uid(), 'sup_manutencao', 'alterar'));

DROP POLICY IF EXISTS sup_patrimonio_delete ON public.sup_patrimonio;
CREATE POLICY sup_patrimonio_delete ON public.sup_patrimonio FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'sup_patrimonio', 'excluir'));

-- ── Pedidos de materiais ─────────────────────────────────────────────
-- O ramo do encarregado externo é preservado: ele não tem can_access nenhum,
-- e enxerga só o próprio pedido pela sessão em sup_ext_sessao.
DROP POLICY IF EXISTS sup_pedido_select ON public.sup_pedido;
CREATE POLICY sup_pedido_select ON public.sup_pedido FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_pedidos_materiais', 'visualizar')
    OR criado_por = auth.uid()
    OR EXISTS (SELECT 1 FROM public.sup_ext_sessao s
                WHERE s.user_id = auth.uid()
                  AND s.contrato_id = sup_pedido.contrato_id
                  AND s.login_informado = sup_pedido.solicitante_login)
  );

DROP POLICY IF EXISTS sup_pedido_insert ON public.sup_pedido;
CREATE POLICY sup_pedido_insert ON public.sup_pedido FOR INSERT TO authenticated
  WITH CHECK (
    (public.can_access(auth.uid(), 'encarregados_solicitar_materiais', 'incluir')
     OR public.can_access(auth.uid(), 'sup_pedidos_materiais', 'alterar'))
    AND criado_por = auth.uid()
  );

DROP POLICY IF EXISTS sup_pedido_update ON public.sup_pedido;
CREATE POLICY sup_pedido_update ON public.sup_pedido FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'sup_pedidos_materiais', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'sup_pedidos_materiais', 'alterar'));

DROP POLICY IF EXISTS sup_pedido_delete ON public.sup_pedido;
CREATE POLICY sup_pedido_delete ON public.sup_pedido FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'sup_pedidos_materiais', 'excluir'));

-- ── Cotações Licitação ↔ Compras ─────────────────────────────────────
DROP POLICY IF EXISTS cotacoes_select ON public.cotacoes_licitacao;
CREATE POLICY cotacoes_select ON public.cotacoes_licitacao FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'cotacoes-licitacao', 'visualizar')
      OR public.can_access(auth.uid(), 'sup_cotacoes', 'visualizar'));

DROP POLICY IF EXISTS cotacoes_insert ON public.cotacoes_licitacao;
CREATE POLICY cotacoes_insert ON public.cotacoes_licitacao FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'cotacoes-licitacao', 'incluir'));

DROP POLICY IF EXISTS cotacoes_update ON public.cotacoes_licitacao;
CREATE POLICY cotacoes_update ON public.cotacoes_licitacao FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'cotacoes-licitacao', 'visualizar')
      OR public.can_access(auth.uid(), 'sup_cotacoes', 'visualizar'));

DROP POLICY IF EXISTS cotacoes_delete ON public.cotacoes_licitacao;
CREATE POLICY cotacoes_delete ON public.cotacoes_licitacao FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'cotacoes-licitacao', 'excluir'));

-- ── RPCs do malote: sai a checagem de empresa ────────────────────────
CREATE OR REPLACE FUNCTION public.sup_malote_carregar(_id uuid, _acao public.app_acao)
RETURNS public.malote_despesa LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.malote_despesa;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT public.sup_malote_pode(_acao) THEN
    RAISE EXCEPTION 'Sem permissão em Suprimentos > Cotações do Malote' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v FROM public.malote_despesa d WHERE d.id = _id;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'Solicitação não encontrada' USING ERRCODE = 'P0002';
  END IF;
  -- A checagem de empresa saiu: empresa é informação visual, não permissão.

  IF v.status IN ('cotacao_aprovada','solicitacao_reprovada','cancelada',
                  'despesa_paga','despesa_reprovada','aguardando_pagamento',
                  'pendente_aprovacao','necessidade_de_ajuste') THEN
    RAISE EXCEPTION 'Esta solicitação está em "%" e não aceita mais alteração de cotação', v.status
      USING ERRCODE = '22023';
  END IF;

  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.sup_malote_compras_passadas(
  p_classificacao_id uuid, p_ignorar_id uuid DEFAULT NULL)
RETURNS TABLE (
  compras int, valor_medio numeric, fornecedor_frequente text, fornecedor_pct int,
  ultima_valor numeric, ultima_data timestamptz, ultima_fornecedor text,
  menor_valor numeric, menor_data timestamptz, menor_fornecedor text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH base AS (
    SELECT d.valor_aprovado_cotacao AS valor,
           d.cotacao_decidida_em    AS quando,
           CASE d.cotacao_vencedor_num WHEN 1 THEN d.cot1_fornecedor
                                       WHEN 2 THEN d.cot2_fornecedor
                                       ELSE d.cot3_fornecedor END AS fornecedor
      FROM public.malote_despesa d
     WHERE d.status = 'cotacao_aprovada'
       AND d.classificacao_id = p_classificacao_id
       -- sem recorte de empresa: o histórico de preço é do grupo inteiro
       AND d.valor_aprovado_cotacao IS NOT NULL
       AND (p_ignorar_id IS NULL OR d.id <> p_ignorar_id)
     ORDER BY d.cotacao_decidida_em DESC NULLS LAST
     LIMIT 10
  ),
  freq AS (
    SELECT fornecedor, count(*) n FROM base
     WHERE coalesce(btrim(fornecedor), '') <> ''
     GROUP BY 1 ORDER BY n DESC, fornecedor LIMIT 1
  )
  SELECT (SELECT count(*)::int FROM base),
         (SELECT round(avg(valor), 2) FROM base),
         (SELECT fornecedor FROM freq),
         (SELECT round(100.0 * n / nullif((SELECT count(*) FROM base), 0))::int FROM freq),
         (SELECT valor FROM base ORDER BY quando DESC NULLS LAST LIMIT 1),
         (SELECT quando FROM base ORDER BY quando DESC NULLS LAST LIMIT 1),
         (SELECT fornecedor FROM base ORDER BY quando DESC NULLS LAST LIMIT 1),
         (SELECT valor FROM base ORDER BY valor ASC LIMIT 1),
         (SELECT quando FROM base ORDER BY valor ASC LIMIT 1),
         (SELECT fornecedor FROM base ORDER BY valor ASC LIMIT 1);
$$;

-- ── Conferência ──────────────────────────────────────────────────────
SELECT tablename, count(*) AS policies_que_ainda_citam_empresa
  FROM pg_policies
 WHERE schemaname = 'public'
   AND (tablename LIKE 'sup!_%' ESCAPE '!' OR tablename LIKE 'cotacoes!_%' ESCAPE '!')
   AND (coalesce(qual::text, '') || coalesce(with_check::text, '')) ILIKE '%empresa%'
 GROUP BY 1 ORDER BY 1;

NOTIFY pgrst, 'reload schema';