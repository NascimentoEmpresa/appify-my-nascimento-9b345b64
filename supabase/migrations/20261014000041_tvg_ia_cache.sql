-- =========================================================================
-- TVs GERENCIAIS: CACHE DA EXPLICAÇÃO DA I.A (14/10/2026)
--
-- Pablo: "demorando muito pra dar resposta" (I.A "de onde vem este número",
-- Edge tvg-ia). A explicação de origem de um indicador só muda quando o
-- resultado muda — fica guardada aqui com a ASSINATURA do resultado (valor,
-- onde, causa, meta); mesmo número = resposta na hora, sem chamar a I.A.
-- Escrita e leitura só pela Edge (service_role); ninguém lê direto.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."TVG_IA_CACHE" (
  codigo     text PRIMARY KEY,
  assinatura text NOT NULL,
  texto      text NOT NULL,
  modelo     text,
  criado_em  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public."TVG_IA_CACHE" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."TVG_IA_CACHE" FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TABLE IF EXISTS public."TVG_IA_CACHE";
