-- SIS-2026-0726: Fluxo de Caixa separa o que é de uso livre (conta movimento) do que não pode ser usado (conta vinculada e aplicações em CDB).
-- A separação sai das CLASSIFICAÇÕES: cada classificação ganha uma "natureza" aqui, e os cards de Entradas, Saídas e Saldo somam por natureza.
-- Classificação sem natureza (ou lançamento sem classificação) não é chutada para nenhum grupo: a tela acusa o valor e pede que se defina.
--
-- Mapa separado da tabela de classificações do Orçamento de propósito: ela é de outro módulo (RLS por setor/aprovador) e este mapa só existe para
-- a leitura do Fluxo. Gate: mesmo menu do Fluxo de Caixa (visualizar para ler, alterar para mapear).

CREATE TABLE IF NOT EXISTS public.financeiro_fluxo_classificacao_natureza (
  classificacao_id uuid PRIMARY KEY REFERENCES public.planejamento_orcamentario_classificacao(id) ON DELETE CASCADE,
  natureza         text NOT NULL CHECK (natureza IN ('livre', 'conta_vinculada', 'cdb')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- Sem FK para auth.users: quem aplica a migration no cluster nem sempre tem REFERENCES nessa tabela ("permission denied for table users").
  updated_by       uuid
);

DROP TRIGGER IF EXISTS fluxo_classificacao_natureza_set_updated ON public.financeiro_fluxo_classificacao_natureza;
CREATE TRIGGER fluxo_classificacao_natureza_set_updated
  BEFORE UPDATE ON public.financeiro_fluxo_classificacao_natureza
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.financeiro_fluxo_classificacao_natureza ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fluxo_classificacao_natureza_select ON public.financeiro_fluxo_classificacao_natureza;
CREATE POLICY fluxo_classificacao_natureza_select ON public.financeiro_fluxo_classificacao_natureza
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'visualizar'));

DROP POLICY IF EXISTS fluxo_classificacao_natureza_write ON public.financeiro_fluxo_classificacao_natureza;
CREATE POLICY fluxo_classificacao_natureza_write ON public.financeiro_fluxo_classificacao_natureza
  FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'alterar'));

-- No cluster tabela nova não herda privilégio: sem o GRANT o Postgres nega antes de avaliar a RLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financeiro_fluxo_classificacao_natureza TO authenticated;

-- Única classificação que já é, sem dúvida, de CDB: "Aplicação Financeira" (aplicação = saída, resgate = entrada). As demais (ex.: Transferência
-- entre contas, Rendimento de aplicação) ficam sem natureza até o Financeiro definir na tela — a tela mostra o aviso.
INSERT INTO public.financeiro_fluxo_classificacao_natureza (classificacao_id, natureza)
SELECT c.id, 'cdb'
FROM public.planejamento_orcamentario_classificacao c
WHERE translate(upper(c.nome), 'ÇÃÁÀÂÉÊÍÓÔÕÚ', 'CAAAEEIOOOU') = 'APLICACAO FINANCEIRA'
ON CONFLICT (classificacao_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
--   DROP TABLE IF EXISTS public.financeiro_fluxo_classificacao_natureza;
--   NOTIFY pgrst, 'reload schema';
