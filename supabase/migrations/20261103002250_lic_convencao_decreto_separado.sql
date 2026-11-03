-- =========================================================================
-- Convenções Coletivas e Decretos Municipais — "Novo Decreto" (03/11/2026)
--
-- PEDIDO: botão "Novo Decreto" ao lado de "Nova Convenção", separando o
-- cadastro do decreto municipal do cadastro da convenção coletiva. O decreto
-- tem só: número, município, anexo, Vale-Transporte e observações.
--
-- MODELO: a mesma tabela (LIC_CONVENCAO_COLETIVA), com `tipo`. Assim o
-- decreto herda versão, anexos, RLS e — principalmente — o vínculo do posto
-- (LIC_POSTO_CONVENCAO.regras: o VT do posto pode sair do decreto e o resto
-- da CCT, sem nada novo no resolvedor nem no retrato da vaga).
--
-- Decreto é do MUNICÍPIO, não do contrato: empresa/contrato deixam de ser
-- obrigatórios, mas continuam obrigatórios para a CCT (CHECK abaixo).
-- Registros antigos ficam 'cct' — inclusive os que já trazem um decreto
-- embutido; a tela continua mostrando esses campos neles.
--
-- Idempotente.
-- =========================================================================

ALTER TABLE public."LIC_CONVENCAO_COLETIVA"
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'cct',
  ADD COLUMN IF NOT EXISTS uf   text;

ALTER TABLE public."LIC_CONVENCAO_COLETIVA" DROP CONSTRAINT IF EXISTS lic_convencao_tipo_ok;
ALTER TABLE public."LIC_CONVENCAO_COLETIVA"
  ADD CONSTRAINT lic_convencao_tipo_ok CHECK (tipo IN ('cct', 'decreto'));

ALTER TABLE public."LIC_CONVENCAO_COLETIVA" ALTER COLUMN empresa_id  DROP NOT NULL;
ALTER TABLE public."LIC_CONVENCAO_COLETIVA" ALTER COLUMN contrato_id DROP NOT NULL;

ALTER TABLE public."LIC_CONVENCAO_COLETIVA" DROP CONSTRAINT IF EXISTS lic_convencao_cct_tem_contrato;
ALTER TABLE public."LIC_CONVENCAO_COLETIVA"
  ADD CONSTRAINT lic_convencao_cct_tem_contrato
  CHECK (tipo <> 'cct' OR (empresa_id IS NOT NULL AND contrato_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_lic_convencao_tipo ON public."LIC_CONVENCAO_COLETIVA"(tipo);

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (só depois de apagar os decretos: contrato volta a ser NOT NULL)
-- DELETE FROM public."LIC_CONVENCAO_COLETIVA" WHERE tipo = 'decreto';
-- ALTER TABLE public."LIC_CONVENCAO_COLETIVA" DROP CONSTRAINT IF EXISTS lic_convencao_cct_tem_contrato;
-- ALTER TABLE public."LIC_CONVENCAO_COLETIVA" DROP CONSTRAINT IF EXISTS lic_convencao_tipo_ok;
-- DROP INDEX IF EXISTS public.idx_lic_convencao_tipo;
-- ALTER TABLE public."LIC_CONVENCAO_COLETIVA" ALTER COLUMN contrato_id SET NOT NULL;
-- ALTER TABLE public."LIC_CONVENCAO_COLETIVA" ALTER COLUMN empresa_id  SET NOT NULL;
-- ALTER TABLE public."LIC_CONVENCAO_COLETIVA" DROP COLUMN IF EXISTS uf;
-- ALTER TABLE public."LIC_CONVENCAO_COLETIVA" DROP COLUMN IF EXISTS tipo;
-- NOTIFY pgrst, 'reload schema';
