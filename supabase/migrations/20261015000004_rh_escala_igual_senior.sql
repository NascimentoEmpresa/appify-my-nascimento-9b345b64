-- =========================================================================
-- RH — ESCALA do colaborador igual à Senior (15/10/2026)
--
-- Pablo, com o print da Mudança de Função do FRANCISCO ANACLETO QUADROS
-- (matr. 2312, empresa 2): "Eu já troquei a escala dele em 01/09, mas no ERP
-- ele ainda continua com a escala de 12x36."
--
-- Na Senior (espelho.BiEmpregados) ele está na escala 12 —
-- "07:00-16:48(1h)(8:48h)" — desde 01/09/2026; no ERP (EMPREGADOS) seguia na
-- 180 — "07:00-19:00(12x36)(1h)". A integração da Senior
-- (integracao-senior/index.mjs → rh_sync_senior_empregados) atualiza
-- situação, filial, salário, CPF… mas NUNCA mandou a escala: o campo ficou
-- como veio da carga antiga. Em 15/10/2026: 249 de 2.460 ativos divergentes.
--
-- rh_sync_escala_espelho(): copia da BiEmpregados (codesc/datesc) para
-- EMPREGADOS ("Escala_1" = código, "Escala" = descrição da tabela ESCALAS,
-- "Data Escala" no formato que a linha já usa). Código que não está em
-- ESCALAS (9 códigos em 15/10) fica "Escala N (descrição não cadastrada)" —
-- melhor que o texto da escala antiga, que estava errado.
-- Roda agora e, daqui para a frente, logo depois de cada carga do espelho
-- (espelho-mysql/espelho.mjs).
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.rh_sync_escala_espelho()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE n integer;
BEGIN
  IF to_regclass('espelho."BiEmpregados"') IS NULL THEN RETURN 0; END IF;
  EXECUTE $q$
    WITH s AS (
      SELECT DISTINCT ON (b.numemp, b.numcad) b.numemp, b.numcad, b.codesc, b.datesc::date AS datesc
        FROM espelho."BiEmpregados" b
       WHERE b.tipcol = 1 AND b.codesc IS NOT NULL
       ORDER BY b.numemp, b.numcad, b.datesc DESC NULLS LAST
    )
    UPDATE public."EMPREGADOS" e SET
      "Escala_1"    = s.codesc,
      "Escala"      = COALESCE(es."Descricao", 'Escala ' || s.codesc || ' (descrição não cadastrada)'),
      "Data Escala" = CASE WHEN s.datesc IS NULL THEN e."Data Escala"
                           WHEN e."Data Escala" ~ '^\d{2}/\d{2}/\d{4}$' THEN to_char(s.datesc, 'DD/MM/YYYY')
                           ELSE to_char(s.datesc, 'YYYY-MM-DD') END
      FROM s
      LEFT JOIN public."ESCALAS" es ON es."Escala" = s.codesc
     WHERE e."Empresa" = s.numemp AND e."Cadastro" = s.numcad
       AND e."Escala_1" IS DISTINCT FROM s.codesc
  $q$;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $fn$;
REVOKE ALL ON FUNCTION public.rh_sync_escala_espelho() FROM PUBLIC, anon, authenticated;

-- Backup do que vai mudar agora (para desfazer, se precisar).
CREATE TABLE IF NOT EXISTS public."EMPREGADOS_ESCALA_BKP_20261015" AS
SELECT e."ID", e."Escala_1", e."Escala", e."Data Escala", now() AS copiado_em
  FROM public."EMPREGADOS" e
  JOIN espelho."BiEmpregados" b ON b.numemp = e."Empresa" AND b.numcad = e."Cadastro" AND b.tipcol = 1
 WHERE e."Escala_1" IS DISTINCT FROM b.codesc;
ALTER TABLE public."EMPREGADOS_ESCALA_BKP_20261015" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."EMPREGADOS_ESCALA_BKP_20261015" FROM anon, authenticated;

-- Acerta agora (FRANCISCO ANACLETO QUADROS e os outros divergentes).
SELECT public.rh_sync_escala_espelho();

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.rh_sync_escala_espelho();
-- UPDATE public."EMPREGADOS" e SET "Escala_1" = k."Escala_1", "Escala" = k."Escala", "Data Escala" = k."Data Escala"
--   FROM public."EMPREGADOS_ESCALA_BKP_20261015" k WHERE k."ID" = e."ID";
