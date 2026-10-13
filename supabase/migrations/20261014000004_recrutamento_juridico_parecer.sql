-- =========================================================================
-- RECRUTAMENTO › KANBAN: O JURÍDICO SÓ DÁ PARECER (14/10/2026)
--
-- PEDIDO (Pablo): "na etapa do jurídico, o jurídico não vai mais aprovar ou
-- reprovar, ele só vai colocar observações no candidato, podendo descrever
-- o nível da observação e escrever, e selecionar status como: Tudo certo,
-- Alguns processos mas OK, Alto risco, Muito processo… O jurídico também
-- pode só dar um OK e passar."
--
-- WA_CURRICULOS.juridico_nivel: o nível do parecer. A observação continua em
-- juridico_obs (opcional) e quem/quando em juridico_por/juridico_em. Dar o
-- parecer passa o candidato para a ENTREVISTA — quem decide é o
-- Recrutamento, olhando o parecer no card. juridico_ok passa a ser só "o
-- Jurídico já olhou" (true); os pareceres antigos ficam como estão.
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

ALTER TABLE public."WA_CURRICULOS" ADD COLUMN IF NOT EXISTS juridico_nivel text;
ALTER TABLE public."WA_CURRICULOS" DROP CONSTRAINT IF EXISTS wa_curriculos_juridico_nivel_check;
ALTER TABLE public."WA_CURRICULOS" ADD CONSTRAINT wa_curriculos_juridico_nivel_check
  CHECK (juridico_nivel IS NULL OR juridico_nivel IN ('tudo_certo', 'alguns_processos_ok', 'muitos_processos', 'alto_risco'));

COMMENT ON COLUMN public."WA_CURRICULOS".juridico_nivel IS
  'Parecer do Jurídico no kanban (mig 20261014000004): tudo_certo | alguns_processos_ok | muitos_processos | alto_risco. Não aprova nem reprova — o Recrutamento decide.';

-- A tela Jurídico › Verificação de Candidatos lê VW_RECRUTAMENTO_CANDIDATOS:
-- a coluna entra no fim (CREATE OR REPLACE VIEW só acrescenta no fim), com o
-- mesmo security_invoker. Definição viva de 14/10/2026 + c.juridico_nivel.
DO $do$
DECLARE d text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'VW_RECRUTAMENTO_CANDIDATOS' AND column_name = 'juridico_nivel') THEN
    d := pg_get_viewdef('public."VW_RECRUTAMENTO_CANDIDATOS"'::regclass);
    d := regexp_replace(d, '\s+FROM\s+\(\(', ', c.juridico_nivel FROM ((');
    EXECUTE 'CREATE OR REPLACE VIEW public."VW_RECRUTAMENTO_CANDIDATOS" WITH (security_invoker = true) AS ' || d;
  END IF;
END $do$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- (a view: recriar pela definição anterior, sem a última coluna c.juridico_nivel)
-- ALTER TABLE public."WA_CURRICULOS" DROP CONSTRAINT IF EXISTS wa_curriculos_juridico_nivel_check;
-- ALTER TABLE public."WA_CURRICULOS" DROP COLUMN IF EXISTS juridico_nivel;
