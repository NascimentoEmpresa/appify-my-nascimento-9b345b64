-- =========================================================================
-- Data de nascimento corrigida no ERP não volta mais para a da Senior
--
-- PEDIDO (16/11/2026, Pablo): o aniversário da MILENA DA CUNHA CASTRO é
-- 11/06, não 21/11; e o modal de RH › Colaboradores tem que deixar editar a
-- data de nascimento.
--
-- PROBLEMA: desde a mig 20260930000275 o sync (rh_sync_senior_empregados,
-- chamado pelo pg_cron rh-sync-senior-espelho de 15 em 15 min) REESCREVE
-- "Nascimento" sempre que a data da Senior é outra. Corrigir só no ERP
-- duraria até a próxima rodada.
--
-- CORREÇÃO
--   a) EMPREGADOS.nascimento_ajustado_em: preenchida = a data foi corrigida
--      no ERP (o modal grava junto com a data). NULL = segue a Senior.
--   b) O sync não mexe no "Nascimento" de quem tem a marca. Se o cadastro
--      for reaproveitado por OUTRA pessoa (CPF diferente), a marca cai e a
--      data volta a ser a da Senior.
--   c) A data da Milena vai para 11/06 mantendo o ano gravado, em ISO (o
--      formato que domina na coluna), já com a marca.
--   O certo continua sendo corrigir também na Senior; a marca só impede que
--   o ERP desfaça a correção enquanto isso.
--
-- A função abaixo é a da mig 20260930000275 (última versão, nenhuma branch
-- redefine) com só os dois trechos marcados "mig 20261116120000".
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

ALTER TABLE public."EMPREGADOS" ADD COLUMN IF NOT EXISTS nascimento_ajustado_em timestamptz;
COMMENT ON COLUMN public."EMPREGADOS".nascimento_ajustado_em IS
  'Quando o "Nascimento" foi corrigido no ERP. Preenchida = o sync da Senior não reescreve a data (mig 20261116120000). NULL = segue a Senior.';

-- ── O sync, respeitando a correção do ERP ────────────────────────────────
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

    -- (mig 20261116120000) Nascimento corrigido no ERP vale mais que o da
    -- Senior: nascimento NULL aqui = "não mexer", como já é para o resto.
    -- Pessoa trocada (cadastro reaproveitado) não herda a correção da antiga.
    IF e.nascimento_ajustado_em IS NOT NULL AND NOT v_outra THEN
      r.nascimento := NULL;
    END IF;

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
           nascimento_ajustado_em = CASE WHEN v_outra THEN NULL ELSE x.nascimento_ajustado_em END,
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

-- ── Correção pedida: MILENA DA CUNHA CASTRO → 11/06 (ano mantido) ────────
-- Achada pelo CPF + nome (os dois, para não pegar outra pessoa). Todos os
-- cadastros dela (contrato anterior também) recebem a data. Sem data
-- legível gravada não há ano para manter: não mexe e avisa.
DO $$
DECLARE
  v_qtd int;
  v_sem_ano int;
BEGIN
  SELECT count(*) FILTER (WHERE public.rh_data_br_para_date(e."Nascimento") IS NULL)
    INTO v_sem_ano
    FROM public."EMPREGADOS" e
   WHERE public.rh_norm_doc(e."CPF") = public.rh_norm_doc('03371899004')
     AND public.rh_norm_nome(e."Nome") = 'MILENA DA CUNHA CASTRO';

  UPDATE public."EMPREGADOS" e
     SET "Nascimento" = to_char(make_date(extract(year FROM public.rh_data_br_para_date(e."Nascimento"))::int, 6, 11), 'YYYY-MM-DD'),
         nascimento_ajustado_em = coalesce(e.nascimento_ajustado_em, now())
   WHERE public.rh_norm_doc(e."CPF") = public.rh_norm_doc('03371899004')
     AND public.rh_norm_nome(e."Nome") = 'MILENA DA CUNHA CASTRO'
     AND public.rh_data_br_para_date(e."Nascimento") IS NOT NULL
     AND (to_char(public.rh_data_br_para_date(e."Nascimento"), 'MM-DD') <> '06-11'
          OR e."Nascimento" !~ '^\d{4}-\d{2}-\d{2}$'
          OR e.nascimento_ajustado_em IS NULL);
  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  RAISE NOTICE 'Nascimento da Milena: % cadastro(s) corrigido(s); % sem data para manter o ano', v_qtd, v_sem_ano;
END $$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Função: recriar a de 20260930000275_empregados_igual_a_senior.sql (linhas
-- 75-231), que não conhece a coluna. Depois:
--   ALTER TABLE public."EMPREGADOS" DROP COLUMN IF EXISTS nascimento_ajustado_em;
-- Data da Milena: o próximo sync devolve a da Senior assim que a marca sumir
-- (ou a versão anterior está no EMPREGADOS_SYNC_SENIOR_LOG, se o sync a
-- tinha gravado).
