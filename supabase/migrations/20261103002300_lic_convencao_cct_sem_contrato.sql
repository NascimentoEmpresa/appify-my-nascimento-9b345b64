-- =========================================================================
-- Convenções Coletivas — ajustes do cadastro da CCT (03/11/2026)
--
-- PEDIDO: a tela da CCT concentra só a convenção e os benefícios. Saem o
-- contrato e os postos (o vínculo CCT → contrato/posto continua na Planilha
-- de Custo, LIC_POSTO_CONVENCAO), o decreto municipal (cadastro próprio,
-- mig 20261103002250) e o Vale-Transporte (vem do decreto, regras.vt do
-- vínculo do posto).
--
-- Banco: a CCT deixa de exigir contrato — segue exigindo a empresa.
-- Os novos campos dos benefícios (base de cálculo de insalubridade,
-- periculosidade e líder em %; desconto do colaborador no VA) moram no
-- jsonb `beneficios`, sem coluna nova; as regras estão em
-- src/lib/licitacoes/convencoes.ts (com teste).
--
-- Depende da 20261103002250 (coluna tipo). Idempotente.
-- =========================================================================

ALTER TABLE public."LIC_CONVENCAO_COLETIVA" DROP CONSTRAINT IF EXISTS lic_convencao_cct_tem_contrato;

ALTER TABLE public."LIC_CONVENCAO_COLETIVA" DROP CONSTRAINT IF EXISTS lic_convencao_cct_tem_empresa;
ALTER TABLE public."LIC_CONVENCAO_COLETIVA"
  ADD CONSTRAINT lic_convencao_cct_tem_empresa
  CHECK (tipo <> 'cct' OR empresa_id IS NOT NULL);

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (só se toda CCT tiver contrato)
-- ALTER TABLE public."LIC_CONVENCAO_COLETIVA" DROP CONSTRAINT IF EXISTS lic_convencao_cct_tem_empresa;
-- ALTER TABLE public."LIC_CONVENCAO_COLETIVA"
--   ADD CONSTRAINT lic_convencao_cct_tem_contrato
--   CHECK (tipo <> 'cct' OR (empresa_id IS NOT NULL AND contrato_id IS NOT NULL));
-- NOTIFY pgrst, 'reload schema';
