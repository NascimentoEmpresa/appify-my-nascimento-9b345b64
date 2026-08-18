-- Recria a rh_sync_senior_empregados da 20260906000008 acrescentando
-- "Cod Situacao". Arquivo proprio em vez de editar a migration antiga:
-- reescrever historico ja aplicado esconde o que mudou e quando.

-- =========================================================================
-- RH — sincronizacao do cadastro vindo do Senior (BiEmpregados)
--
-- Recebe um lote em jsonb e resolve INSERT/UPDATE de uma vez. A logica
-- mora aqui, e nao no script, para que o robo nao precise de regra nem de
-- leitura previa da tabela.
--
-- ATUALIZADA em 18/08/2026: passa a gravar tambem "Cod Situacao"
-- (BiEmpregados.sitafa), que casa com a tabela SITUACOES.
--
-- CHAVE: (Empresa, Cadastro). Medido em 17/08/2026 nos 13.214 do Senior:
--   numcad sozinho ....................  9.810 distintos  <- FUNDE PESSOAS
--   numemp + numcad ................... 13.152 distintos
--   numemp + tipcol + numcad .......... 13.214 distintos  <- unico
-- `numcad = 1` sao CINCO pessoas diferentes (uma por empresa). Por isso a
-- chave nunca pode ser so o cadastro.
--
-- O par (Empresa, Cadastro) deixa 62 colisoes, todas de tipcol = 2 (68
-- pessoas no total, contra 13.146 de tipcol = 1). A EMPREGADOS nao tem
-- coluna de tipo de colaborador, entao NAO da para separa-las aqui: o
-- script filtra tipcol = 1 e as 68 ficam de fora, de proposito, ate haver
-- decisao sobre criar a coluna.
--
-- NAO ha unique index em (Empresa, Cadastro) porque a tabela JA tem 347
-- pares repetidos de antes desta integracao. Por isso o casamento e feito
-- por SELECT ... LIMIT 1 (menor ID) em vez de ON CONFLICT.
--
-- O QUE ATUALIZA em quem ja existe: so o que muda com o tempo — situacao,
-- data de afastamento e salario. Nome, CPF, admissao e nascimento NAO sao
-- sobrescritos: a tela de Colaboradores permite edicao, e sobrescrever
-- apagaria correcao feita a mao a cada rodada do robo.
--
-- Idempotente: rodar duas vezes com o mesmo lote nao insere de novo nem
-- conta atualizacao (o UPDATE so acontece se algum valor mudou de fato).
--
-- ROLLBACK: DROP FUNCTION IF EXISTS public.rh_sync_senior_empregados(jsonb);
-- =========================================================================

CREATE OR REPLACE FUNCTION public.rh_sync_senior_empregados(_linhas jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ins int := 0;
  v_upd int := 0;
  v_ign int := 0;
  v_id  bigint;
  v_ex  bigint;
  r     record;
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

  RETURN jsonb_build_object('inseridos', v_ins, 'atualizados', v_upd, 'ignorados', v_ign);
END $$;

-- Só o robô sincroniza. Sem GRANT para authenticated/anon: e o unico
-- controle de acesso desta funcao, que e SECURITY DEFINER e escreve direto.
REVOKE ALL ON FUNCTION public.rh_sync_senior_empregados(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rh_sync_senior_empregados(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.rh_sync_senior_empregados(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rh_sync_senior_empregados(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
