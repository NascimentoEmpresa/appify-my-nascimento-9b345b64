-- =========================================================================
-- SIS-2026-0770 (reaberto pela Helena, 10/11/2026) — VÍNCULO COM O ENCARREGADO
--
-- "Só faltou o vínculo de quem cada encarregado é responsável. Mesmo que
-- tenha 2, 3 encarregados vinculados em um único contrato, precisamos saber a
-- quem esses colaboradores se reportam. Ex.: pesquisa de clima — se buscarmos
-- pelo colaborador, saberemos de qual liderança ele está reclamando."
--
-- O vínculo É o "reporta a" do organograma (ORGANOGRAMA_NO.parent_id): nada de
-- segunda tabela, para não existirem duas verdades. Contrato com UM encarregado
-- o sistema já liga sozinho (organograma_superior_por_posto); com dois ou mais
-- não chuta e a pessoa fica sem encarregado — a tela do contrato agora separa
-- a turma de cada encarregado e mostra quem falta, com vínculo em lote
-- (organograma_definir_superior_lote, que já existe e já registra no histórico).
--
-- O que muda AQUI no banco: quem troca de contrato não pode continuar
-- "reportando" ao encarregado do contrato antigo. Até hoje o superior definido
-- à mão ficava ("só muda quando mudarem") — certo para gerente/supervisor, que
-- atendem vários contratos, errado para encarregado, que é do posto. Agora, se
-- o superior é encarregado/líder do contrato ANTERIOR, a pessoa sai dele: o
-- sistema tenta deduzir o novo pelo posto e, sem certeza, ela fica sem superior
-- (Pendências / "Sem encarregado" no contrato novo). Fica no histórico dela.
--
-- Só redefine organograma_empregado_gatilho (o resto da mig 20261104009000
-- segue igual). Idempotente. ROLLBACK no fim.
-- =========================================================================

-- O nó é encarregado/líder de campo? A função escrita no organograma vale
-- sobre o cargo da Senior (mesma regra do front, lib/organograma/liderancaContrato.ts).
CREATE OR REPLACE FUNCTION public.organograma_eh_encarregado(_no uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT translate(upper(coalesce(nullif(btrim(o.funcao), ''), e."Título do Cargo"::text, '')), 'ÍÉÁÓÚÂÊÔÃÕÇ', 'IEAOUAEOAOC')
           ~ '(ENCARREGAD|\mLIDER\M|\mLIDERES\M|CHEFE DE (TURMA|EQUIPE|SETOR)|FEITOR|MESTRE DE OBRAS?)'
      FROM public."ORGANOGRAMA_NO" o
      LEFT JOIN public."EMPREGADOS" e ON e."ID" = o.empregado_id
     WHERE o.id = _no), false)
$$;
REVOKE ALL ON FUNCTION public.organograma_eh_encarregado(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.organograma_empregado_gatilho()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id bigint; v_antes boolean; v_agora boolean; v_no public."ORGANOGRAMA_NO"%ROWTYPE; v_sup uuid; v_pa text; v_pd text;
  v_chefe_emp bigint; v_chefe_fil bigint;
BEGIN
  -- O cadastro manda: organograma nenhum pode travar a carga da Senior.
  BEGIN
    IF TG_OP = 'DELETE' THEN
      PERFORM public.organograma_empregado_saiu(OLD."ID"::bigint, OLD."Nome"::text, OLD."CPF"::text, OLD.auth_user_id,
        OLD."Empresa"::bigint, OLD."Filial"::bigint, OLD."Título do Cargo"::text, NOT public.organograma_ativo(OLD."Situação"::text));
      RETURN NULL;
    END IF;

    v_id := NEW."ID"::bigint;
    v_agora := public.organograma_ativo(NEW."Situação"::text);
    v_antes := TG_OP = 'UPDATE' AND public.organograma_ativo(OLD."Situação"::text);

    IF v_agora AND NOT v_antes THEN
      PERFORM public.organograma_empregado_entrou(v_id, TG_OP = 'INSERT');
      RETURN NULL;
    END IF;
    IF TG_OP = 'INSERT' THEN RETURN NULL; END IF;
    IF v_antes AND NOT v_agora THEN
      PERFORM public.organograma_empregado_saiu(v_id, NEW."Nome"::text, NEW."CPF"::text, NEW.auth_user_id,
        NEW."Empresa"::bigint, NEW."Filial"::bigint, NEW."Título do Cargo"::text, false);
      RETURN NULL;
    END IF;
    IF NOT v_agora THEN RETURN NULL; END IF;

    IF NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id THEN
      PERFORM public.organograma_vincular_login(v_id, NEW.auth_user_id);
    END IF;

    IF upper(btrim(coalesce(NEW."Título do Cargo"::text, ''))) IS DISTINCT FROM upper(btrim(coalesce(OLD."Título do Cargo"::text, ''))) THEN
      PERFORM public.organograma_mov_inserir(v_id, NEW.auth_user_id, 'troca_cargo', 'neutra', 'Mudança de cargo', NULL,
        coalesce(nullif(btrim(OLD."Título do Cargo"::text), ''), '—'), coalesce(nullif(btrim(NEW."Título do Cargo"::text), ''), '—'));
    END IF;

    v_pa := nullif(btrim(coalesce(OLD."Posto"::text, '')), ''); v_pd := nullif(btrim(coalesce(NEW."Posto"::text, '')), '');
    IF v_pa IS DISTINCT FROM v_pd THEN
      PERFORM public.organograma_mov_inserir(v_id, NEW.auth_user_id, 'troca_posto', 'neutra', 'Mudança de posto', NULL,
        coalesce(v_pa, '—'), coalesce(v_pd, '—'));
    END IF;

    IF NEW."Filial" IS DISTINCT FROM OLD."Filial" OR NEW."Empresa" IS DISTINCT FROM OLD."Empresa" THEN
      PERFORM public.organograma_mov_inserir(v_id, NEW.auth_user_id, 'troca_contrato', 'neutra', 'Mudança de contrato', NULL,
        coalesce(public.organograma_contrato_nome(OLD."Empresa"::bigint, OLD."Filial"::bigint), '—'),
        coalesce(public.organograma_contrato_nome(NEW."Empresa"::bigint, NEW."Filial"::bigint), '—'));
    END IF;

    -- Superior DEDUZIDO acompanha o posto/contrato novo. O definido por alguém
    -- fica: "deve ser vinculado a primeira vez" — só muda quando mudarem.
    IF v_pa IS DISTINCT FROM v_pd OR NEW."Filial" IS DISTINCT FROM OLD."Filial" OR NEW."Empresa" IS DISTINCT FROM OLD."Empresa" THEN
      SELECT * INTO v_no FROM public."ORGANOGRAMA_NO" WHERE empregado_id = v_id;
      IF v_no.id IS NOT NULL AND (v_no.superior_pendente OR v_no.superior_origem IN ('posto', 'contrato')) THEN
        v_sup := public.organograma_superior_por_posto(v_id);
        IF v_sup IS DISTINCT FROM v_no.parent_id THEN
          PERFORM public.organograma_tentar_ligar(v_no.id, v_sup, 'posto');
        END IF;

      -- SIS-2026-0770: exceto o ENCARREGADO do contrato que a pessoa deixou.
      -- Ele não a acompanha; ela vai para o encarregado do contrato novo (se o
      -- posto disser qual) ou fica sem superior até alguém vincular.
      ELSIF v_no.id IS NOT NULL AND v_no.parent_id IS NOT NULL
            AND (NEW."Filial" IS DISTINCT FROM OLD."Filial" OR NEW."Empresa" IS DISTINCT FROM OLD."Empresa") THEN
        SELECT e."Empresa"::bigint, e."Filial"::bigint INTO v_chefe_emp, v_chefe_fil
          FROM public."ORGANOGRAMA_NO" c JOIN public."EMPREGADOS" e ON e."ID" = c.empregado_id
         WHERE c.id = v_no.parent_id;
        IF v_chefe_emp IS NOT DISTINCT FROM OLD."Empresa"::bigint AND v_chefe_fil IS NOT DISTINCT FROM OLD."Filial"::bigint
           AND (v_chefe_emp IS DISTINCT FROM NEW."Empresa"::bigint OR v_chefe_fil IS DISTINCT FROM NEW."Filial"::bigint)
           AND public.organograma_eh_encarregado(v_no.parent_id) THEN
          v_sup := public.organograma_superior_por_posto(v_id);
          PERFORM set_config('organograma.motivo',
            'Mudou de contrato: o encarregado ' || coalesce(public.organograma_nome_no(v_no.parent_id), '—') || ' ficou no contrato anterior', true);
          IF v_sup IS NOT NULL AND v_sup <> v_no.id AND NOT public.organograma_fecha_ciclo(v_no.id, v_sup) THEN
            PERFORM set_config('organograma.auto', '1', true);
            UPDATE public."ORGANOGRAMA_NO"
               SET parent_id = v_sup, superior_origem = 'posto', do_grupo = false,
                   ordem = (SELECT count(*) FROM public."ORGANOGRAMA_NO" i WHERE i.parent_id = v_sup)
             WHERE id = v_no.id;
            PERFORM set_config('organograma.auto', '', true);
          ELSE
            -- parent_id NULL sem "topo" = Pendências (organograma_no_normaliza).
            UPDATE public."ORGANOGRAMA_NO" SET parent_id = NULL, do_grupo = false, par_grupo = NULL WHERE id = v_no.id;
          END IF;
          PERFORM set_config('organograma.motivo', '', true);
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Organograma não acompanhou o cadastro %: %', coalesce(v_id, OLD."ID"::bigint), SQLERRM;
  END;
  RETURN NULL;
END $$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Reexecutar a seção "organograma_empregado_gatilho" da mig
-- 20261104009000_organograma_dinamico_empresa_toda.sql (o gatilho em si não
-- mudou, só a função) e:
-- DROP FUNCTION IF EXISTS public.organograma_eh_encarregado(uuid);
