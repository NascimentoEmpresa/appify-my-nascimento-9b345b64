-- A migration 20260819000007 já mandava revogar, mas no banco do app a função
-- ficou com EXECUTE para PUBLIC e para anon (só o CREATE FUNCTION entrou; os
-- REVOKE do mesmo arquivo não foram aplicados). Resultado: qualquer um com a
-- chave anon, que é pública no bundle do front, lista as vagas abertas.
--
-- REVOKE de PUBLIC não basta: anon tem grant PRÓPRIO e continuaria executando.
-- Idempotente.
REVOKE ALL ON FUNCTION public.wa_vagas_abertas() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wa_vagas_abertas() FROM anon;
GRANT EXECUTE ON FUNCTION public.wa_vagas_abertas() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wa_vagas_abertas() TO service_role;

NOTIFY pgrst, 'reload schema';
