-- =========================================================================
-- EMPREGADOS: cargo, local e escala passam a ser CORRIGIDOS pela Senior a
-- cada sync — antes só eram preenchidos quando estavam vazios
--
-- SINTOMA (19/10/2026, Pablo): Solicitação de vaga #1376 (FURG JARDINAGEM,
-- substituição de ORLANDI DOS SANTOS FRANZ) saiu com cargo "AUXILIAR
-- ESCRITORIO" — cargo que o contrato nem tem; os requisitos falam de
-- roçadeira e motosserra. A demissão 252 dele também saiu com esse cargo.
--
-- CAUSA
--   A tela fez o que devia: em Substituição o cargo não é digitado, vem de
--   EMPREGADOS."Título do Cargo" do substituído (ModalNovaVaga). O errado era
--   a ficha dele no ERP:
--     EMPREGADOS 13665 (1/10595): Cargo 231 "AUXILIAR ESCRITORIO", local
--       "1113 - SEDE ADMINISTRATIVA - IRGA POA" (posto e "Nome do Cargo" já
--       certos: PO-00085 / JARDINEIRO)
--     Senior: codcar 0025 JARDINEIRO, local 51 "JARDINAGEM FURG"; folha de
--       set/2026 (R046HOL) também JARDINEIRO. Contratado pela vaga #1190
--       (Jardineiro, FURG).
--   rh_completar_ficha_do_senior (mig 188) e rh_enriquecer_empregados_do_
--   espelho(false) só preenchem campo VAZIO, e o sync (mig 275) mantém cargo,
--   local e escala. Ficha que nasce errada — ou cargo que muda na Senior
--   (promoção, correção do RH) — fica errada para sempre.
--   Medido em 19/10 (2.305 ativos pareados com o espelho): 33 com código de
--   cargo diferente da Senior (ex.: SANDRA 13586 LIDER DE GRUPO x JARDINEIRO,
--   JULIANA 4638 SERVENTE DE LIMPEZA x SUPERVISOR TECNICO OPERACIONAL).
--
-- REGRA (Pablo, 19/10): "todas as informações têm que vir da Senior
-- automaticamente já ajustadas".
--
-- O QUE MUDA
--   rh_completar_ficha_do_senior() — o sync já a chama no fim de toda
--   passada — passa a REESCREVER pela Senior (espelho, tipcol = 1, linha
--   mais recente da pessoa):
--     · "Cargo" (código) sempre que difere;
--     · "Título do Cargo" e "Nome do Cargo" quando o código mudou ou o
--       título difere. Título truncado em 30 caracteres (importação antiga:
--       "TRADUTOR E INTERPRETE DE LIBRA") conta como igual — não é dado
--       errado, e trocar só a grafia mexeria à toa nas regras de curso por
--       cargo (TRN_ALUNO.cargo). O espelho só tem a tabela de cargos da
--       empresa 1; nas outras, o título sai do próprio EMPREGADOS quando o par
--       (Empresa, Cargo) é inequívoco (igual à mig 188), senão fica o atual;
--     · "Descrição do Local" pelo organograma (taborg + numloc);
--     · "Escala_1" (código) sempre que difere, e o texto "Escala" quando o
--       código mudou ou está vazio (RH_ESCALA, senão o texto mais usado).
--   Valor ausente na Senior nunca apaga o que o ERP tem. Toda linha alterada
--   fica em EMPREGADOS_SYNC_SENIOR_LOG (antes/depois só dos campos da ficha).
--   Roda agora: corrige o Orlandi e os demais. Testado em transação desfeita
--   (19/10, banco antigo): 10.276 linhas, quase todas DEMITIDOS só com o
--   código trocado — a importação antiga gravou outra numeração (ERP 165 =
--   Senior 0015, ambos SERVENTE DE LIMPEZA). Entre os Trabalhando: 31 códigos,
--   26 títulos e 11 locais de verdade diferentes. Leva ~4 s.
--   ⚠ "Cargo" é bigint e a Senior tem "0231" (MONITOR DE OFICINA) e "231"
--   (AUXILIAR ESCRITORIO): o código colapsa, por isso o título sai do join
--   pelo codcar em TEXTO, nunca pelo número.
--
--   Vaga #1376: cargo -> JARDINEIRO (o mesmo que a função do catálogo já
--   gravada nela, sup_funcao JARDINEIRO do posto FURG RIO GRANDE). Só se
--   ainda estiver com o cargo errado.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

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
  cargos_da_casa AS (
    -- Título por (Empresa, Cargo) quando é inequívoco entre os Trabalhando.
    SELECT "Empresa", "Cargo", max("Título do Cargo") AS titulo
      FROM public."EMPREGADOS"
     WHERE "Título do Cargo" IS NOT NULL AND "Situação" = 'Trabalhando'
     GROUP BY 1, 2
    HAVING count(DISTINCT upper(btrim("Título do Cargo"))) = 1
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
      LEFT JOIN espelho."BiCargos" c ON c.empresa = bi.numemp AND c.cargo = bi.codcar
      LEFT JOIN espelho."BiOrganogramas" o ON o.organograma = bi.taborg AND o.codigo_local = bi.numloc
  ),
  novo AS (
    SELECT e."ID",
           s.cargo IS NOT NULL AND s.cargo IS DISTINCT FROM e."Cargo" AS cargo_mudou,
           s.codesc IS NOT NULL AND s.codesc IS DISTINCT FROM e."Escala_1"::bigint AS escala_mudou,
           coalesce(s.cargo, e."Cargo") AS cargo,
           coalesce(s.titulo_senior, cc.titulo) AS titulo,
           coalesce(s.codesc, e."Escala_1"::bigint) AS codesc,
           coalesce(nullif(btrim(x.descricao), ''), ec.texto) AS escala_texto,
           s.descricao_local
      FROM public."EMPREGADOS" e
      JOIN senior s ON s."ID" = e."ID"
      LEFT JOIN cargos_da_casa cc ON cc."Empresa" = e."Empresa" AND cc."Cargo" = s.cargo
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

-- Agora (Orlandi e os demais).
SELECT public.rh_completar_ficha_do_senior();

-- Vaga #1376: o cargo do substituído corrigido. A trava da vaga
-- (sistema_recrutamento_guard) só deixa quem não é gestor mexer na data, e a
-- migration roda sem auth.uid() — desligada só para este UPDATE, na mesma
-- transação. O histórico automático (trg_rec_historico_automatico) segue
-- ligado e registra a troca.
ALTER TABLE public."SISTEMA_RECRUTAMENTO" DISABLE TRIGGER trg_sistema_recrutamento_guard;
UPDATE public."SISTEMA_RECRUTAMENTO" r
   SET cargo = e."Título do Cargo"
  FROM public."EMPREGADOS" e
 WHERE r.id = 1376
   AND r.substituido_id = 13665
   AND r.cargo = 'AUXILIAR ESCRITORIO'
   AND e."ID" = 13665
   AND e."Título do Cargo" = 'JARDINEIRO';
ALTER TABLE public."SISTEMA_RECRUTAMENTO" ENABLE TRIGGER trg_sistema_recrutamento_guard;

NOTIFY pgrst, 'reload schema';

-- Conferência:
-- SELECT "Cargo", "Título do Cargo", "Descrição do Local" FROM public."EMPREGADOS" WHERE "ID" = 13665;
-- SELECT empregado_id, antes, depois FROM public."EMPREGADOS_SYNC_SENIOR_LOG" ORDER BY id DESC LIMIT 50;

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reaplicar rh_completar_ficha_do_senior da 20260930000188 (só preenche vazio).
-- Fichas: EMPREGADOS_SYNC_SENIOR_LOG guarda o "antes" de cada linha alterada:
-- UPDATE public."EMPREGADOS" e SET "Cargo" = (l.antes->>'Cargo')::bigint,
--        "Título do Cargo" = l.antes->>'Título do Cargo', "Nome do Cargo" = l.antes->>'Nome do Cargo',
--        "Descrição do Local" = l.antes->>'Descrição do Local',
--        "Escala_1" = (l.antes->>'Escala_1')::bigint, "Escala" = l.antes->>'Escala'
--   FROM public."EMPREGADOS_SYNC_SENIOR_LOG" l
--  WHERE l.empregado_id = e."ID" AND l.antes ? 'Escala_1' AND l.criado_em >= '<data da aplicação>';
-- UPDATE public."SISTEMA_RECRUTAMENTO" SET cargo = 'AUXILIAR ESCRITORIO' WHERE id = 1376;
-- NOTIFY pgrst, 'reload schema';
