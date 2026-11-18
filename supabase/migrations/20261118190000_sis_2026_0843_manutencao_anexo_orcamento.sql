-- ============================================================================
-- SIS-2026-0843 — Orçamento (opcional) na solicitação de manutenção
--
-- O supervisor passa a anexar, além da foto do equipamento (obrigatória), a
-- foto/PDF do orçamento (opcional). Os dois ficam na mesma tabela de anexos;
-- a coluna categoria diz qual é qual para o Almoxarifado. Antes disto não havia
-- campo e o orçamento entrava no lugar da foto (anexo de 09/11/2026).
--
-- Anexos existentes ficam como foto_equipamento pelo DEFAULT — era o único
-- arquivo que o formulário pedia. RLS e storage não mudam: o orçamento segue o
-- mesmo caminho <uid>/<solicitacao>/<arquivo> e as mesmas policies da foto; o
-- bucket não restringe tipo MIME, então PDF já é aceito (limite 5 MB mantido).
--
-- ROLLBACK:
--   ALTER TABLE public."SUP_SOLICITACAO_MANUTENCAO_ANEXO"
--     DROP CONSTRAINT IF EXISTS sup_solicitacao_manutencao_anexo_categoria_check;
--   ALTER TABLE public."SUP_SOLICITACAO_MANUTENCAO_ANEXO" DROP COLUMN IF EXISTS categoria;
-- ============================================================================

ALTER TABLE public."SUP_SOLICITACAO_MANUTENCAO_ANEXO"
  ADD COLUMN IF NOT EXISTS categoria text NOT NULL DEFAULT 'foto_equipamento';

ALTER TABLE public."SUP_SOLICITACAO_MANUTENCAO_ANEXO"
  DROP CONSTRAINT IF EXISTS sup_solicitacao_manutencao_anexo_categoria_check;
ALTER TABLE public."SUP_SOLICITACAO_MANUTENCAO_ANEXO"
  ADD CONSTRAINT sup_solicitacao_manutencao_anexo_categoria_check
  CHECK (categoria IN ('foto_equipamento', 'orcamento'));

NOTIFY pgrst, 'reload schema';
