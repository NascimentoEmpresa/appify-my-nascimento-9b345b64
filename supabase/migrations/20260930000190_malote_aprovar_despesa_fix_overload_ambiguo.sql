-- SIS-2026-0439 (fix urgente): a migration 20260930000189 tentou trocar
-- malote_aprovar_despesa adicionando _autorizador_nome, mas CREATE OR
-- REPLACE FUNCTION só substitui quando a assinatura é IDÊNTICA — como o
-- número de parâmetros mudou (8 → 9, o novo com DEFAULT), o Postgres criou
-- um SEGUNDO overload em vez de substituir o antigo. Com dois overloads e
-- os dois últimos parâmetros tendo DEFAULT em ambas as versões, qualquer
-- chamada via PostgREST com 8 argumentos nomeados passou a ser ambígua —
-- quebrou aprovação de despesa pra todo usuário em produção ("Could not
-- choose the best candidate function between...").
--
-- Fix: apaga o overload antigo (8 parâmetros, sem _autorizador_nome) que
-- ficou sobrando. O overload novo (9 parâmetros, criado pela migration 189)
-- continua sendo o único e passa a resolver sem ambiguidade.
--
-- ROLLBACK:
--   (recriar a função de 8 parâmetros com o corpo de
--    20260930000084_malote_veda_data_pagamento_passada.sql)
--   NOTIFY pgrst, 'reload schema';

DROP FUNCTION IF EXISTS public.malote_aprovar_despesa(
  uuid, boolean, numeric, text, text, text, date, date, jsonb
);

NOTIFY pgrst, 'reload schema';
