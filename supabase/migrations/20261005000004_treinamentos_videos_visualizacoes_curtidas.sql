-- =========================================================================
-- TREINAMENTOS — visualizações e curtidas de cada vídeo, no próprio sistema
--
-- PEDIDO (05/10/2026, Pablo): "tem que ter quantas visualizações e curtidas
-- cada vídeo teve também, não só as que estão no youtube, tem que dar pra
-- curtir no sistema" — nos dois lugares que têm vídeo, e em todo vídeo novo.
--
-- 1. TREINAMENTOS ERP ("TREINAMENTOS", visor do ERP, usuário logado)
--    · visualização: JÁ existia — "TREINAMENTO_VISUALIZACAO" conta as
--      aberturas por pessoa (trn_registrar_visualizacao, mig 063).
--    · curtida: nova, "TREINAMENTO_CURTIDA" (uma por pessoa por vídeo).
--    · trn_video_numeros(_ids) → visualizações (soma das aberturas), quem
--      viu, curtidas e se EU curti; trn_video_curtir(_id) liga/desliga.
--
-- 2. PLATAFORMA (aulas "TRN_AULA", Portal do Colaborador — sem auth.uid(),
--    a pessoa é o p_emp que a Edge colaborador-portal resolve pela sessão)
--    · "TRN_AULA_VISUALIZACAO": aberturas por aluno (mesmo formato da ERP);
--    · "TRN_AULA_CURTIDA": uma por aluno por aula;
--    · col_aula_visualizar / col_aula_curtir — chamadas pelas ações novas
--      "aula_visualizar" e "aula_curtir" da Edge (exige redeploy da Edge);
--    · a gestão lê as duas tabelas pela RLS do módulo (trn_rls).
--
-- "Visualização" = abrir o vídeo (o mesmo que a ERP já conta): YouTube e
-- Vimeo tocam em iframe de outro domínio, e a abertura é o que dá para
-- afirmar com honestidade. Cada abertura soma.
--
-- Escrita só pelas RPCs (SECURITY DEFINER), sempre em nome de quem está
-- logado — ninguém curte por outro nem infla o contador de vídeo que não vê.
--
-- Idempotente. Aplicar no banco do app (SQL Editor) — não se auto-aplica.
-- =========================================================================

-- ── 1) Treinamentos ERP: curtidas ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."TREINAMENTO_CURTIDA" (
  treinamento_id uuid NOT NULL REFERENCES public."TREINAMENTOS"(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (treinamento_id, user_id)
);
ALTER TABLE public."TREINAMENTO_CURTIDA" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."TREINAMENTO_CURTIDA" FROM PUBLIC, anon, authenticated;
-- Sem policy: leitura e escrita só pelas RPCs abaixo.

-- Números de vários vídeos de uma vez (a lista de cards e o visor).
CREATE OR REPLACE FUNCTION public.trn_video_numeros(_ids uuid[])
RETURNS TABLE (treinamento_id uuid, visualizacoes bigint, pessoas bigint, curtidas bigint, curti boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT t.id,
         COALESCE((SELECT sum(v.aberturas) FROM public."TREINAMENTO_VISUALIZACAO" v WHERE v.treinamento_id = t.id), 0)::bigint,
         (SELECT count(*) FROM public."TREINAMENTO_VISUALIZACAO" v WHERE v.treinamento_id = t.id)::bigint,
         (SELECT count(*) FROM public."TREINAMENTO_CURTIDA" c WHERE c.treinamento_id = t.id)::bigint,
         EXISTS (SELECT 1 FROM public."TREINAMENTO_CURTIDA" c WHERE c.treinamento_id = t.id AND c.user_id = auth.uid())
    FROM public."TREINAMENTOS" t
   WHERE t.id = ANY(_ids)
     AND auth.uid() IS NOT NULL
     AND public.trn_pode_ver_escopos(t.escopos);
$$;
REVOKE ALL ON FUNCTION public.trn_video_numeros(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_video_numeros(uuid[]) TO authenticated;

-- Curtir / descurtir. Devolve se ficou curtido.
CREATE OR REPLACE FUNCTION public.trn_video_curtir(_treinamento uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_escopos text[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão inválida.'; END IF;
  SELECT t.escopos INTO v_escopos FROM public."TREINAMENTOS" t WHERE t.id = _treinamento;
  IF v_escopos IS NULL THEN RAISE EXCEPTION 'Treinamento não encontrado.'; END IF;
  IF NOT public.trn_pode_ver_escopos(v_escopos) THEN RAISE EXCEPTION 'Você não tem acesso a este treinamento.'; END IF;

  DELETE FROM public."TREINAMENTO_CURTIDA" WHERE treinamento_id = _treinamento AND user_id = auth.uid();
  IF FOUND THEN RETURN false; END IF;
  INSERT INTO public."TREINAMENTO_CURTIDA" (treinamento_id, user_id) VALUES (_treinamento, auth.uid());
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.trn_video_curtir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_video_curtir(uuid) TO authenticated;

-- ── 2) Plataforma: visualizações e curtidas por aula ─────────────────────
CREATE TABLE IF NOT EXISTS public."TRN_AULA_VISUALIZACAO" (
  aula_id     uuid NOT NULL REFERENCES public."TRN_AULA"(id) ON DELETE CASCADE,
  aluno_id    uuid NOT NULL REFERENCES public."TRN_ALUNO"(id) ON DELETE CASCADE,
  aberturas   integer NOT NULL DEFAULT 1 CHECK (aberturas > 0),
  primeira_em timestamptz NOT NULL DEFAULT now(),
  ultima_em   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (aula_id, aluno_id)
);
CREATE TABLE IF NOT EXISTS public."TRN_AULA_CURTIDA" (
  aula_id    uuid NOT NULL REFERENCES public."TRN_AULA"(id) ON DELETE CASCADE,
  aluno_id   uuid NOT NULL REFERENCES public."TRN_ALUNO"(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (aula_id, aluno_id)
);
-- Gestão lê pelo módulo; escrita só pelas col_* abaixo (a Edge usa service_role).
SELECT public.trn_rls('TRN_AULA_VISUALIZACAO', 'treinamentos_cursos');
SELECT public.trn_rls('TRN_AULA_CURTIDA', 'treinamentos_cursos');
REVOKE INSERT, UPDATE, DELETE ON public."TRN_AULA_VISUALIZACAO" FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public."TRN_AULA_CURTIDA" FROM authenticated;

-- Os números de uma aula, do ponto de vista do aluno.
CREATE OR REPLACE FUNCTION public.col_aula_numeros(p_aula uuid, p_aluno uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'visualizacoes', COALESCE((SELECT sum(aberturas) FROM public."TRN_AULA_VISUALIZACAO" WHERE aula_id = p_aula), 0),
    'curtidas', (SELECT count(*) FROM public."TRN_AULA_CURTIDA" WHERE aula_id = p_aula),
    'curti', EXISTS (SELECT 1 FROM public."TRN_AULA_CURTIDA" WHERE aula_id = p_aula AND aluno_id = p_aluno));
$$;
REVOKE ALL ON FUNCTION public.col_aula_numeros(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.col_aula_numeros(uuid, uuid) TO service_role;

-- Abriu a aula: soma uma visualização e devolve os números.
CREATE OR REPLACE FUNCTION public.col_aula_visualizar(p_emp bigint, p_aula uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_aluno uuid;
BEGIN
  PERFORM public.col_prova_curso_ok(p_emp, p_aula);   -- matriculado e aula publicada
  v_aluno := public.col_trn_aluno(p_emp);
  INSERT INTO public."TRN_AULA_VISUALIZACAO" (aula_id, aluno_id)
  VALUES (p_aula, v_aluno)
  ON CONFLICT (aula_id, aluno_id) DO UPDATE
     SET aberturas = public."TRN_AULA_VISUALIZACAO".aberturas + 1, ultima_em = now();
  RETURN public.col_aula_numeros(p_aula, v_aluno);
END $$;
REVOKE ALL ON FUNCTION public.col_aula_visualizar(bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.col_aula_visualizar(bigint, uuid) TO service_role;

-- Curtir / descurtir a aula. Devolve os números já atualizados.
CREATE OR REPLACE FUNCTION public.col_aula_curtir(p_emp bigint, p_aula uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_aluno uuid;
BEGIN
  PERFORM public.col_prova_curso_ok(p_emp, p_aula);
  v_aluno := public.col_trn_aluno(p_emp);
  DELETE FROM public."TRN_AULA_CURTIDA" WHERE aula_id = p_aula AND aluno_id = v_aluno;
  IF NOT FOUND THEN
    INSERT INTO public."TRN_AULA_CURTIDA" (aula_id, aluno_id) VALUES (p_aula, v_aluno);
  END IF;
  RETURN public.col_aula_numeros(p_aula, v_aluno);
END $$;
REVOKE ALL ON FUNCTION public.col_aula_curtir(bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.col_aula_curtir(bigint, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.col_aula_curtir(bigint, uuid);
-- DROP FUNCTION IF EXISTS public.col_aula_visualizar(bigint, uuid);
-- DROP FUNCTION IF EXISTS public.col_aula_numeros(uuid, uuid);
-- DROP TABLE IF EXISTS public."TRN_AULA_CURTIDA";
-- DROP TABLE IF EXISTS public."TRN_AULA_VISUALIZACAO";
-- DROP FUNCTION IF EXISTS public.trn_video_curtir(uuid);
-- DROP FUNCTION IF EXISTS public.trn_video_numeros(uuid[]);
-- DROP TABLE IF EXISTS public."TREINAMENTO_CURTIDA";
