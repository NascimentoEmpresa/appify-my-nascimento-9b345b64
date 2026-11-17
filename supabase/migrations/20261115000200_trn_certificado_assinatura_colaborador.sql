-- =====================================================================
-- TREINAMENTOS — o colaborador ASSINA o próprio certificado, e o modelo
-- padrão passa a ser o da empresa (Nascimento / SN). 13/11/2026.
--
-- Chamado: "os certificados estão sendo gerados apenas com a assinatura da
-- Técnica responsável. Precisamos que, ao término do treinamento em vídeo,
-- o colaborador também realize sua assinatura ... HAGG tem um modelo
-- próprio e SN tem outro." Pablo: "quando o colaborador clicar pra emitir
-- o certificado, primeiro ele deve assinar ... por nome ou desenho".
--
-- O QUE MUDA
--   1) TRN_CERTIFICADO ganha:
--        assinatura_aluno   jsonb   — CÓPIA da assinatura (como a da técnica
--                                     é gravada na emissão, mig 20261005000003):
--                                     {tipo, imagem | texto+fonte+tamanho}
--        assinado_aluno_em  timestamptz
--        empresa            text    — sigla da empresa do colaborador NA
--                                     EMISSÃO (rh_empresa: HAGG, SN, NH, CANAÃ),
--                                     gravada pelo gatilho; escolhe a arte.
--   2) col_certificado (portal): sem assinatura do colaborador NÃO devolve a
--      folha — só { pendente_assinatura, aluno, curso, ultima_assinatura }.
--      Assinado, devolve também assinatura_aluno e empresa.
--   3) col_assinar_certificado (portal, ação nova "assinar_certificado" da
--      Edge colaborador-portal — vai com o redeploy do merge): grava a
--      assinatura UMA vez; assinar de novo não troca (o documento já saiu).
--   4) Modelos com o fundo padrão (NULL ou o arco "preset:nascimento") viram
--      "preset:empresa": a arte dos pptx que o Pablo mandou como padrão.
--
-- JÁ ASSINOU ANTES? A última assinatura vem em `ultima_assinatura` e a tela
-- abre com ela preenchida; ainda assim o clique de assinar é POR
-- certificado (é consentimento daquele documento). Regra espelhada em
-- src/lib/treinamentos/certificadoColaborador.ts — mudar nos dois lugares.
--
-- Acesso: nada de menu novo. As RPCs col_* só rodam pela Edge (service_role),
-- que já amarra o colaborador ao próprio p_emp; a gestão lê as colunas novas
-- pela RLS de TRN_CERTIFICADO que já existe.
-- =====================================================================

-- ── 1) Colunas ─────────────────────────────────────────────────────────
ALTER TABLE public."TRN_CERTIFICADO"
  ADD COLUMN IF NOT EXISTS assinatura_aluno  jsonb,
  ADD COLUMN IF NOT EXISTS assinado_aluno_em timestamptz,
  ADD COLUMN IF NOT EXISTS empresa           text;

-- Mesmos limites do CHECK da TRN_ASSINATURA (desenho PNG ≤ 400 kB; texto ≥ 2
-- letras com fonte; tamanho 0,6–1,4 da mig 20261006000002).
CREATE OR REPLACE FUNCTION public.trn_assinatura_aluno_valida(a jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
  SELECT a IS NULL OR (
    jsonb_typeof(a) = 'object' AND (
      (a->>'tipo' = 'desenho' AND coalesce(a->>'imagem', '') LIKE 'data:image/png;base64,%' AND length(a->>'imagem') <= 400000)
      OR (a->>'tipo' = 'texto'
          AND length(btrim(coalesce(a->>'texto', ''))) BETWEEN 2 AND 80
          AND length(btrim(coalesce(a->>'fonte', ''))) BETWEEN 1 AND 60
          AND coalesce(nullif(a->>'tamanho', '')::numeric, 1) BETWEEN 0.6 AND 1.4)
    )
  );
$$;

ALTER TABLE public."TRN_CERTIFICADO" DROP CONSTRAINT IF EXISTS trn_certificado_assinatura_aluno_chk;
ALTER TABLE public."TRN_CERTIFICADO" ADD CONSTRAINT trn_certificado_assinatura_aluno_chk
  CHECK (public.trn_assinatura_aluno_valida(assinatura_aluno));

-- ── 2) Empresa gravada na emissão ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trn_certificado_empresa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.empresa IS NULL THEN
    SELECT public.rh_empresa(e."Empresa"::text, e."Nome da Empresa") INTO NEW.empresa
      FROM public."TRN_ALUNO" a
      JOIN public."EMPREGADOS" e ON e."ID" = a.empregado_id
     WHERE a.id = NEW.aluno_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_trn_certificado_empresa ON public."TRN_CERTIFICADO";
CREATE TRIGGER trg_trn_certificado_empresa BEFORE INSERT ON public."TRN_CERTIFICADO"
  FOR EACH ROW EXECUTE FUNCTION public.trn_certificado_empresa();

-- Certificados já emitidos: empresa de hoje (é o melhor que se tem).
UPDATE public."TRN_CERTIFICADO" ce
   SET empresa = public.rh_empresa(e."Empresa"::text, e."Nome da Empresa")
  FROM public."TRN_ALUNO" a
  JOIN public."EMPREGADOS" e ON e."ID" = a.empregado_id
 WHERE a.id = ce.aluno_id AND ce.empresa IS NULL;

-- ── 3) Modelo padrão = modelo da empresa ──────────────────────────────
UPDATE public."TRN_CERTIFICADO_MODELO"
   SET fundo_path = 'preset:empresa', updated_at = now()
 WHERE fundo_path IS NULL OR fundo_path = 'preset:nascimento';

-- ── 4) Portal: o certificado (exige a assinatura do colaborador) ───────
-- Mesmo corpo da mig 20261006000002 + a trava e os campos novos.
CREATE OR REPLACE FUNCTION public.col_certificado(p_emp bigint, p_curso uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_aluno uuid; ce record; a record; c record; m record; v_mod jsonb; v_ass jsonb; v_ultima jsonb;
BEGIN
  SELECT id INTO v_aluno FROM public."TRN_ALUNO" WHERE empregado_id = p_emp ORDER BY created_at LIMIT 1;
  IF v_aluno IS NULL THEN RAISE EXCEPTION 'Você ainda não tem cadastro nos treinamentos.'; END IF;
  SELECT * INTO ce FROM public."TRN_CERTIFICADO" WHERE aluno_id = v_aluno AND curso_id = p_curso;
  IF NOT FOUND THEN RAISE EXCEPTION 'Certificado ainda não emitido para este curso.'; END IF;
  SELECT * INTO a FROM public."TRN_ALUNO" WHERE id = v_aluno;
  SELECT * INTO c FROM public."TRN_CURSO" WHERE id = p_curso;

  -- Sem a assinatura do colaborador, a folha não sai: a tela pede antes.
  IF ce.assinatura_aluno IS NULL THEN
    SELECT x.assinatura_aluno INTO v_ultima
      FROM public."TRN_CERTIFICADO" x
     WHERE x.aluno_id = v_aluno AND x.assinatura_aluno IS NOT NULL
     ORDER BY x.assinado_aluno_em DESC NULLS LAST
     LIMIT 1;
    RETURN jsonb_build_object('pendente_assinatura', true, 'aluno', a.nome, 'curso', c.nome, 'ultima_assinatura', v_ultima);
  END IF;

  SELECT * INTO m FROM public."TRN_CERTIFICADO_MODELO" WHERE id = ce.modelo_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('nome', mo.nome,
           'aulas', (SELECT coalesce(jsonb_agg(au.nome ORDER BY au.posicao), '[]'::jsonb) FROM public."TRN_AULA" au WHERE au.modulo_id = mo.id AND au.publicada))
           ORDER BY mo.posicao), '[]'::jsonb)
    INTO v_mod FROM public."TRN_MODULO" mo WHERE mo.curso_id = p_curso;
  SELECT jsonb_build_object('nome_completo', s.nome_completo, 'cargo', s.cargo, 'registro', s.registro, 'tipo', s.tipo,
                            'imagem', s.imagem, 'texto', s.texto, 'fonte', s.fonte, 'tamanho', s.tamanho)
    INTO v_ass FROM public."TRN_ASSINATURA" s WHERE s.id = ce.assinatura_id;
  RETURN jsonb_build_object(
    'codigo', ce.codigo_validacao, 'emitido_em', ce.emitido_em, 'carga_horaria_min', ce.carga_horaria_min,
    'aluno', a.nome, 'documento', a.documento, 'curso', c.nome,
    'modelo', CASE WHEN m.id IS NULL THEN NULL ELSE to_jsonb(m) END,
    'modulos', v_mod,
    'assinatura', v_ass,
    'assinatura_aluno', ce.assinatura_aluno,
    'empresa', ce.empresa);
END $function$;

-- ── 5) Portal: o colaborador assina ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.col_assinar_certificado(p_emp bigint, p_curso uuid, p_assinatura jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_aluno uuid; v_cert uuid; v_ja jsonb; v_a jsonb; v_curso text;
BEGIN
  SELECT id INTO v_aluno FROM public."TRN_ALUNO" WHERE empregado_id = p_emp ORDER BY created_at LIMIT 1;
  IF v_aluno IS NULL THEN RAISE EXCEPTION 'Você ainda não tem cadastro nos treinamentos.'; END IF;
  SELECT ce.id, ce.assinatura_aluno, cu.nome INTO v_cert, v_ja, v_curso
    FROM public."TRN_CERTIFICADO" ce JOIN public."TRN_CURSO" cu ON cu.id = ce.curso_id
   WHERE ce.aluno_id = v_aluno AND ce.curso_id = p_curso
   FOR UPDATE OF ce;
  IF v_cert IS NULL THEN RAISE EXCEPTION 'Certificado ainda não emitido para este curso.'; END IF;
  -- Já assinado: não troca (o certificado já saiu com aquela assinatura).
  IF v_ja IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'ja_assinado', true); END IF;

  -- Só os campos do tipo escolhido.
  v_a := CASE p_assinatura->>'tipo'
    WHEN 'desenho' THEN jsonb_build_object('tipo', 'desenho', 'imagem', p_assinatura->>'imagem')
    WHEN 'texto'   THEN jsonb_build_object('tipo', 'texto', 'texto', btrim(coalesce(p_assinatura->>'texto', '')),
                                           'fonte', p_assinatura->>'fonte',
                                           'tamanho', coalesce(nullif(p_assinatura->>'tamanho', '')::numeric, 1))
  END;
  IF v_a IS NULL THEN RAISE EXCEPTION 'Escolha desenhar ou escrever a sua assinatura.'; END IF;
  IF NOT public.trn_assinatura_aluno_valida(v_a) THEN
    RAISE EXCEPTION 'Assinatura inválida — desenhe de novo ou escreva o seu nome (2 a 80 letras).';
  END IF;

  UPDATE public."TRN_CERTIFICADO" SET assinatura_aluno = v_a, assinado_aluno_em = now() WHERE id = v_cert;
  INSERT INTO public."TRN_ALUNO_HISTORICO"(aluno_id, acao, detalhes, origem, autor_nome)
  VALUES (v_aluno, 'Certificado assinado', 'Curso: ' || v_curso || ' (assinatura do colaborador pelo portal)', 'plataforma', 'Portal do Colaborador');
  RETURN jsonb_build_object('ok', true, 'ja_assinado', false);
END $$;

-- Mesmo padrão das outras col_* (mig 20260930000196): só a Edge (service_role) chama.
REVOKE ALL ON FUNCTION public.col_assinar_certificado(bigint, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.col_assinar_certificado(bigint, uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.col_certificado(bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.col_certificado(bigint, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.trn_certificado_empresa() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Reaplicar col_certificado da mig 20261006000002.
-- DROP FUNCTION IF EXISTS public.col_assinar_certificado(bigint, uuid, jsonb);
-- DROP TRIGGER IF EXISTS trg_trn_certificado_empresa ON public."TRN_CERTIFICADO";
-- DROP FUNCTION IF EXISTS public.trn_certificado_empresa();
-- ALTER TABLE public."TRN_CERTIFICADO" DROP CONSTRAINT IF EXISTS trn_certificado_assinatura_aluno_chk;
-- DROP FUNCTION IF EXISTS public.trn_assinatura_aluno_valida(jsonb);
-- ALTER TABLE public."TRN_CERTIFICADO" DROP COLUMN IF EXISTS assinatura_aluno, DROP COLUMN IF EXISTS assinado_aluno_em, DROP COLUMN IF EXISTS empresa;
-- UPDATE public."TRN_CERTIFICADO_MODELO" SET fundo_path = 'preset:nascimento' WHERE fundo_path = 'preset:empresa';
