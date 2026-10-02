-- SIS-2026-0578: motivo dos descontos por item da nota. Hoje multas, glosas e
-- "outros descontos" são só valores — a Controladoria precisava ligar pro
-- supervisor do contrato pra saber do que se tratava. A tela passa a pedir a
-- justificativa quando o valor correspondente é maior que zero (regra na
-- tela, não no banco, pra não quebrar nota antiga) e o texto alimenta as
-- variáveis {motivo_multas}/{motivo_glosas}/{motivo_outros} da descrição.

ALTER TABLE public.nf_emissao_item
  ADD COLUMN IF NOT EXISTS justificativa_multas text,
  ADD COLUMN IF NOT EXISTS justificativa_glosas text,
  ADD COLUMN IF NOT EXISTS justificativa_outros_descontos text;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public.nf_emissao_item
--   DROP COLUMN IF EXISTS justificativa_multas,
--   DROP COLUMN IF EXISTS justificativa_glosas,
--   DROP COLUMN IF EXISTS justificativa_outros_descontos;
