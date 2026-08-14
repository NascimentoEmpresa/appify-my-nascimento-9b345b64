-- SIS-2026-0125: "Limite para Justificativa" na Classificação Malote —
-- percentual (sobre o valor do orçamento) a partir do qual a despesa exige
-- justificativa. Só o cadastro do campo nesta entrega; a exigência em si na
-- tela de Despesa/Aprovação do Malote fica para um chamado futuro.
ALTER TABLE public.planejamento_orcamentario_classificacao
  ADD COLUMN limite_justificativa_pct numeric(5,2)
    CHECK (limite_justificativa_pct IS NULL OR limite_justificativa_pct >= 0);

NOTIFY pgrst, 'reload schema';
