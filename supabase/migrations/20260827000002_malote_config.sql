-- SIS-2026-0082: Configurações do Malote — regras/prazos únicos pra todo o
-- grupo (não por empresa, confirmado pelo usuário), mais o catálogo de
-- "dias bloqueados" (feriados/recessos/pontos facultativos) usado pra
-- calcular prazos de pagamento.
--
-- Escopo deste chamado: só a tela de configuração (schema + salvar/ler).
-- NENHUMA regra daqui é aplicada em fluxo real ainda — Criar Despesa, Meus
-- Itens e Aprovações do Malote continuam placeholder. O enforcement (achar
-- data de pagamento, bloquear lançamento em dia bloqueado etc.) fica pros
-- chamados que vão construir essas telas de verdade.
--
-- Edição restrita a admin/controladoria/diretor_adm (mesmo trio que edita
-- Orçamento/Classificação — SIS-2026-0079), a pedido do usuário.

-- ============================================================================
-- 1) malote_tipo_bloqueio — catálogo editável de tipos de dia bloqueado
--    (usuário pediu explicitamente que não fosse um enum fixo)
-- ============================================================================
CREATE TABLE public.malote_tipo_bloqueio (
  nome text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

INSERT INTO public.malote_tipo_bloqueio (nome) VALUES
  ('Feriado'), ('Recesso'), ('Ponto Facultativo'), ('Outros')
ON CONFLICT (nome) DO NOTHING;

ALTER TABLE public.malote_tipo_bloqueio ENABLE ROW LEVEL SECURITY;

CREATE POLICY malote_tipo_bloqueio_select ON public.malote_tipo_bloqueio FOR SELECT TO authenticated
  USING (true);

CREATE POLICY malote_tipo_bloqueio_write ON public.malote_tipo_bloqueio FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'));

-- ============================================================================
-- 2) malote_dia_bloqueado — dias específicos cadastrados (data única)
-- ============================================================================
CREATE TABLE public.malote_dia_bloqueado (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data date NOT NULL UNIQUE,
  tipo text NOT NULL REFERENCES public.malote_tipo_bloqueio(nome) ON UPDATE CASCADE,
  descricao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

CREATE INDEX idx_malote_dia_bloqueado_data ON public.malote_dia_bloqueado(data);

CREATE TRIGGER malote_dia_bloqueado_set_updated BEFORE UPDATE ON public.malote_dia_bloqueado
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.malote_dia_bloqueado ENABLE ROW LEVEL SECURITY;

CREATE POLICY malote_dia_bloqueado_select ON public.malote_dia_bloqueado FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'));

CREATE POLICY malote_dia_bloqueado_write ON public.malote_dia_bloqueado FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'));

-- ============================================================================
-- 3) malote_config — linha única (id boolean garante singleton, mesmo
--    padrão de WA_BOT_CONFIG em 20260807000001_whatsapp_chatbot.sql)
-- ============================================================================
CREATE TABLE public.malote_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),

  -- 1.1 Prazo para inclusão e aprovação pelo setor
  inclusao_setor_horario time NOT NULL DEFAULT '12:00',
  inclusao_setor_pagamento_modo text NOT NULL DEFAULT 'hoje' CHECK (inclusao_setor_pagamento_modo IN ('hoje', 'dias_uteis')),
  inclusao_setor_pagamento_dias integer NOT NULL DEFAULT 1 CHECK (inclusao_setor_pagamento_dias >= 1),

  -- 1.2 Prazo para conferência e aprovação
  conferencia_aprovacao_horario time NOT NULL DEFAULT '15:00',
  conferencia_aprovacao_pagamento_modo text NOT NULL DEFAULT 'hoje' CHECK (conferencia_aprovacao_pagamento_modo IN ('hoje', 'dias_uteis')),
  conferencia_aprovacao_pagamento_dias integer NOT NULL DEFAULT 1 CHECK (conferencia_aprovacao_pagamento_dias >= 1),

  -- Bloqueio de Dias
  bloqueio_regra text NOT NULL DEFAULT 'antecipar' CHECK (bloqueio_regra IN ('antecipar', 'proximo_dia_util', 'manter_original')),
  bloqueio_impedir_lancamento boolean NOT NULL DEFAULT false,

  -- 2.1 / 2.2 / 2.3 Inclusão de exceções
  excecao_limite_inclusao_horario time NOT NULL DEFAULT '15:00',
  excecao_limite_aprovacao_horario time NOT NULL DEFAULT '15:30',
  excecao_exigir_justificativa_solicitante boolean NOT NULL DEFAULT true,
  excecao_exigir_justificativa_aprovador boolean NOT NULL DEFAULT true,

  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

INSERT INTO public.malote_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE TRIGGER malote_config_set_updated BEFORE UPDATE ON public.malote_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.malote_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY malote_config_select ON public.malote_config FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'));

-- Sem INSERT/DELETE de propósito: linha única, criada só pelo seed acima.
CREATE POLICY malote_config_update ON public.malote_config FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'));

NOTIFY pgrst, 'reload schema';
