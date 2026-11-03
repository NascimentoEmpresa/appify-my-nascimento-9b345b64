-- SIS-2026-0683 — modalidades independentes e decisão binária do processo.
-- A antiga categoria conjunta permanece como "recurso" para preservar registros existentes.

ALTER TABLE public."LIC_PRAZO_RECURSO"
  DROP CONSTRAINT IF EXISTS "LIC_PRAZO_RECURSO_modalidade_check";

ALTER TABLE public."LIC_PRAZO_RECURSO"
  ADD CONSTRAINT lic_prazo_recurso_modalidade_check
  CHECK (modalidade IN ('recurso', 'contrarrazao', 'impugnacao', 'mandado_seguranca', 'denuncia_tce', 'repactuacao'));

-- "Parcialmente favorável" não faz mais parte do fluxo: os registros legados
-- são mantidos como deferidos antes de restringir as opções aceitas.
UPDATE public."LIC_PRAZO_RECURSO"
   SET resultado = 'favoravel'
 WHERE resultado = 'parcial';

ALTER TABLE public."LIC_PRAZO_RECURSO"
  DROP CONSTRAINT IF EXISTS "LIC_PRAZO_RECURSO_resultado_check";

ALTER TABLE public."LIC_PRAZO_RECURSO"
  ADD CONSTRAINT lic_prazo_recurso_resultado_check
  CHECK (resultado IN ('favoravel', 'desfavoravel'));

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public."LIC_PRAZO_RECURSO" DROP CONSTRAINT IF EXISTS lic_prazo_recurso_modalidade_check;
-- ALTER TABLE public."LIC_PRAZO_RECURSO" ADD CONSTRAINT lic_prazo_recurso_modalidade_check
--   CHECK (modalidade IN ('recurso', 'impugnacao', 'mandado_seguranca', 'denuncia_tce', 'repactuacao'));
-- ALTER TABLE public."LIC_PRAZO_RECURSO" DROP CONSTRAINT IF EXISTS lic_prazo_recurso_resultado_check;
-- ALTER TABLE public."LIC_PRAZO_RECURSO" ADD CONSTRAINT lic_prazo_recurso_resultado_check
--   CHECK (resultado IN ('favoravel', 'parcial', 'desfavoravel'));
