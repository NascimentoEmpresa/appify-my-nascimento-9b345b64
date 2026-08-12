-- SIS-2026-0104 (ajuste no cadastro de Classificação, SIS-2026-0079): o
-- chefe confirmou que o percentual de alçada PODE passar de 100% — na
-- prática, o aprovador 3 (presidência) quase sempre teria um percentual
-- "absurdo" tipo 1000%, só pra garantir que ele sempre seja o teto. Em vez
-- de forçar digitar um número arbitrário grande, adiciona uma flag
-- "Alçada máxima" por aprovador: quando marcada, aquele nível aprova
-- qualquer valor independente do percentual (equivalente a "sem limite").

ALTER TABLE public.planejamento_orcamentario_classificacao
  DROP CONSTRAINT planejamento_orcamentario_classific_aprovador1_limite_pct_check,
  DROP CONSTRAINT planejamento_orcamentario_classific_aprovador2_limite_pct_check,
  DROP CONSTRAINT planejamento_orcamentario_classific_aprovador3_limite_pct_check;

ALTER TABLE public.planejamento_orcamentario_classificacao
  ADD CONSTRAINT planejamento_orcamentario_classific_aprovador1_limite_pct_check CHECK (aprovador1_limite_pct IS NULL OR aprovador1_limite_pct >= 0),
  ADD CONSTRAINT planejamento_orcamentario_classific_aprovador2_limite_pct_check CHECK (aprovador2_limite_pct IS NULL OR aprovador2_limite_pct >= 0),
  ADD CONSTRAINT planejamento_orcamentario_classific_aprovador3_limite_pct_check CHECK (aprovador3_limite_pct IS NULL OR aprovador3_limite_pct >= 0);

ALTER TABLE public.planejamento_orcamentario_classificacao
  ADD COLUMN aprovador1_sem_limite boolean NOT NULL DEFAULT false,
  ADD COLUMN aprovador2_sem_limite boolean NOT NULL DEFAULT false,
  ADD COLUMN aprovador3_sem_limite boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.planejamento_orcamentario_classificacao.aprovador3_sem_limite IS 'Alçada máxima: quando true, esse aprovador aprova qualquer valor, ignorando aprovadorN_limite_pct.';

NOTIFY pgrst, 'reload schema';
