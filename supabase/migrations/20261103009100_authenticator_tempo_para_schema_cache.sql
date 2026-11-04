-- =========================================================================
-- AUTHENTICATOR: tempo para o PostgREST recarregar o schema sob carga
-- (03/11/2026 — post-mortem em docs/incidentes/2026-11-03-post-mortem.md, C2)
--
-- O QUE ACONTECIA
--   A introspecção do schema (o "schema cache" do PostgREST) roda como
--   `authenticator`, que tinha statement_timeout = 8s (infra/ha/pos-restauracao.sql).
--   Em repouso ela leva 80–260 ms. Com a CPU do banco1 no teto passou de 8 s:
--   160 introspecções canceladas no dia. Cada uma vira
--     "Failed to load the schema cache" -> "Attempting to reconnect"
--   e o PostgREST DESCARTA O POOL e responde 503 para todo mundo. As duas
--   maiores quedas do dia começaram 8 a 11 s depois de uma migration aplicada
--   no merge (o NOTIFY pgrst manda recarregar): 14:00:48 -> 14:00:56 e
--   18:55:04 -> 18:55:15 UTC.
--
-- POR QUE SUBIR O DO AUTHENTICATOR NÃO AFROUXA AS TELAS
--   O PostgREST v12 aplica as configurações do papel PERSONIFICADO como
--   configuração de transação ("Impersonated Role Settings",
--   docs.postgrest.org/en/v12/references/transactions.html). Toda requisição
--   do ERP roda como `authenticated` (8 s) ou `anon` (3 s), e esses limites
--   continuam valendo. O do `authenticator` só sobra para o que roda SEM
--   personificação: a introspecção do schema — e o `service_role`, que não tem
--   limite próprio e passa de 8 s para 60 s (Edge Functions e worker).
--
-- lock_timeout continua 8 s: introspecção não pega lock que valha esperar.
--
-- O papel é de cluster (não de banco): ALTER ROLE vale para as conexões NOVAS.
-- O PostgREST pega na próxima reconexão; o pool atual segue com 8 s até lá.
-- =========================================================================

ALTER ROLE authenticator SET statement_timeout = '60s';

-- Conferência: falha a migration se o valor não ficou gravado.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'authenticator'
       AND 'statement_timeout=60s' = ANY (rolconfig)
  ) THEN
    RAISE EXCEPTION 'authenticator sem statement_timeout=60s';
  END IF;
END $$;

-- ROLLBACK
-- ALTER ROLE authenticator SET statement_timeout = '8s';
