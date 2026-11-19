-- Fluxo de Caixa Gerencial (etapa 3): data de VENCIMENTO da nota fiscal
-- ============================================================================
-- Hoje a nota não tem vencimento (a Cobrança assume emissão + 30 dias). Para o aging do Valor Pendente (a vencer × vencidos por faixa) e o filtro de
-- vencimento do Fluxo de Caixa Gerencial, a nota ganha um campo próprio, OPCIONAL:
--   data_vencimento    : a data combinada. Nulo = sem ajuste manual: a tela calcula pelo prazo de pagamento do contrato (contratos.prazo_pagamento, texto
--                        como "ATÉ 15 DIAS MÊS SUBSEQUENTE" ou "30 DIAS") e, se o texto não for entendido, por emissão + 30 dias (mesmo padrão da Cobrança).
--   vencimento_origem  : 'manual' quando o Financeiro ajustou; nulo enquanto vale o cálculo. (Só registra a decisão humana: o cálculo não é gravado.)
-- Não há backfill: as notas antigas continuam valendo pela regra calculada, identificada na tela como "estimado". Ajustar uma nota grava a data.
-- Migration leve (duas colunas anuláveis, sem default): pode rodar inteira de uma vez. Idempotente. NOTIFY ao final.
--
-- ROLLBACK:
--   ALTER TABLE public.nf_emissao DROP COLUMN IF EXISTS data_vencimento, DROP COLUMN IF EXISTS vencimento_origem;
--   NOTIFY pgrst, 'reload schema';
SET lock_timeout = '5s';

ALTER TABLE public.nf_emissao
  ADD COLUMN IF NOT EXISTS data_vencimento date,
  ADD COLUMN IF NOT EXISTS vencimento_origem text;

ALTER TABLE public.nf_emissao DROP CONSTRAINT IF EXISTS nf_emissao_vencimento_origem_check;
ALTER TABLE public.nf_emissao
  ADD CONSTRAINT nf_emissao_vencimento_origem_check CHECK (vencimento_origem IS NULL OR vencimento_origem = 'manual');

NOTIFY pgrst, 'reload schema';
