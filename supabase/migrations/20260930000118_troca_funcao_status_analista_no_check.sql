-- =========================================================================
-- Mudança de Função: CHECK de status aceita "Pendente Analista"
--
-- SINTOMA (15/09/2026)
--   Enviar uma mudança de função falhava com: new row for relation
--   "SISTEMA_SOLICITACOES_TROCA_FUNCAO" violates check constraint
--   "stf_status_conhecido".
--
-- CAUSA
--   A 20260925000004 criou o CHECK com os status da época. A
--   20260930000042 (02/09/2026) colocou o ANALISTA na frente do fluxo — a
--   tela passou a nascer em "Pendente Analista" — e o CHECK não foi
--   atualizado. Toda solicitação nova era recusada pelo banco.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================
ALTER TABLE public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" DROP CONSTRAINT IF EXISTS stf_status_conhecido;
ALTER TABLE public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"
  ADD CONSTRAINT stf_status_conhecido CHECK (status IN (
    'Pendente Analista', 'Pendente Operacional', 'Pendente Escritório',
    'Pendente SST', 'Pendente RH', 'Concluída', 'Reprovada'
  ));

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Recriar o CHECK sem 'Pendente Analista' (texto na 20260925000004).
