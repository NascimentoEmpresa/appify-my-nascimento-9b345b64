-- =========================================================================
-- RH › Colaboradores: o título do cargo sai da Senior pelo código em TEXTO,
-- para todas as empresas — acabou o "palpite" pelo número (03/11/2026).
--
-- O CASO: OTAVIO DA SILVA FERREIRA (NH SERVIÇOS, empresa 5, cadastro 259,
-- admitido 03/11/2026) apareceu no modal como "SUPERVISOR DE LICITAÇÃO". Na
-- Senior ele é codcar '0226' = ASSISTENTE DE DESENV. SISTEMAS — o próprio
-- modal mostrava o posto "...-ASSISTENTE DESENV. DE SISTEMAS I-44h". O Pablo:
-- "não faz o menor sentido, não pode continuar ocorrendo esses erros".
--
-- A CAUSA, MEDIDA NA SENIOR (hagg, 03/11):
--   1. espelho."BiCargos" só tem linhas com empresa = 1 (270 cargos). Mas as
--      quatro empresas com gente ativa (1, 2, 3 e 5) usam a MESMA estrutura
--      de cargos (BiEmpregados.estcar = 1 em todas): pelo codcar em texto,
--      o BiCargos cobre 100% dos ativos — 2.015 da 1, 352 da 2, 16 da 3 e 76
--      da 5. O join `c.empresa = bi.numemp` (mig 083/095/188/20261019000004)
--      só achava título para a empresa 1.
--   2. Para as outras, rh_completar_ficha_do_senior() caía no fallback
--      `cargos_da_casa`: o título de quem já está Trabalhando na mesma
--      (Empresa, "Cargo"). Só que "Cargo" é bigint, e a Senior tem 31 pares
--      de códigos que colapsam no mesmo número com cargos diferentes:
--        '0226' ASSISTENTE DE DESENV. SISTEMAS  x '226' SUPERVISOR DE LICITAÇÃO
--        '0196' ASSISTENTE DE DEPARTAMENTO PES x '196' GERENTE OPERACIONAL
--        '0215' ASSISTENTE LICITACAO I          x '215' Diretor  ... (+28)
--      Na NH o único "226" Trabalhando era JOSE CARLOS FERREIRA EBERT (codcar
--      '226', SUPERVISOR DE LICITAÇÃO): o par (5, 226) era "inequívoco" e o
--      Otavio herdou o cargo dele. A mig 20261019000004 já avisava que o
--      título tem que sair do codcar em texto — o fallback desobedecia.
--   3. Pior: o fallback só valia quando o título estava VAZIO ou o código
--      mudava pelo número — promoção na NH não chegava ao ERP. Simulado
--      (só leitura) no retrato de 16/10 do banco antigo: 28 fichas mudam,
--      14 de gente ativa da NH, e o POSTO da Senior confirma o título novo em
--      todas — ex.: JOEL DOS SANTOS "ASSISTENTE DE COMPRAS II" -> ANALISTA
--      OPERACIONAL I (posto 05-1093-0022-199-6-ANALISTA OPERACIONAL I, desde
--      04/09); XAIANY "AUXILIAR ADMINISTRATIVO" -> ASSISTENTE LICITACAO I;
--      ANA LUIZA, ANNE, ISADORA, JULIANA, SABRINA, GIOVANA idem. As demais são
--      grafia ("ANALISTA DESENV. DE SISTEMAS I" -> "ANALISTA DE
--      DESENVOLVIMENTO DE SISTEMAS I"). O Otavio entrou depois do retrato.
--   Expostos à colisão na Senior: 48 pessoas das empresas 2/3/5 (27 não
--   demitidas). A lista exata do que mudou fica no
--   EMPREGADOS_SYNC_SENIOR_LOG desta aplicação (conferência no fim).
--
-- A REGRA AGORA:
--   · Título do cargo = BiCargos pelo codcar em TEXTO; prefere a linha da
--     própria empresa (se um dia o espelho trouxer as outras) e senão usa a
--     da estrutura única (empresa 1). Nas duas funções que leem o BiCargos.
--   · Fallback pelo número removido: código que não está no BiCargos deixa
--     o título como está — vazio é melhor do que cargo de outra pessoa.
--   · Roda agora (corrige o Otavio e os demais) e segue no sync de 15 em 15
--     min (rh_sync_senior_pelo_espelho → rh_sync_senior_empregados).
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1. Ficha pela Senior (chamada no fim de todo sync) ──────────────────
CREATE OR REPLACE FUNCTION public.rh_completar_ficha_do_senior()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_n int := 0;
BEGIN
  WITH bi AS (
    -- Uma linha por (empresa, cadastro) de EMPREGADO (tipcol = 1 — o terceiro
    -- com o mesmo numcad é outra pessoa, ver mig 095); o espelho repete a
    -- pessoa quando ela mudou de situação: fica a mais recente.
    SELECT DISTINCT ON (numemp, numcad) numemp, numcad, codcar, codesc, taborg, numloc
      FROM espelho."BiEmpregados"
     WHERE tipcol = 1
     ORDER BY numemp, numcad, datadm DESC NULLS LAST
  ),
  escalas_da_casa AS (
    -- Texto da escala por código, o mais usado.
    SELECT DISTINCT ON ("Escala_1") "Escala_1" AS codesc, "Escala" AS texto
      FROM (SELECT "Escala_1", "Escala", count(*) AS n FROM public."EMPREGADOS"
             WHERE "Escala" IS NOT NULL AND "Escala_1" IS NOT NULL GROUP BY 1, 2) t
     ORDER BY "Escala_1", n DESC
  ),
  senior AS (
    SELECT e."ID",
           nullif(regexp_replace(coalesce(bi.codcar, ''), '\D', '', 'g'), '')::bigint AS cargo,
           nullif(btrim(c.titulo), '') AS titulo_senior,
           bi.codesc::bigint AS codesc,
           nullif(btrim(o.descricao_local), '') AS descricao_local
      FROM public."EMPREGADOS" e
      JOIN bi ON bi.numemp = e."Empresa" AND bi.numcad = e."Cadastro"
      -- Título pelo codcar em TEXTO ('0226' <> '226'). Estrutura de cargos
      -- única (estcar = 1) e o espelho só traz a empresa 1: a linha da
      -- própria empresa ganha, senão vale a da estrutura (03/11/2026, Otavio).
      LEFT JOIN LATERAL (
        SELECT bc.titulo FROM espelho."BiCargos" bc
         WHERE bc.cargo = bi.codcar
         ORDER BY (bc.empresa = bi.numemp) DESC, bc.empresa
         LIMIT 1
      ) c ON true
      LEFT JOIN espelho."BiOrganogramas" o ON o.organograma = bi.taborg AND o.codigo_local = bi.numloc
  ),
  novo AS (
    SELECT e."ID",
           s.cargo IS NOT NULL AND s.cargo IS DISTINCT FROM e."Cargo" AS cargo_mudou,
           s.codesc IS NOT NULL AND s.codesc IS DISTINCT FROM e."Escala_1"::bigint AS escala_mudou,
           coalesce(s.cargo, e."Cargo") AS cargo,
           -- Sem fallback pelo número: "Cargo" é bigint e colapsa '0226'/'226'
           -- (foi assim que o Otavio virou SUPERVISOR DE LICITAÇÃO).
           s.titulo_senior AS titulo,
           coalesce(s.codesc, e."Escala_1"::bigint) AS codesc,
           coalesce(nullif(btrim(x.descricao), ''), ec.texto) AS escala_texto,
           s.descricao_local
      FROM public."EMPREGADOS" e
      JOIN senior s ON s."ID" = e."ID"
      LEFT JOIN public."RH_ESCALA" x ON x.codigo = s.codesc
      LEFT JOIN escalas_da_casa ec ON ec.codesc = s.codesc
  ),
  calc AS (
    SELECT e."ID", e."Empresa", e."Cadastro",
           n.cargo AS cargo_novo,
           -- Título: troca quando o código mudou, quando está vazio, ou quando
           -- difere de verdade (não só por truncamento em 30 caracteres).
           CASE WHEN n.titulo IS NOT NULL AND (
                       n.cargo_mudou
                    OR nullif(btrim(e."Título do Cargo"), '') IS NULL
                    OR NOT (upper(n.titulo) LIKE upper(btrim(e."Título do Cargo")) || '%'
                            AND (length(btrim(e."Título do Cargo")) >= 30
                                 OR upper(n.titulo) = upper(btrim(e."Título do Cargo")))))
                THEN n.titulo ELSE e."Título do Cargo" END AS titulo_novo,
           CASE WHEN n.titulo IS NOT NULL AND (
                       n.cargo_mudou
                    OR nullif(btrim(e."Nome do Cargo"), '') IS NULL
                    OR NOT (upper(n.titulo) LIKE upper(btrim(e."Nome do Cargo")) || '%'
                            AND (length(btrim(e."Nome do Cargo")) >= 30
                                 OR upper(n.titulo) = upper(btrim(e."Nome do Cargo")))))
                THEN n.titulo ELSE e."Nome do Cargo" END AS nome_cargo_novo,
           CASE WHEN n.descricao_local IS NOT NULL
                 AND upper(n.descricao_local) IS DISTINCT FROM upper(btrim(e."Descrição do Local"))
                THEN n.descricao_local ELSE e."Descrição do Local" END AS local_novo,
           n.codesc AS escala_1_nova,
           CASE WHEN n.escala_texto IS NOT NULL
                 AND (n.escala_mudou OR nullif(btrim(e."Escala"), '') IS NULL)
                THEN n.escala_texto ELSE e."Escala" END AS escala_nova,
           jsonb_build_object('Cargo', e."Cargo", 'Título do Cargo', e."Título do Cargo",
                              'Nome do Cargo', e."Nome do Cargo", 'Descrição do Local', e."Descrição do Local",
                              'Escala_1', e."Escala_1", 'Escala', e."Escala") AS antes
      FROM public."EMPREGADOS" e
      JOIN novo n ON n."ID" = e."ID"
  ),
  mudou AS (
    SELECT c.* FROM calc c JOIN public."EMPREGADOS" e ON e."ID" = c."ID"
     WHERE e."Cargo"              IS DISTINCT FROM c.cargo_novo
        OR e."Título do Cargo"    IS DISTINCT FROM c.titulo_novo
        OR e."Nome do Cargo"      IS DISTINCT FROM c.nome_cargo_novo
        OR e."Descrição do Local" IS DISTINCT FROM c.local_novo
        OR e."Escala_1"::bigint   IS DISTINCT FROM c.escala_1_nova
        OR e."Escala"             IS DISTINCT FROM c.escala_nova
  ),
  upd AS (
    UPDATE public."EMPREGADOS" e
       SET "Cargo"              = m.cargo_novo,
           "Título do Cargo"    = m.titulo_novo,
           "Nome do Cargo"      = m.nome_cargo_novo,
           "Descrição do Local" = m.local_novo,
           "Escala_1"           = m.escala_1_nova,
           "Escala"             = m.escala_nova
      FROM mudou m
     WHERE e."ID" = m."ID"
    RETURNING e."ID", m."Empresa", m."Cadastro", m.antes,
              jsonb_build_object('Cargo', e."Cargo", 'Título do Cargo', e."Título do Cargo",
                                 'Nome do Cargo', e."Nome do Cargo", 'Descrição do Local', e."Descrição do Local",
                                 'Escala_1', e."Escala_1", 'Escala', e."Escala") AS depois
  )
  INSERT INTO public."EMPREGADOS_SYNC_SENIOR_LOG"(empregado_id, empresa, cadastro, pessoa_trocada, antes, depois)
  SELECT "ID", "Empresa", "Cadastro", false, antes, depois FROM upd;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('fichas_corrigidas', v_n);
END $function$;

-- Só o sync (SECURITY DEFINER) chama; ninguém de fora.
REVOKE ALL ON FUNCTION public.rh_completar_ficha_do_senior() FROM PUBLIC, anon, authenticated;

-- ── 2. Enriquecer (preenche o vazio; chamada antes da ficha no sync) ────
-- Mesmo corpo da mig 095, só o join do BiCargos muda (texto, sem empresa).
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
      -- Cargo pelo codcar em TEXTO, estrutura única (ver o topo desta migration).
      LEFT JOIN LATERAL (
        SELECT bc.titulo FROM espelho."BiCargos" bc
         WHERE bc.cargo = b.codcar
         ORDER BY (bc.empresa = b.numemp) DESC, bc.empresa
         LIMIT 1
      ) c ON true
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

-- ── 3. Agora: Otavio e os demais das empresas 2/3/5 ─────────────────────
SELECT public.rh_completar_ficha_do_senior();

NOTIFY pgrst, 'reload schema';

-- Conferência (pgAdmin):
--   SELECT "ID", "Empresa", "Cadastro", "Cargo", "Título do Cargo", "Nome do Cargo"
--     FROM public."EMPREGADOS" WHERE "Empresa" = 5 AND "Cadastro" = 259;
--     -> ASSISTENTE DE DESENV. SISTEMAS
--   Quem esta aplicação corrigiu (título antes x depois):
--   SELECT l.empregado_id, x."Nome", x."Situação", l.antes->>'Título do Cargo' AS antes,
--          l.depois->>'Título do Cargo' AS depois
--     FROM public."EMPREGADOS_SYNC_SENIOR_LOG" l JOIN public."EMPREGADOS" x ON x."ID" = l.empregado_id
--    WHERE l.criado_em >= now() - interval '1 hour'
--      AND l.antes->>'Título do Cargo' IS DISTINCT FROM l.depois->>'Título do Cargo'
--    ORDER BY x."Situação" = 'Demitido', x."Nome";

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reaplicar rh_completar_ficha_do_senior da 20261019000004 e
-- rh_enriquecer_empregados_do_espelho da 20260930000095 (voltam o join por
-- empresa e o fallback pelo número — e com eles o cargo trocado).
-- Fichas: EMPREGADOS_SYNC_SENIOR_LOG guarda o "antes" de cada linha alterada:
-- UPDATE public."EMPREGADOS" e SET "Cargo" = (l.antes->>'Cargo')::bigint,
--        "Título do Cargo" = l.antes->>'Título do Cargo', "Nome do Cargo" = l.antes->>'Nome do Cargo',
--        "Descrição do Local" = l.antes->>'Descrição do Local',
--        "Escala_1" = (l.antes->>'Escala_1')::bigint, "Escala" = l.antes->>'Escala'
--   FROM public."EMPREGADOS_SYNC_SENIOR_LOG" l
--  WHERE l.empregado_id = e."ID" AND l.antes ? 'Escala_1' AND l.criado_em >= '<data da aplicação>';
-- NOTIFY pgrst, 'reload schema';
