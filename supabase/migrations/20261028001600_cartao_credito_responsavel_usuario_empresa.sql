-- SIS-2026-0759 (ajuste): o responsável pelo cartão passa a ser um USUÁRIO do ERP (login) e a "Empresa"
-- sai da lista de pessoas: vira um campo separado — uma empresa do grupo ou "Grupo" (todas).
-- "responsavel" (text) continua existindo como cache do nome do usuário, para a listagem não precisar de join.
ALTER TABLE public.malote_cartao_credito
  DROP CONSTRAINT IF EXISTS malote_cartao_credito_responsavel_check;

ALTER TABLE public.malote_cartao_credito
  ADD COLUMN IF NOT EXISTS responsavel_user_id uuid,
  ADD COLUMN IF NOT EXISTS responsavel_empresa_id uuid REFERENCES public.empresas(id),
  ADD COLUMN IF NOT EXISTS responsavel_grupo boolean NOT NULL DEFAULT false;

-- Empresa responsável OU Grupo, nunca os dois.
ALTER TABLE public.malote_cartao_credito
  DROP CONSTRAINT IF EXISTS malote_cartao_credito_responsavel_empresa_grupo_check;
ALTER TABLE public.malote_cartao_credito
  ADD CONSTRAINT malote_cartao_credito_responsavel_empresa_grupo_check
  CHECK (NOT (responsavel_grupo AND responsavel_empresa_id IS NOT NULL));

-- Valor antigo "Empresa" (lista fixa da primeira versão) deixa de ser pessoa.
UPDATE public.malote_cartao_credito SET responsavel = NULL WHERE responsavel = 'Empresa';

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   ALTER TABLE public.malote_cartao_credito DROP CONSTRAINT IF EXISTS malote_cartao_credito_responsavel_empresa_grupo_check;
--   ALTER TABLE public.malote_cartao_credito
--     DROP COLUMN IF EXISTS responsavel_user_id, DROP COLUMN IF EXISTS responsavel_empresa_id, DROP COLUMN IF EXISTS responsavel_grupo;
-- =====================================================================
