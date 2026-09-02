-- SIS-2026-0279 (Iury): "alguns integrantes não estão conseguindo cancelar
-- despesa, eu consigo" — reproduzido com o João do Jurídico.
--
-- Causa: a policy malote_despesa_update (20260831000001) copiou a mesma
-- condição de status pro USING e pro WITH CHECK:
--   (created_by = auth.uid() AND status NOT IN (...terminais..., 'cancelada'))
-- USING é avaliado na linha ANTES do update (correto: só deixa mexer numa
-- despesa que ainda não está num status terminal). WITH CHECK é avaliado
-- na linha DEPOIS do update — com a mesma condição, ele proíbe a própria
-- transição que useCancelarDespesa faz (status: "cancelada"), porque o
-- status NOVO cai exatamente na lista proibida. Pra quem só é created_by
-- (sem has_role admin nem malote_supervisor_por_cargo), NENHUMA transição
-- pra status terminal passa por esse WITH CHECK — cancelar (e qualquer
-- outro caminho que grave um status terminal direto, sem RPC) é impossível
-- pra criador comum. Só passa quem cai num dos outros dois OR, que ignoram
-- esse check por completo — daí o Iury conseguir e o João não.
--
-- Fix: WITH CHECK não deve reavaliar o status da linha NOVA — só precisa
-- garantir que a linha continua pertencendo ao mesmo criador (created_by
-- não muda). Quem pode mexer é decidido pelo USING (linha antiga não
-- terminal); o que a mudança FAZ (inclusive virar terminal) é o próprio
-- propósito de cancelar. Sem regressão: ainda não dá pra reabrir/editar
-- uma despesa que já estava terminal (USING continua barrando isso).
DROP POLICY IF EXISTS malote_despesa_update ON public.malote_despesa;
CREATE POLICY malote_despesa_update ON public.malote_despesa FOR UPDATE TO authenticated
  USING (
    (created_by = auth.uid() AND status NOT IN ('despesa_paga', 'despesa_reprovada', 'solicitacao_reprovada', 'cancelada'))
    OR has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
  )
  WITH CHECK (
    created_by = auth.uid()
    OR has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
  );

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- DROP POLICY IF EXISTS malote_despesa_update ON public.malote_despesa;
-- CREATE POLICY malote_despesa_update ON public.malote_despesa FOR UPDATE TO authenticated
--   USING (
--     (created_by = auth.uid() AND status NOT IN ('despesa_paga', 'despesa_reprovada', 'solicitacao_reprovada', 'cancelada'))
--     OR has_role(auth.uid(), 'admin')
--     OR public.malote_supervisor_por_cargo(auth.uid())
--   )
--   WITH CHECK (
--     (created_by = auth.uid() AND status NOT IN ('despesa_paga', 'despesa_reprovada', 'solicitacao_reprovada', 'cancelada'))
--     OR has_role(auth.uid(), 'admin')
--     OR public.malote_supervisor_por_cargo(auth.uid())
--   );
-- NOTIFY pgrst, 'reload schema';
