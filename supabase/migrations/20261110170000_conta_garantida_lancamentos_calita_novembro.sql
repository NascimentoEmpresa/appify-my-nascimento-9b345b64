-- [SEM-CHAMADO] Conta Garantida: lançamentos de 04 a 09/11/2026 pedidos pela Calita (Financeiro) + ajuste de abertura, para a utilização chegar em
-- BB HAGG R$ 0,00 · BB SN R$ 1.360.000,00 (limite todo utilizado) · Sicredi HAGG R$ 2.407.000,00
-- ============================================================================
-- Lançamentos pedidos (todos HISTÓRICOS: entram no saldo/utilização, mas não vão ao Fluxo de Caixa nem à Conciliação, e não passam pela conferência
-- de saldo/limite — a Calita está acertando a conta ao extrato, não registrando um pagamento novo):
--   CG-2026-0001 BB HAGG      : 04/11 resgate 1.000.000,00 · 06/11 amortização 1.000.000,00                       (líquido 0)
--   CG-2026-0002 BB SN        : 05/11 resgate 1.360.000,00                                                         (líquido +1.360.000,00)
--   CG-2026-0003 Sicredi HAGG : 05/11 resgate 609.299,99 · 06/11 amortização 839.000,00 · 09/11 resgate 66.000,00  (líquido -163.700,01)
--
-- Somados ao saldo de hoje não chegam aos valores finais: BB SN iria a 2.275.000,00 (limite 1.360.000,00) e o Sicredi a 2.243.299,99. Por isso entram
-- dois ajustes de abertura históricos, datados de 04/11 (antes dos lançamentos):
--   CG-2026-0002 : amortização de 915.000,00  (zera o que a conta já tinha; o resgate de 1.360.000,00 leva ao limite)
--   CG-2026-0003 : resgate de 163.700,01       (saldo de partida 2.570.700,01; depois dos lançamentos fecha em 2.407.000,00)
-- Obs.: em 05/11 o Sicredi passa por 3.180.000,00 (acima do limite de 3.000.000,00) por conta dos valores informados — a conferência de limite ignora histórico.
--
-- Trava por conta: só lança se o saldo atual ainda for o esperado (BB HAGG 0 · BB SN 915.000,00 · Sicredi 2.407.000,00). Se mudou, NÃO lança nessa conta
-- e avisa (os ajustes teriam de ser recalculados). Idempotente (observação com o marcador "Ajuste Calita 10/11/2026" na conta).
--
-- ROLLBACK:
--   DELETE FROM public.financeiro_conta_garantida_movimento
--    WHERE historico AND observacao LIKE '%Ajuste Calita 10/11/2026%';
--   NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_cls_cg uuid;  -- classificação do resgate/amortização (a mesma das linhas já existentes)
  r record;
  v_conta uuid;
  v_saldo numeric;
BEGIN
  SELECT classificacao_id INTO v_cls_cg
    FROM public.financeiro_conta_garantida_movimento
   WHERE tipo = 'resgate' AND classificacao_id IS NOT NULL
   ORDER BY seq LIMIT 1;

  FOR r IN
    SELECT * FROM (VALUES
      ('CG-2026-0001',       0.00::numeric),
      ('CG-2026-0002',  915000.00::numeric),
      ('CG-2026-0003', 2407000.00::numeric)
    ) AS t(numero, saldo_esperado)
  LOOP
    SELECT id INTO v_conta FROM public.financeiro_conta_garantida WHERE numero = r.numero;
    IF v_conta IS NULL THEN
      RAISE NOTICE 'Conta % não existe neste banco: nada a fazer.', r.numero;
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM public.financeiro_conta_garantida_movimento
                WHERE conta_garantida_id = v_conta AND observacao LIKE '%Ajuste Calita 10/11/2026%') THEN
      RAISE NOTICE 'Conta %: lançamentos da Calita já feitos, nada a fazer.', r.numero;
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(CASE tipo WHEN 'resgate' THEN valor WHEN 'amortizacao' THEN -valor ELSE 0 END), 0) INTO v_saldo
      FROM public.financeiro_conta_garantida_movimento
     WHERE conta_garantida_id = v_conta AND cancelado_em IS NULL;

    IF v_saldo <> r.saldo_esperado THEN
      RAISE NOTICE 'Conta %: saldo é R$ % (esperado R$ %): lançamentos NÃO feitos, recalcular os ajustes.', r.numero, v_saldo, r.saldo_esperado;
      CONTINUE;
    END IF;

    IF r.numero = 'CG-2026-0001' THEN
      INSERT INTO public.financeiro_conta_garantida_movimento (conta_garantida_id, tipo, data_movimento, valor, classificacao_id, observacao, historico) VALUES
        (v_conta, 'resgate',     DATE '2026-11-04', 1000000.00, v_cls_cg, 'Ajuste Calita 10/11/2026: resgate informado pelo Financeiro.', true),
        (v_conta, 'amortizacao', DATE '2026-11-06', 1000000.00, v_cls_cg, 'Ajuste Calita 10/11/2026: amortização informada pelo Financeiro.', true);
    ELSIF r.numero = 'CG-2026-0002' THEN
      INSERT INTO public.financeiro_conta_garantida_movimento (conta_garantida_id, tipo, data_movimento, valor, classificacao_id, observacao, historico) VALUES
        (v_conta, 'amortizacao', DATE '2026-11-04',  915000.00, v_cls_cg, 'Ajuste Calita 10/11/2026: ajuste de abertura (zera o saldo anterior para o limite todo utilizado ficar em R$ 1.360.000,00).', true),
        (v_conta, 'resgate',     DATE '2026-11-05', 1360000.00, v_cls_cg, 'Ajuste Calita 10/11/2026: resgate informado pelo Financeiro (limite todo utilizado).', true);
    ELSE
      INSERT INTO public.financeiro_conta_garantida_movimento (conta_garantida_id, tipo, data_movimento, valor, classificacao_id, observacao, historico) VALUES
        (v_conta, 'resgate',     DATE '2026-11-04',  163700.01, v_cls_cg, 'Ajuste Calita 10/11/2026: ajuste de abertura (saldo de partida para os lançamentos de 05 a 09/11 fecharem em R$ 2.407.000,00).', true),
        (v_conta, 'resgate',     DATE '2026-11-05',  609299.99, v_cls_cg, 'Ajuste Calita 10/11/2026: resgate informado pelo Financeiro.', true),
        (v_conta, 'amortizacao', DATE '2026-11-06',  839000.00, v_cls_cg, 'Ajuste Calita 10/11/2026: amortização informada pelo Financeiro.', true),
        (v_conta, 'resgate',     DATE '2026-11-09',   66000.00, v_cls_cg, 'Ajuste Calita 10/11/2026: resgate informado pelo Financeiro.', true);
    END IF;
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
