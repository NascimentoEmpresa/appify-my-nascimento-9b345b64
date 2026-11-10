-- [SEM-CHAMADO] Conta Garantida CG-2026-0003 (Sicredi 119, HAGG): lança o saldo de abertura (marco zero) que faltava no histórico
-- ============================================================================
-- A carga do histórico (SIS-2026-0798) começou a conta do zero em 02/01/2026, sem o saldo devedor que ela já tinha. O saldo acumulado ficou
-- abaixo de zero em vários dias (mínimo -R$ 380.400,92) e o "Utilizado" aparece menor que o real: R$ 2.010.298,08 contra o marco zero informado pelo
-- Financeiro, R$ 2.407.000,00 (diferença: R$ 396.701,92). Com o lançamento, o pior ponto da linha do tempo passa a R$ 16.301,00 e o saldo atual a R$ 2.407.000,00.
--
-- Como é lançado: UM resgate HISTÓRICO de R$ 396.701,92 em 01/01/2026 (antes do primeiro lançamento da conta, 02/01). Histórico entra no saldo, mas:
--   - não vai ao Fluxo de Caixa (v_conta_garantida_fluxo_caixa filtra NOT historico), então a Conciliação Bancária não muda;
--   - não entra na conferência de saldo/limite (conta_garantida_validar_saldo filtra NOT historico).
-- Atenção: o gráfico "resgates por mês" da tela soma resgates sem olhar o histórico, então janeiro/2026 mostra R$ 396.701,92 a mais.
--
-- Trava de segurança: só lança se o saldo devedor da conta ainda for exatamente R$ 2.010.298,08 (o valor em que o marco zero foi calculado). Se já
-- mudou (lançamento novo ou estorno), NÃO faz nada e avisa — o valor do ajuste teria de ser recalculado (marco zero - saldo atual).
-- Idempotente (não lança de novo se a observação "Saldo de abertura (marco zero)" já existe na conta).
-- A premissa (saldo real de R$ 2.407.000,00 no Sicredi) vem do Financeiro: confirmar no extrato antes de mergear.
--
-- ROLLBACK:
--   DELETE FROM public.financeiro_conta_garantida_movimento
--    WHERE historico AND observacao LIKE 'Saldo de abertura (marco zero)%'
--      AND conta_garantida_id = (SELECT id FROM public.financeiro_conta_garantida WHERE numero = 'CG-2026-0003');
--   NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_conta uuid;
  v_saldo numeric;
  v_classificacao uuid;
BEGIN
  SELECT id INTO v_conta FROM public.financeiro_conta_garantida WHERE numero = 'CG-2026-0003';
  IF v_conta IS NULL THEN
    RAISE NOTICE 'Conta CG-2026-0003 não existe neste banco: nada a fazer.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.financeiro_conta_garantida_movimento
              WHERE conta_garantida_id = v_conta AND historico AND observacao LIKE 'Saldo de abertura (marco zero)%') THEN
    RAISE NOTICE 'Saldo de abertura já lançado na conta CG-2026-0003: nada a fazer.';
    RETURN;
  END IF;

  SELECT COALESCE(SUM(CASE tipo WHEN 'resgate' THEN valor WHEN 'amortizacao' THEN -valor ELSE 0 END), 0) INTO v_saldo
    FROM public.financeiro_conta_garantida_movimento
   WHERE conta_garantida_id = v_conta AND cancelado_em IS NULL;

  IF v_saldo <> 2010298.08 THEN
    RAISE NOTICE 'Saldo devedor da CG-2026-0003 é R$ % (esperado R$ 2010298.08): ajuste NÃO lançado. Recalcular: marco zero 2407000.00 - saldo atual.', v_saldo;
    RETURN;
  END IF;

  -- mesma classificação (Cheque Especial) das linhas históricas da conta
  SELECT classificacao_id INTO v_classificacao
    FROM public.financeiro_conta_garantida_movimento
   WHERE conta_garantida_id = v_conta AND historico AND classificacao_id IS NOT NULL
   ORDER BY seq LIMIT 1;

  INSERT INTO public.financeiro_conta_garantida_movimento (conta_garantida_id, tipo, data_movimento, valor, classificacao_id, observacao, historico)
  VALUES (v_conta, 'resgate', DATE '2026-01-01', 396701.92, v_classificacao,
          'Saldo de abertura (marco zero): saldo devedor que a conta já tinha antes da carga do histórico. Marco zero R$ 2.407.000,00 informado pelo Financeiro.', true);
END
$$;

NOTIFY pgrst, 'reload schema';
