-- =========================================================================
-- TREINAMENTOS — curso só PUBLICA com assinatura de TÉCNICO(A) EM SEGURANÇA
-- (06/10/2026)
--
-- PEDIDO (Pablo): "nos 3 pontinhos do curso tem que ter um botão pra
-- adicionar a assinatura, e o curso não pode ser publicado sem ter uma
-- assinatura de uma Técnica em Segurança, e o cargo tem que aparecer na
-- assinatura também — Cargo e Registro."
--
-- MODELO (em cima da mig 20261005000003)
--   · "TRN_ASSINATURA".registro: o registro profissional (ex. nº do MTE).
--     Sai no certificado embaixo do cargo. Até aqui o cargo e o registro
--     iam juntos num texto só ("Téc em segurança - 0031036") — separados
--     abaixo para a única assinatura que existia.
--   · trn_assinatura_eh_tst(cargo, registro): a assinatura vale para
--     publicar quando o cargo é de Técnico(a) em Segurança (aceita
--     abreviação "Téc em segurança") E o registro está preenchido.
--   · Gatilho no "TRN_CURSO": publicar (ou trocar a assinatura de curso já
--     publicado) exige assinatura ATIVA e válida. Cursos que já estavam
--     publicados sem assinatura NÃO são despublicados — a trava pega na
--     próxima vez que alguém publicar/trocar.
--   · Gatilho no "TRN_ASSINATURA": não deixa desativar, excluir ou tirar o
--     cargo/registro de uma assinatura que segura curso publicado.
--
-- Idempotente. Aplicar no banco do app (SQL Editor) — não se auto-aplica.
-- =========================================================================

-- ── 1) Registro ──────────────────────────────────────────────────────────
ALTER TABLE public."TRN_ASSINATURA" ADD COLUMN IF NOT EXISTS registro text;

-- A assinatura que existia guardava "cargo - registro" num campo só.
UPDATE public."TRN_ASSINATURA"
   SET cargo = 'Técnica em Segurança do Trabalho', registro = '0031036'
 WHERE id = '489a3809-97a0-4a2b-9b0a-8a9eb4fd4369'
   AND registro IS NULL AND cargo = 'Téc em segurança - 0031036';

-- ── 2) O que conta como Técnico(a) em Segurança ──────────────────────────
-- Mesma regra em src/pages/treinamentos/plataforma/assinaturaFolha.tsx
-- (assinaturaValeParaPublicar) — mudar nos dois lugares.
CREATE OR REPLACE FUNCTION public.trn_assinatura_eh_tst(p_cargo text, p_registro text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT lower(translate(coalesce(p_cargo, ''), 'ÉéÊêÇç', 'EeEeCc')) ~ 'tec.*seguranc'
     AND length(btrim(coalesce(p_registro, ''))) >= 2
$$;

-- ── 3) Curso: publicar exige a assinatura ────────────────────────────────
CREATE OR REPLACE FUNCTION public.trn_curso_publicar_exige_assinatura()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.publicado
     AND (TG_OP = 'INSERT' OR NOT OLD.publicado OR NEW.assinatura_id IS DISTINCT FROM OLD.assinatura_id) THEN
    IF NEW.assinatura_id IS NULL THEN
      RAISE EXCEPTION 'O curso só pode ser publicado com a assinatura de um(a) Técnico(a) em Segurança — adicione nos três pontinhos do curso (Assinatura do curso).';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public."TRN_ASSINATURA" a
                    WHERE a.id = NEW.assinatura_id AND a.ativo
                      AND public.trn_assinatura_eh_tst(a.cargo, a.registro)) THEN
      RAISE EXCEPTION 'A assinatura do curso precisa ser de um(a) Técnico(a) em Segurança, com cargo e registro preenchidos.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_trn_curso_publicar_exige_assinatura ON public."TRN_CURSO";
CREATE TRIGGER trg_trn_curso_publicar_exige_assinatura BEFORE INSERT OR UPDATE OF publicado, assinatura_id ON public."TRN_CURSO"
  FOR EACH ROW EXECUTE FUNCTION public.trn_curso_publicar_exige_assinatura();

-- ── 4) Assinatura em uso por curso publicado não perde a validade ────────
CREATE OR REPLACE FUNCTION public.trn_assinatura_protege_publicado()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_curso text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.ativo AND public.trn_assinatura_eh_tst(NEW.cargo, NEW.registro) THEN
    RETURN NEW;
  END IF;
  SELECT c.nome INTO v_curso FROM public."TRN_CURSO" c WHERE c.assinatura_id = OLD.id AND c.publicado LIMIT 1;
  IF v_curso IS NOT NULL THEN
    RAISE EXCEPTION 'Esta assinatura é a do curso publicado "%" — troque a assinatura do curso (ou despublique) antes.', v_curso;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS trg_trn_assinatura_protege_publicado ON public."TRN_ASSINATURA";
CREATE TRIGGER trg_trn_assinatura_protege_publicado BEFORE UPDATE OR DELETE ON public."TRN_ASSINATURA"
  FOR EACH ROW EXECUTE FUNCTION public.trn_assinatura_protege_publicado();

-- ── 5) Portal do Colaborador: o certificado devolve o registro ───────────
-- Mesmo corpo de col_certificado (mig 20261005000003) + 'registro'.
CREATE OR REPLACE FUNCTION public.col_certificado(p_emp bigint, p_curso uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_aluno uuid; ce record; a record; c record; m record; v_mod jsonb; v_ass jsonb;
BEGIN
  SELECT id INTO v_aluno FROM public."TRN_ALUNO" WHERE empregado_id = p_emp ORDER BY created_at LIMIT 1;
  IF v_aluno IS NULL THEN RAISE EXCEPTION 'Você ainda não tem cadastro nos treinamentos.'; END IF;
  SELECT * INTO ce FROM public."TRN_CERTIFICADO" WHERE aluno_id = v_aluno AND curso_id = p_curso;
  IF NOT FOUND THEN RAISE EXCEPTION 'Certificado ainda não emitido para este curso.'; END IF;
  SELECT * INTO a FROM public."TRN_ALUNO" WHERE id = v_aluno;
  SELECT * INTO c FROM public."TRN_CURSO" WHERE id = p_curso;
  SELECT * INTO m FROM public."TRN_CERTIFICADO_MODELO" WHERE id = ce.modelo_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('nome', mo.nome,
           'aulas', (SELECT coalesce(jsonb_agg(au.nome ORDER BY au.posicao), '[]'::jsonb) FROM public."TRN_AULA" au WHERE au.modulo_id = mo.id AND au.publicada))
           ORDER BY mo.posicao), '[]'::jsonb)
    INTO v_mod FROM public."TRN_MODULO" mo WHERE mo.curso_id = p_curso;
  SELECT jsonb_build_object('nome_completo', s.nome_completo, 'cargo', s.cargo, 'registro', s.registro, 'tipo', s.tipo,
                            'imagem', s.imagem, 'texto', s.texto, 'fonte', s.fonte)
    INTO v_ass FROM public."TRN_ASSINATURA" s WHERE s.id = ce.assinatura_id;
  RETURN jsonb_build_object(
    'codigo', ce.codigo_validacao, 'emitido_em', ce.emitido_em, 'carga_horaria_min', ce.carga_horaria_min,
    'aluno', a.nome, 'documento', a.documento, 'curso', c.nome,
    'modelo', CASE WHEN m.id IS NULL THEN NULL ELSE to_jsonb(m) END,
    'modulos', v_mod,
    'assinatura', v_ass);
END $function$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Reaplicar col_certificado da mig 20261005000003 (sem 'registro').
-- DROP TRIGGER IF EXISTS trg_trn_assinatura_protege_publicado ON public."TRN_ASSINATURA";
-- DROP FUNCTION IF EXISTS public.trn_assinatura_protege_publicado();
-- DROP TRIGGER IF EXISTS trg_trn_curso_publicar_exige_assinatura ON public."TRN_CURSO";
-- DROP FUNCTION IF EXISTS public.trn_curso_publicar_exige_assinatura();
-- DROP FUNCTION IF EXISTS public.trn_assinatura_eh_tst(text, text);
-- UPDATE public."TRN_ASSINATURA" SET cargo = 'Téc em segurança - 0031036' WHERE id = '489a3809-97a0-4a2b-9b0a-8a9eb4fd4369';
-- ALTER TABLE public."TRN_ASSINATURA" DROP COLUMN IF EXISTS registro;
