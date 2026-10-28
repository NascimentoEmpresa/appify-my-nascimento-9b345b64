-- SIS-2026-0759: "Responsável pelo cartão" — quem está usando cada cartão (Helena, Antonio,
-- Guiomar, Senilton, Carlos ou Empresa). Troca de responsável não mexe na empresa do cartão.
-- Nullable: os cartões já cadastrados ficam sem responsável até alguém editar (a tela exige no cadastro/edição).
ALTER TABLE public.malote_cartao_credito
  ADD COLUMN IF NOT EXISTS responsavel text;

ALTER TABLE public.malote_cartao_credito
  DROP CONSTRAINT IF EXISTS malote_cartao_credito_responsavel_check;
ALTER TABLE public.malote_cartao_credito
  ADD CONSTRAINT malote_cartao_credito_responsavel_check
  CHECK (responsavel IS NULL OR responsavel IN ('Helena', 'Antonio', 'Guiomar', 'Senilton', 'Carlos', 'Empresa'));

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   ALTER TABLE public.malote_cartao_credito DROP CONSTRAINT IF EXISTS malote_cartao_credito_responsavel_check;
--   ALTER TABLE public.malote_cartao_credito DROP COLUMN IF EXISTS responsavel;
-- =====================================================================
