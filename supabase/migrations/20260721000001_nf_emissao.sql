-- Emissão de NF (Financeiro) — etapa do Analista no fluxo de recepção de
-- notas fiscais, substituindo o processo manual em Excel/VBA (planilha
-- "Modelo" por contrato). Independente do módulo "Fiscal & Tributário"
-- (tabela `nota_fiscal`, `/app/fiscal`) — não usamos esses nomes de
-- propósito, para não colidir com aquele protótipo desconectado.

-- ============================================================================
-- Dados fiscais fixos do contrato (1 registro por contrato, reaproveitado em
-- toda NF daquele contrato — elimina a redigitação manual de retenções,
-- prazo de pagamento, CNAE etc. em toda nota).
-- ============================================================================
CREATE TABLE public.contrato_dados_fiscais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL UNIQUE REFERENCES public.contratos(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  issqn_pct numeric(6,4) NOT NULL DEFAULT 0,
  inss_pct numeric(6,4) NOT NULL DEFAULT 0,
  ir_pct numeric(6,4) NOT NULL DEFAULT 0,
  cofins_pct numeric(6,4) NOT NULL DEFAULT 0,
  pis_pct numeric(6,4) NOT NULL DEFAULT 0,
  csll_pct numeric(6,4) NOT NULL DEFAULT 0,
  prazo_pagamento text,
  codigo_servico_lc116 text,
  codigo_servico_municipal_cnae text,
  conta_pagamento text,
  email_envio_nf text,
  instrucoes_envio text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id)
);

CREATE INDEX idx_cdf_empresa ON public.contrato_dados_fiscais(empresa_id);

CREATE TRIGGER cdf_set_updated BEFORE UPDATE ON public.contrato_dados_fiscais
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.contrato_dados_fiscais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cdf_select" ON public.contrato_dados_fiscais FOR SELECT TO authenticated
  USING (empresa_id = get_user_empresa(auth.uid()) OR has_role(auth.uid(), 'admin'));

CREATE POLICY "cdf_insert" ON public.contrato_dados_fiscais FOR INSERT TO authenticated
  WITH CHECK (
    (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
    AND (has_role(auth.uid(), 'admin') OR empresa_id = get_user_empresa(auth.uid()))
  );

CREATE POLICY "cdf_update" ON public.contrato_dados_fiscais FOR UPDATE TO authenticated
  USING (
    (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
    AND (has_role(auth.uid(), 'admin') OR empresa_id = get_user_empresa(auth.uid()))
  )
  WITH CHECK (
    (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
    AND (has_role(auth.uid(), 'admin') OR empresa_id = get_user_empresa(auth.uid()))
  );

-- ============================================================================
-- Cabeçalho da NF
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE public.nf_emissao_status AS ENUM ('rascunho', 'enviada');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE public.nf_emissao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  contrato_id uuid NOT NULL REFERENCES public.contratos(id),
  variacao text,
  competencia date NOT NULL,
  data_emissao date,
  numero_nf text,
  status public.nf_emissao_status NOT NULL DEFAULT 'rascunho',
  observacoes text,
  valor_contrato_exec_total numeric(14,2) NOT NULL DEFAULT 0,
  vlr_bruto_total numeric(14,2) NOT NULL DEFAULT 0,
  vlr_liquido_total numeric(14,2) NOT NULL DEFAULT 0,
  issqn_total numeric(14,2) NOT NULL DEFAULT 0,
  inss_total numeric(14,2) NOT NULL DEFAULT 0,
  ir_total numeric(14,2) NOT NULL DEFAULT 0,
  cofins_total numeric(14,2) NOT NULL DEFAULT 0,
  pis_total numeric(14,2) NOT NULL DEFAULT 0,
  csll_total numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id)
);

CREATE INDEX idx_nfe_empresa ON public.nf_emissao(empresa_id);
CREATE INDEX idx_nfe_contrato ON public.nf_emissao(contrato_id);
CREATE INDEX idx_nfe_competencia ON public.nf_emissao(competencia);

CREATE TRIGGER nfe_set_updated BEFORE UPDATE ON public.nf_emissao
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Trava de imutabilidade: uma NF "enviada" precisa continuar confiável para
-- a próxima etapa (validação do Financeiro, ainda não construída) — só
-- admin/controladoria podem alterar ou excluir depois do envio.
CREATE OR REPLACE FUNCTION public.nf_emissao_guard_enviada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_status public.nf_emissao_status;
BEGIN
  v_old_status := CASE WHEN TG_OP = 'DELETE' THEN OLD.status ELSE OLD.status END;
  IF v_old_status = 'enviada' AND NOT (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria')) THEN
    RAISE EXCEPTION 'Esta NF já foi enviada para o Financeiro e não pode mais ser alterada. Qualquer correção deve ser feita diretamente com o setor.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER nfe_guard_enviada_upd BEFORE UPDATE ON public.nf_emissao
  FOR EACH ROW EXECUTE FUNCTION public.nf_emissao_guard_enviada();
CREATE TRIGGER nfe_guard_enviada_del BEFORE DELETE ON public.nf_emissao
  FOR EACH ROW EXECUTE FUNCTION public.nf_emissao_guard_enviada();

ALTER TABLE public.nf_emissao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nfe_select" ON public.nf_emissao FOR SELECT TO authenticated
  USING (empresa_id = get_user_empresa(auth.uid()) OR has_role(auth.uid(), 'admin'));

CREATE POLICY "nfe_insert" ON public.nf_emissao FOR INSERT TO authenticated
  WITH CHECK (
    (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
    AND (has_role(auth.uid(), 'admin') OR empresa_id = get_user_empresa(auth.uid()))
  );

CREATE POLICY "nfe_update" ON public.nf_emissao FOR UPDATE TO authenticated
  USING (
    (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
    AND (has_role(auth.uid(), 'admin') OR empresa_id = get_user_empresa(auth.uid()))
  )
  WITH CHECK (
    (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
    AND (has_role(auth.uid(), 'admin') OR empresa_id = get_user_empresa(auth.uid()))
  );

CREATE POLICY "nfe_delete" ON public.nf_emissao FOR DELETE TO authenticated
  USING (
    (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
    AND (has_role(auth.uid(), 'admin') OR empresa_id = get_user_empresa(auth.uid()))
  );

-- ============================================================================
-- Itens/postos da NF
-- ============================================================================
CREATE TABLE public.nf_emissao_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nf_emissao_id uuid NOT NULL REFERENCES public.nf_emissao(id) ON DELETE CASCADE,
  ordem integer NOT NULL DEFAULT 1,
  identificacao text,
  valor_contrato_exec numeric(14,2) NOT NULL DEFAULT 0,
  vlr_va numeric(14,2) NOT NULL DEFAULT 0,
  vlr_vt numeric(14,2) NOT NULL DEFAULT 0,
  vlr_materiais numeric(14,2) NOT NULL DEFAULT 0,
  faltas numeric(14,2) NOT NULL DEFAULT 0,
  posto_nao_implementado numeric(14,2) NOT NULL DEFAULT 0,
  multas numeric(14,2) NOT NULL DEFAULT 0,
  glosas numeric(14,2) NOT NULL DEFAULT 0,
  outros_descontos numeric(14,2) NOT NULL DEFAULT 0,
  qtd_colaboradores integer NOT NULL DEFAULT 0,
  vlr_bruto numeric(14,2) NOT NULL DEFAULT 0,
  total_descontos numeric(14,2) NOT NULL DEFAULT 0,
  vlr_mao_obra numeric(14,2) NOT NULL DEFAULT 0,
  vlr_liquido numeric(14,2) NOT NULL DEFAULT 0,
  issqn numeric(14,2) NOT NULL DEFAULT 0,
  inss numeric(14,2) NOT NULL DEFAULT 0,
  ir numeric(14,2) NOT NULL DEFAULT 0,
  cofins numeric(14,2) NOT NULL DEFAULT 0,
  pis numeric(14,2) NOT NULL DEFAULT 0,
  csll numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_nfei_nf ON public.nf_emissao_item(nf_emissao_id);

CREATE TRIGGER nfei_set_updated BEFORE UPDATE ON public.nf_emissao_item
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.nf_emissao_item ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nfei_select" ON public.nf_emissao_item FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.nf_emissao n WHERE n.id = nf_emissao_id
      AND (n.empresa_id = get_user_empresa(auth.uid()) OR has_role(auth.uid(), 'admin'))
  ));

CREATE POLICY "nfei_write" ON public.nf_emissao_item FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.nf_emissao n WHERE n.id = nf_emissao_id
      AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
      AND (has_role(auth.uid(), 'admin') OR n.empresa_id = get_user_empresa(auth.uid()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.nf_emissao n WHERE n.id = nf_emissao_id
      AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
      AND (has_role(auth.uid(), 'admin') OR n.empresa_id = get_user_empresa(auth.uid()))
  ));

-- ============================================================================
-- Anexos da NF (PDF/XML) — bucket dedicado, mesmo padrão de
-- pre_titulo_anexo/pre-titulos-fiscal já usado em Contas a Pagar.
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('nf-emissao', 'nf-emissao', false, 26214400)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.nf_emissao_anexo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nf_emissao_id uuid NOT NULL REFERENCES public.nf_emissao(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_nfea_nf ON public.nf_emissao_anexo(nf_emissao_id);

ALTER TABLE public.nf_emissao_anexo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nfea_select" ON public.nf_emissao_anexo FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.nf_emissao n WHERE n.id = nf_emissao_id
      AND (n.empresa_id = get_user_empresa(auth.uid()) OR has_role(auth.uid(), 'admin'))
  ));

CREATE POLICY "nfea_write" ON public.nf_emissao_anexo FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.nf_emissao n WHERE n.id = nf_emissao_id
      AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
      AND (has_role(auth.uid(), 'admin') OR n.empresa_id = get_user_empresa(auth.uid()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.nf_emissao n WHERE n.id = nf_emissao_id
      AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
      AND (has_role(auth.uid(), 'admin') OR n.empresa_id = get_user_empresa(auth.uid()))
  ));

CREATE POLICY "nf_emissao_storage_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'nf-emissao' AND (has_role(auth.uid(), 'admin') OR storage_path_empresa(name) = get_user_empresa(auth.uid())));

CREATE POLICY "nf_emissao_storage_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'nf-emissao' AND (has_role(auth.uid(), 'admin') OR storage_path_empresa(name) = get_user_empresa(auth.uid())));

CREATE POLICY "nf_emissao_storage_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'nf-emissao' AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR storage_path_empresa(name) = get_user_empresa(auth.uid())));
