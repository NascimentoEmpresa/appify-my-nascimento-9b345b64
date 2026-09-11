-- =========================================================================
-- Recrutamento: etiquetas na solicitação de vaga
--
-- Pedido de 11/09/2026: na Gestão Recrutamento e na tela do analista
-- (Licitações › Analistas Validações › Gestão Recrutamento — a MESMA tela,
-- escopo "analista"), um botão para marcar a solicitação com "Confere",
-- "Visto", "OK", "Revisar", "Digitar"... e filtrar a fila por elas.
--
-- É anotação de quem trabalha a fila, não etapa do fluxo: o `status`
-- continua dizendo onde a vaga está. Por isso é uma coluna text[] na própria
-- SISTEMA_RECRUTAMENTO, sem tabela nova e sem histórico — uma etiqueta que
-- some é só alguém que desmarcou.
--
-- QUEM MARCA: quem já pode escrever na solicitação pela RLS
-- (sistema_recrutamento_update) e passa no gatilho sistema_recrutamento_guard
-- como "gestor": recrutamento_gestao (incluir/alterar) e
-- licitacoes_analistas_recrutamento (alterar/aprovar). O Operacional
-- (escopo só de leitura) vê as etiquetas e não tem o botão. Nenhuma policy
-- muda aqui.
--
-- O CATÁLOGO vive na CHECK abaixo E em src/lib/recrutamento/etiquetas.ts.
-- Etiqueta nova entra nos dois lugares, por migration.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  ADD COLUMN IF NOT EXISTS etiquetas text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public."SISTEMA_RECRUTAMENTO".etiquetas IS
  'Etiquetas de trabalho da fila (Confere, Visto, OK, Revisar, Digitar, Aguardando retorno, Pendência). Anotação de quem analisa, não etapa do fluxo. Catálogo espelhado em src/lib/recrutamento/etiquetas.ts.';

ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  DROP CONSTRAINT IF EXISTS sistema_recrutamento_etiquetas_catalogo;
ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  ADD CONSTRAINT sistema_recrutamento_etiquetas_catalogo
  CHECK (etiquetas <@ ARRAY['Confere','Visto','OK','Revisar','Digitar','Aguardando retorno','Pendência']::text[]);

-- O filtro da tela é `etiquetas && ARRAY[...]` (overlaps): índice GIN.
CREATE INDEX IF NOT EXISTS idx_sistema_recrutamento_etiquetas
  ON public."SISTEMA_RECRUTAMENTO" USING gin (etiquetas);

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP INDEX IF EXISTS public.idx_sistema_recrutamento_etiquetas;
-- ALTER TABLE public."SISTEMA_RECRUTAMENTO" DROP CONSTRAINT IF EXISTS sistema_recrutamento_etiquetas_catalogo;
-- ALTER TABLE public."SISTEMA_RECRUTAMENTO" DROP COLUMN IF EXISTS etiquetas;
-- NOTIFY pgrst, 'reload schema';
