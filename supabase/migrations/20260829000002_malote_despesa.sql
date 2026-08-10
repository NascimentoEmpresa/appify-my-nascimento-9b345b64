-- SIS-2026-0095: Criar Despesa do Malote — 3 tabelas (consolidadas a
-- pedido do usuário, menos tabelas pro Eduardo) cobrindo os 3 fluxos do
-- mockup:
--   1) Solicitação de Despesa/Compra/Manutenção — quando a Classificação
--      tem requer_solicitacao=true (planejamento_orcamentario_classificacao,
--      SIS-2026-0079/82).
--   2) Despesa lançada direto no malote — quando requer_solicitacao=false.
--   3) Ratear Classificação — despesa "guarda-chuva" dividida entre
--      VÁRIAS classificações diferentes (só classificações com
--      requer_solicitacao=false podem entrar aqui, regra confirmada com o
--      chefe).
--
-- Escopo deste chamado: só as telas/CRUD. "Enviar para aprovação" grava
-- status='pendente_aprovacao' e para por aí — o roteamento pros
-- Aprovadores 1/2/3 por limite de alçada (%) fica pro chamado que vai
-- construir Aprovações do Malote de verdade.
--
-- Sem tabela pra Competência DRE ainda (por ora só um campo de data, sem
-- integração contábil real — decisão do usuário).

-- ============================================================================
-- 1) malote_despesa — registro único pros 3 fluxos, diferenciados por
--    `origem`. Campos de Solicitação e de Despesa convivem na mesma linha;
--    cada fluxo só preenche os seus (o resto fica NULL).
-- ============================================================================
CREATE TABLE public.malote_despesa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  classificacao_id uuid REFERENCES public.planejamento_orcamentario_classificacao(id),

  origem text NOT NULL CHECK (origem IN ('solicitacao', 'despesa_unica', 'despesa_multi_classificacao')),
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'pendente_aprovacao')),

  -- classificacao_id é obrigatória pros fluxos de classificação única
  -- (solicitacao/despesa_unica) e proibida no rateio entre classificações
  -- (cada linha do rateio carrega a sua própria, ver malote_despesa_rateio_linha).
  CONSTRAINT malote_despesa_classificacao_coerente CHECK (
    (origem = 'despesa_multi_classificacao' AND classificacao_id IS NULL)
    OR (origem <> 'despesa_multi_classificacao' AND classificacao_id IS NOT NULL)
  ),

  nome text NOT NULL,
  valor_total numeric(14,2) NOT NULL DEFAULT 0,

  -- Campos de Solicitação (origem = 'solicitacao')
  motivo text,
  descricao text,
  links text,
  tipo_movimento text CHECK (tipo_movimento IS NULL OR tipo_movimento IN ('entrada', 'saida')),

  -- Campos de Despesa (origem IN ('despesa_unica', 'despesa_multi_classificacao'))
  data_pagamento date,
  competencia date,
  forma_pagamento text,
  informacoes_pagamento text,

  -- Parcelamento (despesa)
  parcelado boolean NOT NULL DEFAULT false,
  numero_parcelas integer,
  dia_desconto integer,

  arquivos text[] NOT NULL DEFAULT '{}',

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

CREATE INDEX idx_malote_despesa_empresa ON public.malote_despesa(empresa_id);
CREATE INDEX idx_malote_despesa_classificacao ON public.malote_despesa(classificacao_id);
CREATE INDEX idx_malote_despesa_created_by ON public.malote_despesa(created_by);

CREATE TRIGGER malote_despesa_set_updated BEFORE UPDATE ON public.malote_despesa
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.malote_despesa ENABLE ROW LEVEL SECURITY;

-- Qualquer usuário autenticado pode criar/ver/editar as próprias despesas
-- (tela de uso diário, não é configuração restrita) — isolado por empresa
-- ativa. admin/controladoria/diretor_adm enxergam e editam tudo (mesmo
-- trio de acesso administrativo já usado no resto do Malote), preparando
-- terreno pra tela de Aprovações.
CREATE POLICY malote_despesa_select ON public.malote_despesa FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm')
    OR empresa_id = get_user_empresa(auth.uid())
  );

CREATE POLICY malote_despesa_insert ON public.malote_despesa FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY malote_despesa_update ON public.malote_despesa FOR UPDATE TO authenticated
  USING (
    (created_by = auth.uid() AND status = 'rascunho')
    OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm')
  )
  WITH CHECK (
    (created_by = auth.uid() AND status = 'rascunho')
    OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm')
  );

CREATE POLICY malote_despesa_delete ON public.malote_despesa FOR DELETE TO authenticated
  USING (
    (created_by = auth.uid() AND status = 'rascunho')
    OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm')
  );

-- ============================================================================
-- 2) malote_despesa_rateio_linha — linhas do rateio. Usada tanto pelo
--    rateio dentro de UMA classificação (Empresa/Contrato/Fornecedor/
--    Integrante) quanto pelo rateio ENTRE classificações (aí cada linha
--    também carrega classificacao_id).
-- ============================================================================
CREATE TABLE public.malote_despesa_rateio_linha (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  despesa_id uuid NOT NULL REFERENCES public.malote_despesa(id) ON DELETE CASCADE,
  classificacao_id uuid REFERENCES public.planejamento_orcamentario_classificacao(id),
  empresa_id uuid REFERENCES public.empresas(id),
  contrato_id uuid REFERENCES public.contratos(id),
  fornecedor_id uuid REFERENCES public.fornecedor(id),
  -- Integrante = colaborador (EMPREGADOS."ID", base do RH em /app/rh/colaboradores).
  -- Sem FK: EMPREGADOS é tabela legada migrada, sem constraint de PK confiável.
  integrante_empregado_id bigint,
  percentual numeric(6,3),
  valor numeric(14,2) NOT NULL DEFAULT 0,
  ordem integer NOT NULL DEFAULT 0
);

CREATE INDEX idx_malote_rateio_linha_despesa ON public.malote_despesa_rateio_linha(despesa_id);

ALTER TABLE public.malote_despesa_rateio_linha ENABLE ROW LEVEL SECURITY;

CREATE POLICY malote_rateio_linha_all ON public.malote_despesa_rateio_linha FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = despesa_id AND (
    d.created_by = auth.uid()
    OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm')
    OR d.empresa_id = get_user_empresa(auth.uid())
  )))
  WITH CHECK (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = despesa_id AND (
    d.created_by = auth.uid()
    OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm')
  )));

-- ============================================================================
-- 3) malote_despesa_parcela — parcelas geradas na criação (compartilhada
--    pelos 3 fluxos que usam parcelamento).
-- ============================================================================
CREATE TABLE public.malote_despesa_parcela (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  despesa_id uuid NOT NULL REFERENCES public.malote_despesa(id) ON DELETE CASCADE,
  numero_parcela integer NOT NULL,
  valor numeric(14,2) NOT NULL,
  data_vencimento date NOT NULL,
  UNIQUE (despesa_id, numero_parcela)
);

CREATE INDEX idx_malote_parcela_despesa ON public.malote_despesa_parcela(despesa_id);

ALTER TABLE public.malote_despesa_parcela ENABLE ROW LEVEL SECURITY;

CREATE POLICY malote_parcela_all ON public.malote_despesa_parcela FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = despesa_id AND (
    d.created_by = auth.uid()
    OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm')
    OR d.empresa_id = get_user_empresa(auth.uid())
  )))
  WITH CHECK (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = despesa_id AND (
    d.created_by = auth.uid()
    OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm')
  )));

-- ============================================================================
-- 4) Storage bucket pra anexos (orçamentos, prints, PDFs, imagens coladas)
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('malote-anexos', 'malote-anexos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "malote_anexos_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'malote-anexos' AND auth.uid() IS NOT NULL);

CREATE POLICY "malote_anexos_write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'malote-anexos' AND auth.uid() IS NOT NULL);

CREATE POLICY "malote_anexos_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'malote-anexos' AND (
    owner = auth.uid()
    OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm')
  ));

NOTIFY pgrst, 'reload schema';
