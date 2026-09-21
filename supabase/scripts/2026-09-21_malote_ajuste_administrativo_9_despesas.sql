-- [SEM-CHAMADO] (Iury): empurra as 9 despesas do print de hoje (todas
-- "Pendente aprovação N2" com exceção=Sim) direto pra "Aguardando
-- pagamento", por decisão administrativa — fora do fluxo normal de
-- aprovação. Fica registrado no histórico de cada despesa como um evento
-- 'ajuste_administrativo' (ver migration 20260930000188, RODAR ANTES
-- deste script) em vez de 'aprovacao_nivel', pra diferenciar de uma
-- aprovação real.
--
-- Guarda de segurança: só afeta despesa que hoje ainda está
-- status='pendente_aprovacao' — rodar este script de novo não duplica
-- nada (2ª vez não acha nenhuma linha nesse status pra mover/logar).
--
-- Script de uso único (não é migration — não roda de novo em outro
-- ambiente, é específico pra estas 9 despesas de hoje).

WITH movidas AS (
  UPDATE public.malote_despesa
  SET status = 'aguardando_pagamento'
  WHERE numero IN (
    'SD-2026-0046', 'SD-2026-0051', 'SD-2026-0061', 'SD-2026-0053', 'SD-2026-0060',
    'SD-2026-0055', 'SD-2026-0056', 'SD-2026-0057', 'SD-2026-0059'
  )
  AND status = 'pendente_aprovacao'
  RETURNING id, numero, nivel_aprovacao_atual
)
INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, nivel, descricao)
SELECT id, 'ajuste_administrativo', nivel_aprovacao_atual,
       'Movida para "Aguardando pagamento" manualmente via banco (ajuste administrativo), fora do fluxo normal de aprovação.'
FROM movidas
RETURNING despesa_id, tipo_evento;
