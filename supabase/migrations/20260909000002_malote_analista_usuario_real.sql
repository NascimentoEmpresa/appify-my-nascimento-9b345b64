-- SIS-2026-0170 (ajuste após feedback do usuário): o catálogo
-- "malote_analista" criado em 20260909000001 estava desconectado dos
-- usuários reais do sistema — o Iury já tem usuários com cargo "Analista
-- de Contrato" (profiles.cargo, mesmo texto livre curado usado nos
-- Aprovadores), então o vínculo deve apontar direto pra auth.users, não
-- pra um catálogo de nome digitado à parte.
--
-- Sem filtro por cargo no picker (outro ponto do feedback): existe pelo
-- menos uma exceção conhecida (colaboradora com cargo "Aprendiz" que
-- também atua como analista), então o picker busca entre TODOS os
-- usuários ativos, com o cargo aparecendo só como informação auxiliar —
-- mesmo padrão de useAprovadoresDisponiveis() sem slot.
--
-- Ambas as tabelas ainda estavam vazias (nenhum dado real cadastrado),
-- confirmado antes de rodar isto.

ALTER TABLE public.malote_analista_contrato
  DROP CONSTRAINT IF EXISTS malote_analista_contrato_analista_id_fkey,
  DROP CONSTRAINT IF EXISTS malote_analista_contrato_analista_id_contrato_id_key,
  DROP COLUMN IF EXISTS analista_id,
  ADD COLUMN analista_user_id uuid NOT NULL REFERENCES auth.users(id),
  ADD CONSTRAINT malote_analista_contrato_analista_user_id_contrato_id_key UNIQUE (analista_user_id, contrato_id);

DROP TABLE IF EXISTS public.malote_analista;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   (tabelas ainda vazias em produção no momento desta migration — sem
--   necessidade de reconstrução de dado)
-- =====================================================================
