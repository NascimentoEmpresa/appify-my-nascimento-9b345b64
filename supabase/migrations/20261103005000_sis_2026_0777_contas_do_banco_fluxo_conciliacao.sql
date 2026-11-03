-- ============================================================================
-- SIS-2026-0777 — Separar as contas do mesmo banco (ex.: Sicredi HAGG 119 e HAGG 155) no Fluxo de Caixa e na Conciliação
-- ============================================================================
-- Hoje o Fluxo e a conciliação só enxergam BANCO + EMPRESA. O Sicredi tem mais de uma conta por empresa (119 e 155 da HAGG), então os
-- lançamentos das duas se misturavam e o extrato de uma conta era comparado com o Fluxo das duas.
--
-- 1) financeiro_conta_banco: cadastro das contas (banco + empresa + número + apelido). Um banco pode ter N contas.
-- 2) financeiro_fluxo_caixa_conta: a que conta cada lançamento do Fluxo pertence. Fica numa tabela à parte (e não nas views do Fluxo) de
--    propósito: o lançamento original e os ajustes do Fluxo não mudam, e as 6 views continuam como estão. A chave é a mesma do ajuste do Fluxo
--    (origem + despesa_id + parcela); parcela = 0 é o lançamento sem parcela. Lançamento sem linha aqui = "sem conta definida" (comportamento
--    de hoje: continua valendo por banco + empresa).
-- 3) financeiro_conciliacao_fluxo_caixa.conta_banco_id: de qual conta é a conciliação salva (nulo = conciliação por banco + empresa, como antes).
--    O saldo inicial já tem a coluna `conta` (texto, hoje vazia): passa a guardar o id da conta quando o saldo é de uma conta específica.
--
-- Sem menu novo: o cadastro e a atribuição usam o acesso que já existe. O cadastro das contas fica na aba "Contas" de Cartão de Crédito →
-- Gerenciar Bancos e Bandeiras (junto do catálogo de bancos), então lê quem vê o Fluxo de Caixa, a Conciliação ou o Cartão de Crédito e grava
-- quem tem 'alterar' em um dos três (a atribuição em massa já exige 'alterar' no Fluxo).
--
-- SEMENTE: HAGG 119 e HAGG 155 no Sicredi, só quando banco e empresa são achados sem ambiguidade (uma única correspondência). Se não, o
-- cadastro fica vazio e o Financeiro cadastra pela tela.
--
-- Migration leve (2 tabelas novas e 1 coluna): pode rodar inteira de uma vez.
--
-- ROLLBACK:
--   ALTER TABLE public.financeiro_conciliacao_fluxo_caixa DROP COLUMN IF EXISTS conta_banco_id;
--   DROP TABLE IF EXISTS public.financeiro_fluxo_caixa_conta;
--   DROP TABLE IF EXISTS public.financeiro_conta_banco;
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.financeiro_conta_banco (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  banco_id uuid NOT NULL REFERENCES public.malote_cartao_banco(id),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  numero text NOT NULL CHECK (btrim(numero) <> ''),
  apelido text,
  ativo boolean NOT NULL DEFAULT true,
  created_by uuid, -- sem FK para auth.users: criar a chave exige permissão naquela tabela (42501 ao aplicar pelo pgAdmin)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS financeiro_conta_banco_unica ON public.financeiro_conta_banco (banco_id, empresa_id, numero);

CREATE TABLE IF NOT EXISTS public.financeiro_fluxo_caixa_conta (
  origem text NOT NULL CHECK (origem IN ('malote', 'debito_automatico', 'cartao_fatura', 'aplicacao_financeira', 'importacao_historica')),
  despesa_id uuid NOT NULL,
  parcela int NOT NULL DEFAULT 0, -- numero_parcela do lançamento; 0 = sem parcela
  conta_banco_id uuid NOT NULL REFERENCES public.financeiro_conta_banco(id),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (origem, despesa_id, parcela)
);
CREATE INDEX IF NOT EXISTS financeiro_fluxo_caixa_conta_conta ON public.financeiro_fluxo_caixa_conta (conta_banco_id);

ALTER TABLE public.financeiro_conciliacao_fluxo_caixa
  ADD COLUMN IF NOT EXISTS conta_banco_id uuid REFERENCES public.financeiro_conta_banco(id);

ALTER TABLE public.financeiro_conta_banco ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financeiro_fluxo_caixa_conta ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS financeiro_conta_banco_select ON public.financeiro_conta_banco;
CREATE POLICY financeiro_conta_banco_select ON public.financeiro_conta_banco
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'visualizar') OR public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'visualizar') OR public.can_access(auth.uid(), 'financeiro-cartao-credito', 'visualizar'));

DROP POLICY IF EXISTS financeiro_conta_banco_insert ON public.financeiro_conta_banco;
CREATE POLICY financeiro_conta_banco_insert ON public.financeiro_conta_banco
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'alterar') OR public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'alterar') OR public.can_access(auth.uid(), 'financeiro-cartao-credito', 'alterar'));

DROP POLICY IF EXISTS financeiro_conta_banco_update ON public.financeiro_conta_banco;
CREATE POLICY financeiro_conta_banco_update ON public.financeiro_conta_banco
  FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'alterar') OR public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'alterar') OR public.can_access(auth.uid(), 'financeiro-cartao-credito', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'alterar') OR public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'alterar') OR public.can_access(auth.uid(), 'financeiro-cartao-credito', 'alterar'));

DROP POLICY IF EXISTS financeiro_fluxo_caixa_conta_select ON public.financeiro_fluxo_caixa_conta;
CREATE POLICY financeiro_fluxo_caixa_conta_select ON public.financeiro_fluxo_caixa_conta
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'visualizar') OR public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'visualizar') OR public.can_access(auth.uid(), 'financeiro-cartao-credito', 'visualizar'));

DROP POLICY IF EXISTS financeiro_fluxo_caixa_conta_insert ON public.financeiro_fluxo_caixa_conta;
CREATE POLICY financeiro_fluxo_caixa_conta_insert ON public.financeiro_fluxo_caixa_conta
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'alterar') OR public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'alterar') OR public.can_access(auth.uid(), 'financeiro-cartao-credito', 'alterar'));

DROP POLICY IF EXISTS financeiro_fluxo_caixa_conta_update ON public.financeiro_fluxo_caixa_conta;
CREATE POLICY financeiro_fluxo_caixa_conta_update ON public.financeiro_fluxo_caixa_conta
  FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'alterar') OR public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'alterar') OR public.can_access(auth.uid(), 'financeiro-cartao-credito', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'alterar') OR public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'alterar') OR public.can_access(auth.uid(), 'financeiro-cartao-credito', 'alterar'));

DROP POLICY IF EXISTS financeiro_fluxo_caixa_conta_delete ON public.financeiro_fluxo_caixa_conta;
CREATE POLICY financeiro_fluxo_caixa_conta_delete ON public.financeiro_fluxo_caixa_conta
  FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'alterar') OR public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'alterar') OR public.can_access(auth.uid(), 'financeiro-cartao-credito', 'alterar'));

GRANT SELECT, INSERT, UPDATE ON public.financeiro_conta_banco TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financeiro_fluxo_caixa_conta TO authenticated;

-- Semente: Sicredi HAGG 119 e 155 (só se banco e empresa forem únicos).
DO $$
DECLARE
  v_banco uuid;
  v_empresa uuid;
BEGIN
  IF (SELECT count(*) FROM public.malote_cartao_banco WHERE nome ILIKE 'sicredi%') = 1 THEN
    SELECT id INTO v_banco FROM public.malote_cartao_banco WHERE nome ILIKE 'sicredi%';
  END IF;
  IF (SELECT count(*) FROM public.empresas WHERE COALESCE(nome_fantasia, '') ILIKE '%hagg%' OR razao_social ILIKE '%hagg%') = 1 THEN
    SELECT id INTO v_empresa FROM public.empresas WHERE COALESCE(nome_fantasia, '') ILIKE '%hagg%' OR razao_social ILIKE '%hagg%';
  END IF;
  IF v_banco IS NOT NULL AND v_empresa IS NOT NULL THEN
    INSERT INTO public.financeiro_conta_banco (banco_id, empresa_id, numero, apelido) VALUES
      (v_banco, v_empresa, '119', 'HAGG 119'),
      (v_banco, v_empresa, '155', 'HAGG 155')
    ON CONFLICT (banco_id, empresa_id, numero) DO NOTHING;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
