-- =========================================================================
-- EMPREGADOS igual à Senior (BiEmpregados): o sync passa a corrigir o que
-- está errado — e corrige agora as 32 linhas divergentes
--
-- SINTOMA (30/09/2026, Pablo): EMPREGADOS ID 13597 = "LUIZA VITORIA VEIGA
-- BARRETO", Empresa 1 / Cadastro 10542, filial 1099, admissão 04/09/2026.
-- Na Senior o 1/10542 é DAIANE CAROLINE ANTUNES DA CRUZ, filial 1050,
-- admissão 10/09/2026, outro CPF. "As informações do EMPREGADOS têm que estar
-- idênticas ao BiEmpregados ... só ajusta o que tá errado."
--
-- CAUSA (rh_sync_senior_empregados, chamada pelo integracao-senior):
--   1. Chave (Empresa, Cadastro) — e a Senior REAPROVEITA o numcad.
--   2. Achada a linha, o sync só mexia em Situação / Cod Situacao / Data
--      Afastamento / Valor Salário. Nome, CPF, Admissão, Filial, Nascimento,
--      Sexo e PIS só entravam no INSERT — nunca mais corrigidos, embora a
--      integração mande todos a cada passada.
--
-- MEDIDO em 30/09 (13.332 linhas não-MEI pareadas com a Senior, tipcol = 1):
--   32 divergem — nome 14, filial 14, admissão 13, PIS 10, nascimento 7,
--   CPF 5, sexo 4, situação 0. Das 14 de nome, 6 são OUTRA PESSOA (cadastro
--   reaproveitado: LUIZA→DAIANE 1/10542, SABRINA PINHEIRO→MAICOL 1/10628,
--   DAIANE SILVA→ANTONIO ROSA 1/9901, ISMAEL→EMERSON 1/10513, BIATRIZ→PETRICK
--   2/2453, CLEITON→MARIA BEATRIZ 1/2078) e 8 são o mesmo nome corrigido na
--   Senior. Nenhuma das 32 tinha login do ERP vinculado.
--
-- CORREÇÃO
--   a) O sync compara e REESCREVE cada campo que vem da Senior quando ele
--      difere de verdade (data como data; CPF/PIS sem zero à esquerda; nome
--      sem diferença de espaço/caixa). Igual → não toca (o formato gravado
--      não muda à toa).
--   b) Pessoa trocada = CPF diferente (os dois preenchidos): o que era da
--      pessoa ANTIGA sai junto — login, e-mail, senha, perfil/setor/líder do
--      ERP, permissões, telefone, pix e a ficha (cargo, escala, local, posto,
--      Nome Filial), que é remontada pelo espelho (tipcol = 1).
--   c) Filial mudou → "Nome Filial" recalculado pela filial nova.
--   d) Tudo que muda fica em EMPREGADOS_SYNC_SENIOR_LOG (antes/depois) —
--      RLS ligada, sem policy (guarda CPF/PIS).
--   e) Cadastro repetido na EMPREGADOS (3 casos): casa com o mesmo nome, o
--      mesmo CPF, Trabalhando, ID maior — nessa ordem.
--   f) Roda uma vez AGORA pelo espelho (espelho."BiEmpregados", tipcol = 1),
--      no mesmo formato da integração.
--
-- FORA (sem decisão): terceiros (tipcol = 2) e as 22 linhas não-MEI que não
-- existem na Senior. Nada é apagado aqui.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

-- ── Histórico do que o sync altera ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."EMPREGADOS_SYNC_SENIOR_LOG" (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empregado_id   bigint NOT NULL,
  empresa        bigint,
  cadastro       bigint,
  pessoa_trocada boolean NOT NULL DEFAULT false,
  antes          jsonb NOT NULL,
  depois         jsonb NOT NULL,
  criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_empregados_sync_log_emp ON public."EMPREGADOS_SYNC_SENIOR_LOG"(empregado_id, criado_em DESC);
ALTER TABLE public."EMPREGADOS_SYNC_SENIOR_LOG" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."EMPREGADOS_SYNC_SENIOR_LOG" FROM PUBLIC, anon, authenticated;

-- Normalizadores (só para COMPARAR; o valor gravado mantém o formato).
CREATE OR REPLACE FUNCTION public.rh_norm_nome(_t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT nullif(regexp_replace(upper(btrim(coalesce(_t, ''))), '\s+', ' ', 'g'), '');
$$;
CREATE OR REPLACE FUNCTION public.rh_norm_doc(_t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT nullif(ltrim(regexp_replace(coalesce(_t, ''), '\D', '', 'g'), '0'), '');
$$;

-- ── O sync ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rh_sync_senior_empregados(_linhas jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_ins int := 0;
  v_upd int := 0;
  v_troca int := 0;
  v_ign int := 0;
  v_id  bigint;
  r     record;
  e     public."EMPREGADOS"%ROWTYPE;
  v_outra boolean;
  v_filial_mudou boolean;
  v_antes jsonb;
  v_depois jsonb;
  v_enriquecer jsonb;
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

    SELECT * INTO e
      FROM public."EMPREGADOS" x
     WHERE x."Empresa" = r.empresa AND x."Cadastro" = r.cadastro
     ORDER BY (public.rh_norm_nome(x."Nome") = public.rh_norm_nome(r.nome)) DESC NULLS LAST,
              (public.rh_norm_doc(x."CPF") = public.rh_norm_doc(r.cpf)) DESC NULLS LAST,
              (x."Situação" = 'Trabalhando') DESC NULLS LAST,
              x."ID" DESC
     LIMIT 1;

    IF NOT FOUND THEN
      v_id := v_id + 1;
      INSERT INTO public."EMPREGADOS"
        ("ID", "Empresa", "Cadastro", "Nome", "Admissão", "Situação", "Cod Situacao",
         "Data Afastamento", "Filial", "Sexo", "Nascimento", "CPF", "PIS", "Valor Salário")
      VALUES
        (v_id, r.empresa, r.cadastro, btrim(r.nome), r.admissao, r.situacao, r.cod_situacao,
         r.data_afastamento, r.filial, r.sexo, r.nascimento, r.cpf, r.pis, r.salario);
      v_ins := v_ins + 1;
      CONTINUE;
    END IF;

    -- Outra pessoa: CPF diferente; sem CPF dos dois lados para comparar, o
    -- primeiro nome diferente (nome corrigido na Senior mantém o primeiro nome).
    v_outra := CASE
      WHEN public.rh_norm_doc(e."CPF") IS NOT NULL AND public.rh_norm_doc(r.cpf) IS NOT NULL
        THEN public.rh_norm_doc(e."CPF") <> public.rh_norm_doc(r.cpf)
      ELSE split_part(public.rh_norm_nome(e."Nome"), ' ', 1) IS DISTINCT FROM split_part(public.rh_norm_nome(r.nome), ' ', 1)
    END;
    v_filial_mudou := r.filial IS NOT NULL AND e."Filial" IS DISTINCT FROM r.filial;

    IF NOT v_outra AND NOT v_filial_mudou
       AND public.rh_norm_nome(e."Nome") IS NOT DISTINCT FROM public.rh_norm_nome(r.nome)
       AND (r.cpf IS NULL OR public.rh_norm_doc(e."CPF") IS NOT DISTINCT FROM public.rh_norm_doc(r.cpf))
       AND (r.pis IS NULL OR public.rh_norm_doc(e."PIS") IS NOT DISTINCT FROM public.rh_norm_doc(r.pis))
       AND (r.admissao IS NULL OR public.rh_data_br_para_date(e."Admissão") IS NOT DISTINCT FROM public.rh_data_br_para_date(r.admissao))
       AND (r.nascimento IS NULL OR public.rh_data_br_para_date(e."Nascimento") IS NOT DISTINCT FROM public.rh_data_br_para_date(r.nascimento))
       AND public.rh_data_br_para_date(e."Data Afastamento") IS NOT DISTINCT FROM public.rh_data_br_para_date(r.data_afastamento)
       AND (r.sexo IS NULL OR e."Sexo" IS NOT DISTINCT FROM r.sexo)
       AND (r.situacao IS NULL OR e."Situação" IS NOT DISTINCT FROM r.situacao)
       AND (r.cod_situacao IS NULL OR e."Cod Situacao" IS NOT DISTINCT FROM r.cod_situacao)
       AND (r.salario IS NULL OR e."Valor Salário" IS NOT DISTINCT FROM r.salario) THEN
      CONTINUE;
    END IF;

    v_antes := to_jsonb(e);

    UPDATE public."EMPREGADOS" x
       SET "Nome"             = CASE WHEN public.rh_norm_nome(x."Nome") IS NOT DISTINCT FROM public.rh_norm_nome(r.nome) THEN x."Nome" ELSE btrim(r.nome) END,
           "CPF"              = CASE WHEN r.cpf IS NULL OR public.rh_norm_doc(x."CPF") IS NOT DISTINCT FROM public.rh_norm_doc(r.cpf) THEN x."CPF" ELSE r.cpf END,
           "PIS"              = CASE WHEN r.pis IS NULL OR public.rh_norm_doc(x."PIS") IS NOT DISTINCT FROM public.rh_norm_doc(r.pis) THEN x."PIS" ELSE r.pis END,
           "Admissão"         = CASE WHEN r.admissao IS NULL
                                       OR public.rh_data_br_para_date(x."Admissão") IS NOT DISTINCT FROM public.rh_data_br_para_date(r.admissao)
                                     THEN x."Admissão" ELSE r.admissao END,
           "Nascimento"       = CASE WHEN r.nascimento IS NULL
                                       OR public.rh_data_br_para_date(x."Nascimento") IS NOT DISTINCT FROM public.rh_data_br_para_date(r.nascimento)
                                     THEN x."Nascimento" ELSE r.nascimento END,
           "Data Afastamento" = CASE WHEN public.rh_data_br_para_date(x."Data Afastamento") IS NOT DISTINCT FROM public.rh_data_br_para_date(r.data_afastamento)
                                     THEN x."Data Afastamento" ELSE r.data_afastamento END,
           "Filial"           = coalesce(r.filial, x."Filial"),
           "Sexo"             = coalesce(r.sexo, x."Sexo"),
           "Situação"         = coalesce(r.situacao, x."Situação"),
           "Cod Situacao"     = coalesce(r.cod_situacao, x."Cod Situacao"),
           "Valor Salário"    = coalesce(r.salario, x."Valor Salário"),
           "Nome Filial"      = CASE WHEN v_filial_mudou OR v_outra THEN NULL ELSE x."Nome Filial" END,
           auth_user_id       = CASE WHEN v_outra THEN NULL ELSE x.auth_user_id END,
           email              = CASE WHEN v_outra THEN NULL ELSE x.email END,
           "Senha"            = CASE WHEN v_outra THEN NULL ELSE x."Senha" END,
           chave_secreta      = CASE WHEN v_outra THEN NULL ELSE x.chave_secreta END,
           "Perfil_ERP"       = CASE WHEN v_outra THEN NULL ELSE x."Perfil_ERP" END,
           "Setor_ERP"        = CASE WHEN v_outra THEN NULL ELSE x."Setor_ERP" END,
           "Ativo_ERP"        = CASE WHEN v_outra THEN NULL ELSE x."Ativo_ERP" END,
           "LIDER"            = CASE WHEN v_outra THEN NULL ELSE x."LIDER" END,
           tipo_acesso        = CASE WHEN v_outra THEN NULL ELSE x.tipo_acesso END,
           telefone           = CASE WHEN v_outra THEN NULL ELSE x.telefone END,
           contrato_responsavel_id = CASE WHEN v_outra THEN NULL ELSE x.contrato_responsavel_id END,
           contrato_responsavel    = CASE WHEN v_outra THEN NULL ELSE x.contrato_responsavel END,
           permissoes_compras      = CASE WHEN v_outra THEN NULL ELSE x.permissoes_compras END,
           permissoes_malote       = CASE WHEN v_outra THEN NULL ELSE x.permissoes_malote END,
           classificacoes_responsavel = CASE WHEN v_outra THEN NULL ELSE x.classificacoes_responsavel END,
           aprovar_cotacao_classif = CASE WHEN v_outra THEN NULL ELSE x.aprovar_cotacao_classif END,
           "Chave Pix"        = CASE WHEN v_outra THEN NULL ELSE x."Chave Pix" END,
           "Cargo"            = CASE WHEN v_outra THEN NULL ELSE x."Cargo" END,
           "Título do Cargo"  = CASE WHEN v_outra THEN NULL ELSE x."Título do Cargo" END,
           "Nome do Cargo"    = CASE WHEN v_outra THEN NULL ELSE x."Nome do Cargo" END,
           "Escala_1"         = CASE WHEN v_outra THEN NULL ELSE x."Escala_1" END,
           "Escala"           = CASE WHEN v_outra THEN NULL ELSE x."Escala" END,
           "Descrição do Local" = CASE WHEN v_outra THEN NULL ELSE x."Descrição do Local" END,
           "Posto"            = CASE WHEN v_outra THEN NULL ELSE x."Posto" END,
           "Nome do Posto"    = CASE WHEN v_outra THEN NULL ELSE x."Nome do Posto" END
     WHERE x."ID" = e."ID";

    SELECT to_jsonb(x) INTO v_depois FROM public."EMPREGADOS" x WHERE x."ID" = e."ID";
    INSERT INTO public."EMPREGADOS_SYNC_SENIOR_LOG"(empregado_id, empresa, cadastro, pessoa_trocada, antes, depois)
    VALUES (e."ID", r.empresa, r.cadastro, v_outra, v_antes, v_depois);

    v_upd := v_upd + 1;
    IF v_outra THEN v_troca := v_troca + 1; END IF;
  END LOOP;

  -- Remonta o que ficou vazio (ficha da pessoa nova, Nome Filial de quem
  -- mudou de filial) pelo espelho, com o join certo (tipcol = 1).
  BEGIN
    v_enriquecer := public.rh_enriquecer_empregados_do_espelho(false);
  EXCEPTION WHEN OTHERS THEN
    v_enriquecer := jsonb_build_object('erro', SQLERRM);
  END;

  BEGIN
    v_contratos := public.contratos_sincronizar_filiais();
  EXCEPTION WHEN OTHERS THEN
    v_contratos := jsonb_build_object('erro', SQLERRM);
  END;

  BEGIN
    v_fichas := public.rh_completar_ficha_do_senior();
  EXCEPTION WHEN OTHERS THEN
    v_fichas := jsonb_build_object('erro', SQLERRM);
  END;

  RETURN jsonb_build_object('inseridos', v_ins, 'atualizados', v_upd, 'pessoas_trocadas', v_troca, 'ignorados', v_ign,
                            'enriquecer', v_enriquecer, 'contratos', v_contratos, 'fichas', v_fichas);
END $function$;
REVOKE ALL ON FUNCTION public.rh_sync_senior_empregados(jsonb) FROM PUBLIC, anon;

-- ── Uma passada agora, pelo espelho (mesmo formato da integração) ────────
SELECT public.rh_sync_senior_empregados(coalesce((
  SELECT jsonb_agg(jsonb_build_object(
           'empresa', b.numemp, 'cadastro', b.numcad, 'nome', btrim(b.nomfun),
           'admissao',   CASE WHEN b.datadm IS NULL OR extract(year FROM b.datadm) <= 1901 THEN NULL ELSE to_char(b.datadm, 'DD/MM/YYYY') END,
           'data_afastamento', CASE WHEN b.datafa IS NULL OR extract(year FROM b.datafa) <= 1901 THEN NULL ELSE to_char(b.datafa, 'DD/MM/YYYY') END,
           'nascimento', CASE WHEN b.datnas IS NULL OR extract(year FROM b.datnas) <= 1901 THEN NULL ELSE to_char(b.datnas, 'DD/MM/YYYY') END,
           'situacao', nullif(btrim(coalesce(s.descricao, '')), ''),
           'cod_situacao', b.sitafa,
           'filial', b.codfil,
           'sexo', nullif(btrim(coalesce(b.tipsex, '')), ''),
           'cpf', nullif(b.numcpf::text, ''),
           'pis', nullif(b.numpis::text, ''),
           'salario', CASE WHEN b.valsal IS NULL THEN NULL
                           ELSE replace(replace(replace(to_char(b.valsal, 'FM999,999,990.00'), ',', '#'), '.', ','), '#', '.') END))
    FROM espelho."BiEmpregados" b
    LEFT JOIN espelho."BiSituacoes" s
           ON nullif(regexp_replace(s.situacao::text, '\D', '', 'g'), '')::int = b.sitafa
   WHERE b.tipcol = 1), '[]'::jsonb));

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Cada linha alterada tem a versão anterior INTEIRA em
-- "EMPREGADOS_SYNC_SENIOR_LOG".antes (to_jsonb da linha). Para voltar uma:
--   UPDATE public."EMPREGADOS" x SET "Nome" = l.antes->>'Nome', "CPF" = l.antes->>'CPF', ...
--     FROM public."EMPREGADOS_SYNC_SENIOR_LOG" l WHERE l.id = <id do log> AND x."ID" = l.empregado_id;
-- A função anterior está em 20260906000011_rh_sync_empregados_com_cod_situacao.sql (+ mig 188).
