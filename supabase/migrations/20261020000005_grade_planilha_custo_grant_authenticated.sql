-- [SEM-CHAMADO] "permission denied for table grade" / "permission denied for table planilha_custo" ao SALVAR (20/10/2026).
--
-- José (Licitações) não conseguiu salvar a grade nem a planilha de custo depois da virada para o cluster (16/10). "permission
-- denied for table" é GRANT, não RLS: a policy nem chega a rodar. É o mesmo grupo de problema das tabelas DIARIA_*
-- (20261019000002): o privilégio de tabela do `authenticated` não atravessou a virada. Foi corrigido à mão no cluster em
-- 20/10/2026; esta migration deixa o registro no repositório para uma reconstrução do banco não perder o grant.
--
-- GRANT só acrescenta (se o cluster já tinha, não muda nada) e a RLS continua decidindo quem lê e quem escreve. Não mexe em anon.
--
-- Idempotente. ROLLBACK (só se quiser voltar a negar escrita a authenticated nestas tabelas):
--   REVOKE INSERT, UPDATE, DELETE ON TABLE public.grade, public.planilha_custo FROM authenticated;
--   NOTIFY pgrst, 'reload schema';

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.grade, public.planilha_custo TO authenticated;

NOTIFY pgrst, 'reload schema';
