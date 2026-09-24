-- SIS-2026-0524: corrige erro de produção "Could not choose the best
-- candidate function" no Confirmar Pagamento do Malote.
--
-- Causa: a migration 20260930000230_controle_juros_malote.sql adicionou o
-- parâmetro _valor_juros em malote_pagar_despesa/malote_pagar_parcela via
-- CREATE OR REPLACE FUNCTION — mas Postgres identifica função pela
-- assinatura (nome + tipos de parâmetro), não só pelo nome. Como o número
-- de parâmetros mudou (7 → 8), isso criou um SEGUNDO overload em vez de
-- substituir o original da 20260930000039_malote_pagamento_banco.sql — as
-- duas assinaturas passaram a coexistir no banco. Uma chamada com os 7
-- parâmetros antigos passou a ter dois candidatos possíveis (a antiga, e a
-- nova com _valor_juros DEFAULT NULL), e o PostgREST não sabe desambiguar.
--
-- Fix: DROP explícito da assinatura de 7 parâmetros antes de recriar a de
-- 8 — sem isso, CREATE OR REPLACE nunca remove o overload velho.

DROP FUNCTION IF EXISTS public.malote_pagar_despesa(uuid, date, text, text, jsonb, text, uuid);
DROP FUNCTION IF EXISTS public.malote_pagar_parcela(uuid, uuid, date, text, text, jsonb, text, uuid);

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
--   (recriar as assinaturas de 7 parâmetros, ver
--   20260930000039_malote_pagamento_banco.sql, se for necessário reverter
--   a feature de juros por completo — nesse caso também reverter a
--   20260930000230_controle_juros_malote.sql)
-- =====================================================================
