-- =========================================================================
-- Jurídico › Processos: empresa AUTORA que ainda assim PAGA
--
-- Pedido do Pablo (29/09/2026): "quando a empresa for AUTORA às vezes ela
-- ainda paga pelo processo, então deixa opção de a empresa irá PAGAR e a
-- empresa irá RECEBER pra preencher".
--
-- Desde 28/09 a tela trata toda empresa autora como "a receber" (pedidos,
-- acordo e sentença fora do custo final — empresaRecebe() em
-- src/lib/juridico/tipoProcesso.ts). Consignação em pagamento é o caso
-- típico em que ela é autora e desembolsa.
--
--   • empresa_autora_resultado: 'receber' | 'pagar'. NULL = receber, que é
--     o que todo processo já cadastrado assumia — nada muda pra eles.
--   • Só é gravada com a empresa autora; nos demais a tela grava NULL.
--   • Repete em toda linha de motivo, como os outros campos do processo
--     (o Salvar apaga e recria as linhas).
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

ALTER TABLE public."JUR_PROCESSOS" ADD COLUMN IF NOT EXISTS empresa_autora_resultado text;

ALTER TABLE public."JUR_PROCESSOS" DROP CONSTRAINT IF EXISTS jur_processos_empresa_autora_resultado_check;
ALTER TABLE public."JUR_PROCESSOS" ADD CONSTRAINT jur_processos_empresa_autora_resultado_check
  CHECK (empresa_autora_resultado IS NULL OR empresa_autora_resultado IN ('receber', 'pagar'));

COMMENT ON COLUMN public."JUR_PROCESSOS".empresa_autora_resultado IS
  'Só com a empresa do grupo como AUTORA: receber (NULL = receber) | pagar — pagar faz pedidos/acordo/sentença contarem como desembolso.';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public."JUR_PROCESSOS" DROP CONSTRAINT IF EXISTS jur_processos_empresa_autora_resultado_check,
--   DROP COLUMN IF EXISTS empresa_autora_resultado;
