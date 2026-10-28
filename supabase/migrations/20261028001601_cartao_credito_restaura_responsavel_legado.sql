-- SIS-2026-0759: restaura os nomes preservados pela 001499 depois que a
-- migration 001600 remove a restrição intermediária de responsáveis fixos.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'malote_cartao_credito'
       AND column_name = 'responsavel_legado_20261028'
  ) THEN
    UPDATE public.malote_cartao_credito
       SET responsavel = responsavel_legado_20261028
     WHERE responsavel_legado_20261028 IS NOT NULL
       AND responsavel_legado_20261028 <> 'Empresa';
  END IF;
END
$migration$;

ALTER TABLE public.malote_cartao_credito
  DROP COLUMN IF EXISTS responsavel_legado_20261028;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   -- A coluna temporária e os valores originais só existem durante a
--   -- sequência 001499 -> 001500 -> 001600 -> 001601.
-- =====================================================================
