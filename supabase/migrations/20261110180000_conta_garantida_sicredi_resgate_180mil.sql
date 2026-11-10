-- [SEM-CHAMADO] Conta Garantida Sicredi HAGG (CG-2026-0003): lança o resgate de R$ 180.000,00 de 10/11/2026 que a Calita esqueceu, sem mudar o saldo de R$ 2.407.000,00
-- ============================================================================
-- Continuação da 20261110170000 (que já está no banco). O resgate esquecido não muda o resultado final (R$ 2.407.000,00), então o ajuste de abertura
-- daquela migration precisa cair o mesmo valor:
--   antes : ajuste de abertura = resgate de R$ 163.700,01 (04/11)         → saldo de partida 2.570.700,01
--   agora : ajuste de abertura = AMORTIZAÇÃO de R$ 16.299,99 (04/11)      → saldo de partida 2.390.700,01
--   novo  : resgate histórico de R$ 180.000,00 em 10/11/2026
--   conta : 2.390.700,01 + 609.299,99 (05/11) - 839.000,00 (06/11) + 66.000,00 (09/11) + 180.000,00 (10/11) = 2.407.000,00
-- Efeito colateral bom: o pico de 05/11 passa de R$ 3.180.000,00 para R$ 3.000.000,00 (exatamente o limite), em vez de ficar acima dele.
-- Continua HISTÓRICO (entra no saldo, não vai ao Fluxo de Caixa/Conciliação nem à conferência de limite).
--
-- Trava: só mexe se o saldo ainda for R$ 2.407.000,00 e o ajuste de abertura ainda for o resgate de R$ 163.700,01 da migration anterior; senão avisa e não faz
-- nada. Idempotente (marcador "Resgate esquecido 10/11/2026").
--
-- ROLLBACK:
--   DELETE FROM public.financeiro_conta_garantida_movimento WHERE historico AND observacao LIKE '%Resgate esquecido 10/11/2026%' AND valor = 180000.00;
--   UPDATE public.financeiro_conta_garantida_movimento SET tipo = 'resgate', valor = 163700.01,
--          observacao = 'Ajuste Calita 10/11/2026: ajuste de abertura (saldo de partida para os lançamentos de 05 a 09/11 fecharem em R$ 2.407.000,00).'
--    WHERE historico AND observacao LIKE 'Ajuste Calita 10/11/2026: ajuste de abertura (amortização%' AND valor = 16299.99
--      AND conta_garantida_id = (SELECT id FROM public.financeiro_conta_garantida WHERE numero = 'CG-2026-0003');
--   NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_conta uuid;
  v_saldo numeric;
  v_ajuste uuid;
  v_cls uuid;
BEGIN
  SELECT id INTO v_conta FROM public.financeiro_conta_garantida WHERE numero = 'CG-2026-0003';
  IF v_conta IS NULL THEN
    RAISE NOTICE 'Conta CG-2026-0003 não existe neste banco: nada a fazer.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.financeiro_conta_garantida_movimento
              WHERE conta_garantida_id = v_conta AND observacao LIKE '%Resgate esquecido 10/11/2026%') THEN
    RAISE NOTICE 'Resgate de R$ 180.000,00 já lançado na CG-2026-0003: nada a fazer.';
    RETURN;
  END IF;

  SELECT COALESCE(SUM(CASE tipo WHEN 'resgate' THEN valor WHEN 'amortizacao' THEN -valor ELSE 0 END), 0) INTO v_saldo
    FROM public.financeiro_conta_garantida_movimento
   WHERE conta_garantida_id = v_conta AND cancelado_em IS NULL;

  SELECT id, classificacao_id INTO v_ajuste, v_cls
    FROM public.financeiro_conta_garantida_movimento
   WHERE conta_garantida_id = v_conta AND cancelado_em IS NULL AND historico AND tipo = 'resgate' AND valor = 163700.01
     AND observacao LIKE 'Ajuste Calita 10/11/2026: ajuste de abertura%'
   LIMIT 1;

  IF v_saldo <> 2407000.00 OR v_ajuste IS NULL THEN
    RAISE NOTICE 'CG-2026-0003: saldo R$ % (esperado 2407000.00) ou ajuste de abertura de 163700.01 não encontrado: NADA alterado, recalcular.', v_saldo;
    RETURN;
  END IF;

  UPDATE public.financeiro_conta_garantida_movimento
     SET tipo = 'amortizacao', valor = 16299.99,
         observacao = 'Ajuste Calita 10/11/2026: ajuste de abertura (amortização; saldo de partida para os lançamentos de 05 a 10/11 fecharem em R$ 2.407.000,00).'
   WHERE id = v_ajuste;

  INSERT INTO public.financeiro_conta_garantida_movimento (conta_garantida_id, tipo, data_movimento, valor, classificacao_id, observacao, historico)
  VALUES (v_conta, 'resgate', DATE '2026-11-10', 180000.00, v_cls,
          'Resgate esquecido 10/11/2026: resgate de hoje informado depois pela Calita (Financeiro); não muda o saldo de R$ 2.407.000,00 porque o ajuste de abertura caiu o mesmo valor.', true);
END
$$;

NOTIFY pgrst, 'reload schema';
