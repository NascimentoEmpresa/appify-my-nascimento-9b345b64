-- SIS-2026-0582: a tela de Emissão de NF passa a registrar, por nota, o
-- Código de Serviço, o CNAE e o código NBS (digitados pela analista; o
-- Código de Serviço e o CNAE vêm pré-preenchidos do contrato, que já os tem
-- em contratos.codigo_servico_lc116 / codigo_servico_municipal_cnae). NBS não
-- existia em lugar nenhum. Colunas livres e opcionais — a obrigatoriedade
-- (se vier) é decidida na tela, não no banco, pra não quebrar nota antiga.

ALTER TABLE public.nf_emissao
  ADD COLUMN IF NOT EXISTS codigo_servico text,
  ADD COLUMN IF NOT EXISTS cnae text,
  ADD COLUMN IF NOT EXISTS nbs text;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public.nf_emissao
--   DROP COLUMN IF EXISTS codigo_servico,
--   DROP COLUMN IF EXISTS cnae,
--   DROP COLUMN IF EXISTS nbs;
