-- =========================================================================
-- Treinamentos: aula com vídeo só conclui (e só dá certificado) depois do
-- vídeo visto até o fim (02/10/2026)
--
-- Pedido do Pablo: "o vídeo dos treinamentos, o usuário só consiga concluir
-- quando terminar o vídeo — se não terminar, não pode pegar o certificado."
--
-- Antes: o player avisava "vídeo assistido" ao chegar em 90% e isso só
-- liberava a PROVA (mig 205); o botão "Marcar como concluída" fechava a aula
-- sem ver nada, e col_trn_certificar emitia o certificado quando todas as
-- aulas estavam concluídas. Agora:
--   • o player (Portal do Colaborador) só avisa no FIM do vídeo e não deixa
--     adiantar — arrastar para frente volta ao ponto mais distante já visto;
--   • col_concluir_aula recusa a aula com vídeo sem video_assistido — e como
--     o certificado depende de todas as aulas concluídas, ele também fica
--     preso ao vídeo;
--   • col_curso devolve video_assistido e video_obrigatorio, para a tela
--     travar o botão com a mesma regra.
--
-- "Vídeo obrigatório" = um vídeo que o player consegue acompanhar: arquivo
-- do bucket (video_path), YouTube, Vimeo ou link direto de arquivo de vídeo
-- (a mesma detecção de embedDeVideo, em treinamento/core.ts). Link de outra
-- plataforma, embed genérico e aula ao vivo ficam de fora — nesses o player
-- não sabe quando acabou, e travar seria prender o aluno para sempre.
--
-- Aulas já concluídas não são reabertas. A Edge colaborador-portal não muda
-- (as ações e os parâmetros são os mesmos).
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.trn_aula_video_obrigatorio(p_video_url text, p_video_path text, p_tipo text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $f$
  SELECT coalesce(p_tipo, '') <> 'ao_vivo' AND (
       nullif(btrim(coalesce(p_video_path, '')), '') IS NOT NULL
    OR coalesce(p_video_url, '') ~* '(youtube\.com/(watch\?(.*&)?v=|embed/|shorts/|live/)|youtu\.be/)[A-Za-z0-9_-]{6,}'
    OR coalesce(p_video_url, '') ~* 'vimeo\.com/(video/)?[0-9]+'
    OR coalesce(p_video_url, '') ~* '\.(mp4|webm|ogg|mov|m4v)(\?|#|$)'
  );
$f$;
REVOKE ALL ON FUNCTION public.trn_aula_video_obrigatorio(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_aula_video_obrigatorio(text, text, text) TO authenticated;

-- ── Concluir a aula (versão atual + a trava do vídeo) ─────────────────────
CREATE OR REPLACE FUNCTION public.col_concluir_aula(p_emp bigint, p_aula uuid, p_tempo_seg integer DEFAULT 0, p_avaliacao integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_aluno uuid; v_au record; v_curso uuid; v_nota int; v_cert text; v_nome text;
BEGIN
  v_aluno := public.col_trn_aluno(p_emp);
  IF v_aluno IS NULL THEN RAISE EXCEPTION 'Você ainda não tem cadastro nos treinamentos.'; END IF;
  SELECT au.*, mo.curso_id INTO v_au FROM public."TRN_AULA" au JOIN public."TRN_MODULO" mo ON mo.id = au.modulo_id WHERE au.id = p_aula AND au.publicada;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aula não encontrada.'; END IF;
  v_curso := v_au.curso_id;
  PERFORM public.col_trn_exige_curso(v_aluno, v_curso);
  IF p_avaliacao IS NOT NULL AND p_avaliacao NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Avaliação de 1 a 5.'; END IF;

  -- Aula com quiz só conclui depois de passar nele.
  IF v_au.quiz IS NOT NULL AND jsonb_array_length(v_au.quiz) > 0 THEN
    SELECT nota_quiz INTO v_nota FROM public."TRN_PROGRESSO" WHERE aluno_id = v_aluno AND aula_id = p_aula;
    IF v_nota IS NULL OR v_nota < v_au.nota_minima THEN
      RAISE EXCEPTION 'Responda o quiz da aula (nota mínima %) para concluí-la.', v_au.nota_minima || '%';
    END IF;
  END IF;

  -- 02/10/2026 (mig 290): aula com vídeo só conclui depois do vídeo visto
  -- até o fim (o player não deixa adiantar e só avisa no fim — ver
  -- CursoColaborador.tsx). Sem isso, "Marcar como concluída" fechava a aula
  -- sem assistir, e o certificado saía mesmo assim.
  IF public.trn_aula_video_obrigatorio(v_au.video_url, v_au.video_path, v_au.tipo_conteudo)
     AND NOT coalesce((SELECT p.video_assistido FROM public."TRN_PROGRESSO" p
                        WHERE p.aluno_id = v_aluno AND p.aula_id = p_aula), false) THEN
    RAISE EXCEPTION 'Assista o vídeo até o fim para concluir esta aula.';
  END IF;

  INSERT INTO public."TRN_PROGRESSO"(aluno_id, aula_id, concluida, concluida_em, tempo_seg, avaliacao)
  VALUES (v_aluno, p_aula, true, now(), greatest(coalesce(p_tempo_seg,0),0), p_avaliacao)
  ON CONFLICT (aluno_id, aula_id) DO UPDATE
    SET concluida = true,
        concluida_em = coalesce(public."TRN_PROGRESSO".concluida_em, now()),
        tempo_seg = public."TRN_PROGRESSO".tempo_seg + greatest(coalesce(p_tempo_seg,0),0),
        avaliacao = coalesce(EXCLUDED.avaliacao, public."TRN_PROGRESSO".avaliacao);

  SELECT nome INTO v_nome FROM public."TRN_ALUNO" WHERE id = v_aluno;
  INSERT INTO public."TRN_ALUNO_HISTORICO"(aluno_id, acao, detalhes, origem, autor_nome)
  VALUES (v_aluno, 'Aula concluída', v_au.nome, 'plataforma', v_nome);

  v_cert := public.col_trn_certificar(v_aluno, v_curso);
  RETURN jsonb_build_object('ok', true, 'certificado', v_cert);
END $function$;

-- ── O curso do aluno (versão atual + video_assistido / video_obrigatorio) ─
CREATE OR REPLACE FUNCTION public.col_curso(p_emp bigint, p_curso uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_aluno uuid; c record; v_insc date; v_hoje date := public.col_hoje(); v_mod jsonb; v_cert text; v_total int; v_conc int;
BEGIN
  v_aluno := public.col_trn_aluno(p_emp);
  IF v_aluno IS NULL THEN RAISE EXCEPTION 'Você ainda não tem cadastro nos treinamentos.'; END IF;
  PERFORM public.col_trn_exige_curso(v_aluno, p_curso);
  SELECT * INTO c FROM public."TRN_CURSO" WHERE id = p_curso;
  SELECT inscrito_em INTO v_insc FROM public."TRN_MATRICULA" WHERE aluno_id = v_aluno AND curso_id = p_curso;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', mo.id, 'nome', mo.nome, 'posicao', mo.posicao,
           'libera_em', CASE WHEN mo.liberar_dias IS NOT NULL AND v_insc IS NOT NULL THEN v_insc + mo.liberar_dias END,
           'bloqueado', coalesce(mo.liberar_dias IS NOT NULL AND v_insc IS NOT NULL AND v_insc + mo.liberar_dias > v_hoje, false),
           'aulas', (
             SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', au.id, 'nome', au.nome, 'tipo_conteudo', au.tipo_conteudo, 'video_url', au.video_url,
               'video_path', au.video_path, 'thumb_path', au.thumb_path, 'descricao', au.descricao, 'posicao', au.posicao,
               'carga_horaria_min', au.carga_horaria_min, 'materiais', au.materiais, 'cta_texto', au.cta_texto, 'cta_url', au.cta_url,
               -- O quiz vai SEM a resposta certa: quem corrige é col_responder_quiz.
               'quiz', CASE WHEN au.quiz IS NULL THEN NULL ELSE (
                          SELECT jsonb_agg(jsonb_build_object('id', q->>'id', 'enunciado', q->>'enunciado', 'opcoes', q->'opcoes'))
                            FROM jsonb_array_elements(au.quiz) q) END,
               'nota_minima', au.nota_minima,
               'libera_em', greatest(au.liberar_em, CASE WHEN au.liberar_dias IS NOT NULL AND v_insc IS NOT NULL THEN v_insc + au.liberar_dias END),
               'bloqueado', coalesce(greatest(au.liberar_em, CASE WHEN au.liberar_dias IS NOT NULL AND v_insc IS NOT NULL THEN v_insc + au.liberar_dias END) > v_hoje, false),
               'concluida', coalesce(p.concluida, false), 'concluida_em', p.concluida_em,
               'avaliacao', p.avaliacao, 'tempo_seg', coalesce(p.tempo_seg, 0), 'nota_quiz', p.nota_quiz,
               -- mig 290: a tela só libera "concluir" com o vídeo visto até o fim.
               'video_assistido', coalesce(p.video_assistido, false),
               'video_obrigatorio', public.trn_aula_video_obrigatorio(au.video_url, au.video_path, au.tipo_conteudo)
             ) ORDER BY au.posicao, au.created_at), '[]'::jsonb)
               FROM public."TRN_AULA" au
               LEFT JOIN public."TRN_PROGRESSO" p ON p.aula_id = au.id AND p.aluno_id = v_aluno
              WHERE au.modulo_id = mo.id AND au.publicada)
         ) ORDER BY mo.posicao, mo.created_at), '[]'::jsonb)
    INTO v_mod
    FROM public."TRN_MODULO" mo WHERE mo.curso_id = p_curso;

  SELECT count(au.id), count(p.id) FILTER (WHERE p.concluida) INTO v_total, v_conc
    FROM public."TRN_MODULO" mo JOIN public."TRN_AULA" au ON au.modulo_id = mo.id AND au.publicada
    LEFT JOIN public."TRN_PROGRESSO" p ON p.aula_id = au.id AND p.aluno_id = v_aluno
   WHERE mo.curso_id = p_curso;
  SELECT codigo_validacao INTO v_cert FROM public."TRN_CERTIFICADO" WHERE aluno_id = v_aluno AND curso_id = p_curso;

  RETURN jsonb_build_object(
    'curso', jsonb_build_object('id', c.id, 'nome', c.nome, 'descricao', c.descricao, 'capa_path', c.capa_path,
                                'carga_horaria_min', c.carga_horaria_min, 'comentarios_habilitados', c.comentarios_habilitados,
                                'emite_certificado', c.certificado_modelo_id IS NOT NULL, 'inscrito_em', v_insc),
    'modulos', v_mod, 'aulas', v_total, 'concluidas', v_conc,
    'pct', CASE WHEN v_total = 0 THEN 0 ELSE round(100.0 * v_conc / v_total) END,
    'certificado', v_cert);
END $function$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reaplicar col_concluir_aula e col_curso sem os blocos marcados "mig 290"
-- (as versões anteriores estão na 20260930000196 / 20260930000205). Depois:
-- DROP FUNCTION IF EXISTS public.trn_aula_video_obrigatorio(text, text, text);
-- NOTIFY pgrst, 'reload schema';
