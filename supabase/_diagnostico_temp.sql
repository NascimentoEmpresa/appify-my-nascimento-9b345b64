-- DIAGNÓSTICO ROUND 2 — o BEGIN/ROLLBACK no final garante que nada disso
-- fica gravado, mesmo o UPDATE de teste. Rode tudo de uma vez (Run) e me
-- manda o resultado de cada bloco.

-- 1) todas as policies de UPDATE (e quaisquer outras) na tabela plano_acao —
--    pra descartar alguma policy antiga que não foi removida e ainda está
--    bloqueando junto com a pa_update nova.
select policyname, cmd, permissive, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'plano_acao'
order by cmd, policyname;

-- 2) RLS está habilitada/forçada na tabela? (relforcerowsecurity=true faria
--    a policy valer até pro dono da tabela, o que não deveria ser o caso aqui)
select relrowsecurity, relforcerowsecurity
from pg_class
where oid = 'public.plano_acao'::regclass;

-- 3) TESTE REAL: faz a UPDATE de verdade, como esse usuário faria, dentro
--    de uma transação, e desfaz no final — não grava nada no banco.
begin;

set local role authenticated;
select set_config('request.jwt.claim.sub', '97260632-2f1a-44e3-9f93-58b2b1f3702c', true);
select set_config('request.jwt.claims', '{"sub":"97260632-2f1a-44e3-9f93-58b2b1f3702c","role":"authenticated"}', true);

-- se isso der erro de RLS, o erro vai aparecer aqui embaixo, igual em produção
update public.plano_acao
   set titulo = titulo
 where id = 'eb853af2-55e3-4c23-9089-990d7f237684';

rollback;
