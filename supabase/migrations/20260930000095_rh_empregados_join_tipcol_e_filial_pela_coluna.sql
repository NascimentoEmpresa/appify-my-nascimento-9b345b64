-- =========================================================================
-- EMPREGADOS: "Nome Filial" de outra pessoa em 80 colaboradores
--
-- O SINTOMA (11/09/2026)
--   MARIA APARECIDA KUNZLER, Filial 1037, apareceu com "Nome Filial" =
--   "1060 - PM FLORES DA CUNHA". O certo, pela própria coluna Filial dela e
--   pela BiFilial, é "1037 - BENTO GONÇALVES - LIMPEZA - 048.2026".
--
-- A CAUSA
--   A 20260930000083 (e a 089 atrás dela) casam EMPREGADOS com o espelho por
--   (Empresa, Cadastro). Só que a chave do Senior é (numemp, tipcol, numcad):
--   67 cadastros aparecem DUAS vezes na BiEmpregados — o empregado (tipcol 1)
--   e um terceiro (tipcol 2) com o mesmo numcad e outro nome. O 9005 da
--   empresa 1 é a Maria (1037) e a Jocélia (1060). O UPDATE ... FROM casou com
--   as duas e gravou a que veio primeiro: 80 colaboradores ficaram com filial,
--   cargo, local e escala DE OUTRA PESSOA.
--
-- A CORREÇÃO
--   1. O join passa a exigir tipcol = 1 (único: 0 duplicatas dentro dele).
--   2. "Nome Filial" deixa de vir do codfil do espelho: vem de
--      EMPREGADOS."Filial" -> BiFilial(empresa, codigo). É a regra do RH —
--      a coluna Filial da linha manda, sempre.
--   3. Estoque: os 80 envenenados recebem cargo/título/local/escala do
--      espelho certo (sobrescrevendo, porque o que está lá é de outra pessoa),
--      e TODA linha recebe "Nome Filial" pela própria Filial (71 mudam).
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── 1 e 2. A função, com o join certo e a filial pela coluna ─────────────
CREATE OR REPLACE FUNCTION public.rh_enriquecer_empregados_do_espelho(
  _sobrescrever boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, espelho, pg_temp
AS $fn$
DECLARE
  v_alteradas int;
BEGIN
  WITH fonte AS (
    SELECT e."ID"                    AS id_empregado,
           b.codcar::int             AS cod_cargo,
           btrim(c.titulo)           AS titulo_cargo,
           -- Contrato = código + apelido da filial. Nunca só o apelido.
           CASE WHEN f.codigo IS NULL THEN NULL
                ELSE f.codigo::text || ' - ' || btrim(f.apelido) END AS nome_filial,
           btrim(o.descricao_local)  AS local_descricao,
           b.codesc::int             AS cod_escala,
           btrim(x.descricao)        AS escala_descricao
      FROM public."EMPREGADOS" e
      -- tipcol = 1: a chave do Senior é (numemp, tipcol, numcad). Sem o tipcol,
      -- 67 cadastros casavam com DUAS linhas (empregado + terceiro com o mesmo
      -- numcad) e o UPDATE pegava a de outra pessoa — ver a 20260930000095.
      JOIN espelho."BiEmpregados"         b ON b.numemp = e."Empresa" AND b.numcad = e."Cadastro" AND b.tipcol = 1
      LEFT JOIN espelho."BiCargos"        c ON c.empresa = b.numemp AND c.cargo = b.codcar
      -- A filial é a da coluna "Filial" da própria linha — não o codfil do
      -- espelho. É a regra do RH: Filial 1037 -> BiFilial 1037, sempre.
      LEFT JOIN espelho."BiFilial"        f ON f.empresa = e."Empresa" AND f.codigo = e."Filial"
      LEFT JOIN espelho."BiOrganogramas"  o ON o.codigo_local = b.numloc
      LEFT JOIN public."RH_ESCALA"        x ON x.codigo = b.codesc::int
  ),
  novo AS (
    SELECT s.id_empregado,
           CASE WHEN _sobrescrever OR e."Cargo" IS NULL
                THEN coalesce(s.cod_cargo, e."Cargo") ELSE e."Cargo" END AS cargo,
           CASE WHEN _sobrescrever OR nullif(btrim(e."Título do Cargo"), '') IS NULL
                THEN coalesce(s.titulo_cargo, e."Título do Cargo") ELSE e."Título do Cargo" END AS titulo_cargo,
           CASE WHEN _sobrescrever OR nullif(btrim(e."Nome do Cargo"), '') IS NULL
                THEN coalesce(s.titulo_cargo, e."Nome do Cargo") ELSE e."Nome do Cargo" END AS nome_cargo,
           CASE WHEN _sobrescrever OR nullif(btrim(e."Nome Filial"), '') IS NULL
                THEN coalesce(s.nome_filial, e."Nome Filial") ELSE e."Nome Filial" END AS nome_filial,
           CASE WHEN _sobrescrever OR nullif(btrim(e."Descrição do Local"), '') IS NULL
                THEN coalesce(s.local_descricao, e."Descrição do Local") ELSE e."Descrição do Local" END AS local_descricao,
           CASE WHEN _sobrescrever OR e."Escala_1" IS NULL
                THEN coalesce(s.cod_escala, e."Escala_1") ELSE e."Escala_1" END AS escala_1,
           CASE WHEN _sobrescrever OR nullif(btrim(e."Escala"), '') IS NULL
                THEN coalesce(s.escala_descricao, e."Escala") ELSE e."Escala" END AS escala
      FROM fonte s
      JOIN public."EMPREGADOS" e ON e."ID" = s.id_empregado
  )
  UPDATE public."EMPREGADOS" e
     SET "Cargo"              = n.cargo,
         "Título do Cargo"    = n.titulo_cargo,
         "Nome do Cargo"      = n.nome_cargo,
         "Nome Filial"        = n.nome_filial,
         "Descrição do Local" = n.local_descricao,
         "Escala_1"           = n.escala_1,
         "Escala"             = n.escala
    FROM novo n
   WHERE n.id_empregado = e."ID"
     AND (e."Cargo"              IS DISTINCT FROM n.cargo
       OR e."Título do Cargo"    IS DISTINCT FROM n.titulo_cargo
       OR e."Nome do Cargo"      IS DISTINCT FROM n.nome_cargo
       OR e."Nome Filial"        IS DISTINCT FROM n.nome_filial
       OR e."Descrição do Local" IS DISTINCT FROM n.local_descricao
       OR e."Escala_1"           IS DISTINCT FROM n.escala_1
       OR e."Escala"             IS DISTINCT FROM n.escala);

  GET DIAGNOSTICS v_alteradas = ROW_COUNT;
  RETURN jsonb_build_object('linhas_alteradas', v_alteradas, 'sobrescreveu', _sobrescrever);
END $fn$;

-- ── 3a. Os 80 envenenados: refaz pelo espelho certo, sobrescrevendo ──────
WITH envenenados AS (
  SELECT e."ID"
    FROM public."EMPREGADOS" e
   WHERE EXISTS (SELECT 1 FROM espelho."BiEmpregados" b
                  WHERE b.numemp = e."Empresa" AND b.numcad = e."Cadastro" AND b.tipcol <> 1)
),
fonte AS (
  SELECT e."ID" AS id_empregado,
         b.codcar::int            AS cod_cargo,
         btrim(c.titulo)          AS titulo_cargo,
         btrim(o.descricao_local) AS local_descricao,
         b.codesc::int            AS cod_escala,
         btrim(x.descricao)       AS escala_descricao
    FROM public."EMPREGADOS" e
    JOIN envenenados v ON v."ID" = e."ID"
    JOIN espelho."BiEmpregados"        b ON b.numemp = e."Empresa" AND b.numcad = e."Cadastro" AND b.tipcol = 1
    LEFT JOIN espelho."BiCargos"       c ON c.empresa = b.numemp AND c.cargo = b.codcar
    LEFT JOIN espelho."BiOrganogramas" o ON o.codigo_local = b.numloc
    LEFT JOIN public."RH_ESCALA"       x ON x.codigo = b.codesc::int
)
UPDATE public."EMPREGADOS" e
   SET "Cargo"              = coalesce(s.cod_cargo, e."Cargo"),
       "Título do Cargo"    = coalesce(s.titulo_cargo, e."Título do Cargo"),
       "Nome do Cargo"      = coalesce(s.titulo_cargo, e."Nome do Cargo"),
       "Descrição do Local" = coalesce(s.local_descricao, e."Descrição do Local"),
       "Escala_1"           = coalesce(s.cod_escala, e."Escala_1"),
       "Escala"             = coalesce(s.escala_descricao, e."Escala")
  FROM fonte s
 WHERE s.id_empregado = e."ID";

-- ── 3b. Nome Filial de TODOS pela própria Filial ─────────────────────────
UPDATE public."EMPREGADOS" e
   SET "Nome Filial" = f.codigo::text || ' - ' || btrim(f.apelido)
  FROM espelho."BiFilial" f
 WHERE f.empresa = e."Empresa" AND f.codigo = e."Filial"
   AND e."Nome Filial" IS DISTINCT FROM (f.codigo::text || ' - ' || btrim(f.apelido));

-- ── 3c. Os 4 que não têm o par (Empresa, Filial) no espelho ─────────────
-- Demitidos com "Empresa" = 2 (SN) mas "Nome da Empresa" = NH: a filial
-- 1093 deles é a da NH (empresa 5 no Senior), não a da SN. Resolve pelo
-- nome da empresa da própria linha — é o único dado consistente que sobrou.
UPDATE public."EMPREGADOS" e
   SET "Nome Filial" = f.codigo::text || ' - ' || btrim(f.apelido)
  FROM espelho."BiFilial" f
 WHERE f.codigo = e."Filial"
   AND f.empresa = CASE
         WHEN upper(coalesce(e."Nome da Empresa", '')) LIKE '%HAGG%' THEN 1
         WHEN upper(coalesce(e."Nome da Empresa", '')) LIKE '%CANA%' THEN 3
         WHEN upper(coalesce(e."Nome da Empresa", '')) ~ '(^|[^A-Z])NH([^A-Z]|$)' THEN 5
         WHEN upper(coalesce(e."Nome da Empresa", '')) ~ '(^|[^A-Z])SN([^A-Z]|$)' THEN 2
       END
   AND NOT EXISTS (SELECT 1 FROM espelho."BiFilial" g WHERE g.empresa = e."Empresa" AND g.codigo = e."Filial")
   AND e."Nome Filial" IS DISTINCT FROM (f.codigo::text || ' - ' || btrim(f.apelido));

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────────
SELECT count(*) AS divergentes
  FROM public."EMPREGADOS" e
  JOIN espelho."BiFilial" f ON f.empresa = e."Empresa" AND f.codigo = e."Filial"
 WHERE e."Nome Filial" IS DISTINCT FROM (f.codigo::text || ' - ' || btrim(f.apelido));
-- (esperado: 0)

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- A função volta com a versão da 20260930000089. Os valores sobrescritos
-- nos 80 não voltam — o que estava lá era de outra pessoa.
