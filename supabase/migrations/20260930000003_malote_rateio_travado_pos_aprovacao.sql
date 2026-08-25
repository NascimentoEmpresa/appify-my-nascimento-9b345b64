-- SIS-2026-0223 (complemento 3, pedido do usuário): o WITH CHECK de
-- malote_rateio_linha_all só checava dono/admin/cargo, sem olhar o status
-- da despesa — o solicitante (ou o cargo-bypass) conseguia redistribuir
-- empresa/contrato do rateio mesmo com a despesa PARCELADA já aprovada e
-- em fase de pagamento (aguardando_pagamento em diante), incluindo
-- ajuste_pagamento (esse é sobre dado de pagamento, não redistribuição).
-- Alinhado com o usuário: pra despesa parcelada, o Rateio só é editável na
-- fase de lançamento (antes de virar "pagável") — depois disso, ninguém
-- mais mexe. Defesa em profundidade: o client (DespesaVisualizar.tsx) já
-- ganhou o mesmo gate, isto aqui é o reforço no banco.
--
-- Fronteira reaproveitada de STATUS_COM_PARCELA_VISIVEL
-- (src/hooks/useMaloteDespesa.ts) — os mesmos 4 status que tornam as
-- parcelas visíveis/pagáveis nas telas de lista são os que travam o
-- Rateio aqui. Despesa NÃO parcelada mantém o comportamento de sempre
-- (sem essa trava) — mudança futura, fora de escopo agora.
DROP POLICY IF EXISTS malote_rateio_linha_all ON public.malote_despesa_rateio_linha;
CREATE POLICY malote_rateio_linha_all ON public.malote_despesa_rateio_linha FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = despesa_id AND (
    d.created_by = auth.uid()
    OR has_role(auth.uid(), 'admin')
    OR (d.empresa_id = get_user_empresa(auth.uid()) AND public.malote_despesa_visivel_por_setor(auth.uid(), d.classificacao_id))
  )))
  WITH CHECK (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = despesa_id AND (
    has_role(auth.uid(), 'admin')
    OR (
      (d.created_by = auth.uid() OR public.malote_supervisor_por_cargo(auth.uid()))
      AND NOT (d.parcelado AND d.status IN ('aguardando_pagamento', 'pronto_para_pagar', 'ajuste_pagamento', 'despesa_paga'))
    )
  )));

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP POLICY IF EXISTS malote_rateio_linha_all ON public.malote_despesa_rateio_linha;
--   CREATE POLICY malote_rateio_linha_all ON public.malote_despesa_rateio_linha FOR ALL TO authenticated
--     USING (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = despesa_id AND (
--       d.created_by = auth.uid()
--       OR has_role(auth.uid(), 'admin')
--       OR (d.empresa_id = get_user_empresa(auth.uid()) AND public.malote_despesa_visivel_por_setor(auth.uid(), d.classificacao_id))
--     )))
--     WITH CHECK (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = despesa_id AND (
--       d.created_by = auth.uid()
--       OR has_role(auth.uid(), 'admin')
--       OR public.malote_supervisor_por_cargo(auth.uid())
--     )));
