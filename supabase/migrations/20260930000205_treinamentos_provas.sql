-- =========================================================================
-- Treinamentos: PROVAS depois da aula — tentativas limitadas (3 por padrão),
-- pontuação e tudo configurável por aula
--
-- Pedido do Pablo em 22/09/2026: "desenvolve também provas e que cada
-- usuario após ver o vídeo possa responder e pontuar, podendo repetir 3x as
-- provas, deixa bem configurável e customizável".
--
-- Evolução do quiz que já existia (TRN_AULA.quiz + col_responder_quiz, da
-- 20260930000196): o banco de perguntas continua em TRN_AULA.quiz, agora com
-- formato estendido (campos novos opcionais — o quiz antigo segue valendo):
--   {id, enunciado, tipo: 'unica'|'multipla'|'vf' (padrão unica),
--    opcoes: [texto], correta: índice (unica/vf), corretas: [índices] (multipla),
--    pontos: n (padrão 1), explicacao: texto (opcional, mostrado no gabarito)}
--
-- TRN_AULA.prova_config (jsonb, chaves ausentes = padrão de trn_prova_cfg):
--   titulo               'Prova da aula'
--   instrucoes           texto livre mostrado antes de começar
--   tentativas_max       3      (NULL = ilimitado)
--   nota_vale            'maior' | 'ultima'
--   liberar_apos_video   true   — só abre depois do vídeo assistido até o fim
--                                 (quando o vídeo é detectável: arquivo,
--                                 YouTube, Vimeo, .mp4…; link/embed/texto
--                                 não têm como ser medidos → abre direto)
--   embaralhar_perguntas false
--   embaralhar_opcoes    false
--   sortear              NULL   — n perguntas sorteadas do banco por tentativa
--   tempo_limite_min     NULL   — cronômetro por tentativa
--   intervalo_min        NULL   — espera mínima entre uma tentativa e a próxima
--   gabarito             'ao_final' | 'nunca' | 'resultado' | 'sempre'
--                          nunca     = só a nota
--                          resultado = + certo/errado por pergunta
--                          ao_final  = + resposta certa e explicação quando
--                                      aprova ou acabam as tentativas
--                          sempre    = + resposta certa e explicação sempre
--   multipla_parcial     false  — múltipla escolha vale fração dos pontos
--                                 ((acertos − erros) / corretas); false = tudo
--                                 ou nada
--
-- Nota = pontos obtidos / pontos possíveis (0–100). nota_minima continua na
-- coluna própria. Aprovou → conclui a aula (col_concluir_aula), igual antes.
--
-- Tentativas em "TRN_PROVA_TENTATIVA": cada início grava as perguntas
-- servidas (e a ordem das opções); a resposta só é aceita para aquelas
-- perguntas. Tentativa aberta é retomada (recarregar a página não gasta
-- tentativa nem sorteia outras perguntas); com tempo limite, a vencida é
-- fechada com nota 0. Esgotou sem aprovar → o RH libera tentativa extra pelo
-- ERP (TRN_PROGRESSO.prova_tentativas_extras, trn_prova_liberar_tentativa).
--
-- col_responder_quiz (portal antigo, ainda em produção até o rebuild) passa
-- a respeitar as tentativas: vira um atalho de "inicia com todas as
-- perguntas na ordem original + responde".
--
-- Idempotente. Aplicar no banco do app. A Edge Function colaborador-portal
-- ganha as ações prova / prova_iniciar / prova_responder / video_assistido
-- (deploy à parte).
-- =========================================================================

-- 1) Estrutura -------------------------------------------------------------
ALTER TABLE public."TRN_AULA" ADD COLUMN IF NOT EXISTS prova_config jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public."TRN_AULA".prova_config IS 'Configuração da prova da aula (ver trn_prova_cfg). Chave ausente = padrão.';

ALTER TABLE public."TRN_PROGRESSO" ADD COLUMN IF NOT EXISTS video_assistido boolean NOT NULL DEFAULT false;
ALTER TABLE public."TRN_PROGRESSO" ADD COLUMN IF NOT EXISTS prova_tentativas_extras integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public."TRN_PROVA_TENTATIVA" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aluno_id      uuid NOT NULL REFERENCES public."TRN_ALUNO"(id) ON DELETE CASCADE,
  aula_id       uuid NOT NULL REFERENCES public."TRN_AULA"(id) ON DELETE CASCADE,
  numero        integer NOT NULL,
  -- [{id, ordem:[índices originais das opções, na ordem mostrada]}]
  perguntas     jsonb NOT NULL,
  respostas     jsonb,
  -- Correção item a item (para o ERP e o gabarito): [{id, ok, pontos, max, marcadas, corretas}]
  correcao      jsonb,
  pontos        numeric,
  pontos_total  numeric,
  acertos       integer,
  total         integer,
  nota          integer CHECK (nota IS NULL OR nota BETWEEN 0 AND 100),
  aprovado      boolean,
  encerramento  text CHECK (encerramento IS NULL OR encerramento IN ('enviada','tempo_esgotado')),
  iniciada_em   timestamptz NOT NULL DEFAULT now(),
  expira_em     timestamptz,
  enviada_em    timestamptz,
  UNIQUE (aluno_id, aula_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_trn_prova_tentativa_aluno ON public."TRN_PROVA_TENTATIVA"(aluno_id, aula_id);
CREATE INDEX IF NOT EXISTS idx_trn_prova_tentativa_aula  ON public."TRN_PROVA_TENTATIVA"(aula_id);

-- Leitura pelo ERP (quem vê o módulo); escrita só pelas funções abaixo.
ALTER TABLE public."TRN_PROVA_TENTATIVA" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."TRN_PROVA_TENTATIVA" FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public."TRN_PROVA_TENTATIVA" TO authenticated;
DROP POLICY IF EXISTS trn_prova_tentativa_select ON public."TRN_PROVA_TENTATIVA";
CREATE POLICY trn_prova_tentativa_select ON public."TRN_PROVA_TENTATIVA" FOR SELECT TO authenticated USING (public.trn_ve_modulo());

-- 2) Configuração e perguntas ----------------------------------------------
CREATE OR REPLACE FUNCTION public.trn_prova_cfg(p_cfg jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'titulo', 'Prova da aula', 'instrucoes', NULL,
    'tentativas_max', 3, 'nota_vale', 'maior', 'liberar_apos_video', true,
    'embaralhar_perguntas', false, 'embaralhar_opcoes', false, 'sortear', NULL,
    'tempo_limite_min', NULL, 'intervalo_min', NULL, 'gabarito', 'ao_final', 'multipla_parcial', false
  ) || coalesce(p_cfg, '{}'::jsonb);
$$;

-- Perguntas normalizadas: id estável (o antigo sem id vira q<n>), tipo,
-- corretas como array e pontos.
CREATE OR REPLACE FUNCTION public.trn_prova_perguntas(p_quiz jsonb)
RETURNS TABLE (pid text, ord int, tipo text, enunciado text, opcoes jsonb, corretas int[], pontos numeric, explicacao text)
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(nullif(q->>'id', ''), 'q' || o) AS pid,
         o::int,
         coalesce(nullif(q->>'tipo', ''), 'unica'),
         q->>'enunciado',
         coalesce(q->'opcoes', '[]'::jsonb),
         CASE WHEN coalesce(q->>'tipo', 'unica') = 'multipla' AND jsonb_typeof(q->'corretas') = 'array'
              THEN ARRAY(SELECT x::int FROM jsonb_array_elements_text(q->'corretas') x)
              ELSE ARRAY[coalesce((q->>'correta')::int, 0)] END,
         greatest(coalesce((q->>'pontos')::numeric, 1), 0),
         nullif(btrim(coalesce(q->>'explicacao', '')), '')
    FROM jsonb_array_elements(coalesce(p_quiz, '[]'::jsonb)) WITH ORDINALITY AS t(q, o);
$$;

-- O vídeo da aula dá pra medir até o fim? (arquivo, YouTube, Vimeo, link de .mp4…)
CREATE OR REPLACE FUNCTION public.trn_aula_video_mensuravel(p_video_path text, p_video_url text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT p_video_path IS NOT NULL
      OR coalesce(p_video_url, '') ~* '(youtube\.com|youtu\.be|vimeo\.com|\.(mp4|webm|ogg|ogv|mov|m4v)(\?|#|$))';
$$;

-- 3) Núcleo (por aluno_id — o portal e o atalho legado passam por aqui) -----

-- Fecha tentativa aberta que passou do tempo (+2 min de tolerância) com nota 0.
CREATE OR REPLACE FUNCTION public.trn_prova_fechar_vencidas(p_aluno uuid, p_aula uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public."TRN_PROVA_TENTATIVA"
     SET enviada_em = now(), encerramento = 'tempo_esgotado', nota = 0, aprovado = false,
         pontos = 0, acertos = 0, total = jsonb_array_length(perguntas)
   WHERE aluno_id = p_aluno AND aula_id = p_aula AND enviada_em IS NULL
     AND expira_em IS NOT NULL AND expira_em + interval '2 minutes' < now();
END $$;

-- Estado da prova para o aluno: config, liberação, tentativas, histórico e a
-- tentativa aberta (perguntas SEM as respostas certas).
CREATE OR REPLACE FUNCTION public.trn_prova_estado(p_aluno uuid, p_aula uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  au record; cfg jsonb; pr record; v_usadas int; v_max int; v_restantes int; v_aberta record;
  v_liberada boolean := true; v_motivo text; v_ultima timestamptz; v_prox timestamptz; v_aprovado boolean;
  v_perguntas jsonb; v_hist jsonb; v_total_banco int;
BEGIN
  SELECT * INTO au FROM public."TRN_AULA" WHERE id = p_aula;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aula não encontrada.'; END IF;
  cfg := public.trn_prova_cfg(au.prova_config);
  SELECT count(*) INTO v_total_banco FROM public.trn_prova_perguntas(au.quiz);
  IF v_total_banco = 0 THEN RETURN jsonb_build_object('tem_prova', false); END IF;

  PERFORM public.trn_prova_fechar_vencidas(p_aluno, p_aula);
  SELECT * INTO pr FROM public."TRN_PROGRESSO" WHERE aluno_id = p_aluno AND aula_id = p_aula;

  SELECT count(*) FILTER (WHERE enviada_em IS NOT NULL), max(enviada_em), bool_or(aprovado)
    INTO v_usadas, v_ultima, v_aprovado
    FROM public."TRN_PROVA_TENTATIVA" WHERE aluno_id = p_aluno AND aula_id = p_aula;
  v_max := CASE WHEN cfg->'tentativas_max' IS NULL OR jsonb_typeof(cfg->'tentativas_max') = 'null' THEN NULL
                ELSE (cfg->>'tentativas_max')::int + coalesce(pr.prova_tentativas_extras, 0) END;
  v_restantes := CASE WHEN v_max IS NULL THEN NULL ELSE greatest(v_max - v_usadas, 0) END;

  SELECT * INTO v_aberta FROM public."TRN_PROVA_TENTATIVA"
   WHERE aluno_id = p_aluno AND aula_id = p_aula AND enviada_em IS NULL ORDER BY numero DESC LIMIT 1;

  IF (cfg->>'liberar_apos_video')::boolean AND public.trn_aula_video_mensuravel(au.video_path, au.video_url)
     AND NOT coalesce(pr.video_assistido, false) THEN
    v_liberada := false; v_motivo := 'Assista ao vídeo até o fim para liberar a prova.';
  ELSIF v_aberta.id IS NULL AND v_restantes = 0 THEN
    v_liberada := false; v_motivo := 'Você usou todas as tentativas desta prova. Se precisar de mais uma, procure o setor de Treinamentos.';
  ELSIF v_aberta.id IS NULL AND (cfg->>'intervalo_min') IS NOT NULL AND v_ultima IS NOT NULL
        AND v_ultima + make_interval(mins => (cfg->>'intervalo_min')::int) > now() THEN
    v_prox := v_ultima + make_interval(mins => (cfg->>'intervalo_min')::int);
    v_liberada := false;
    v_motivo := 'Próxima tentativa liberada às ' || to_char(v_prox AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') || '.';
  END IF;

  IF v_aberta.id IS NOT NULL THEN
    SELECT jsonb_agg(jsonb_build_object(
             'id', p.pid, 'tipo', p.tipo, 'enunciado', p.enunciado, 'pontos', p.pontos,
             -- opções na ordem sorteada, cada uma com o índice ORIGINAL (é ele que volta na resposta)
             'opcoes', (SELECT jsonb_agg(jsonb_build_object('i', o.i::int, 'texto', p.opcoes->>(o.i::int)) ORDER BY o.pos)
                          FROM jsonb_array_elements_text(s.x->'ordem') WITH ORDINALITY AS o(i, pos))
           ) ORDER BY s.pos)
      INTO v_perguntas
      FROM jsonb_array_elements(v_aberta.perguntas) WITH ORDINALITY AS s(x, pos)
      JOIN public.trn_prova_perguntas(au.quiz) p ON p.pid = s.x->>'id';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('numero', numero, 'nota', nota, 'aprovado', aprovado,
                                               'enviada_em', enviada_em, 'encerramento', encerramento) ORDER BY numero), '[]'::jsonb)
    INTO v_hist FROM public."TRN_PROVA_TENTATIVA"
   WHERE aluno_id = p_aluno AND aula_id = p_aula AND enviada_em IS NOT NULL;

  RETURN jsonb_build_object(
    'tem_prova', true,
    'config', jsonb_build_object(
      'titulo', cfg->>'titulo', 'instrucoes', cfg->>'instrucoes', 'tentativas_max', v_max,
      'nota_minima', au.nota_minima, 'nota_vale', cfg->>'nota_vale', 'tempo_limite_min', cfg->'tempo_limite_min',
      'intervalo_min', cfg->'intervalo_min', 'gabarito', cfg->>'gabarito',
      'perguntas', least(coalesce(nullif((cfg->>'sortear'), '')::int, v_total_banco), v_total_banco)),
    'liberada', v_liberada, 'motivo', v_motivo, 'proxima_em', v_prox,
    'video_assistido', coalesce(pr.video_assistido, false),
    'usadas', v_usadas, 'restantes', v_restantes,
    'nota', pr.nota_quiz, 'aprovado', coalesce(pr.nota_quiz >= au.nota_minima, false),
    'historico', v_hist,
    'aberta', CASE WHEN v_aberta.id IS NULL THEN NULL ELSE jsonb_build_object(
                'id', v_aberta.id, 'numero', v_aberta.numero, 'iniciada_em', v_aberta.iniciada_em,
                'expira_em', v_aberta.expira_em, 'perguntas', v_perguntas) END);
END $$;

-- Começa (ou retoma) uma tentativa. p_ordem_original = sem sorteio/embaralhar
-- (usado só pelo atalho do portal antigo).
CREATE OR REPLACE FUNCTION public.trn_prova_iniciar(p_aluno uuid, p_aula uuid, p_ordem_original boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE au record; cfg jsonb; est jsonb; v_id uuid; v_num int; v_sel jsonb; v_n int;
BEGIN
  est := public.trn_prova_estado(p_aluno, p_aula);
  IF NOT (est->>'tem_prova')::boolean THEN RAISE EXCEPTION 'Esta aula não tem prova.'; END IF;
  IF est->'aberta' IS NOT NULL AND jsonb_typeof(est->'aberta') = 'object' THEN
    RETURN (est->'aberta'->>'id')::uuid;
  END IF;
  IF NOT (est->>'liberada')::boolean THEN RAISE EXCEPTION '%', est->>'motivo'; END IF;

  SELECT * INTO au FROM public."TRN_AULA" WHERE id = p_aula;
  cfg := public.trn_prova_cfg(au.prova_config);
  v_n := CASE WHEN p_ordem_original THEN NULL ELSE nullif(cfg->>'sortear', '')::int END;

  SELECT jsonb_agg(jsonb_build_object('id', x.pid, 'ordem', x.ordem) ORDER BY x.chave)
    INTO v_sel
    FROM (
      SELECT p.pid,
             CASE WHEN NOT p_ordem_original AND (cfg->>'embaralhar_perguntas')::boolean THEN random() ELSE p.ord END AS chave,
             (SELECT jsonb_agg(i ORDER BY CASE WHEN NOT p_ordem_original AND (cfg->>'embaralhar_opcoes')::boolean AND p.tipo <> 'vf' THEN random() ELSE i END)
                FROM generate_series(0, jsonb_array_length(p.opcoes) - 1) i) AS ordem
        FROM public.trn_prova_perguntas(au.quiz) p
       -- sorteio: n perguntas ao acaso (a ordem de exibição vem da "chave")
       ORDER BY CASE WHEN v_n IS NOT NULL THEN random() ELSE p.ord END
       LIMIT coalesce(v_n, 100000)
    ) x;

  SELECT coalesce(max(numero), 0) + 1 INTO v_num FROM public."TRN_PROVA_TENTATIVA" WHERE aluno_id = p_aluno AND aula_id = p_aula;
  INSERT INTO public."TRN_PROVA_TENTATIVA"(aluno_id, aula_id, numero, perguntas, expira_em)
  VALUES (p_aluno, p_aula, v_num, v_sel,
          CASE WHEN nullif(cfg->>'tempo_limite_min', '') IS NOT NULL THEN now() + make_interval(mins => (cfg->>'tempo_limite_min')::int) END)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Corrige e fecha a tentativa. p_respostas = {"<id da pergunta>": [índices originais marcados]}
-- (aceita número solto para única/V-F). Devolve o resultado já filtrado pelo modo de gabarito.
CREATE OR REPLACE FUNCTION public.trn_prova_responder(p_aluno uuid, p_tentativa uuid, p_respostas jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t record; au record; cfg jsonb; p record; v_marc int[]; v_hits int; v_erros int; v_pts numeric; v_ok boolean;
  v_total_pts numeric := 0; v_obt numeric := 0; v_acertos int := 0; v_total int := 0; v_nota int; v_aprov boolean;
  v_itens jsonb := '[]'::jsonb; v_gab text; v_mostra_certas boolean; v_restantes int; est jsonb; v_nome text;
BEGIN
  SELECT * INTO t FROM public."TRN_PROVA_TENTATIVA" WHERE id = p_tentativa AND aluno_id = p_aluno FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tentativa não encontrada.'; END IF;
  IF t.enviada_em IS NOT NULL THEN RAISE EXCEPTION 'Esta tentativa já foi enviada.'; END IF;
  SELECT * INTO au FROM public."TRN_AULA" WHERE id = t.aula_id;
  cfg := public.trn_prova_cfg(au.prova_config);

  FOR p IN
    SELECT q.*, s.pos FROM jsonb_array_elements(t.perguntas) WITH ORDINALITY AS s(x, pos)
      JOIN public.trn_prova_perguntas(au.quiz) q ON q.pid = s.x->>'id'
     ORDER BY s.pos
  LOOP
    v_total := v_total + 1;
    v_total_pts := v_total_pts + p.pontos;
    v_marc := CASE jsonb_typeof(p_respostas->p.pid)
                WHEN 'array'  THEN ARRAY(SELECT DISTINCT x::int FROM jsonb_array_elements_text(p_respostas->p.pid) x)
                WHEN 'number' THEN ARRAY[(p_respostas->>p.pid)::int]
                ELSE '{}'::int[] END;
    IF p.tipo <> 'multipla' AND cardinality(v_marc) > 1 THEN v_marc := v_marc[1:1]; END IF;
    v_ok := v_marc <@ p.corretas AND p.corretas <@ v_marc AND cardinality(v_marc) > 0;
    IF v_ok THEN
      v_pts := p.pontos;
    ELSIF p.tipo = 'multipla' AND (cfg->>'multipla_parcial')::boolean AND cardinality(p.corretas) > 0 THEN
      SELECT count(*) FILTER (WHERE m = ANY(p.corretas)), count(*) FILTER (WHERE NOT (m = ANY(p.corretas)))
        INTO v_hits, v_erros FROM unnest(v_marc) m;
      v_pts := round(p.pontos * greatest(v_hits - v_erros, 0)::numeric / cardinality(p.corretas), 2);
    ELSE
      v_pts := 0;
    END IF;
    IF v_ok THEN v_acertos := v_acertos + 1; END IF;
    v_obt := v_obt + v_pts;
    v_itens := v_itens || jsonb_build_object('id', p.pid, 'ok', v_ok, 'pontos', v_pts, 'max', p.pontos,
                                             'marcadas', to_jsonb(v_marc), 'corretas', to_jsonb(p.corretas),
                                             'explicacao', p.explicacao);
  END LOOP;
  IF v_total = 0 THEN RAISE EXCEPTION 'As perguntas desta prova mudaram. Recarregue a página e comece de novo.'; END IF;

  v_nota := CASE WHEN v_total_pts = 0 THEN 0 ELSE round(100.0 * v_obt / v_total_pts) END;
  v_aprov := v_nota >= au.nota_minima;

  UPDATE public."TRN_PROVA_TENTATIVA"
     SET respostas = p_respostas, correcao = v_itens, pontos = v_obt, pontos_total = v_total_pts,
         acertos = v_acertos, total = v_total, nota = v_nota, aprovado = v_aprov,
         enviada_em = now(),
         encerramento = CASE WHEN expira_em IS NOT NULL AND expira_em + interval '2 minutes' < now() THEN 'tempo_esgotado' ELSE 'enviada' END
   WHERE id = t.id;
  -- Fora do tempo (com tolerância): registra, mas vale zero.
  IF t.expira_em IS NOT NULL AND t.expira_em + interval '2 minutes' < now() THEN
    UPDATE public."TRN_PROVA_TENTATIVA" SET nota = 0, aprovado = false WHERE id = t.id;
    v_nota := 0; v_aprov := false;
  END IF;

  INSERT INTO public."TRN_PROGRESSO"(aluno_id, aula_id, nota_quiz)
  VALUES (p_aluno, t.aula_id, v_nota)
  ON CONFLICT (aluno_id, aula_id) DO UPDATE
    SET nota_quiz = CASE WHEN cfg->>'nota_vale' = 'ultima' THEN EXCLUDED.nota_quiz
                         ELSE greatest(coalesce(public."TRN_PROGRESSO".nota_quiz, 0), EXCLUDED.nota_quiz) END,
        updated_at = now();

  SELECT nome INTO v_nome FROM public."TRN_ALUNO" WHERE id = p_aluno;
  INSERT INTO public."TRN_ALUNO_HISTORICO"(aluno_id, acao, detalhes, origem, autor_nome)
  VALUES (p_aluno, CASE WHEN v_aprov THEN 'Prova aprovada' ELSE 'Prova reprovada' END,
          au.nome || ' · tentativa ' || t.numero || ' · nota ' || v_nota || '% (mínimo ' || au.nota_minima || '%)',
          'plataforma', v_nome);

  est := public.trn_prova_estado(p_aluno, t.aula_id);
  v_restantes := (est->>'restantes')::int;
  v_gab := cfg->>'gabarito';
  v_mostra_certas := v_gab = 'sempre' OR (v_gab = 'ao_final' AND (v_aprov OR v_restantes = 0));

  RETURN jsonb_build_object(
    'nota', v_nota, 'aprovado', v_aprov, 'nota_minima', au.nota_minima,
    'pontos', v_obt, 'pontos_total', v_total_pts, 'acertos', v_acertos, 'total', v_total,
    'numero', t.numero, 'restantes', v_restantes, 'nota_vigente', est->'nota',
    'itens', CASE
               WHEN v_gab = 'nunca' THEN NULL
               WHEN v_mostra_certas THEN v_itens
               ELSE (SELECT jsonb_agg(i - 'corretas' - 'explicacao') FROM jsonb_array_elements(v_itens) i)
             END);
END $$;

-- 4) Portal do Colaborador (service_role via Edge Function) ----------------
CREATE OR REPLACE FUNCTION public.col_prova(p_emp bigint, p_aula uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_aluno uuid; v_curso uuid;
BEGIN
  v_aluno := public.col_trn_aluno(p_emp);
  IF v_aluno IS NULL THEN RAISE EXCEPTION 'Você ainda não tem cadastro nos treinamentos.'; END IF;
  SELECT mo.curso_id INTO v_curso FROM public."TRN_AULA" au JOIN public."TRN_MODULO" mo ON mo.id = au.modulo_id WHERE au.id = p_aula AND au.publicada;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aula não encontrada.'; END IF;
  PERFORM public.col_trn_exige_curso(v_aluno, v_curso);
  RETURN public.trn_prova_estado(v_aluno, p_aula);
END $$;

CREATE OR REPLACE FUNCTION public.col_prova_iniciar(p_emp bigint, p_aula uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_aluno uuid;
BEGIN
  PERFORM public.col_prova(p_emp, p_aula);           -- valida aluno/curso/aula
  v_aluno := public.col_trn_aluno(p_emp);
  PERFORM public.trn_prova_iniciar(v_aluno, p_aula, false);
  RETURN public.trn_prova_estado(v_aluno, p_aula);
END $$;

CREATE OR REPLACE FUNCTION public.col_prova_responder(p_emp bigint, p_tentativa uuid, p_respostas jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_aluno uuid; v_aula uuid; r jsonb; v_cert text;
BEGIN
  v_aluno := public.col_trn_aluno(p_emp);
  IF v_aluno IS NULL THEN RAISE EXCEPTION 'Você ainda não tem cadastro nos treinamentos.'; END IF;
  SELECT aula_id INTO v_aula FROM public."TRN_PROVA_TENTATIVA" WHERE id = p_tentativa AND aluno_id = v_aluno;
  IF v_aula IS NULL THEN RAISE EXCEPTION 'Tentativa não encontrada.'; END IF;
  PERFORM public.col_prova(p_emp, v_aula);
  r := public.trn_prova_responder(v_aluno, p_tentativa, coalesce(p_respostas, '{}'::jsonb));
  IF (r->>'aprovado')::boolean THEN
    v_cert := (public.col_concluir_aula(p_emp, v_aula, 0, NULL))->>'certificado';
  END IF;
  RETURN r || jsonb_build_object('certificado', v_cert);
END $$;

-- O player avisa quando o vídeo chegou ao fim (≥ 90%). Libera a prova.
CREATE OR REPLACE FUNCTION public.col_video_assistido(p_emp bigint, p_aula uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_aluno uuid;
BEGIN
  PERFORM public.col_prova_curso_ok(p_emp, p_aula);
  v_aluno := public.col_trn_aluno(p_emp);
  INSERT INTO public."TRN_PROGRESSO"(aluno_id, aula_id, video_assistido)
  VALUES (v_aluno, p_aula, true)
  ON CONFLICT (aluno_id, aula_id) DO UPDATE SET video_assistido = true, updated_at = now()
   WHERE NOT public."TRN_PROGRESSO".video_assistido;
END $$;

-- Validação comum (aluno + curso liberado + aula publicada), sem montar estado.
CREATE OR REPLACE FUNCTION public.col_prova_curso_ok(p_emp bigint, p_aula uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_aluno uuid; v_curso uuid;
BEGIN
  v_aluno := public.col_trn_aluno(p_emp);
  IF v_aluno IS NULL THEN RAISE EXCEPTION 'Você ainda não tem cadastro nos treinamentos.'; END IF;
  SELECT mo.curso_id INTO v_curso FROM public."TRN_AULA" au JOIN public."TRN_MODULO" mo ON mo.id = au.modulo_id WHERE au.id = p_aula AND au.publicada;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aula não encontrada.'; END IF;
  PERFORM public.col_trn_exige_curso(v_aluno, v_curso);
END $$;

-- Portal antigo: mesma assinatura, agora gastando tentativa (todas as
-- perguntas, ordem original; respostas por posição).
CREATE OR REPLACE FUNCTION public.col_responder_quiz(p_emp bigint, p_aula uuid, p_respostas int[])
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_aluno uuid; v_tent uuid; v_resp jsonb := '{}'::jsonb; p record; r jsonb; v_cert text; v_total int;
BEGIN
  PERFORM public.col_prova_curso_ok(p_emp, p_aula);
  v_aluno := public.col_trn_aluno(p_emp);
  SELECT count(*) INTO v_total FROM public."TRN_AULA" au, public.trn_prova_perguntas(au.quiz) WHERE au.id = p_aula;
  IF v_total = 0 THEN RAISE EXCEPTION 'Esta aula não tem quiz.'; END IF;
  IF coalesce(array_length(p_respostas, 1), 0) <> v_total THEN RAISE EXCEPTION 'Responda todas as % perguntas.', v_total; END IF;
  -- Tentativa aberta pelo portal novo seria de outra ordem: só vale a de ordem original.
  v_tent := public.trn_prova_iniciar(v_aluno, p_aula, true);
  FOR p IN SELECT q.pid, q.ord FROM public."TRN_AULA" au, public.trn_prova_perguntas(au.quiz) q WHERE au.id = p_aula LOOP
    IF p_respostas[p.ord] IS NOT NULL THEN v_resp := v_resp || jsonb_build_object(p.pid, p_respostas[p.ord]); END IF;
  END LOOP;
  r := public.trn_prova_responder(v_aluno, v_tent, v_resp);
  IF (r->>'aprovado')::boolean THEN
    v_cert := (public.col_concluir_aula(p_emp, p_aula, 0, NULL))->>'certificado';
  END IF;
  RETURN jsonb_build_object('nota', r->'nota', 'aprovado', r->'aprovado', 'nota_minima', r->'nota_minima',
                            'acertos', r->'acertos', 'total', r->'total',
                            'corretas', coalesce((SELECT jsonb_agg((i->>'ok')::boolean) FROM jsonb_array_elements(r->'itens') i), '[]'::jsonb),
                            'certificado', v_cert);
END $$;

-- 5) ERP: resultados e tentativa extra --------------------------------------
CREATE OR REPLACE FUNCTION public.trn_prova_tentativas_aluno(p_aluno uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.trn_ve_modulo() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(x ORDER BY x->>'curso', (x->>'modulo_pos')::int, (x->>'aula_pos')::int), '[]'::jsonb) FROM (
      SELECT jsonb_build_object(
               'aula_id', au.id, 'aula', au.nome, 'aula_pos', au.posicao, 'curso', c.nome, 'modulo_pos', mo.posicao,
               'nota_minima', au.nota_minima,
               'tentativas_max', public.trn_prova_cfg(au.prova_config)->'tentativas_max',
               'extras', coalesce(pr.prova_tentativas_extras, 0),
               'nota', pr.nota_quiz, 'video_assistido', coalesce(pr.video_assistido, false),
               'tentativas', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                                 'numero', t.numero, 'nota', t.nota, 'aprovado', t.aprovado, 'acertos', t.acertos,
                                 'total', t.total, 'pontos', t.pontos, 'pontos_total', t.pontos_total,
                                 'iniciada_em', t.iniciada_em, 'enviada_em', t.enviada_em, 'encerramento', t.encerramento)
                                 ORDER BY t.numero), '[]'::jsonb)
                                FROM public."TRN_PROVA_TENTATIVA" t WHERE t.aluno_id = p_aluno AND t.aula_id = au.id)) AS x
        FROM public."TRN_AULA" au
        JOIN public."TRN_MODULO" mo ON mo.id = au.modulo_id
        JOIN public."TRN_CURSO" c ON c.id = mo.curso_id
        LEFT JOIN public."TRN_PROGRESSO" pr ON pr.aula_id = au.id AND pr.aluno_id = p_aluno
       WHERE EXISTS (SELECT 1 FROM public."TRN_PROVA_TENTATIVA" t WHERE t.aluno_id = p_aluno AND t.aula_id = au.id)
          OR coalesce(pr.prova_tentativas_extras, 0) > 0
    ) s);
END $$;

CREATE OR REPLACE FUNCTION public.trn_prova_liberar_tentativa(p_aluno uuid, p_aula uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_aula text;
BEGIN
  IF NOT public.trn_acesso('treinamentos_alunos', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar alunos.' USING ERRCODE = '42501';
  END IF;
  SELECT nome INTO v_aula FROM public."TRN_AULA" WHERE id = p_aula;
  IF v_aula IS NULL THEN RAISE EXCEPTION 'Aula não encontrada.'; END IF;
  INSERT INTO public."TRN_PROGRESSO"(aluno_id, aula_id, prova_tentativas_extras)
  VALUES (p_aluno, p_aula, 1)
  ON CONFLICT (aluno_id, aula_id) DO UPDATE
    SET prova_tentativas_extras = public."TRN_PROGRESSO".prova_tentativas_extras + 1, updated_at = now();
  INSERT INTO public."TRN_ALUNO_HISTORICO"(aluno_id, acao, detalhes, autor_nome)
  VALUES (p_aluno, 'Tentativa extra liberada', 'Prova: ' || v_aula, public.trn_nome_autor());
END $$;

-- Resultado da prova por aula (tela do curso, no ERP).
CREATE OR REPLACE FUNCTION public.trn_prova_resultados_aula(p_aula uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.trn_ve_modulo() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'resumo', (SELECT jsonb_build_object(
                 'alunos', count(DISTINCT t.aluno_id),
                 'aprovados', count(DISTINCT t.aluno_id) FILTER (WHERE t.aprovado),
                 'tentativas', count(*) FILTER (WHERE t.enviada_em IS NOT NULL),
                 'media', round(avg(t.nota) FILTER (WHERE t.enviada_em IS NOT NULL)))
                 FROM public."TRN_PROVA_TENTATIVA" t WHERE t.aula_id = p_aula),
    -- % de acerto por pergunta: mostra onde a turma erra.
    'perguntas', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', i->>'id', 'respostas', n, 'acertos', ok) ), '[]'::jsonb)
                    FROM (SELECT i->>'id' AS id, i, count(*) OVER (PARTITION BY i->>'id') n,
                                 count(*) FILTER (WHERE (i->>'ok')::boolean) OVER (PARTITION BY i->>'id') ok,
                                 row_number() OVER (PARTITION BY i->>'id') rn
                            FROM public."TRN_PROVA_TENTATIVA" t, jsonb_array_elements(coalesce(t.correcao, '[]'::jsonb)) i
                           WHERE t.aula_id = p_aula) z WHERE rn = 1),
    'alunos', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'aluno_id', a.id, 'nome', a.nome, 'contrato', a.contrato,
                 'tentativas', x.n, 'melhor', x.melhor, 'ultima', x.ultima, 'aprovado', x.aprovado, 'em', x.em) ORDER BY a.nome), '[]'::jsonb)
                 FROM (SELECT aluno_id, count(*) FILTER (WHERE enviada_em IS NOT NULL) n, max(nota) melhor,
                              (array_agg(nota ORDER BY numero DESC) FILTER (WHERE enviada_em IS NOT NULL))[1] ultima,
                              bool_or(coalesce(aprovado, false)) aprovado, max(enviada_em) em
                         FROM public."TRN_PROVA_TENTATIVA" WHERE aula_id = p_aula GROUP BY aluno_id) x
                 JOIN public."TRN_ALUNO" a ON a.id = x.aluno_id));
END $$;

-- 6) Duplicar curso/módulo passa a copiar a configuração da prova -----------
CREATE OR REPLACE FUNCTION public.trn_aula_copia_prova_cfg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- As funções de duplicar listam as colunas antigas; a cópia chega sem
  -- prova_config. Se for cópia exata de outra aula (mesmo nome/quiz), herda.
  IF NEW.prova_config = '{}'::jsonb AND NEW.quiz IS NOT NULL THEN
    SELECT o.prova_config INTO NEW.prova_config
      FROM public."TRN_AULA" o
     WHERE o.id <> NEW.id AND o.nome = NEW.nome AND o.quiz = NEW.quiz AND o.prova_config <> '{}'::jsonb
     ORDER BY o.updated_at DESC LIMIT 1;
    NEW.prova_config := coalesce(NEW.prova_config, '{}'::jsonb);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_trn_aula_copia_prova_cfg ON public."TRN_AULA";
CREATE TRIGGER trg_trn_aula_copia_prova_cfg BEFORE INSERT ON public."TRN_AULA"
  FOR EACH ROW EXECUTE FUNCTION public.trn_aula_copia_prova_cfg();

-- 7) Permissões das funções -------------------------------------------------
DO $$
DECLARE f text;
BEGIN
  -- núcleo: só por dentro (col_* e ERP)
  FOREACH f IN ARRAY ARRAY[
    'trn_prova_fechar_vencidas(uuid,uuid)', 'trn_prova_estado(uuid,uuid)', 'trn_prova_iniciar(uuid,uuid,boolean)',
    'trn_prova_responder(uuid,uuid,jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
  -- portal: só a Edge Function (service_role)
  FOREACH f IN ARRAY ARRAY[
    'col_prova(bigint,uuid)', 'col_prova_iniciar(bigint,uuid)', 'col_prova_responder(bigint,uuid,jsonb)',
    'col_video_assistido(bigint,uuid)', 'col_prova_curso_ok(bigint,uuid)', 'col_responder_quiz(bigint,uuid,int[])'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  -- ERP
  FOREACH f IN ARRAY ARRAY[
    'trn_prova_tentativas_aluno(uuid)', 'trn_prova_liberar_tentativa(uuid,uuid)', 'trn_prova_resultados_aula(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS trg_trn_aula_copia_prova_cfg ON public."TRN_AULA";
-- DROP FUNCTION IF EXISTS public.trn_aula_copia_prova_cfg(), public.trn_prova_resultados_aula(uuid),
--   public.trn_prova_liberar_tentativa(uuid,uuid), public.trn_prova_tentativas_aluno(uuid),
--   public.col_video_assistido(bigint,uuid), public.col_prova_curso_ok(bigint,uuid),
--   public.col_prova_responder(bigint,uuid,jsonb), public.col_prova_iniciar(bigint,uuid), public.col_prova(bigint,uuid),
--   public.trn_prova_responder(uuid,uuid,jsonb), public.trn_prova_iniciar(uuid,uuid,boolean), public.trn_prova_estado(uuid,uuid),
--   public.trn_prova_fechar_vencidas(uuid,uuid), public.trn_aula_video_mensuravel(text,text),
--   public.trn_prova_perguntas(jsonb), public.trn_prova_cfg(jsonb);
-- reaplicar col_responder_quiz da 20260930000196;
-- DROP TABLE IF EXISTS public."TRN_PROVA_TENTATIVA";
-- ALTER TABLE public."TRN_PROGRESSO" DROP COLUMN IF EXISTS video_assistido, DROP COLUMN IF EXISTS prova_tentativas_extras;
-- ALTER TABLE public."TRN_AULA" DROP COLUMN IF EXISTS prova_config;
