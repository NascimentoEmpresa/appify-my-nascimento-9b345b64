-- =====================================================================
-- Treinamentos › Dashboard › Acesso por contrato: TODOS os contratos.
--
-- Pedido do Pablo (23/10/2026): o gráfico só mostrava os 12 contratos com
-- mais alunos e não dava para achar os outros. A trn_dashboard_dados ganha a
-- chave 'por_contrato_todos' (sem LIMIT); a tela busca, filtra por faixa de
-- acesso, ordena e escolhe quantos mostrar. 'por_contrato' (top 12) NÃO muda:
-- a TV de Treinamentos e o espelho gerencial (tvg) leem dela.
--
-- Corpo copiado da definição viva (mig 20261008000007, a última que cria a
-- função); só a chave nova foi acrescentada. A trn_dashboard (checagem de
-- módulo + chamada) não muda.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.trn_dashboard_dados(_curso uuid DEFAULT NULL::uuid, _de date DEFAULT NULL::date, _ate date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r   jsonb;
  ano int := extract(year FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int;
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN

  WITH
  curso_f AS (SELECT c.* FROM public."TRN_CURSO" c WHERE c.id = _curso),
  base AS (
    SELECT a.* FROM public."TRN_ALUNO" a
     WHERE a.status <> 'demitido'
       AND (_curso IS NULL
            OR a.acesso_completo
            OR EXISTS (SELECT 1 FROM public."TRN_MATRICULA" m WHERE m.aluno_id = a.id AND m.curso_id = _curso)
            OR EXISTS (SELECT 1 FROM curso_f c WHERE c.liberado_para_todos)
            OR public.trn_regra_libera(_curso, a.contrato, a.cargo))
  ),
  aulas AS (
    SELECT au.id, au.nome, au.publicada, mo.curso_id
      FROM public."TRN_AULA" au JOIN public."TRN_MODULO" mo ON mo.id = au.modulo_id
     WHERE (_curso IS NULL OR mo.curso_id = _curso)
  ),
  prog AS (
    SELECT p.*, aulas.curso_id FROM public."TRN_PROGRESSO" p JOIN aulas ON aulas.id = p.aula_id
     WHERE (_de IS NULL OR p.updated_at::date >= _de) AND (_ate IS NULL OR p.updated_at::date <= _ate)
  ),
  coment AS (
    SELECT c.*, aulas.curso_id FROM public."TRN_COMENTARIO" c JOIN aulas ON aulas.id = c.aula_id
     WHERE (_de IS NULL OR c.created_at::date >= _de) AND (_ate IS NULL OR c.created_at::date <= _ate)
  ),
  cert AS (
    SELECT c.* FROM public."TRN_CERTIFICADO" c
     WHERE (_curso IS NULL OR c.curso_id = _curso)
       AND (_de IS NULL OR c.emitido_em::date >= _de) AND (_ate IS NULL OR c.emitido_em::date <= _ate)
  ),
  provas AS (
    SELECT t.* FROM public."TRN_PROVA_TENTATIVA" t JOIN aulas ON aulas.id = t.aula_id
     WHERE t.enviada_em IS NOT NULL
       AND (_de IS NULL OR t.enviada_em::date >= _de) AND (_ate IS NULL OR t.enviada_em::date <= _ate)
  ),
  interagiram AS (SELECT DISTINCT aluno_id FROM prog),
  concluiram  AS (SELECT DISTINCT aluno_id FROM prog WHERE concluida),
  -- Aulas publicadas por curso: é o denominador de "concluiu o curso".
  total_aulas AS (SELECT curso_id, count(*) n FROM aulas WHERE publicada GROUP BY curso_id),
  -- Quem fechou todas as aulas publicadas do curso (a qualquer tempo:
  -- conclusão de curso é estado, não atividade do período).
  fechou_curso AS (
    SELECT x.curso_id, x.aluno_id
      FROM (SELECT au.curso_id, p.aluno_id, count(*) n
              FROM public."TRN_PROGRESSO" p JOIN aulas au ON au.id = p.aula_id AND au.publicada
             WHERE p.concluida GROUP BY 1, 2) x
      JOIN total_aulas t ON t.curso_id = x.curso_id AND x.n >= t.n AND t.n > 0
  ),
  cursos AS (SELECT c.* FROM public."TRN_CURSO" c WHERE _curso IS NULL OR c.id = _curso),
  contratos AS (
    SELECT b.contrato AS nome, count(*) n,
           count(*) FILTER (WHERE b.status = 'ativo') ativos
      FROM base b WHERE nullif(btrim(b.contrato), '') IS NOT NULL
     GROUP BY b.contrato
  )
  SELECT jsonb_build_object(
    -- Alunos
    'alunos',            (SELECT count(*) FROM base),
    'alunos_ativos',     (SELECT count(*) FROM base WHERE status = 'ativo'),
    'alunos_inativos',   (SELECT count(*) FROM base WHERE status = 'inativo'),
    'alunos_bloqueados', (SELECT count(*) FROM base WHERE status = 'bloqueado'),
    'alunos_afastados',  (SELECT count(*) FROM base WHERE situacao IS NOT NULL AND situacao <> 'Trabalhando'),
    'alunos_demitidos',  (SELECT count(*) FROM public."TRN_ALUNO" WHERE status = 'demitido'),
    'acessaram_7d',      (SELECT count(*) FROM base WHERE ultimo_acesso_em >= now() - interval '7 days'),
    'acessaram_30d',     (SELECT count(*) FROM base WHERE ultimo_acesso_em >= now() - interval '30 days'),
    'primeiros_acessos_periodo', (SELECT count(*) FROM base
                                   WHERE primeiro_acesso_em IS NOT NULL
                                     AND (_de IS NULL OR primeiro_acesso_em::date >= _de)
                                     AND (_ate IS NULL OR primeiro_acesso_em::date <= _ate)),
    -- Atividade
    'aulas_concluidas',  (SELECT count(*) FROM prog WHERE concluida),
    'avaliacao_media',   (SELECT round(avg(avaliacao)::numeric, 1) FROM prog WHERE avaliacao IS NOT NULL),
    'avaliacoes',        (SELECT count(*) FROM prog WHERE avaliacao IS NOT NULL),
    'avaliacoes_por_nota', (SELECT jsonb_agg(coalesce(n.q, 0) ORDER BY g.nota)
                              FROM generate_series(1, 5) g(nota)
                              LEFT JOIN (SELECT avaliacao, count(*) q FROM prog WHERE avaliacao IS NOT NULL GROUP BY 1) n
                                ON n.avaliacao = g.nota),
    'comentarios',       (SELECT count(*) FROM coment),
    'comentarios_pendentes', (SELECT count(*) FROM public."TRN_COMENTARIO" WHERE status = 'pendente'),
    'cursos_publicados', (SELECT count(*) FROM public."TRN_CURSO" WHERE publicado),
    'cursos_total',      (SELECT count(*) FROM public."TRN_CURSO"),
    'certificados',      (SELECT count(*) FROM cert),
    'provas_enviadas',   (SELECT count(*) FROM provas),
    'provas_aprovadas',  (SELECT count(*) FROM provas WHERE aprovado),
    'interacao_real',    (SELECT count(*) FROM interagiram),
    'concluidos',        (SELECT count(*) FROM concluiram),
    -- Séries
    'ano',               ano,
    'primeiros_acessos_por_mes', (SELECT jsonb_agg(coalesce(pm.n, 0) ORDER BY g.m)
                                    FROM generate_series(1, 12) g(m)
                                    LEFT JOIN (SELECT extract(month FROM primeiro_acesso_em AT TIME ZONE 'America/Sao_Paulo')::int mes, count(*) n
                                                 FROM base WHERE extract(year FROM primeiro_acesso_em AT TIME ZONE 'America/Sao_Paulo') = ano
                                                GROUP BY 1) pm ON pm.mes = g.m),
    'conclusoes_por_mes', (SELECT jsonb_agg(coalesce(pm.n, 0) ORDER BY g.m)
                             FROM generate_series(1, 12) g(m)
                             LEFT JOIN (SELECT extract(month FROM p.concluida_em AT TIME ZONE 'America/Sao_Paulo')::int mes, count(*) n
                                          FROM public."TRN_PROGRESSO" p JOIN aulas ON aulas.id = p.aula_id
                                         WHERE p.concluida AND extract(year FROM p.concluida_em AT TIME ZONE 'America/Sao_Paulo') = ano
                                         GROUP BY 1) pm ON pm.mes = g.m),
    -- Últimos 30 dias, dia a dia: quem entrou pela primeira vez.
    'primeiros_acessos_30d', (SELECT jsonb_agg(jsonb_build_object('dia', d.dia::date, 'n', coalesce(x.n, 0)) ORDER BY d.dia)
                                FROM generate_series(hoje - 29, hoje, interval '1 day') d(dia)
                                LEFT JOIN (SELECT (primeiro_acesso_em AT TIME ZONE 'America/Sao_Paulo')::date dia, count(*) n
                                             FROM base WHERE primeiro_acesso_em >= now() - interval '31 days' GROUP BY 1) x
                                  ON x.dia = d.dia::date),
    -- Por curso: alcance, quem começou, quem terminou e a nota.
    'por_curso', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                     'id', c.id, 'nome', c.nome, 'publicado', c.publicado,
                     'aulas', coalesce((SELECT n FROM total_aulas t WHERE t.curso_id = c.id), 0),
                     'alcance', public.trn_curso_alcance(c.id),
                     'iniciaram', (SELECT count(DISTINCT p.aluno_id) FROM prog p WHERE p.curso_id = c.id),
                     'concluiram', (SELECT count(*) FROM fechou_curso f WHERE f.curso_id = c.id),
                     'avaliacao_media', (SELECT round(avg(p.avaliacao)::numeric, 1) FROM prog p
                                          WHERE p.curso_id = c.id AND p.avaliacao IS NOT NULL),
                     'avaliacoes', (SELECT count(*) FROM prog p WHERE p.curso_id = c.id AND p.avaliacao IS NOT NULL),
                     'comentarios', (SELECT count(*) FROM coment x WHERE x.curso_id = c.id),
                     'certificados', (SELECT count(*) FROM cert x WHERE x.curso_id = c.id)
                   ) ORDER BY c.publicado DESC, c.nome), '[]'::jsonb)
                    FROM cursos c),
    -- Contratos com mais gente na base, e quanto dela já entrou.
    'por_contrato', (SELECT coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'alunos', n, 'ativos', ativos)
                                               ORDER BY n DESC, nome), '[]'::jsonb)
                       FROM (SELECT * FROM contratos ORDER BY n DESC, nome LIMIT 12) t),
    -- Todos os contratos (mig 20261023000020): o Dashboard filtra/ordena na tela.
    -- A lista de cima (top 12) fica como estava porque a TV lê dela.
    'por_contrato_todos', (SELECT coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'alunos', n, 'ativos', ativos)
                                                     ORDER BY n DESC, nome), '[]'::jsonb)
                             FROM contratos),
    -- Aulas mais concluídas no período.
    'top_aulas', (SELECT coalesce(jsonb_agg(jsonb_build_object('nome', x.nome, 'curso', x.curso, 'n', x.n) ORDER BY x.n DESC), '[]'::jsonb)
                    FROM (SELECT au.nome, cu.nome curso, count(*) n
                            FROM prog p JOIN aulas au ON au.id = p.aula_id JOIN public."TRN_CURSO" cu ON cu.id = au.curso_id
                           WHERE p.concluida GROUP BY au.nome, cu.nome ORDER BY count(*) DESC LIMIT 8) x)
  ) INTO r;
  RETURN r;
END $function$;
REVOKE ALL ON FUNCTION public.trn_dashboard_dados(uuid, date, date) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Reaplicar a trn_dashboard_dados da mig 20261008000007 (sem 'por_contrato_todos').