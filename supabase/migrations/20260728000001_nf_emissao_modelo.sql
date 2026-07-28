-- Modelo de NF por contrato — molde fixo das notas que um contrato emite
-- toda competência (ex: TJRS sempre tem "PRÉDIO I"/"PRÉDIO II"), pra abrir
-- "Nova NF" já pré-preenchida em vez de em branco. Só a estrutura (quais
-- notas, que posto(s)/% compõem cada uma) fica salva aqui — valores são
-- sempre resolvidos ao vivo contra planilha_custo (resolverPostosVigentes)
-- na hora de abrir a nota, nunca cacheados neste modelo.

CREATE TABLE public.nf_emissao_modelo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  contrato_id uuid NOT NULL REFERENCES public.contratos(id) ON DELETE CASCADE,
  variacao text,
  ordem integer NOT NULL DEFAULT 1,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id)
);

CREATE INDEX idx_nfem_empresa ON public.nf_emissao_modelo(empresa_id);
CREATE INDEX idx_nfem_contrato ON public.nf_emissao_modelo(contrato_id);

CREATE TRIGGER nfem_set_updated BEFORE UPDATE ON public.nf_emissao_modelo
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.nf_emissao_modelo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nfem_select" ON public.nf_emissao_modelo FOR SELECT TO authenticated
  USING (empresa_id = get_user_empresa(auth.uid()) OR has_role(auth.uid(), 'admin'));

CREATE POLICY "nfem_insert" ON public.nf_emissao_modelo FOR INSERT TO authenticated
  WITH CHECK (
    (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
    AND (has_role(auth.uid(), 'admin') OR empresa_id = get_user_empresa(auth.uid()))
  );

CREATE POLICY "nfem_update" ON public.nf_emissao_modelo FOR UPDATE TO authenticated
  USING (
    (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
    AND (has_role(auth.uid(), 'admin') OR empresa_id = get_user_empresa(auth.uid()))
  )
  WITH CHECK (
    (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
    AND (has_role(auth.uid(), 'admin') OR empresa_id = get_user_empresa(auth.uid()))
  );

CREATE POLICY "nfem_delete" ON public.nf_emissao_modelo FOR DELETE TO authenticated
  USING (
    (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
    AND (has_role(auth.uid(), 'admin') OR empresa_id = get_user_empresa(auth.uid()))
  );

-- ============================================================================
-- Itens do modelo — que posto(s) compõem cada variação, e em que percentual
-- (ex: 40%/60% de um posto dividido entre duas notas do mesmo contrato).
-- ============================================================================
CREATE TABLE public.nf_emissao_modelo_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nf_emissao_modelo_id uuid NOT NULL REFERENCES public.nf_emissao_modelo(id) ON DELETE CASCADE,
  ordem integer NOT NULL DEFAULT 1,
  posto text,
  percentual numeric(6,2) NOT NULL DEFAULT 100,
  identificacao_padrao text,
  inss_categoria text NOT NULL DEFAULT 'normais'
    CHECK (inss_categoria IN ('normais', 'insalubridade_20', 'periculosidade_30', 'insalubridade_40')),
  ultimo_valor_unitario numeric(14,2),
  ultimo_visto_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_nfemi_modelo ON public.nf_emissao_modelo_item(nf_emissao_modelo_id);

CREATE TRIGGER nfemi_set_updated BEFORE UPDATE ON public.nf_emissao_modelo_item
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.nf_emissao_modelo_item ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nfemi_select" ON public.nf_emissao_modelo_item FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.nf_emissao_modelo m WHERE m.id = nf_emissao_modelo_id
      AND (m.empresa_id = get_user_empresa(auth.uid()) OR has_role(auth.uid(), 'admin'))
  ));

CREATE POLICY "nfemi_write" ON public.nf_emissao_modelo_item FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.nf_emissao_modelo m WHERE m.id = nf_emissao_modelo_id
      AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
      AND (has_role(auth.uid(), 'admin') OR m.empresa_id = get_user_empresa(auth.uid()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.nf_emissao_modelo m WHERE m.id = nf_emissao_modelo_id
      AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
      AND (has_role(auth.uid(), 'admin') OR m.empresa_id = get_user_empresa(auth.uid()))
  ));

-- ============================================================================
-- Rastreabilidade: de qual modelo/variação uma NF emitida se originou.
-- ON DELETE SET NULL (não CASCADE) — apagar um modelo não pode apagar
-- histórico de notas já emitidas.
-- ============================================================================
ALTER TABLE public.nf_emissao
  ADD COLUMN nf_emissao_modelo_id uuid REFERENCES public.nf_emissao_modelo(id) ON DELETE SET NULL;

CREATE INDEX idx_nfe_modelo ON public.nf_emissao(nf_emissao_modelo_id);
