-- =========================================================================
-- Patrimônio › Contas/Obrigações: parcela numerada pela ORDEM DO VENCIMENTO
--
-- SINTOMA (14/09/2026, MURANO PARCELAS)
--   A lista, ordenada por vencimento, mostrava 22/78 (ago/26), 61/78
--   (set/26), 60/78 (out/26), 62/78... e lá na frente 23/78 em out/2030.
--   O número da parcela (parcela_numero e o "· Parcela N/T" gravado na
--   descrição) não acompanhava a data: quem edita vencimento "uma a uma",
--   ou reordena na mão, deixa o número onde estava.
--
-- REGRA
--   Dentro de um contrato (contrato_uid), a parcela N é a N-ésima pelo
--   vencimento (empate: id). parcela_total = quantidade de parcelas do
--   contrato. A descrição que termina em "· Parcela N/T" é reescrita junto.
--
--   1. Corrige o que existe (todos os contratos, não só o Murano).
--   2. Trigger mantém: qualquer INSERT/UPDATE/DELETE renumera o contrato
--      afetado (no-op quando já está certo). Statement-level, com guarda de
--      profundidade pra não se chamar de novo.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.jur_parcelas_renumerar(p_contrato uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF p_contrato IS NULL THEN RETURN; END IF;
  WITH ordem AS (
    SELECT id,
           row_number() OVER (ORDER BY vencimento NULLS LAST, parcela_numero NULLS LAST, id) AS n,
           count(*)     OVER ()                                                             AS total
      FROM public."JUR_PATRIMONIO_OBRIGACOES"
     WHERE contrato_uid = p_contrato
  )
  UPDATE public."JUR_PATRIMONIO_OBRIGACOES" o
     SET parcela_numero = ordem.n,
         parcela_total  = ordem.total,
         descricao      = CASE
                            WHEN o.descricao ~ '\s·\s*Parcela\s+\d+\s*/\s*\d+\s*$'
                              THEN regexp_replace(o.descricao, '\s·\s*Parcela\s+\d+\s*/\s*\d+\s*$', ' · Parcela ' || ordem.n || '/' || ordem.total)
                            ELSE o.descricao
                          END
    FROM ordem
   WHERE o.id = ordem.id
     AND (o.parcela_numero IS DISTINCT FROM ordem.n
          OR o.parcela_total IS DISTINCT FROM ordem.total
          OR (o.descricao ~ '\s·\s*Parcela\s+\d+\s*/\s*\d+\s*$'
              AND o.descricao !~ ('\s·\s*Parcela\s+' || ordem.n || '\s*/\s*' || ordem.total || '\s*$')));
END $fn$;
REVOKE ALL ON FUNCTION public.jur_parcelas_renumerar(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.jur_parcelas_renumerar(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.jur_parcelas_renumerar(uuid) TO authenticated;

-- ── 1) Corrige o estoque ────────────────────────────────────────────────
DO $$
DECLARE c uuid;
BEGIN
  FOR c IN SELECT DISTINCT contrato_uid FROM public."JUR_PATRIMONIO_OBRIGACOES" WHERE contrato_uid IS NOT NULL LOOP
    PERFORM public.jur_parcelas_renumerar(c);
  END LOOP;
END $$;

-- ── 2) Mantém ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.jur_parcelas_renumerar_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE c uuid;
BEGIN
  -- A renumeração faz UPDATE na mesma tabela; sem esta guarda o trigger se
  -- chamaria de novo (e de novo).
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  FOR c IN
    SELECT DISTINCT contrato_uid FROM (
      SELECT contrato_uid FROM novas  WHERE contrato_uid IS NOT NULL
      UNION ALL
      SELECT contrato_uid FROM velhas WHERE contrato_uid IS NOT NULL
    ) x
  LOOP
    PERFORM public.jur_parcelas_renumerar(c);
  END LOOP;
  RETURN NULL;
END $fn$;

DROP TRIGGER IF EXISTS trg_jur_parcelas_renumerar_ins ON public."JUR_PATRIMONIO_OBRIGACOES";
CREATE TRIGGER trg_jur_parcelas_renumerar_ins
  AFTER INSERT ON public."JUR_PATRIMONIO_OBRIGACOES"
  REFERENCING NEW TABLE AS novas
  FOR EACH STATEMENT EXECUTE FUNCTION public.jur_parcelas_renumerar_trg();

DROP TRIGGER IF EXISTS trg_jur_parcelas_renumerar_upd ON public."JUR_PATRIMONIO_OBRIGACOES";
-- Sem lista de colunas: transition table não aceita "UPDATE OF". A função
-- renumera só se algo estiver fora do lugar, então UPDATE de status/valor
-- passa sem escrever nada.
CREATE TRIGGER trg_jur_parcelas_renumerar_upd
  AFTER UPDATE ON public."JUR_PATRIMONIO_OBRIGACOES"
  REFERENCING OLD TABLE AS velhas NEW TABLE AS novas
  FOR EACH STATEMENT EXECUTE FUNCTION public.jur_parcelas_renumerar_trg();

DROP TRIGGER IF EXISTS trg_jur_parcelas_renumerar_del ON public."JUR_PATRIMONIO_OBRIGACOES";
CREATE TRIGGER trg_jur_parcelas_renumerar_del
  AFTER DELETE ON public."JUR_PATRIMONIO_OBRIGACOES"
  REFERENCING OLD TABLE AS velhas
  FOR EACH STATEMENT EXECUTE FUNCTION public.jur_parcelas_renumerar_trg();

NOTIFY pgrst, 'reload schema';

-- Conferência: contratos em que o número não segue a data (deve dar 0).
-- SELECT count(*) FROM (
--   SELECT id, parcela_numero, row_number() OVER (PARTITION BY contrato_uid ORDER BY vencimento, id) AS n
--     FROM public."JUR_PATRIMONIO_OBRIGACOES" WHERE contrato_uid IS NOT NULL) x
--  WHERE parcela_numero <> n;

-- =========================================================================
-- ROLLBACK (a renumeração não se desfaz)
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_jur_parcelas_renumerar_ins ON public."JUR_PATRIMONIO_OBRIGACOES";
-- DROP TRIGGER IF EXISTS trg_jur_parcelas_renumerar_upd ON public."JUR_PATRIMONIO_OBRIGACOES";
-- DROP TRIGGER IF EXISTS trg_jur_parcelas_renumerar_del ON public."JUR_PATRIMONIO_OBRIGACOES";
-- DROP FUNCTION IF EXISTS public.jur_parcelas_renumerar_trg();
-- DROP FUNCTION IF EXISTS public.jur_parcelas_renumerar(uuid);
