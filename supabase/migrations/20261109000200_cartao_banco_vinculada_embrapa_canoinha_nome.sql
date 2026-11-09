-- [SEM-CHAMADO] Banco "Conta Vinculda Embrapa Canoinha" (sem o A): corrige o nome para "Conta Vinculada"
-- ============================================================================
-- Com o nome digitado errado, a conciliação bancária tratava o resgate de 12/01/2026 (R$ 12.795,04) como movimento interno e o
-- escondia do Fluxo, e o extrato OFX ficava com a divergência "Consta no extrato, sem lançamento no Fluxo".
-- O lançamento aponta para o banco por id (banco_id), então basta renomear o cadastro. Só altera se ainda estiver com o nome errado
-- (reexecutar não muda nada); não há outro banco com o nome certo, então não conflita.
-- Idempotente.

UPDATE public.malote_cartao_banco
   SET nome = 'Banco do Brasil Conta Vinculada Embrapa Canoinha'
 WHERE id = 'f57efbe2-3c5b-4f81-a526-e5458eaa58a1'
   AND nome = 'Banco do Brasil Conta Vinculda Embrapa Canoinha';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- UPDATE public.malote_cartao_banco SET nome = 'Banco do Brasil Conta Vinculda Embrapa Canoinha' WHERE id = 'f57efbe2-3c5b-4f81-a526-e5458eaa58a1';
