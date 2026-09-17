-- =========================================================================
-- CONTRATOS: filial nova do Senior vira contrato sozinha
--
-- SINTOMA (17/09/2026, CRISTIANA SOARES PEREIRA, vaga de Substituição)
--   "Contrato — do colaborador escolhido" vazio. Ela é da filial 1110
--   (UFRGS DIGITADORES 014.2026), que existe no Senior desde abril, tem 25
--   pessoas Trabalhando — e NÃO tem linha em CONTRATOS. O mesmo vale para
--   1111 (VERANÓPOLIS RECEP, 13) e 1112 (UFRGS AUX SAÚDE BUCAL, 18): 56
--   colaboradores sem contrato em vaga, demissão e advertência.
--
-- CAUSA
--   CONTRATOS é cadastro do ERP (Contratos › tela), preenchido à mão;
--   EMPREGADOS vem do Senior toda hora. Filial nova chega pelo sync e
--   ninguém cadastra o contrato — e todo casamento colaborador→contrato
--   passa por CONTRATOS."Filial".
--
-- O QUE MUDA
--   1. contratos_sincronizar_filiais(): pra cada (empresa, filial) de
--      espelho.BiFilial que tem gente Trabalhando em EMPREGADOS e NENHUMA
--      linha em CONTRATOS com essa (empresa, filial), cria o contrato — nome = apelido
--      do Senior, razão social = nome da filial, endereço/CEP da filial,
--      ATIVO = 'SIM'. (Empresa, filial) que já tem contrato (mesmo
--      inativo) NÃO é tocada: ali o cadastro é do Contratos e uma linha a
--      mais só criaria dúvida. O id é max+1 (a coluna não é identity).
--   2. rh_sync_senior_empregados chama a função no fim: a cada rodada do
--      robô (toda hora, sync-senior.yml), filial nova já nasce com contrato.
--   3. Roda agora: cria 1110, 1111, 1112 (HAGG) e 1098 CEITEC (SN) — 65 pessoas.
--
--   O front também mudou (mesma PR): o casamento passa a usar (Empresa,
--   Filial) — a filial 1097 existe em três empresas — e compara o nome
--   normalizado ("LIMP"/"LIMPEZA", "063.2026"/"063/2026").
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.contratos_sincronizar_filiais()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, espelho, pg_temp
AS $fn$
DECLARE
  v_id    bigint;
  v_novos int := 0;
  f       record;
BEGIN
  SELECT coalesce(max(id), 0) INTO v_id FROM public."CONTRATOS";
  FOR f IN
    SELECT b.empresa, b.codigo, btrim(b.nome) AS nome, btrim(b.apelido) AS apelido,
           nullif(btrim(concat_ws(', ', nullif(btrim(b.rua), ''), nullif(btrim(b.numero::text), ''))), '') AS endereco,
           -- cep é integer no espelho: 90040001 → "90040-001".
           CASE WHEN b.cep IS NULL OR b.cep = 0 THEN NULL
                ELSE regexp_replace(lpad(b.cep::text, 8, '0'), '^(\d{5})(\d{3})$', '\1-\2') END AS cep
      FROM espelho."BiFilial" b
     WHERE nullif(btrim(b.apelido), '') IS NOT NULL
       AND EXISTS (SELECT 1 FROM public."EMPREGADOS" e
                    WHERE e."Empresa" = b.empresa AND e."Filial" = b.codigo AND e."Situação" = 'Trabalhando')
       -- Chave (empresa, filial), como no Senior: a 1098 é UFRGS COPA na HAGG
       -- e CEITEC na SN — dois contratos de verdade.
       AND NOT EXISTS (SELECT 1 FROM public."CONTRATOS" c WHERE c."Empresa" = b.empresa AND c."Filial" = b.codigo)
     ORDER BY b.codigo
  LOOP
    v_id := v_id + 1;
    INSERT INTO public."CONTRATOS"
      (id, "Empresa", "NOME EMPRESA", "Filial", "Razão Social", "NOME CONTRATO", "Endereço", "CEP", "ATIVO")
    VALUES
      (v_id, f.empresa,
       CASE f.empresa WHEN 1 THEN 'HAGG' WHEN 2 THEN 'SN' WHEN 3 THEN 'CANAÃ' WHEN 5 THEN 'NH' ELSE NULL END,
       f.codigo, f.nome, f.apelido, f.endereco, f.cep, 'SIM');
    v_novos := v_novos + 1;
  END LOOP;
  RETURN jsonb_build_object('contratos_criados', v_novos);
END $fn$;
REVOKE ALL ON FUNCTION public.contratos_sincronizar_filiais() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contratos_sincronizar_filiais() FROM anon;
GRANT EXECUTE ON FUNCTION public.contratos_sincronizar_filiais() TO service_role;

-- O robô do Senior (rh_sync_senior_empregados) fecha a rodada criando os
-- contratos das filiais novas. Corpo da 20260906000008 + a chamada no fim.
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

  RETURN jsonb_build_object('inseridos', v_ins, 'atualizados', v_upd, 'ignorados', v_ign, 'contratos', v_contratos);
END $function$;

-- Agora.
SELECT public.contratos_sincronizar_filiais();

NOTIFY pgrst, 'reload schema';

-- Conferência: Trabalhando sem contrato ativo na (Empresa, Filial) — as que
-- sobrarem já TÊM contrato cadastrado (inativo ou em outra empresa) e são
-- do Contratos ajustar à mão.
-- SELECT e."Empresa", e."Filial", min(e."Nome Filial"), count(*)
--   FROM public."EMPREGADOS" e WHERE e."Situação"='Trabalhando'
--    AND NOT EXISTS (SELECT 1 FROM public."CONTRATOS" c WHERE c."Empresa"=e."Empresa" AND c."Filial"=e."Filial" AND c."ATIVO"='SIM')
--  GROUP BY 1,2 ORDER BY 4 DESC;

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reaplicar rh_sync_senior_empregados da 20260906000008 (sem a chamada);
-- DROP FUNCTION IF EXISTS public.contratos_sincronizar_filiais();
-- DELETE FROM public."CONTRATOS" WHERE ("Empresa", "Filial") IN ((1,1110), (1,1111), (1,1112), (2,1098));  -- só os criados por ela
-- NOTIFY pgrst, 'reload schema';
