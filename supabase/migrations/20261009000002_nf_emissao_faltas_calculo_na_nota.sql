-- SIS-2026-0633 (Veranópolis): o cálculo de faltas por dias virou uma seção da NOTA
-- ("Faltas — cálculo por dias", acima de Observações), com várias linhas (local, posto
-- da Planilha de Custo, valor do posto, dias). Em vez de colunas por item (migration
-- 20261009000001, que já criou `contratos.nf_faltas_por_dias` e continua valendo), as
-- linhas ficam em `nf_emissao.faltas_calculo` (jsonb). O R$ das faltas de cada item segue
-- gravado em `nf_emissao_item.faltas`, então nada muda nos cálculos nem nos relatórios.
--
-- Rodar em BLOCOS, um de cada vez (deadlock 40P01 com a sessão paralela do SQL Editor);
-- cada bloco é idempotente.

-- ============================== BLOCO 1 ==============================
SET lock_timeout = '8s';

ALTER TABLE public.nf_emissao
  ADD COLUMN IF NOT EXISTS faltas_calculo jsonb;

COMMENT ON COLUMN public.nf_emissao.faltas_calculo IS
  'SIS-2026-0633: linhas do cálculo de faltas por dias [{item, posto, valor_posto, dias}]; item = índice (0-based) do item que recebe o desconto.';

-- ============================== BLOCO 2 ==============================
-- As colunas por item da primeira versão não são mais usadas (nunca chegaram a ser gravadas).
SET lock_timeout = '8s';

ALTER TABLE public.nf_emissao_item
  DROP COLUMN IF EXISTS faltas_dias,
  DROP COLUMN IF EXISTS faltas_valor_posto;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (manual):
--   ALTER TABLE public.nf_emissao DROP COLUMN IF EXISTS faltas_calculo;
