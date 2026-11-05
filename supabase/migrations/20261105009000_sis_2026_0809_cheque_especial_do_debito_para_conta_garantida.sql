-- ============================================================================
-- SIS-2026-0809 — Cheque especial lançado no Débito Automático passa para a Conta Garantida
-- ============================================================================
-- Antes de a tela da Conta Garantida poder lançar (SIS-2026-0798), o Financeiro registrava resgate (liberação) e amortização do cheque especial na
-- tela de Débito Automático, com a classificação CHEQUE ESPECIAL. A carga do histórico (20261104004200) trouxe só o Fluxo importado da planilha,
-- que termina em 04/09/2026; o que foi lançado no Débito Automático depois disso não está na Conta Garantida. Esta migration MOVE esses lançamentos:
--
--   - cada Débito Automático PAGO, classificação CHEQUE ESPECIAL (valores já com os ajustes do Fluxo), de uma empresa+banco que tem Conta Garantida,
--     vira um lançamento nativo da Conta Garantida: entrada = resgate, saída = amortização, mesma data, valor e classificação;
--   - o lançamento passa a vir ao Fluxo de Caixa pela fonte 'conta_garantida' (ID CGM-…), e o Débito Automático original vai para a LIXEIRA
--     (deleted_at), sem apagar nada: sai da tela de Débito Automático e do Fluxo por essa fonte, então não conta duas vezes;
--   - a conta corrente do Fluxo (conciliação) vem da Conta Garantida (Sicredi 119), como nos lançamentos feitos pela tela;
--   - o vínculo fica nas duas pontas: financeiro_conta_garantida_movimento.origem_debito_id e "DEBITO_AUTOMATICO".conta_garantida_movimento_id, e o
--     Débito Automático ganha um evento no histórico. Restaurar da lixeira um Débito movido é recusado (duplicaria o lançamento).
--
-- JUROS, IOF e tarifas do cheque especial NÃO entram (não são resgate nem amortização; JUROS de SN no Sicredi nem tem Conta Garantida).
--
-- Conferência de saldo: o saldo da Conta Garantida parte de zero em jan/2026 (não há saldo inicial de 31/12/2025), então no meio do ano ele já passa
-- por valores negativos. Como no histórico, os lançamentos movidos NÃO entram na checagem de saldo negativo/limite (origem_debito_id); lançamento novo
-- e estorno continuam conferidos. A checagem só deixa de olhar os movidos.
--
-- IDEMPOTENTE: um Débito já movido não aparece mais na fonte do Fluxo (está na lixeira) nem é movido de novo. O resultado sai em NOTICE.
-- Esperado hoje: 24 lançamentos (21 Sicredi HAGG, 3 BB SN); saldo Sicredi HAGG 1.221.599,07 → 1.525.298,08 (sem os 485.000 de teste da TI, a estornar);
-- BB SN 555.000,00 → 915.000,00.
--
-- ROLLBACK (desfaz a movimentação; os dados originais continuam na lixeira do Débito Automático):
--   DELETE FROM public.financeiro_fluxo_caixa_conta WHERE origem = 'conta_garantida' AND despesa_id IN (SELECT id FROM public.financeiro_conta_garantida_movimento WHERE origem_debito_id IS NOT NULL);
--   UPDATE public."DEBITO_AUTOMATICO" SET deleted_at = NULL, deleted_por = NULL, conta_garantida_movimento_id = NULL WHERE conta_garantida_movimento_id IS NOT NULL;
--   (antes: DROP TRIGGER debito_automatico_guard_movido_cg ON public."DEBITO_AUTOMATICO";)
--   DELETE FROM public.financeiro_conta_garantida_movimento WHERE origem_debito_id IS NOT NULL;
--   (recriar conta_garantida_validar_saldo de 20261104004200; ALTER TABLE ... DROP COLUMN origem_debito_id / conta_garantida_movimento_id)
SET lock_timeout = '5s';

ALTER TABLE public.financeiro_conta_garantida_movimento ADD COLUMN IF NOT EXISTS origem_debito_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS financeiro_conta_garantida_movimento_origem_debito
  ON public.financeiro_conta_garantida_movimento (origem_debito_id) WHERE origem_debito_id IS NOT NULL;

ALTER TABLE public."DEBITO_AUTOMATICO" ADD COLUMN IF NOT EXISTS conta_garantida_movimento_id uuid;

-- Débito movido para a Conta Garantida não volta da lixeira (o lançamento já existe lá; restaurar duplicaria no Fluxo e no saldo).
CREATE OR REPLACE FUNCTION public.debito_automatico_guard_movido_cg()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.conta_garantida_movimento_id IS NOT NULL AND OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'Este lançamento foi movido para a Conta Garantida (SIS-2026-0809) e não pode voltar para o Débito Automático. Para desfazer, estorne-o na tela da Conta Garantida.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS debito_automatico_guard_movido_cg ON public."DEBITO_AUTOMATICO";
CREATE TRIGGER debito_automatico_guard_movido_cg BEFORE UPDATE ON public."DEBITO_AUTOMATICO"
  FOR EACH ROW EXECUTE FUNCTION public.debito_automatico_guard_movido_cg();

-- Conferência de saldo: histórico e lançamentos movidos do Débito Automático não entram no mínimo/máximo (o saldo continua acumulado desde o primeiro).
CREATE OR REPLACE FUNCTION public.conta_garantida_validar_saldo(_conta_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limite numeric;
  v_min numeric;
  v_max numeric;
BEGIN
  SELECT limite INTO v_limite FROM public.financeiro_conta_garantida WHERE id = _conta_id;
  SELECT min(x.saldo), max(x.saldo) INTO v_min, v_max FROM (
    SELECT m.historico, m.origem_debito_id,
           sum(CASE m.tipo WHEN 'resgate' THEN m.valor WHEN 'amortizacao' THEN -m.valor ELSE 0 END) OVER (ORDER BY m.data_movimento, m.seq) AS saldo
      FROM public.financeiro_conta_garantida_movimento m
     WHERE m.conta_garantida_id = _conta_id AND m.cancelado_em IS NULL
  ) x
  WHERE NOT x.historico AND x.origem_debito_id IS NULL;
  IF v_min < 0 THEN
    RAISE EXCEPTION 'A amortização não pode ser maior que o saldo devedor da conta (em alguma data o saldo ficaria negativo em R$ %).', abs(v_min);
  END IF;
  IF v_max > v_limite THEN
    RAISE EXCEPTION 'A operação excede o limite contratado da conta (o saldo utilizado chegaria a R$ %, limite de R$ %).', v_max, v_limite;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.conta_garantida_validar_saldo(uuid) FROM PUBLIC, anon, authenticated;

-- ── Movimentação ────────────────────────────────────────────────────────────
DO $$
DECLARE
  r record;
  v_conta public.financeiro_conta_garantida%ROWTYPE;
  v_mov uuid;
  v_numero text;
  v_movidos int := 0;
  v_sem_conta int := 0;
  c record;
BEGIN
  FOR r IN
    SELECT v.despesa_id, v.id_malote, v.data_pagamento, v.valor, v.tipo, v.classificacao_id, v.empresa_id, v.banco_id, v.descricao,
           d.created_by
      FROM public.v_debito_automatico_fluxo_caixa v
      JOIN public."DEBITO_AUTOMATICO" d ON d.id = v.despesa_id
     WHERE upper(btrim(v.classificacao_nome)) = 'CHEQUE ESPECIAL'
       AND d.conta_garantida_movimento_id IS NULL
       AND v.data_pagamento IS NOT NULL AND v.valor > 0
     ORDER BY v.data_pagamento, (CASE WHEN v.tipo = 'entrada' THEN 0 ELSE 1 END), v.id_malote
  LOOP
    SELECT * INTO v_conta FROM public.financeiro_conta_garantida
     WHERE empresa_id = r.empresa_id AND banco_id = r.banco_id ORDER BY created_at LIMIT 1;
    IF NOT FOUND THEN
      v_sem_conta := v_sem_conta + 1;
      RAISE NOTICE 'Sem Conta Garantida para % (empresa %, banco %): fica no Débito Automático.', r.id_malote, r.empresa_id, r.banco_id;
      CONTINUE;
    END IF;

    v_mov := NULL;
    INSERT INTO public.financeiro_conta_garantida_movimento
      (conta_garantida_id, tipo, data_movimento, valor, classificacao_id, observacao, created_by, origem_debito_id)
    VALUES (v_conta.id, CASE WHEN r.tipo = 'entrada' THEN 'resgate' ELSE 'amortizacao' END, r.data_pagamento, r.valor, r.classificacao_id,
            left('Movido do Débito Automático ' || r.id_malote || COALESCE(' · ' || NULLIF(btrim(r.descricao), ''), ''), 300), r.created_by, r.despesa_id)
    ON CONFLICT (origem_debito_id) WHERE origem_debito_id IS NOT NULL DO NOTHING
    RETURNING id, numero INTO v_mov, v_numero;
    IF v_mov IS NULL THEN CONTINUE; END IF;

    -- conta corrente do Fluxo: a da Conta Garantida (Sicredi 119); sem ela, a que o Débito já tinha
    IF v_conta.conta_banco_id IS NOT NULL THEN
      INSERT INTO public.financeiro_fluxo_caixa_conta (origem, despesa_id, parcela, conta_banco_id)
      VALUES ('conta_garantida', v_mov, 0, v_conta.conta_banco_id)
      ON CONFLICT (origem, despesa_id, parcela) DO UPDATE SET conta_banco_id = EXCLUDED.conta_banco_id, updated_at = now();
    ELSE
      INSERT INTO public.financeiro_fluxo_caixa_conta (origem, despesa_id, parcela, conta_banco_id)
      SELECT 'conta_garantida', v_mov, 0, f.conta_banco_id
        FROM public.financeiro_fluxo_caixa_conta f
       WHERE f.origem = 'debito_automatico' AND f.despesa_id = r.despesa_id AND f.conta_banco_id IS NOT NULL
      ON CONFLICT (origem, despesa_id, parcela) DO NOTHING;
    END IF;

    UPDATE public."DEBITO_AUTOMATICO"
       SET conta_garantida_movimento_id = v_mov, deleted_at = now(), deleted_por = NULL
     WHERE id = r.despesa_id;
    INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
    VALUES (r.despesa_id, 'exclusao', NULL, 'Movido para a Conta Garantida (' || v_numero || ') — SIS-2026-0809.');
    v_movidos := v_movidos + 1;
  END LOOP;

  RAISE NOTICE 'Cheque especial movido do Débito Automático para a Conta Garantida: % lançamento(s); % sem Conta Garantida.', v_movidos, v_sem_conta;
  FOR c IN
    SELECT cg.numero, e.nome_fantasia AS emp, b.nome AS banco,
           COALESCE(sum(CASE m.tipo WHEN 'resgate' THEN m.valor WHEN 'amortizacao' THEN -m.valor ELSE 0 END), 0) AS saldo
      FROM public.financeiro_conta_garantida cg
      JOIN public.empresas e ON e.id = cg.empresa_id
      JOIN public.malote_cartao_banco b ON b.id = cg.banco_id
      LEFT JOIN public.financeiro_conta_garantida_movimento m ON m.conta_garantida_id = cg.id AND m.cancelado_em IS NULL
     GROUP BY cg.numero, e.nome_fantasia, b.nome ORDER BY cg.numero
  LOOP
    RAISE NOTICE 'Saldo utilizado % (% / %): %', c.numero, c.emp, c.banco, c.saldo;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
