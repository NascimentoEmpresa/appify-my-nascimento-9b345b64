-- SIS-2026-0170: 2 catálogos novos dentro de Configurações do Malote —
-- Analistas de Contratos (pedido do Iury) e Formas de Pagamento.
--
-- Analistas de Contratos: cadastro de analistas + vínculo analista<->
-- contrato. Serve pra, futuramente, saber quem deve justificar um
-- lançamento do malote quando ele ultrapassa o limite_justificativa_pct já
-- cadastrado na Classificação do Malote (planejamento_orcamentario_
-- classificacao, desde SIS-2026-0079) — campo que hoje existe mas ainda
-- não é consumido em lugar nenhum. Mesmo padrão scope-limitado já usado em
-- malote_config (SIS-2026-0082): só o cadastro agora, sem enforcement.
--
-- Formas de Pagamento: catálogo nomeado de instrumentos de pagamento (ex.:
-- "Banco do Brasil - Ag. 1234-5" / Transferência Bancária). Não substitui
-- o Select fixo de 5 opções já usado em Criar Despesa e outras telas —
-- confirmado com o usuário que essa troca fica pra outro chamado.
--
-- Mesmo padrão de acesso de malote_dia_bloqueado/malote_tipo_bloqueio:
-- SELECT e escrita restritos a admin/controladoria/diretor_adm.

CREATE TABLE public.malote_analista (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

CREATE TRIGGER malote_analista_set_updated BEFORE UPDATE ON public.malote_analista
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.malote_analista ENABLE ROW LEVEL SECURITY;

CREATE POLICY malote_analista_select ON public.malote_analista FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'));

CREATE POLICY malote_analista_write ON public.malote_analista FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'));

-- empresa_id não é coluna aqui de propósito — deriva de contratos.empresa_id
-- via join na leitura, evita redundância/inconsistência com o contrato.
CREATE TABLE public.malote_analista_contrato (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analista_id uuid NOT NULL REFERENCES public.malote_analista(id),
  contrato_id uuid NOT NULL REFERENCES public.contratos(id),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  UNIQUE (analista_id, contrato_id)
);

CREATE INDEX idx_malote_analista_contrato_contrato ON public.malote_analista_contrato(contrato_id);

CREATE TRIGGER malote_analista_contrato_set_updated BEFORE UPDATE ON public.malote_analista_contrato
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.malote_analista_contrato ENABLE ROW LEVEL SECURITY;

CREATE POLICY malote_analista_contrato_select ON public.malote_analista_contrato FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'));

CREATE POLICY malote_analista_contrato_write ON public.malote_analista_contrato FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'));

CREATE TABLE public.malote_forma_pagamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('transferencia_bancaria', 'pix', 'boleto', 'cartao', 'dinheiro')),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

CREATE TRIGGER malote_forma_pagamento_set_updated BEFORE UPDATE ON public.malote_forma_pagamento
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.malote_forma_pagamento ENABLE ROW LEVEL SECURITY;

CREATE POLICY malote_forma_pagamento_select ON public.malote_forma_pagamento FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'));

CREATE POLICY malote_forma_pagamento_write ON public.malote_forma_pagamento FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'));

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP TABLE IF EXISTS public.malote_analista_contrato;
--   DROP TABLE IF EXISTS public.malote_analista;
--   DROP TABLE IF EXISTS public.malote_forma_pagamento;
-- =====================================================================
