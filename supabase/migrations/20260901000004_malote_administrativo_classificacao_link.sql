-- SIS-2026-0125: segundo par da Ligação — liga cada Classificação
-- Administrativo (malote_classificacao_administrativo, catálogo simples) a
-- UMA Classificação do Malote (planejamento_orcamentario_classificacao),
-- pra que o Orçamento Geral consiga pegar aprovadores/alçadas/limite de
-- justificativa dos orçamentos administrativos a partir da Classificação
-- Malote correspondente. Mesmo padrão de
-- malote_licitacao_classificacao_link (SIS-2026-0084), tabela separada em
-- vez de reaproveitar a mesma (evita mexer numa tabela já em uso).

CREATE TABLE public.malote_administrativo_classificacao_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classificacao_administrativa_id uuid NOT NULL UNIQUE REFERENCES public.malote_classificacao_administrativo(id),
  classificacao_malote_id uuid NOT NULL REFERENCES public.planejamento_orcamentario_classificacao(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

CREATE INDEX idx_malote_adm_class_link_classificacao ON public.malote_administrativo_classificacao_link(classificacao_malote_id);

CREATE TRIGGER malote_adm_class_link_set_updated BEFORE UPDATE ON public.malote_administrativo_classificacao_link
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.malote_administrativo_classificacao_link ENABLE ROW LEVEL SECURITY;

CREATE POLICY malote_adm_class_link_select ON public.malote_administrativo_classificacao_link FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'));

CREATE POLICY malote_adm_class_link_write ON public.malote_administrativo_classificacao_link FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'));

NOTIFY pgrst, 'reload schema';
