-- SIS-2026-0759: prepara a migration 20261028001500 para instalações onde
-- malote_cartao_credito.responsavel já existe com nomes completos de usuários.
-- A versão 001500 aplica temporariamente uma lista fixa e falha ao validar
-- esses nomes. O valor original fica preservado até a 001601, após a 001600
-- remover definitivamente a lista fixa.
ALTER TABLE public.malote_cartao_credito
  ADD COLUMN IF NOT EXISTS responsavel_legado_20261028 text;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'malote_cartao_credito'
       AND column_name = 'responsavel'
  ) THEN
    UPDATE public.malote_cartao_credito
       SET responsavel_legado_20261028 = responsavel
     WHERE responsavel IS NOT NULL;

    -- A migration 001500 precisa validar esta lista intermediária. Os valores
    -- fora dela são restaurados pela 001601, não descartados.
    UPDATE public.malote_cartao_credito
       SET responsavel = NULL
     WHERE responsavel IS NOT NULL
       AND responsavel NOT IN ('Helena', 'Antonio', 'Guiomar', 'Senilton', 'Carlos', 'Empresa');
  END IF;
END
$migration$;

-- =====================================================================
-- ROLLBACK
--   ALTER TABLE public.malote_cartao_credito DROP COLUMN IF EXISTS responsavel_legado_20261028;
-- =====================================================================
