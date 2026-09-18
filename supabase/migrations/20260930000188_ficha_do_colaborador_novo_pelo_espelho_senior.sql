-- =========================================================================
-- RH: ficha do colaborador novo (cargo, escala, posto) completada pelo
-- espelho do Senior — quem entra pelo sync deixava de ter cargo
--
-- PEDIDO (18/09/2026, Pablo)
--   Solicitar Demissão de ALISSON ALESSANDRO MUNIZ ALMEIDA (admitido em
--   11/09/2026): "Cargo não informado", Escala e Cargo vazios — e a
--   solicitação foi mesmo assim.
--
-- CAUSA
--   rh_sync_senior_empregados (o sync diário) INSERE o colaborador novo só com
--   o básico (nome, admissão, situação, filial, CPF, PIS, salário). Cargo,
--   escala e local nunca eram preenchidos: 24 colaboradores Trabalhando
--   admitidos desde 24/08/2026 estavam sem "Título do Cargo".
--
-- O QUE MUDA
--   1. rh_completar_ficha_do_senior(): pra quem está com "Título do Cargo",
--      "Escala" ou "Descrição do Local" NULO, busca no espelho do Senior
--      (espelho."BiEmpregados" + BiCargos + BiOrganogramas) e preenche SÓ o
--      que está vazio — nunca sobrescreve o que o RH já tem. A escala em
--      texto não existe no espelho: sai do próprio EMPREGADOS (o texto mais
--      comum entre quem tem o mesmo código de escala, "Escala_1" = codesc).
--      O espelho só tem a tabela de cargos da empresa 1 (e o código muda de
--      empresa pra empresa): pras outras, o título sai do próprio EMPREGADOS
--      — só quando o par (Empresa, Cargo) tem UM título entre quem está
--      Trabalhando; par ambíguo fica em branco, melhor do que cargo errado.
--      Conferido antes: codcar bate com "Cargo" em 99,6% das fichas,
--      descricao_local com "Descrição do Local" em 97%, codesc com "Escala_1"
--      em 98,5%.
--   2. rh_sync_senior_empregados chama isso no fim (como já faz com os
--      contratos, mig 180) — colaborador novo sai do sync com a ficha inteira.
--   3. Roda agora pros 24.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.rh_completar_ficha_do_senior()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_n int := 0;
BEGIN
  WITH bi AS (
    -- Uma linha por (empresa, cadastro): o espelho repete a pessoa quando ela
    -- mudou de situação; fica a mais recente.
    SELECT DISTINCT ON (numemp, numcad) numemp, numcad, codcar, codesc, taborg, numloc
      FROM espelho."BiEmpregados"
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
  escalas AS (
    -- Texto da escala por código, o mais usado.
    SELECT DISTINCT ON ("Escala_1") "Escala_1" AS codesc, "Escala" AS texto
      FROM (SELECT "Escala_1", "Escala", count(*) AS n FROM public."EMPREGADOS"
             WHERE "Escala" IS NOT NULL AND "Escala_1" IS NOT NULL GROUP BY 1, 2) t
     ORDER BY "Escala_1", n DESC
  ),
  alvo AS (
    SELECT e."ID",
           nullif(regexp_replace(coalesce(bi.codcar, ''), '\D', '', 'g'), '')::bigint AS cargo,
           coalesce(c.titulo, cc.titulo) AS titulo_cargo,
           bi.codesc,
           esc.texto AS escala,
           o.descricao_local
      FROM public."EMPREGADOS" e
      JOIN bi ON bi.numemp = e."Empresa" AND bi.numcad = e."Cadastro"
      LEFT JOIN espelho."BiCargos" c ON c.empresa = bi.numemp AND c.cargo = bi.codcar
      LEFT JOIN espelho."BiOrganogramas" o ON o.organograma = bi.taborg AND o.codigo_local = bi.numloc
      LEFT JOIN escalas esc ON esc.codesc = bi.codesc
      LEFT JOIN cargos_da_casa cc ON cc."Empresa" = e."Empresa"
                                 AND cc."Cargo" = nullif(regexp_replace(coalesce(bi.codcar, ''), '\D', '', 'g'), '')::bigint
     WHERE e."Título do Cargo" IS NULL OR e."Escala" IS NULL OR e."Descrição do Local" IS NULL
  )
  UPDATE public."EMPREGADOS" e
     SET "Título do Cargo"    = coalesce(e."Título do Cargo", a.titulo_cargo),
         "Cargo"              = coalesce(e."Cargo", a.cargo),
         "Escala_1"           = coalesce(e."Escala_1", a.codesc),
         "Escala"             = coalesce(e."Escala", a.escala),
         "Descrição do Local" = coalesce(e."Descrição do Local", a.descricao_local)
    FROM alvo a
   WHERE a."ID" = e."ID"
     AND (a.titulo_cargo IS NOT NULL OR a.cargo IS NOT NULL OR a.codesc IS NOT NULL OR a.escala IS NOT NULL OR a.descricao_local IS NOT NULL);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('fichas_completadas', v_n);
END $fn$;
REVOKE ALL ON FUNCTION public.rh_completar_ficha_do_senior() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.rh_sync_senior_empregados(_linhas jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ins int := 0;
  v_upd int := 0;
  v_ign int := 0;
  v_id  bigint;
  v_ex  bigint;
  r     record;
  v_contratos jsonb;
  v_fichas    jsonb;
BEGIN
  -- "ID" nao e identity nem tem default: quem insere precisa gerar.
  SELECT coalesce(max("ID"), 0) INTO v_id FROM public."EMPREGADOS";

  FOR r IN
    SELECT * FROM jsonb_to_recordset(coalesce(_linhas, '[]'::jsonb)) AS x(
      empresa bigint, cadastro bigint, nome text, admissao text,
      situacao text, data_afastamento text, filial bigint, sexo text,
      nascimento text, cpf text, pis text, salario text, cod_situacao integer)
  LOOP
    IF r.empresa IS NULL OR r.cadastro IS NULL OR coalesce(btrim(r.nome), '') = '' THEN
      v_ign := v_ign + 1;
      CONTINUE;
    END IF;

    SELECT "ID" INTO v_ex
      FROM public."EMPREGADOS"
     WHERE "Empresa" = r.empresa AND "Cadastro" = r.cadastro
     ORDER BY "ID"
     LIMIT 1;

    IF v_ex IS NULL THEN
      v_id := v_id + 1;
      INSERT INTO public."EMPREGADOS"
        ("ID", "Empresa", "Cadastro", "Nome", "Admissão", "Situação", "Cod Situacao",
         "Data Afastamento", "Filial", "Sexo", "Nascimento", "CPF", "PIS", "Valor Salário")
      VALUES
        (v_id, r.empresa, r.cadastro, r.nome, r.admissao, r.situacao, r.cod_situacao,
         r.data_afastamento, r.filial, r.sexo, r.nascimento, r.cpf, r.pis, r.salario);
      v_ins := v_ins + 1;
    ELSE
      UPDATE public."EMPREGADOS" e
         SET "Situação"         = coalesce(r.situacao, e."Situação"),
             "Cod Situacao"     = coalesce(r.cod_situacao, e."Cod Situacao"),
             "Data Afastamento" = r.data_afastamento,
             "Valor Salário"    = coalesce(r.salario, e."Valor Salário")
       WHERE e."ID" = v_ex
         AND (e."Situação"         IS DISTINCT FROM coalesce(r.situacao, e."Situação")
           OR e."Cod Situacao"     IS DISTINCT FROM coalesce(r.cod_situacao, e."Cod Situacao")
           OR e."Data Afastamento" IS DISTINCT FROM r.data_afastamento
           OR e."Valor Salário"    IS DISTINCT FROM coalesce(r.salario, e."Valor Salário"));
      IF FOUND THEN v_upd := v_upd + 1; END IF;
    END IF;
  END LOOP;

  -- Filial nova no Senior → contrato novo em CONTRATOS (17/09/2026, mig 180).
  -- Erro aqui não pode derrubar o sync dos colaboradores.
  BEGIN
    v_contratos := public.contratos_sincronizar_filiais();
  EXCEPTION WHEN OTHERS THEN
    v_contratos := jsonb_build_object('erro', SQLERRM);
  END;

  -- Ficha do colaborador novo (cargo, escala, local) pelo espelho (18/09/2026,
  -- mig 188). Erro aqui também não derruba o sync.
  BEGIN
    v_fichas := public.rh_completar_ficha_do_senior();
  EXCEPTION WHEN OTHERS THEN
    v_fichas := jsonb_build_object('erro', SQLERRM);
  END;

  RETURN jsonb_build_object('inseridos', v_ins, 'atualizados', v_upd, 'ignorados', v_ign, 'contratos', v_contratos, 'fichas', v_fichas);
END $function$;

-- Agora.
SELECT public.rh_completar_ficha_do_senior();

NOTIFY pgrst, 'reload schema';

-- Conferência: Trabalhando ainda sem cargo.
-- SELECT "Nome", "Admissão", "Empresa", "Cadastro" FROM public."EMPREGADOS" WHERE "Situação"='Trabalhando' AND "Título do Cargo" IS NULL;

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reaplicar rh_sync_senior_empregados da 20260930000180 (sem a chamada);
-- DROP FUNCTION IF EXISTS public.rh_completar_ficha_do_senior();
-- NOTIFY pgrst, 'reload schema';
