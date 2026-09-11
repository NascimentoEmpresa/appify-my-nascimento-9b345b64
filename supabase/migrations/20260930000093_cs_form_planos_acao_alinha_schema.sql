-- =========================================================================
-- CS_FORM_PLANOS_ACAO: o banco do app divergiu da migration que a criou
--
-- O SINTOMA (11/09/2026)
--   Concluir um plano de ação no Painel Gerencial dava
--   "null value in column "acao" of relation "CS_FORM_PLANOS_ACAO" violates
--   not-null constraint".
--
-- A CAUSA
--   A tela grava NULL em `acao`/`prazo` de propósito quando o valor é o mesmo
--   da resposta do formulário — é o desenho da 20260721000002: "normalmente
--   NULL: a ação e o prazo vêm das perguntas 14 e 15 da resposta; preenchidos
--   só em override manual ou plano avulso". Gravar igual congelaria o valor e
--   uma correção feita depois no formulário nunca mais chegaria na tela.
--
--   Só que a tabela que está no banco do app NÃO é a da migration: `acao` e
--   `prazo` estão NOT NULL, não existe a CHECK `cs_plano_fonte_chk` (que é o
--   que garante "ou acompanha uma resposta, ou se basta sozinho"), falta o
--   UNIQUE de `resposta_id`, e o DEFAULT de `status` é 'Emandamento' — que
--   nem passa na própria cs_plano_status_chk. Foi criada à mão em algum
--   momento, com outra forma. A tabela está vazia: alinhar não mexe em dado.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

ALTER TABLE public."CS_FORM_PLANOS_ACAO"
  ALTER COLUMN acao  DROP NOT NULL,
  ALTER COLUMN prazo DROP NOT NULL,
  ALTER COLUMN status SET DEFAULT 'Em andamento';

-- Ou é acompanhamento de uma resposta, ou é um plano que se basta sozinho.
ALTER TABLE public."CS_FORM_PLANOS_ACAO"
  DROP CONSTRAINT IF EXISTS cs_plano_fonte_chk;
ALTER TABLE public."CS_FORM_PLANOS_ACAO"
  ADD CONSTRAINT cs_plano_fonte_chk
  CHECK (resposta_id IS NOT NULL OR (acao IS NOT NULL AND prazo IS NOT NULL));

-- Uma resposta tem UMA linha de acompanhamento (a tela faz update na que
-- existe; sem isto, dois cliques criariam duas).
CREATE UNIQUE INDEX IF NOT EXISTS cs_planos_resposta_uq
  ON public."CS_FORM_PLANOS_ACAO"(resposta_id) WHERE resposta_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────────
-- SELECT column_name, is_nullable, column_default FROM information_schema.columns
--  WHERE table_name = 'CS_FORM_PLANOS_ACAO' AND column_name IN ('acao','prazo','status');

-- =========================================================================
-- ROLLBACK (volta à forma divergente — só se algo depender dela)
-- =========================================================================
-- DROP INDEX IF EXISTS public.cs_planos_resposta_uq;
-- ALTER TABLE public."CS_FORM_PLANOS_ACAO" DROP CONSTRAINT IF EXISTS cs_plano_fonte_chk;
-- ALTER TABLE public."CS_FORM_PLANOS_ACAO"
--   ALTER COLUMN acao SET NOT NULL, ALTER COLUMN prazo SET NOT NULL;
-- NOTIFY pgrst, 'reload schema';
