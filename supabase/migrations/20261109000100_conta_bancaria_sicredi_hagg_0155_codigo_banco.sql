-- [SEM-CHAMADO] Conta Sicredi HAGG ag. 0155 / 32026-9 estava com banco_codigo '478' (digitação trocada); o código do Sicredi é '748'.
-- ============================================================================
-- Achado ao preparar a integração PagFor (SIS-2026-0681): o arquivo CNAB leva o código do banco em todo registro, e '478' não existe.
-- Só corrige a conta apontada pelo id, e só se ainda estiver com '478' — reexecutar não muda nada. A outra conta (ag. 0119) já está '748'.
-- Não há chave única em conflito: UNIQUE (empresa_id, banco_codigo, agencia, conta) e a agência/conta desta linha é única.
-- Idempotente.

UPDATE public.conta_bancaria
   SET banco_codigo = '748'
 WHERE id = '2fad14a9-8141-4f62-b2e0-eff272194732'
   AND banco_codigo = '478'
   AND agencia = '0155'
   AND conta = '32026';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- UPDATE public.conta_bancaria SET banco_codigo = '478' WHERE id = '2fad14a9-8141-4f62-b2e0-eff272194732';
