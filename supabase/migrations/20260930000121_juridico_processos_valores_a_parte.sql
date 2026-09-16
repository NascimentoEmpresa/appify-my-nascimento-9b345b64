-- =========================================================================
-- Jurídico › Processos: "Valores à parte"
--
-- Pedido do Pablo em 15/09/2026: "preciso conseguir cadastrar valores à
-- parte sem ser dos motivos — tem que ter um motivo, mas separado dos
-- valores dos motivos".
--
-- Cada lançamento tem um motivo (texto livre, obrigatório) e um valor.
-- Não se mistura com as linhas de motivo (JUR_PROCESSOS tem 1 linha por
-- motivo do processo): mora numa coluna própria do PROCESSO, no mesmo
-- formato do propostas_json — text com JSON, repetido em toda linha de
-- motivo, lido de uma linha só na tela.
--
--   [{ "motivo": "Honorários periciais", "valor": 1500, "descricao": "" }]
--
-- Entra no custo final do processo (é desembolso real), salvo quando o
-- "Valor final" foi fechado à mão — aí ele manda, como já era.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

ALTER TABLE public."JUR_PROCESSOS"
  ADD COLUMN IF NOT EXISTS valores_a_parte_json text;

COMMENT ON COLUMN public."JUR_PROCESSOS".valores_a_parte_json IS
  'Valores à parte (fora dos motivos): [{motivo,valor,descricao}]. Campo do PROCESSO (repetido nas linhas de motivo). Migration 20260930000121.';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public."JUR_PROCESSOS" DROP COLUMN IF EXISTS valores_a_parte_json;
