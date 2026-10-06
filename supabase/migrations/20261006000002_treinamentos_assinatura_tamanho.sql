-- =========================================================================
-- TREINAMENTOS — assinatura: TAMANHO da letra (06/10/2026)
--
-- PEDIDO (Pablo): "a assinatura tem que ficar melhor, bem mais tipos de
-- letra, escolher tamanho das letras, alguns formatos estão saindo pra
-- fora". As letras novas são só front (lista FONTES_ASSINATURA em
-- assinaturaFolha.tsx — o banco só exige fonte não vazia). O "saindo pra
-- fora" também é front: o texto agora encolhe para caber na largura.
--
--   · "TRN_ASSINATURA".tamanho: multiplicador da letra da assinatura
--     escrita (0,6 a 1,4; 1 = padrão). Nunca passa da largura do bloco —
--     acima do que cabe, o front reduz.
--   · col_certificado devolve 'tamanho' para o Portal do Colaborador.
--
-- Idempotente. Aplicar no banco do app (SQL Editor) — não se auto-aplica.
-- =========================================================================

ALTER TABLE public."TRN_ASSINATURA" ADD COLUMN IF NOT EXISTS tamanho numeric(3,2) NOT NULL DEFAULT 1;
ALTER TABLE public."TRN_ASSINATURA" DROP CONSTRAINT IF EXISTS trn_assinatura_tamanho_chk;
ALTER TABLE public."TRN_ASSINATURA" ADD CONSTRAINT trn_assinatura_tamanho_chk CHECK (tamanho BETWEEN 0.6 AND 1.4);

-- Mesmo corpo de col_certificado (mig 20261006000001) + 'tamanho'.
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
                            'imagem', s.imagem, 'texto', s.texto, 'fonte', s.fonte, 'tamanho', s.tamanho)
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
-- Reaplicar col_certificado da mig 20261006000001 (sem 'tamanho').
-- ALTER TABLE public."TRN_ASSINATURA" DROP CONSTRAINT IF EXISTS trn_assinatura_tamanho_chk;
-- ALTER TABLE public."TRN_ASSINATURA" DROP COLUMN IF EXISTS tamanho;
