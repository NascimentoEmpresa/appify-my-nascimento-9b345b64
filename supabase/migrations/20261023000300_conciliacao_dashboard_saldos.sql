-- SIS-2026-0713: dashboard de conciliações e conferência mensal dos saldos.
--  1) saldo inicial (fechamento de dezembro) informado à mão, por empresa + banco + conta + ano de início do histórico;
--  2) saldo final do extrato (LEDGERBAL do OFX, corrigível à mão) guardado em cada conciliação salva.
-- Idempotente: pode ser reaplicada.

CREATE TABLE IF NOT EXISTS public.financeiro_conciliacao_saldo_inicial (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  banco_id uuid NOT NULL,
  conta text NOT NULL DEFAULT '',
  ano int NOT NULL CHECK (ano BETWEEN 2000 AND 2100),
  valor numeric NOT NULL,
  updated_by uuid, -- sem FK para auth.users: criar a chave exige permissão naquela tabela (42501 ao aplicar pelo pgAdmin)
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, banco_id, conta, ano)
);

ALTER TABLE public.financeiro_conciliacao_saldo_inicial ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conciliacao_saldo_inicial_select ON public.financeiro_conciliacao_saldo_inicial;
CREATE POLICY conciliacao_saldo_inicial_select ON public.financeiro_conciliacao_saldo_inicial
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'visualizar'));

DROP POLICY IF EXISTS conciliacao_saldo_inicial_insert ON public.financeiro_conciliacao_saldo_inicial;
CREATE POLICY conciliacao_saldo_inicial_insert ON public.financeiro_conciliacao_saldo_inicial
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'incluir'));

DROP POLICY IF EXISTS conciliacao_saldo_inicial_update ON public.financeiro_conciliacao_saldo_inicial;
CREATE POLICY conciliacao_saldo_inicial_update ON public.financeiro_conciliacao_saldo_inicial
  FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'alterar'));

DROP POLICY IF EXISTS conciliacao_saldo_inicial_delete ON public.financeiro_conciliacao_saldo_inicial;
CREATE POLICY conciliacao_saldo_inicial_delete ON public.financeiro_conciliacao_saldo_inicial
  FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'excluir'));

ALTER TABLE public.financeiro_conciliacao_fluxo_caixa
  ADD COLUMN IF NOT EXISTS saldo_final_extrato numeric,
  ADD COLUMN IF NOT EXISTS saldo_final_extrato_data date;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public.financeiro_conciliacao_fluxo_caixa
--   DROP COLUMN IF EXISTS saldo_final_extrato, DROP COLUMN IF EXISTS saldo_final_extrato_data;
-- DROP TABLE IF EXISTS public.financeiro_conciliacao_saldo_inicial;
