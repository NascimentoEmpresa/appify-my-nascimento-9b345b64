-- =========================================================================
-- Recrutamento: "Digitar" sai do catálogo de etiquetas
--
-- Mesmo dia da 20260930000090, a pedido: das etiquetas pedidas, "Digitar"
-- não era pra ficar. Sai da CHECK e de quem já tinha sido marcado com ela —
-- a ordem importa: primeiro limpa as linhas, depois aperta a CHECK, senão a
-- constraint nova é recusada pelas linhas que ainda a têm.
--
-- Catálogo espelhado em src/lib/recrutamento/etiquetas.ts.
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- O gatilho sistema_recrutamento_guard só deixa "gestor" (auth.uid() com
-- acesso) mexer em coluna que não seja a data de início — e no SQL Editor
-- não há auth.uid(). Desliga só para esta limpeza e religa em seguida.
ALTER TABLE public."SISTEMA_RECRUTAMENTO" DISABLE TRIGGER trg_sistema_recrutamento_guard;
UPDATE public."SISTEMA_RECRUTAMENTO"
   SET etiquetas = array_remove(etiquetas, 'Digitar')
 WHERE 'Digitar' = ANY (etiquetas);
ALTER TABLE public."SISTEMA_RECRUTAMENTO" ENABLE TRIGGER trg_sistema_recrutamento_guard;

ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  DROP CONSTRAINT IF EXISTS sistema_recrutamento_etiquetas_catalogo;
ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  ADD CONSTRAINT sistema_recrutamento_etiquetas_catalogo
  CHECK (etiquetas <@ ARRAY['Confere','Visto','OK','Revisar','Aguardando retorno','Pendência']::text[]);

COMMENT ON COLUMN public."SISTEMA_RECRUTAMENTO".etiquetas IS
  'Etiquetas de trabalho da fila (Confere, Visto, OK, Revisar, Aguardando retorno, Pendência). Anotação de quem analisa, não etapa do fluxo. Catálogo espelhado em src/lib/recrutamento/etiquetas.ts.';

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK — volta a CHECK da 20260930000090 (a etiqueta removida das linhas
-- não volta: era anotação, não há como saber quem tinha).
-- =========================================================================
-- ALTER TABLE public."SISTEMA_RECRUTAMENTO" DROP CONSTRAINT IF EXISTS sistema_recrutamento_etiquetas_catalogo;
-- ALTER TABLE public."SISTEMA_RECRUTAMENTO" ADD CONSTRAINT sistema_recrutamento_etiquetas_catalogo
--   CHECK (etiquetas <@ ARRAY['Confere','Visto','OK','Revisar','Digitar','Aguardando retorno','Pendência']::text[]);
-- NOTIFY pgrst, 'reload schema';
