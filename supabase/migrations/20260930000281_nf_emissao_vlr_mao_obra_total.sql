-- [SEM-CHAMADO]: o informativo de Mão de Obra (db0f76ca) adicionou
-- vlr_mao_obra_total em TotaisNf (calculos.ts), e esse objeto é espalhado
-- direto no payload de insert/update de nf_emissao em useNfEmissao.ts
-- (useSalvarNfEmissao, useAtualizarNfEmissao, useValidarNfEmissao) — faltou
-- a coluna correspondente na tabela, causando erro ao salvar/validar/
-- cancelar qualquer nota ("Could not find the 'vlr_mao_obra_total' column").

ALTER TABLE public.nf_emissao
  ADD COLUMN IF NOT EXISTS vlr_mao_obra_total numeric(14,2) NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public.nf_emissao DROP COLUMN IF EXISTS vlr_mao_obra_total;
