-- ============================================================================
-- SIS-2026-0798 (parte 3) — carga do passado na Conta Garantida a partir do Fluxo de Caixa
-- ============================================================================
-- O Fluxo de Caixa (planilha 2026 importada) já tem os cheques especiais e juros de jan/2026 em diante. Esta migration cria as 3 contas garantidas
-- que existem de fato e traz esses lançamentos como HISTÓRICO (historico = true: contam no saldo e nos gráficos, não geram linha nova no Fluxo,
-- que já as tem). Decisões do Financeiro (chamado SIS-2026-0798):
--   - Contas: BB HAGG, BB SN e Sicredi HAGG (as contas 119 e 155 do Sicredi ficam MESCLADAS numa conta só, "119", por enquanto).
--   - Limites mantidos da tela antiga: 150.000 / 1.950.000 / 3.000.000 (editáveis em Editar conta). Taxa e vencimento: a preencher pela tela.
--   - Mapeamento: CHEQUE ESPECIAL entrada = resgate; CHEQUE ESPECIAL saída = amortização; JUROS saída = juros. JUROS de entrada (estorno de
--     R$ 84,19 no BB SN) e o JUROS de Banrisul/Caixa (sem cheque especial) ficam de fora.
--   - Número da conta do BB: não consta em lugar nenhum; entra "A informar" e o Financeiro corrige em Editar conta.
--   - Não há saldo inicial de 31/12/2025: o saldo parte de zero em jan/2026.
--
-- Também ajusta a conferência de saldo (conta_garantida_validar_saldo): o HISTÓRICO não entra mais na checagem de limite e de saldo negativo.
-- Sem isso o BB HAGG (pico de 249.950 contra limite de 150.000 no histórico) recusaria qualquer lançamento novo para sempre. Lançamento novo e
-- estorno continuam conferidos normalmente, na linha do tempo inteira.
--
-- IDEMPOTENTE: cada lançamento carrega a linha do Fluxo de origem (origem_linha_id, único); reexecutar não duplica. A conta é reaproveitada pelo
-- par empresa + banco, mesmo que o Financeiro já tenha corrigido o número dela.
-- O resultado (saldo de cada conta) sai em NOTICE para conferência. Esperado, pelo Fluxo de 04/11/2026: BB HAGG 0,00 / BB SN 555.000,00 /
-- Sicredi HAGG 1.221.599,07.
--
-- Migration leve (~190 linhas): pode rodar inteira.
--
-- ROLLBACK:
--   DELETE FROM public.financeiro_conta_garantida_movimento WHERE historico AND origem_linha_id IS NOT NULL;
--   DELETE FROM public.financeiro_conta_garantida c WHERE NOT EXISTS (SELECT 1 FROM public.financeiro_conta_garantida_movimento m WHERE m.conta_garantida_id = c.id);
--   (recriar conta_garantida_validar_saldo de 20261104004000)
--   ALTER TABLE public.financeiro_conta_garantida_movimento DROP COLUMN IF EXISTS origem_linha_id;
SET lock_timeout = '5s';

ALTER TABLE public.financeiro_conta_garantida_movimento ADD COLUMN IF NOT EXISTS origem_linha_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS financeiro_conta_garantida_movimento_origem
  ON public.financeiro_conta_garantida_movimento (origem_linha_id) WHERE origem_linha_id IS NOT NULL;

-- Conferência de saldo: só as posições de lançamentos NÃO históricos entram no mínimo/máximo (o saldo continua acumulado desde o primeiro).
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
    SELECT m.historico,
           sum(CASE m.tipo WHEN 'resgate' THEN m.valor WHEN 'amortizacao' THEN -m.valor ELSE 0 END) OVER (ORDER BY m.data_movimento, m.seq) AS saldo
      FROM public.financeiro_conta_garantida_movimento m
     WHERE m.conta_garantida_id = _conta_id AND m.cancelado_em IS NULL
  ) x
  WHERE NOT x.historico;
  IF v_min < 0 THEN
    RAISE EXCEPTION 'A amortização não pode ser maior que o saldo devedor da conta (em alguma data o saldo ficaria negativo em R$ %).', abs(v_min);
  END IF;
  IF v_max > v_limite THEN
    RAISE EXCEPTION 'A operação excede o limite contratado da conta (o saldo utilizado chegaria a R$ %, limite de R$ %).', v_max, v_limite;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.conta_garantida_validar_saldo(uuid) FROM PUBLIC, anon, authenticated;

-- Carga
DO $$
DECLARE
  r record;
  v_banco uuid;
  v_empresa uuid;
  v_n_banco int;
  v_n_empresa int;
  v_conta uuid;
  v_cb uuid;
  v_novos int;
  v_saldo numeric;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('Banco do Brasil', 'HAGG', 150000::numeric, 'A informar'),
      ('Banco do Brasil', 'SN',   1950000::numeric, 'A informar'),
      ('Sicredi',         'HAGG', 3000000::numeric, '119')
    ) AS x(banco_nome, empresa_nome, limite, numero_conta)
  LOOP
    -- banco e empresa vêm das próprias linhas do Fluxo (nome exato): tem que haver um só de cada
    SELECT count(DISTINCT f.banco_id), count(DISTINCT f.empresa_id), min(f.banco_id::text)::uuid, min(f.empresa_id::text)::uuid
      INTO v_n_banco, v_n_empresa, v_banco, v_empresa
      FROM public.v_fluxo_caixa_importado_fluxo_caixa f
     WHERE f.banco_nome = r.banco_nome AND f.empresa_nome = r.empresa_nome AND upper(btrim(f.classificacao_nome)) = 'CHEQUE ESPECIAL';
    IF v_n_banco <> 1 OR v_n_empresa <> 1 THEN
      RAISE EXCEPTION 'Carga da Conta Garantida: % / % não achou um banco e uma empresa únicos no Fluxo (bancos %, empresas %).', r.banco_nome, r.empresa_nome, v_n_banco, v_n_empresa;
    END IF;

    SELECT id INTO v_conta FROM public.financeiro_conta_garantida
     WHERE empresa_id = v_empresa AND banco_id = v_banco ORDER BY created_at LIMIT 1;
    IF v_conta IS NULL THEN
      -- conta corrente cadastrada na SIS-2026-0777 com esse número (só o Sicredi 119 existe), para o Fluxo/conciliação já separarem por conta
      SELECT id INTO v_cb FROM public.financeiro_conta_banco
       WHERE banco_id = v_banco AND empresa_id = v_empresa AND numero = r.numero_conta LIMIT 1;
      INSERT INTO public.financeiro_conta_garantida (empresa_id, banco_id, conta_banco_id, conta, limite, observacao)
      VALUES (v_empresa, v_banco, v_cb, r.numero_conta, r.limite,
              'Criada pela carga do histórico do Fluxo de Caixa (SIS-2026-0798). Conferir número da conta, taxa e vencimento.')
      RETURNING id INTO v_conta;
    END IF;

    -- mesmas datas: entrada (resgate) antes da saída, para o saldo do dia nunca aparecer negativo
    INSERT INTO public.financeiro_conta_garantida_movimento
      (conta_garantida_id, tipo, data_movimento, valor, classificacao_id, observacao, historico, origem_linha_id)
    SELECT v_conta,
           CASE WHEN upper(btrim(f.classificacao_nome)) = 'JUROS' THEN 'juros' WHEN f.tipo = 'entrada' THEN 'resgate' ELSE 'amortizacao' END,
           f.data_pagamento, f.valor, f.classificacao_id,
           left('Histórico do Fluxo de Caixa' || COALESCE(' · ' || NULLIF(btrim(f.descricao), ''), ''), 300),
           true, f.linha_id
      FROM public.v_fluxo_caixa_importado_fluxo_caixa f
     WHERE f.banco_id = v_banco AND f.empresa_id = v_empresa
       AND (upper(btrim(f.classificacao_nome)) = 'CHEQUE ESPECIAL' OR (upper(btrim(f.classificacao_nome)) = 'JUROS' AND f.tipo = 'saida'))
       AND f.data_pagamento IS NOT NULL AND f.valor > 0 AND f.linha_id IS NOT NULL
     ORDER BY f.data_pagamento, (CASE WHEN f.tipo = 'entrada' THEN 0 ELSE 1 END), f.linha_id
    ON CONFLICT (origem_linha_id) WHERE origem_linha_id IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_novos = ROW_COUNT;

    SELECT COALESCE(sum(CASE tipo WHEN 'resgate' THEN valor WHEN 'amortizacao' THEN -valor ELSE 0 END), 0) INTO v_saldo
      FROM public.financeiro_conta_garantida_movimento WHERE conta_garantida_id = v_conta AND cancelado_em IS NULL;
    RAISE NOTICE 'Conta Garantida % / %: % lançamentos novos; saldo devedor R$ %', r.banco_nome, r.empresa_nome, v_novos, v_saldo;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
