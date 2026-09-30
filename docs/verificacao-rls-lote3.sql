-- ============================================================================
--  Verificacao de visibilidade — reescrita RLS lote 3 (policies MISTAS)
--  (migration ..._rls_can_access_subquery_lote3_mistas.sql)
-- ============================================================================
--
--  Estas policies sao `user_id = auth.uid() OR can_access(...)`. O teste aqui e
--  MAIS FORTE que o dos lotes anteriores: um usuario sem 'administracao' NAO ve
--  zero — ve as PROPRIAS linhas (via user_id). Esse numero tem que ficar
--  IDENTICO depois: nem virar 0 (quebraria o acesso do dono), nem aumentar
--  (vazaria linha de outro).
--
--  COMO USAR (SQL Editor do projeto de producao)
--  1. Rode ANTES da migration. Confira contra o gabarito abaixo.
--  2. Aplique a migration do lote 3.
--  3. Rode de novo. Os 6 numeros tem que ser IDENTICOS.
--
--  Gabarito capturado em 30/09/2026 (antes da reescrita):
--    ADMIN (tem administracao): notificacoes 13876 | screen_permission_user 17381 | sessoes_ativas 6439
--    OUTRO (so as proprias):    notificacoes     7 | screen_permission_user     5 | sessoes_ativas    0
-- ============================================================================

-- ADMIN — ve tudo via can_access
BEGIN;
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims',
    '{"sub":"97260632-2f1a-44e3-9f93-58b2b1f3702c","role":"authenticated"}', true);
  SELECT 'ADMIN' AS perfil, 'notificacoes' AS tabela, count(*) AS linhas_visiveis FROM public.notificacoes
  UNION ALL SELECT 'ADMIN','screen_permission_user', count(*) FROM public.screen_permission_user
  UNION ALL SELECT 'ADMIN','sessoes_ativas', count(*) FROM public.sessoes_ativas;
ROLLBACK;

-- OUTRO — ve SO as proprias linhas via user_id (nao pode ser 0, nao pode aumentar)
BEGIN;
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims',
    '{"sub":"777fddd0-2739-4dc2-92fd-242cb1c206e6","role":"authenticated"}', true);
  SELECT 'OUTRO' AS perfil, 'notificacoes' AS tabela, count(*) AS linhas_visiveis FROM public.notificacoes
  UNION ALL SELECT 'OUTRO','screen_permission_user', count(*) FROM public.screen_permission_user
  UNION ALL SELECT 'OUTRO','sessoes_ativas', count(*) FROM public.sessoes_ativas;
ROLLBACK;

-- ============================================================================
-- Se os 6 numeros baterem depois de aplicar, esta seguro.
-- Atencao especial ao OUTRO: notificacoes tem que continuar 7 e
-- screen_permission_user tem que continuar 5. Qualquer mudanca = rollback.
-- ============================================================================
