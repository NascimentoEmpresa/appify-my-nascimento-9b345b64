-- =========================================================================
-- EMPREGADOS."Nome Filial" passa a ser "1109 - POLICIA CIVIL RS LIMPEZA 066.2026"
--
-- O SINTOMA (11/09/2026)
--   A Solicitação de Demissão mostrava como "Contrato" da VANESSA SOARES DA
--   SILVA o texto "1109 - PALÁCIO DA POLÍCIA". Isso é o POSTO dela (o local
--   do organograma), não o contrato. O contrato é a FILIAL do Senior:
--   BiFilial.codigo 1109, apelido "POLICIA CIVIL RS LIMPEZA 066.2026".
--
-- A CAUSA
--   A tela lia "Descrição do Local" (= BiOrganogramas.descricao_local, que a
--   migration 20260930000083 preenche) achando que era o contrato. E a
--   coluna certa, "Nome Filial", guardava só o apelido, sem o código — e o
--   RH fala do contrato SEMPRE pelo código na frente.
--
-- A DECISÃO
--   A fonte é a EMPREGADOS, não uma montagem na tela. "Nome Filial" passa a
--   carregar código + apelido em TODAS as linhas, e três coisas garantem
--   que continue assim:
--     1. a função de enriquecimento (000083) grava já nesse formato;
--     2. um trigger BEFORE INSERT/UPDATE prefixa o que chegar sem código —
--        a planilha do Importar Colaboradores, o robô do Senior, quem for;
--     3. o UPDATE abaixo arruma o estoque: 13.297 linhas pelo espelho
--        (código + apelido oficiais, o que de quebra corrige grafias tortas
--        da planilha como "VERANOPOLIS   -  001/2021") e as 40 que não
--        estão no espelho pelo próprio "Filial" da linha.
--   "Descrição do Local" não muda: é o posto, e a tela mostra como posto.
--
-- QUEM COMPARA "Nome Filial" COM CONTRATOS."NOME CONTRATO" (Vagas, Demissão)
--   passou a tirar o prefixo antes de comparar — ver semCodigoFilial() em
--   src/lib/rh/colaboradoresUtils.ts.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── 1. O enriquecimento grava com o código ───────────────────────────────
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
      JOIN espelho."BiEmpregados"         b ON b.numemp = e."Empresa" AND b.numcad = e."Cadastro"
      LEFT JOIN espelho."BiCargos"        c ON c.empresa = b.numemp AND c.cargo = b.codcar
      LEFT JOIN espelho."BiFilial"        f ON f.empresa = b.numemp AND f.codigo = b.codfil
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

-- ── 2. O trigger que não deixa entrar sem código ─────────────────────────
-- Prefixa "Nome Filial" com "Filial" quando o texto chega sem um código na
-- frente. Se já vier "1109 - ..." (do enriquecimento, ou de uma tela que já
-- gravou certo), não mexe.
CREATE OR REPLACE FUNCTION public.rh_empregados_nome_filial_com_codigo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW."Filial" IS NOT NULL
     AND nullif(btrim(NEW."Nome Filial"), '') IS NOT NULL
     AND NEW."Nome Filial" !~ '^\s*\d+\s*-' THEN
    NEW."Nome Filial" := NEW."Filial"::text || ' - ' || btrim(NEW."Nome Filial");
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_rh_empregados_nome_filial_com_codigo ON public."EMPREGADOS";
CREATE TRIGGER trg_rh_empregados_nome_filial_com_codigo
  BEFORE INSERT OR UPDATE OF "Nome Filial", "Filial" ON public."EMPREGADOS"
  FOR EACH ROW EXECUTE FUNCTION public.rh_empregados_nome_filial_com_codigo();

-- ── 3. O estoque ─────────────────────────────────────────────────────────
-- Quem está no espelho recebe o oficial (código + apelido do Senior).
UPDATE public."EMPREGADOS" e
   SET "Nome Filial" = f.codigo::text || ' - ' || btrim(f.apelido)
  FROM espelho."BiEmpregados" b
  JOIN espelho."BiFilial" f ON f.empresa = b.numemp AND f.codigo = b.codfil
 WHERE b.numemp = e."Empresa" AND b.numcad = e."Cadastro"
   AND e."Nome Filial" IS DISTINCT FROM (f.codigo::text || ' - ' || btrim(f.apelido));

-- Quem ficou fora do espelho (40 linhas históricas) ganha o próprio código.
UPDATE public."EMPREGADOS"
   SET "Nome Filial" = "Filial"::text || ' - ' || btrim("Nome Filial")
 WHERE "Filial" IS NOT NULL
   AND nullif(btrim("Nome Filial"), '') IS NOT NULL
   AND "Nome Filial" !~ '^\s*\d+\s*-';

-- ── 4. As solicitações de demissão que já gravaram o posto como contrato ─
-- `contrato` e `colaborador_filial` passam a ser o "Nome Filial" atual do
-- colaborador. `contrato_id` só é apontado quando existe UM contrato ativo
-- da mesma filial com o mesmo nome (sem o código) — apontar errado é pior
-- que não apontar.
UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO" s
   SET contrato           = e."Nome Filial",
       colaborador_filial = e."Nome Filial",
       contrato_id        = coalesce((
         SELECT c.id FROM public."CONTRATOS" c
          WHERE c."ATIVO" = 'SIM' AND c."Filial" = e."Filial"
            AND upper(btrim(c."NOME CONTRATO")) = upper(btrim(regexp_replace(e."Nome Filial", '^\s*\d+\s*-\s*', '')))
          LIMIT 1), s.contrato_id)
  FROM public."EMPREGADOS" e
 WHERE e."ID" = s.colaborador_id
   AND nullif(btrim(e."Nome Filial"), '') IS NOT NULL
   AND (s.contrato IS DISTINCT FROM e."Nome Filial"
     OR s.colaborador_filial IS DISTINCT FROM e."Nome Filial");

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────────
SELECT count(*)                                                  AS total,
       count(*) FILTER (WHERE "Nome Filial" ~ '^\d+ - ')          AS com_codigo,
       count(*) FILTER (WHERE nullif(btrim("Nome Filial"),'') IS NULL) AS sem_filial
  FROM public."EMPREGADOS";

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_rh_empregados_nome_filial_com_codigo ON public."EMPREGADOS";
-- DROP FUNCTION IF EXISTS public.rh_empregados_nome_filial_com_codigo();
-- UPDATE public."EMPREGADOS" SET "Nome Filial" = regexp_replace("Nome Filial", '^\s*\d+\s*-\s*', '')
--  WHERE "Nome Filial" ~ '^\s*\d+\s*-';
-- (a função de enriquecimento volta com a versão da 20260930000083;
--  o `contrato` das solicitações não volta a ser o posto — não faz sentido.)
-- NOTIFY pgrst, 'reload schema';
