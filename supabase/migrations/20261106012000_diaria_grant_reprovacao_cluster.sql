-- Controle de Diárias: reprovar retorna 403 / permission denied for table
-- DIARIA_SOLICITACAO (prints de 06/11/2026, SD-2026-000280).
--
-- useDecidirSolicitacaoDiaria reprova com PATCH {status: 'reprovada'}.
-- A migration original 20260930000019 concedia SELECT e UPDATE, mas a
-- recomposição dos grants do cluster (20261019000002) só restaurou SELECT.
-- Sem privilégio de UPDATE, a requisição falha ANTES da RLS e diaria_guard().
-- Aprovação, ajuste e exclusão usam RPCs SECURITY DEFINER e não dependem dele.
--
-- Restaura somente a escrita da coluna usada pela reprovação. Não libera os
-- dados da solicitação nem os carimbos de decisão: diaria_guard() continua
-- validando permissão operacional/financeiro, estado solicitado, impedimento
-- de decidir a própria solicitação e preenchendo autor/data. A RLS e o evento
-- automático continuam ativos. Idempotente; funciona com o frontend atual.

GRANT UPDATE (status) ON TABLE public."DIARIA_SOLICITACAO" TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (retorna ao bloqueio do PATCH de reprovação quando não há UPDATE
-- de tabela; não remove grants mais amplos que já existiam):
-- REVOKE UPDATE (status) ON TABLE public."DIARIA_SOLICITACAO" FROM authenticated;
-- NOTIFY pgrst, 'reload schema';
