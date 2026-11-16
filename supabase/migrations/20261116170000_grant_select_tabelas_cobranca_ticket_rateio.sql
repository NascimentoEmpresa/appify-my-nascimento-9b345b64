-- GRANT SELECT nas tabelas novas lidas direto pela tela (cobranca_registro, ticket_extrato_*, DEBITO_AUTOMATICO_RATEIO)
-- ============================================================================
-- Tabela criada por quem NÃO é o postgres (ex.: o usuário do pgAdmin) não herda o GRANT padrão do papel `authenticated`: só o postgres e o
-- supabase_admin têm default privileges neste cluster. O resultado é "permission denied for table ..." na leitura pela tela, mesmo com a RLS
-- certa (a escrita pelas RPCs SECURITY DEFINER funciona, o que esconde o problema). O `CREATE TABLE IF NOT EXISTS` das migrations originais não
-- corrige isso numa tabela que já existe, então o GRANT vai explícito aqui. A RLS continua decidindo quem vê o quê.
--   • cobranca_registro            (SIS-2026-0878, 20261115120000)
--   • ticket_extrato_importacao    (SIS-2026-0825, 20261116160000)
--   • ticket_extrato_linha         (SIS-2026-0825, 20261116160000)
--   • DEBITO_AUTOMATICO_RATEIO     (SIS-2026-0877, 20261115110000) — lida pela view do Fluxo (security_invoker); aqui só por garantia
-- Idempotente. NOTIFY ao final.
--
-- ROLLBACK:
--   REVOKE SELECT ON public.cobranca_registro, public.ticket_extrato_importacao, public.ticket_extrato_linha, public."DEBITO_AUTOMATICO_RATEIO" FROM authenticated;
--   NOTIFY pgrst, 'reload schema';

GRANT SELECT ON public.cobranca_registro TO authenticated;
GRANT SELECT ON public.ticket_extrato_importacao TO authenticated;
GRANT SELECT ON public.ticket_extrato_linha TO authenticated;
GRANT SELECT ON public."DEBITO_AUTOMATICO_RATEIO" TO authenticated;

NOTIFY pgrst, 'reload schema';
