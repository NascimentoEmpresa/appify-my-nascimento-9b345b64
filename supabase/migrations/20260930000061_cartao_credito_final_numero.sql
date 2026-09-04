-- SIS-2026-0255 (achado testando o import de fatura com o usuário): mais
-- de um cartão cadastrado tem o MESMO titular (ex. "HELENA R NASCIMENTO"
-- aparece tanto no cartão Banrisul quanto no Banco do Brasil dela) — o
-- usuário confundiu qual cartão selecionar na hora de importar a fatura,
-- guiando só pelo nome. "Final do Cartão" (4 últimos dígitos) fica visível
-- no cadastro e no Select de import, pra bater com o que está escrito na
-- fatura de verdade sem depender de decorar nome × banco.
ALTER TABLE public.malote_cartao_credito
  ADD COLUMN final_cartao text CHECK (final_cartao IS NULL OR final_cartao ~ '^\d{4}$');

-- Backfill dos 6 cartões já cadastrados — final já embutido no próprio
-- "Nome no Malote" (tipo_forma_pagamento = "Cartão de Crédito - NNNN").
UPDATE public.malote_cartao_credito
SET final_cartao = substring(tipo_forma_pagamento FROM '\d{4}$')
WHERE tipo_forma_pagamento ~ '\d{4}$' AND final_cartao IS NULL;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   ALTER TABLE public.malote_cartao_credito DROP COLUMN IF EXISTS final_cartao;
-- =====================================================================
