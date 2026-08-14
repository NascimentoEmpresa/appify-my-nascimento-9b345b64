-- =====================================================================
-- SIS-2026-0112 — fecha o `anon` nas funções auxiliares
--
-- A 20260831000001 revogou o acesso público das 6 RPCs de porta e de duas
-- auxiliares, mas esqueceu três: sup_malote_brl, sup_malote_pode e
-- sup_malote_nome_ator. No Postgres, função nova nasce com EXECUTE para
-- PUBLIC, então elas ficaram alcançáveis pelo papel `anon`.
--
-- NÃO houve vazamento: sup_malote_brl só formata número; sup_malote_pode
-- devolve can_access(auth.uid(), ...), que é false sem sessão; e
-- sup_malote_nome_ator devolve o nome do PRÓPRIO chamador, nunca o de outra
-- pessoa. Mesmo assim elas não têm por que estar abertas — e o encarregado
-- externo do Supply navega em sessão anônima, então essa superfície é real
-- ainda que inofensiva.
-- =====================================================================

REVOKE ALL ON FUNCTION public.sup_malote_brl(numeric)            FROM public, anon;
REVOKE ALL ON FUNCTION public.sup_malote_pode(public.app_acao)   FROM public, anon;
REVOKE ALL ON FUNCTION public.sup_malote_nome_ator()             FROM public, anon;

GRANT EXECUTE ON FUNCTION public.sup_malote_brl(numeric)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_malote_pode(public.app_acao) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_malote_nome_ator()           TO authenticated;

-- ── Conferência: nenhuma sup_malote_* pode sobrar com anon ───────────
SELECT p.proname,
       (SELECT string_agg(a.rolname, ', ' ORDER BY a.rolname)
          FROM aclexplode(p.proacl) x JOIN pg_roles a ON a.oid = x.grantee
         WHERE x.privilege_type = 'EXECUTE') AS quem_executa
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname LIKE 'sup_malote%'
 ORDER BY 1;

NOTIFY pgrst, 'reload schema';