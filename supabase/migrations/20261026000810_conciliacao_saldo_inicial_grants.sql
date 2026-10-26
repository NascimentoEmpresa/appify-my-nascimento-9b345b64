-- [SEM-CHAMADO] Conciliação: "permission denied for table financeiro_conciliacao_saldo_inicial"
--
-- A 20261023000300 criou a tabela e as policies (can_access 'conciliacao-fluxo-caixa'),
-- mas não deu GRANT ao papel authenticated. No cluster as tabelas novas não herdam o
-- privilégio de tabela: sem ele o Postgres nega a leitura ANTES de avaliar a RLS, e a
-- tela de Conciliação falha para quem não é dono/admin (Erica). Quem pode ver/gravar
-- continua sendo decidido pelas policies.
--
-- Idempotente (GRANT repetido não faz mal).

GRANT SELECT, INSERT, UPDATE, DELETE ON public.financeiro_conciliacao_saldo_inicial TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   REVOKE SELECT, INSERT, UPDATE, DELETE ON public.financeiro_conciliacao_saldo_inicial FROM authenticated;
--   NOTIFY pgrst, 'reload schema';
