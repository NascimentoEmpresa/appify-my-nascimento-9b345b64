-- [SEM-CHAMADO] Modelos (variações) da NF: Código de Serviço, CNAE e Código NBS padrão por variação
-- ============================================================================
-- Pedido do Ruan (Financeiro): os três códigos que a emissão e a validação da NF passaram a exigir também podem ser cadastrados no modelo da
-- variação (Contrato > Modelos de NF) e vêm preenchidos ao abrir a variação na emissão. Em branco = a emissão usa o do contrato (Código de
-- Serviço e CNAE); o NBS segue manual. Mesmas colunas e tipo (text) de nf_emissao. RLS inalterada (colunas novas herdam as policies da tabela).
-- Idempotente. NOTIFY ao final.
--
-- ROLLBACK:
--   ALTER TABLE public.nf_emissao_modelo DROP COLUMN IF EXISTS codigo_servico, DROP COLUMN IF EXISTS cnae, DROP COLUMN IF EXISTS nbs;
--   NOTIFY pgrst, 'reload schema';

ALTER TABLE public.nf_emissao_modelo
  ADD COLUMN IF NOT EXISTS codigo_servico text,
  ADD COLUMN IF NOT EXISTS cnae text,
  ADD COLUMN IF NOT EXISTS nbs text;

NOTIFY pgrst, 'reload schema';
