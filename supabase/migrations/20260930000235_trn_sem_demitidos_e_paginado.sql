-- =========================================================================
-- Treinamentos: demitido não conta nem aparece em "Quem vê este curso";
-- lista de pessoas paginada.
--
-- Caso de 24/09/2026: a ação em massa "Todos os alunos da plataforma" com
-- "Adicionar curso" matriculou os 13.355 alunos no NR-23 — 10.857 deles
-- demitidos — e o bloco "Quem vê este curso" carregou as 13.355 linhas de
-- uma vez. Pedido do Pablo: só quem NÃO está demitido (situação 7 da Senior,
-- "Demitido" no TRN_ALUNO.situacao) entra; afastados (atestado, férias,
-- licença...) entram.
--
--   · trn_acao_massa: 'adicionar_curso' pula demitidos (inclusive "todos").
--   · trn_curso_alcance / trn_alunos_do_curso / trn_liberacao_opcoes:
--     elegível = situacao <> 'Demitido' (antes: só status 'ativo', que
--     deixava afastados de fora).
--   · trn_curso_publico(_curso, _busca, _offset): pessoas específicas sem
--     demitidos, 50 por página, com busca por nome/CPF e total.
--   As matrículas já gravadas de demitidos NÃO são apagadas — só deixam de
--   contar e de aparecer (demitido não entra no portal).
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.trn_acao_massa(_acao text, _alunos uuid[] DEFAULT NULL::uuid[], _tag uuid DEFAULT NULL::uuid, _param jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE alvo uuid[]; n int := 0; x uuid;
BEGIN
  IF NOT public.trn_acesso('treinamentos_alunos','alterar') THEN
    RAISE EXCEPTION 'Você não tem permissão para alterar alunos.';
  END IF;
  IF _alunos IS NOT NULL AND array_length(_alunos,1) > 0 THEN
    alvo := _alunos;
  ELSIF _tag IS NOT NULL THEN
    SELECT array_agg(aluno_id) INTO alvo FROM public."TRN_ALUNO_TAG" WHERE tag_id = _tag;
  ELSE
    SELECT array_agg(id) INTO alvo FROM public."TRN_ALUNO";
  END IF;
  IF alvo IS NULL THEN RETURN jsonb_build_object('afetados', 0); END IF;

  CASE _acao
    WHEN 'adicionar_curso' THEN
      -- 24/09/2026: demitido não recebe curso, nem em "todos os alunos".
      INSERT INTO public."TRN_MATRICULA"(aluno_id, curso_id, origem)
      SELECT a, (_param->>'curso_id')::uuid, 'massa'
        FROM unnest(alvo) a JOIN public."TRN_ALUNO" t ON t.id = a
       WHERE t.situacao IS DISTINCT FROM 'Demitido'
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS n = ROW_COUNT;
    WHEN 'remover_curso' THEN
      DELETE FROM public."TRN_MATRICULA" WHERE curso_id = (_param->>'curso_id')::uuid AND aluno_id = ANY(alvo);
      GET DIAGNOSTICS n = ROW_COUNT;
    WHEN 'adicionar_tag' THEN
      INSERT INTO public."TRN_ALUNO_TAG"(aluno_id, tag_id)
      SELECT a, (_param->>'tag_id')::uuid FROM unnest(alvo) a ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS n = ROW_COUNT;
    WHEN 'remover_tag' THEN
      DELETE FROM public."TRN_ALUNO_TAG" WHERE tag_id = (_param->>'tag_id')::uuid AND aluno_id = ANY(alvo);
      GET DIAGNOSTICS n = ROW_COUNT;
    WHEN 'observacao' THEN
      UPDATE public."TRN_ALUNO" SET observacoes = _param->>'texto' WHERE id = ANY(alvo);
      GET DIAGNOSTICS n = ROW_COUNT;
    WHEN 'bloquear' THEN
      UPDATE public."TRN_ALUNO" SET status = 'bloqueado' WHERE id = ANY(alvo) AND status <> 'bloqueado';
      GET DIAGNOSTICS n = ROW_COUNT;
    WHEN 'desbloquear' THEN
      UPDATE public."TRN_ALUNO" SET status = 'ativo', expira_em = CASE WHEN prazo_acesso_dias IS NULL THEN NULL ELSE current_date + prazo_acesso_dias END
       WHERE id = ANY(alvo) AND status = 'bloqueado';
      GET DIAGNOSTICS n = ROW_COUNT;
    WHEN 'ativar' THEN
      UPDATE public."TRN_ALUNO" SET status = 'ativo' WHERE id = ANY(alvo) AND status = 'pendente';
      GET DIAGNOSTICS n = ROW_COUNT;
    WHEN 'data_matricula' THEN
      UPDATE public."TRN_MATRICULA" SET inscrito_em = (_param->>'data')::date
       WHERE aluno_id = ANY(alvo) AND (_param->>'curso_id' IS NULL OR curso_id = (_param->>'curso_id')::uuid);
      GET DIAGNOSTICS n = ROW_COUNT;
    WHEN 'prazo_acesso' THEN
      UPDATE public."TRN_ALUNO" SET prazo_acesso_dias = (_param->>'dias')::int,
             expira_em = current_date + (_param->>'dias')::int WHERE id = ANY(alvo);
      GET DIAGNOSTICS n = ROW_COUNT;
    WHEN 'remover_prazo' THEN
      UPDATE public."TRN_ALUNO" SET prazo_acesso_dias = NULL, expira_em = NULL WHERE id = ANY(alvo);
      GET DIAGNOSTICS n = ROW_COUNT;
    WHEN 'excluir' THEN
      IF NOT public.trn_acesso('treinamentos_alunos','excluir') THEN
        RAISE EXCEPTION 'Você não tem permissão para excluir alunos.';
      END IF;
      DELETE FROM public."TRN_ALUNO" WHERE id = ANY(alvo);
      GET DIAGNOSTICS n = ROW_COUNT;
    ELSE
      RAISE EXCEPTION 'Ação desconhecida: %', _acao;
  END CASE;

  -- Uma linha de histórico por aluno afetado, para o "Histórico" contar.
  IF _acao <> 'excluir' THEN
    FOREACH x IN ARRAY alvo LOOP
      INSERT INTO public."TRN_ALUNO_HISTORICO"(aluno_id, acao, detalhes, autor_nome)
      VALUES (x, 'Ação em massa: ' || _acao, _param::text, public.trn_nome_autor());
    END LOOP;
  END IF;
  RETURN jsonb_build_object('afetados', n, 'alvo', array_length(alvo,1));
END $function$;

CREATE OR REPLACE FUNCTION public.trn_curso_alcance(_curso uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT count(*)::int
    FROM public."TRN_ALUNO" a
    JOIN public."TRN_CURSO" c ON c.id = _curso
   WHERE a.situacao IS DISTINCT FROM 'Demitido'
     AND (EXISTS (SELECT 1 FROM public."TRN_MATRICULA" m WHERE m.curso_id = c.id AND m.aluno_id = a.id)
          OR a.acesso_completo OR c.liberado_para_todos
          OR public.trn_regra_libera(c.id, a.contrato, a.cargo));
$fn$;

CREATE OR REPLACE FUNCTION public.trn_alunos_do_curso(_curso uuid)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT public.trn_ve_modulo() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  RETURN ARRAY(
    SELECT a.id FROM public."TRN_ALUNO" a JOIN public."TRN_CURSO" c ON c.id = _curso
     WHERE a.situacao IS DISTINCT FROM 'Demitido'
       AND (EXISTS (SELECT 1 FROM public."TRN_MATRICULA" m WHERE m.curso_id = c.id AND m.aluno_id = a.id)
            OR (c.publicado AND (a.acesso_completo OR c.liberado_para_todos OR public.trn_regra_libera(c.id, a.contrato, a.cargo)))));
END $fn$;

CREATE OR REPLACE FUNCTION public.trn_liberacao_opcoes()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT public.trn_acesso('treinamentos_cursos') THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  -- Quem não está demitido (afastados contam): contrato/cargo de quem saiu não é de ninguém hoje.
  RETURN jsonb_build_object(
    'contratos', (SELECT coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'ativos', n) ORDER BY nome), '[]'::jsonb)
                    FROM (SELECT contrato nome, count(*) n FROM public."TRN_ALUNO"
                           WHERE situacao IS DISTINCT FROM 'Demitido' AND nullif(btrim(contrato), '') IS NOT NULL GROUP BY 1) x),
    'cargos', (SELECT coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'ativos', n) ORDER BY nome), '[]'::jsonb)
                 FROM (SELECT cargo nome, count(*) n FROM public."TRN_ALUNO"
                        WHERE situacao IS DISTINCT FROM 'Demitido' AND nullif(btrim(cargo), '') IS NOT NULL GROUP BY 1) y));
END $fn$;

DROP FUNCTION IF EXISTS public.trn_curso_publico(uuid);
CREATE OR REPLACE FUNCTION public.trn_curso_publico(_curso uuid, _busca text DEFAULT NULL, _offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_busca text := nullif(btrim(coalesce(_busca, '')), '');
  v_dig   text := regexp_replace(coalesce(_busca, ''), '\D', '', 'g');
BEGIN
  IF NOT public.trn_acesso('treinamentos_cursos') THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  RETURN (
    WITH ind AS (
      SELECT m.id AS matricula_id, a.id AS aluno_id, a.nome, a.contrato, a.cargo, a.situacao, m.inscrito_em
        FROM public."TRN_MATRICULA" m JOIN public."TRN_ALUNO" a ON a.id = m.aluno_id
       WHERE m.curso_id = _curso
         AND a.situacao IS DISTINCT FROM 'Demitido'
         AND (v_busca IS NULL OR a.nome ILIKE '%' || v_busca || '%'
              OR (length(v_dig) >= 5 AND regexp_replace(coalesce(a.documento, ''), '\D', '', 'g') LIKE '%' || v_dig || '%'))
    )
    SELECT jsonb_build_object(
      'liberado_para_todos', (SELECT liberado_para_todos FROM public."TRN_CURSO" WHERE id = _curso),
      'regras', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'id', l.id, 'contrato', l.contrato, 'cargo', l.cargo,
                    'ativos', (SELECT count(*) FROM public."TRN_ALUNO" a
                                WHERE a.situacao IS DISTINCT FROM 'Demitido'
                                  AND (nullif(btrim(l.contrato), '') IS NULL OR upper(btrim(l.contrato)) = upper(btrim(a.contrato)))
                                  AND (nullif(btrim(l.cargo), '') IS NULL OR upper(btrim(l.cargo)) = upper(btrim(a.cargo))))
                  ) ORDER BY l.contrato NULLS LAST, l.cargo NULLS LAST), '[]'::jsonb)
                   FROM public."TRN_CURSO_LIBERACAO" l WHERE l.curso_id = _curso),
      'total_individuais', (SELECT count(*) FROM ind),
      'individuais', (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.nome), '[]'::jsonb)
                        FROM (SELECT * FROM ind ORDER BY nome LIMIT 50 OFFSET greatest(coalesce(_offset, 0), 0)) p),
      'alcance', public.trn_curso_alcance(_curso)));
END $fn$;

REVOKE ALL ON FUNCTION public.trn_curso_publico(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_curso_publico(uuid, text, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Conferência:
-- SELECT public.trn_curso_alcance(id), nome FROM "TRN_CURSO" WHERE publicado;

-- ROLLBACK
-- Reaplicar trn_acao_massa (mig 190), trn_curso_alcance / trn_alunos_do_curso /
-- trn_liberacao_opcoes / trn_curso_publico(uuid) da mig 20260930000231.
-- NOTIFY pgrst, 'reload schema';
