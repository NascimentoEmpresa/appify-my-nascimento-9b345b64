-- SIS-2026-0125: separa "Classificação Administrativo" (catálogo simples,
-- só nome+ativo) de "Classificação Malote" (a rica, com tipo/setor/
-- aprovadores/alçadas, que continua sendo planejamento_orcamentario_
-- classificacao). O Orçamento Administrativo passa a referenciar essa
-- classificação simples em vez da rica.

CREATE TABLE public.malote_classificacao_administrativo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  nome_key text GENERATED ALWAYS AS (lower(btrim(nome))) STORED,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  UNIQUE (nome_key)
);

CREATE TRIGGER mca_set_updated BEFORE UPDATE ON public.malote_classificacao_administrativo
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.malote_classificacao_administrativo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mca_select" ON public.malote_classificacao_administrativo FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "mca_insert" ON public.malote_classificacao_administrativo FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'));

CREATE POLICY "mca_update" ON public.malote_classificacao_administrativo FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'));

-- Sem policy de DELETE de propósito, mesmo motivo da tabela irmã: uma
-- classificação referenciada por orçamentos não pode sumir (FK RESTRICT).

-- Seed preservando os MESMOS ids das classificações hoje em
-- planejamento_orcamentario_classificacao com tipo administrativo/nulo —
-- assim o FK de planejamento_orcamentario.classificacao_id continua válido
-- depois do repoint abaixo, sem precisar migrar dados de orçamento. Também
-- inclui qualquer classificação (mesmo tipo='contrato') que já esteja
-- referenciada por um orçamento existente — achamos dados de teste em
-- produção com essa inconsistência (classificação de contrato usada num
-- orçamento administrativo); sem isso o repoint do FK abaixo quebraria.
INSERT INTO public.malote_classificacao_administrativo (id, nome, ativo, created_at, updated_at, created_by, updated_by)
SELECT id, nome, ativo, created_at, updated_at, created_by, updated_by
FROM public.planejamento_orcamentario_classificacao
WHERE tipo = 'administrativo'
   OR tipo IS NULL
   OR id IN (SELECT DISTINCT classificacao_id FROM public.planejamento_orcamentario);

ALTER TABLE public.planejamento_orcamentario
  DROP CONSTRAINT planejamento_orcamentario_classificacao_id_fkey,
  ADD CONSTRAINT planejamento_orcamentario_classificacao_id_fkey
    FOREIGN KEY (classificacao_id) REFERENCES public.malote_classificacao_administrativo(id);

NOTIFY pgrst, 'reload schema';
