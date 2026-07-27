-- Conta Garantida (cheque especial + rendimento indexado a CDI) — v1
-- "quebra-galho": alimentado por upload manual da mesma planilha de Fluxo de
-- Caixa que o Financeiro já mantém (não existe ainda como dado ao vivo no
-- ERP). Porta o motor de cálculo do sistema legado standalone (Flask, fora
-- do ERP oficial) usado hoje pelo Financeiro.
--
-- Sem empresa_id de propósito: o sistema legado não tem seletor de empresa
-- (conferido no template — não existe filtro por empresa) e os próprios
-- nomes dos bancos já embutem a empresa no rótulo (ex. "BB HAGG" vs
-- "BANRI CANAA"), então é um dashboard único pro grupo inteiro, igual ao uso
-- real de hoje. Mapear pra conta_bancaria (banco_codigo/agencia/conta) exigiria
-- reconciliar manualmente os 13 rótulos livres do Excel contra cadastros
-- estruturados — fora do escopo do quebra-galho.

CREATE TABLE public.fin_conta_garantida_banco (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL UNIQUE,
  limite numeric(15,2) NOT NULL DEFAULT 0,
  taxa_mensal numeric(10,4) NOT NULL DEFAULT 0,
  perc_cdi numeric(10,2) NOT NULL DEFAULT 0,
  vencimento date,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER fcgb_set_updated BEFORE UPDATE ON public.fin_conta_garantida_banco
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.fin_conta_garantida_banco ENABLE ROW LEVEL SECURITY;

CREATE POLICY fcgb_select ON public.fin_conta_garantida_banco FOR SELECT TO authenticated USING (true);

CREATE POLICY fcgb_write ON public.fin_conta_garantida_banco FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'));

-- ============================================================================
-- Movimentos relevantes do Fluxo de Caixa (cheque especial/aplicação/juros/
-- rendimento), já filtrados na importação. Cada upload SUBSTITUI por completo
-- os movimentos — é sempre o snapshot mais recente da planilha, não um ledger
-- incremental (mesmo comportamento que cobranca_relatorio_nota já tinha).
-- ============================================================================
CREATE TABLE public.fin_conta_garantida_movimento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data date NOT NULL,
  banco text NOT NULL,
  tipo text NOT NULL,
  classificacao text NOT NULL,
  valor numeric(15,2) NOT NULL DEFAULT 0,
  importado_em timestamptz NOT NULL DEFAULT now(),
  importado_por uuid REFERENCES auth.users(id)
);

CREATE INDEX idx_fcg_mov_data ON public.fin_conta_garantida_movimento(banco, data);

ALTER TABLE public.fin_conta_garantida_movimento ENABLE ROW LEVEL SECURITY;

CREATE POLICY fcgm_select ON public.fin_conta_garantida_movimento FOR SELECT TO authenticated USING (true);

CREATE POLICY fcgm_write ON public.fin_conta_garantida_movimento FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'));

-- ============================================================================
-- Histórico de CDI diário (Bacen, série 12) — dado público, global, cacheado
-- localmente pra não depender da API do Bacen a cada carregamento do painel.
-- ============================================================================
CREATE TABLE public.fin_cdi_historico (
  data date PRIMARY KEY,
  valor_pct numeric(10,6) NOT NULL
);

ALTER TABLE public.fin_cdi_historico ENABLE ROW LEVEL SECURITY;

CREATE POLICY fcdi_select ON public.fin_cdi_historico FOR SELECT TO authenticated USING (true);

CREATE POLICY fcdi_write ON public.fin_cdi_historico FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'));

-- Seed dos bancos já conhecidos no legado (mesmos nomes/limites de
-- BANCOS_PADRAO em routes.py), pra não começar com a lista vazia.
INSERT INTO public.fin_conta_garantida_banco (nome, limite) VALUES
  ('BANRI CANAA', 0),
  ('BANRI HAGG', 0),
  ('BANRI LF', 0),
  ('BANRI NH', 0),
  ('BB HAGG', 150000),
  ('BB HAGG- APLICAÇÃO', 0),
  ('BB SN', 1950000),
  ('BRADESCO HAGG', 0),
  ('BRADESCO SN', 0),
  ('CAIXA HAGG', 0),
  ('CAIXA SN', 0),
  ('SICREDI HAGG 119', 3000000),
  ('SICREDI HAGG 155', 0)
ON CONFLICT (nome) DO NOTHING;
