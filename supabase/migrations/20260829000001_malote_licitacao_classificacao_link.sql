-- SIS-2026-0084: liga cada coluna de custo da Planilha de Custo (rubrica
-- fixa, ex.: salario, insalubridade, rat_fap) a UMA Classificação do
-- Malote (planejamento_orcamentario_classificacao). Objetivo futuro
-- (ainda não implementado aqui): agregar vários itens da licitação numa
-- única classificação do malote pra orçamento/alçada.
--
-- "Classificação Licitação" não é um catálogo no banco — é a lista fixa de
-- colunas de public.planilha_custo (~80 rubricas), mantida no frontend em
-- src/lib/planilhaCustoClassificacoes.ts. Por isso campo_planilha_custo é
-- só texto (chave da coluna), sem FK — validado no frontend contra essa
-- lista fixa, não contra uma tabela.
--
-- UNIQUE(campo_planilha_custo) garante a regra do mockup: "cada
-- classificação de licitação pode ter apenas uma classificação de malote
-- vinculada".
--
-- Escopo deste chamado: só a tela de gerenciar as ligações (CRUD). Nenhuma
-- lógica de agregação/orçamento usa essa tabela ainda.

CREATE TABLE public.malote_licitacao_classificacao_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campo_planilha_custo text NOT NULL UNIQUE,
  classificacao_malote_id uuid NOT NULL REFERENCES public.planejamento_orcamentario_classificacao(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

CREATE INDEX idx_malote_lic_class_link_classificacao ON public.malote_licitacao_classificacao_link(classificacao_malote_id);

CREATE TRIGGER malote_lic_class_link_set_updated BEFORE UPDATE ON public.malote_licitacao_classificacao_link
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.malote_licitacao_classificacao_link ENABLE ROW LEVEL SECURITY;

-- Mesmo trio de acesso já usado no resto da configuração do Malote
-- (SIS-2026-0082): admin/controladoria/diretor_adm.
CREATE POLICY malote_lic_class_link_select ON public.malote_licitacao_classificacao_link FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'));

CREATE POLICY malote_lic_class_link_write ON public.malote_licitacao_classificacao_link FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'));

NOTIFY pgrst, 'reload schema';
