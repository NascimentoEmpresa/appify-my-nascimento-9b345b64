-- =====================================================================
-- SIS-2026-0199 — hotfix: preços vazavam entre empresas do grupo
--
-- Achado na revisão da PR #426 (regra J7 — filtro de escopo em query nova).
--
-- O QUE ESTAVA ERRADO
-- A 20260925000004 criou duas funções SECURITY DEFINER que leem
-- sup_estoque_item direto, e a policy de sup_item_preco checando só
-- can_access. Nos três casos faltou o recorte por empresa.
--
-- Em SECURITY DEFINER a RLS da tabela lida NÃO se aplica — a função roda com
-- os privilégios do dono. Então o filtro que sup_estoque_item_select faz…
--
--     AND empresa_id IN (SELECT ue.empresa_id FROM public.user_empresa ue
--                         WHERE ue.user_id = auth.uid())
--
-- …era pulado. Resultado: quem tivesse o menu `sup_precos_consulta` (ou
-- `sup_estoque`) enxergava o preço de TODAS as empresas do grupo, não só das
-- suas. A tela de Licitações é justamente a que mais gente vai ter.
--
-- É o mesmo erro que o README já descreve em outras palavras: ter o menu
-- liberado responde "esta pessoa acessa a TELA?", nunca "esta pessoa pode ver
-- ESTA LINHA?". As duas perguntas precisam ser feitas.
--
-- Idempotente. Só redefine as funções e a policy; nenhum dado é tocado.
--
-- ROLLBACK: reaplicar as definições da 20260925000004 (sem o filtro).
--           Não recomendado — reabre o vazamento.
-- =====================================================================

-- ── 1) Policy da tabela de histórico ─────────────────────────────────
DROP POLICY IF EXISTS sup_item_preco_select ON public.sup_item_preco;
CREATE POLICY sup_item_preco_select ON public.sup_item_preco
  FOR SELECT TO authenticated
  USING (
    (
      public.can_access(auth.uid(), 'sup_estoque', 'visualizar')
      OR public.can_access(auth.uid(), 'sup_precos_consulta', 'visualizar')
    )
    -- Sem isto, o menu liberado bastava para ler o preço de qualquer empresa.
    AND sup_item_preco.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
  );

-- ── 2) Histórico de um material ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sup_item_precos(p_sup_item_id uuid)
RETURNS TABLE (
  valor_unitario numeric, valor_anterior numeric, valido_ate date,
  origem text, fornecedor_nome text, documento text,
  registrado_em timestamptz, registrado_por_nome text, almoxarifado text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.valor_unitario, p.valor_anterior, p.valido_ate, p.origem,
         p.fornecedor_nome, p.documento, p.registrado_em, p.registrado_por_nome,
         a.nome
    FROM public.sup_item_preco p
    LEFT JOIN public.almoxarifado a ON a.id = p.almoxarifado_id
   WHERE p.sup_item_id = p_sup_item_id
     AND (public.can_access(auth.uid(), 'sup_estoque', 'visualizar')
          OR public.can_access(auth.uid(), 'sup_precos_consulta', 'visualizar'))
     AND p.empresa_id IN (
       SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
     )
   ORDER BY p.registrado_em DESC
   LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.sup_item_precos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_item_precos(uuid) TO authenticated;

-- ── 3) Consulta de preços da Licitação ───────────────────────────────
CREATE OR REPLACE FUNCTION public.sup_precos_consulta(p_busca text DEFAULT NULL)
RETURNS TABLE (
  sup_item_id uuid, material text, tipo text,
  valor_unitario numeric, valido_ate date, vencido boolean,
  fornecedor_nome text, atualizado_em timestamptz, almoxarifado text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT ON (ei.sup_item_id)
         ei.sup_item_id, i.nome, i.tipo,
         ei.valor_unitario, ei.preco_valido_ate,
         (ei.preco_valido_ate IS NOT NULL AND ei.preco_valido_ate < CURRENT_DATE),
         COALESCE(f.razao_social, ei.fornecedor),
         ei.updated_at, a.nome
    FROM public.sup_estoque_item ei
    JOIN public.sup_item i ON i.id = ei.sup_item_id
    LEFT JOIN public.fornecedor f ON f.id = ei.fornecedor_id
    LEFT JOIN public.almoxarifado a ON a.id = ei.almoxarifado_id
   WHERE COALESCE(ei.valor_unitario, 0) > 0
     AND i.ativo
     AND (p_busca IS NULL OR btrim(p_busca) = ''
          OR i.nome ILIKE '%' || btrim(p_busca) || '%')
     AND (public.can_access(auth.uid(), 'sup_precos_consulta', 'visualizar')
          OR public.can_access(auth.uid(), 'sup_estoque', 'visualizar'))
     -- O mesmo recorte que sup_estoque_item_select faz, refeito à mão porque
     -- SECURITY DEFINER não passa pela RLS da tabela.
     AND ei.empresa_id IN (
       SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
     )
   ORDER BY ei.sup_item_id, ei.updated_at DESC
$$;

REVOKE ALL ON FUNCTION public.sup_precos_consulta(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_precos_consulta(text) TO authenticated;

-- ── Conferência ──────────────────────────────────────────────────────
-- Deve devolver só material das empresas do usuário logado.
SELECT count(*) AS precos_visiveis_para_mim FROM public.sup_precos_consulta(NULL);

NOTIFY pgrst, 'reload schema';
