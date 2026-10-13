-- SIS-2026-0633 (Veranópolis): desconto de faltas por DIAS na emissão de NF.
--
-- A planilha modelo do Veranópolis ("Tabela calculo faltas") calcula, por escola,
-- valor do posto ÷ 30 × dias de falta. Cada escola é um item da nota. Esta migration:
--   1) cria a flag `contratos.nf_faltas_por_dias` (liga o bloco "Faltas — cálculo por
--      dias" na emissão) e liga só no contrato VERANOPOLIS - 001/2021;
--   2) guarda os dias e o valor do posto usados em cada item (nf_emissao_item), para a
--      nota reaberta mostrar o cálculo e não só o R$ final.
-- `nf_emissao_item.faltas` (R$) continua sendo o valor que entra nos cálculos — nada
-- muda para os demais contratos.
--
-- Rodar em BLOCOS, um de cada vez (SQL Editor do Supabase abre sessão paralela e o
-- ALTER TABLE pode dar deadlock 40P01; cada bloco é idempotente, se der deadlock
-- é só reexecutar aquele bloco).

-- ============================== BLOCO 1 ==============================
SET lock_timeout = '8s';

ALTER TABLE public.nf_emissao_item
  ADD COLUMN IF NOT EXISTS faltas_dias numeric,
  ADD COLUMN IF NOT EXISTS faltas_valor_posto numeric;

COMMENT ON COLUMN public.nf_emissao_item.faltas_dias IS
  'SIS-2026-0633: dias de falta (pessoa-dia) do item; quando preenchido, faltas = faltas_valor_posto (ou contrato exec. ÷ qtd_colaboradores) ÷ 30 × dias.';
COMMENT ON COLUMN public.nf_emissao_item.faltas_valor_posto IS
  'SIS-2026-0633: valor do posto digitado para o cálculo de faltas; nulo = contrato exec. do item ÷ qtd_colaboradores.';

-- ============================== BLOCO 2 ==============================
SET lock_timeout = '8s';

ALTER TABLE public.contratos
  ADD COLUMN IF NOT EXISTS nf_faltas_por_dias boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.contratos.nf_faltas_por_dias IS
  'SIS-2026-0633: a emissão de NF deste contrato calcula as faltas por dias (valor do posto ÷ 30 × dias), como a planilha do Veranópolis.';

UPDATE public.contratos
   SET nf_faltas_por_dias = true
 WHERE nome = 'VERANOPOLIS   -  001/2021';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   UPDATE public.contratos SET nf_faltas_por_dias = false WHERE nome = 'VERANOPOLIS   -  001/2021';
--   ALTER TABLE public.contratos DROP COLUMN IF EXISTS nf_faltas_por_dias;
--   ALTER TABLE public.nf_emissao_item DROP COLUMN IF EXISTS faltas_dias, DROP COLUMN IF EXISTS faltas_valor_posto;
