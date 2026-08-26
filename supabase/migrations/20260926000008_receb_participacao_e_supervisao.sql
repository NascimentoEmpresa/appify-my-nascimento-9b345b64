-- =====================================================================
-- SIS-2026-0207 — recebimento: destravar a atribuição e devolver a
--                 supervisão
--
-- Achados na revisão da PR #432. Dois defeitos na mesma função de escopo.
--
-- DEFEITO 1 — o recebimento trava no primeiro que abrir.
-- `sup_receb_usuario_participa` só aceita um usuário "de fora" enquanto
-- `status = 'aguardando' AND recebido_por IS NULL`. Assim que alguém inicia,
-- mais ninguém consegue continuar, conferir ou recusar — e não existe RPC de
-- reatribuição nem escape para supervisor. Quem começou saiu de férias?
-- Aquele recebimento morre, e como `nf_lancar_estoque` também depende dele, a
-- NF nunca entra no estoque.
--
-- DEFEITO 2 — o supervisor perdeu a visão da quantidade esperada.
-- `sup_receb_itens` tem um ramo que revela `quantidade_esperada` para quem tem
-- `recebimentos/aprovar` — exatamente o que a conferência cega prevê (§15:
-- "somente o Gerente ou Supervisor do Almoxarifado poderá visualizar as
-- quantidades originalmente solicitadas"). Só que a função aborta ANTES, no
-- gate de participação, que não tem cláusula de aprovador. O ramo era
-- inalcançável: o supervisor auditando a conferência de outra pessoa levava
-- "atribuído a outro participante".
--
-- CORREÇÃO: quem tem `recebimentos/aprovar` participa de qualquer recebimento.
-- É o mesmo papel que já pode ver a quantidade esperada — dar-lhe acesso não
-- afrouxa a conferência cega, devolve a supervisão que ela pressupõe.
--
-- Idempotente. Só redefine uma função.
--
-- ROLLBACK: reaplicar a definição da 20260926000005 (reabre o travamento).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.sup_receb_usuario_participa(
  p_recebimento_id uuid, p_user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.recebimento_nf r
      LEFT JOIN public.sup_compra_pedido pc ON pc.id = r.sup_compra_pedido_id
      LEFT JOIN public.malote_despesa d ON d.id = pc.despesa_id
      LEFT JOIN public.planejamento_orcamentario_classificacao c
             ON c.id = d.classificacao_id
     WHERE r.id = p_recebimento_id
       AND (
         r.recebido_por = p_user_id
         OR pc.created_by = p_user_id
         OR d.created_by = p_user_id
         OR d.cotacao_decidida_por = p_user_id
         OR c.aprovador_solicitacao_user_id = p_user_id
         OR c.aprovador1_user_id = p_user_id
         OR c.aprovador2_user_id = p_user_id
         OR c.aprovador3_user_id = p_user_id
         -- Recebimentos ainda não atribuídos formam a fila de trabalho. O
         -- primeiro usuário autorizado que inicia a conferência assume a linha.
         OR (r.status = 'aguardando' AND r.recebido_por IS NULL)
         -- Supervisão do almoxarifado: participa de QUALQUER recebimento.
         -- Sem isto, (a) um recebimento iniciado por alguém que saiu ficava
         -- preso para sempre, e (b) o ramo de sup_receb_itens que mostra a
         -- quantidade esperada ao aprovador era inalcançável, porque esta
         -- função abortava antes.
         OR public.can_access(p_user_id, 'recebimentos', 'aprovar')
       )
  );
$$;

REVOKE ALL ON FUNCTION public.sup_receb_usuario_participa(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- ── Conferência ──────────────────────────────────────────────────────
-- Deve conter a cláusula de aprovador.
SELECT (pg_get_functiondef(p.oid) LIKE '%recebimentos%aprovar%') AS supervisao_ok
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'sup_receb_usuario_participa';

NOTIFY pgrst, 'reload schema';
