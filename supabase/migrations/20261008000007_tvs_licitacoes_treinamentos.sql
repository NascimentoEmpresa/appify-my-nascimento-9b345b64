-- =========================================================================
-- SISTEMAS › TV's — LICITAÇÕES E TREINAMENTOS NA TV (08/10/2026)
--
-- PEDIDOS (Pablo):
--   · "transforma o dashboard de /app/painel-executivo/tv em um dashboard da
--     licitação nos relatórios da TV — não modifica esse, apenas cria um se
--     baseando nesse pra TV da licitação";
--   · "faz um dashboard de treinamentos também pra TV, como opção nos
--     relatórios".
--
-- LICITAÇÕES: o Painel Executivo lê a grade (public.grade) com o login de
-- quem abre e faz as contas na tela (usePainelLicitacao). A TV não tem
-- login: tv_licitacao_dados() entrega a grade inteira (o grupo todo, como a
-- TV do Painel Executivo) em linhas compactas — 486 processos, ~140 KB em
-- 08/10/2026 — e a TV faz as MESMAS contas (src/lib/tv/licitacaoTv.ts).
-- Interna; a prévia da gestão usa tv_licitacao_previa(), que exige a mesma
-- liberação do Painel Executivo (menu painel-executivo). Nada no Painel
-- Executivo muda.
--
-- TREINAMENTOS: trn_dashboard começa com trn_ve_modulo() (login). Mesmo
-- desenho do dir_rel_dados / dir_vagas_painel_dados:
--   · trn_dashboard_dados = o corpo de hoje, COPIADO da definição viva
--     (pg_get_functiondef de 08/10/2026), sem a linha da checagem. Interna;
--   · trn_dashboard = checagem + chamada (a tela do Dashboard fica igual —
--     conferido: mesmo md5 da saída antes e depois).
--
-- tv_relatorio ganha os ramos 'licitacoes' e 'treinamentos'; o CHECK do item
-- aceita os dois. Período e contrato do item não se aplicam a eles (as telas
-- de origem abrem sem filtro).
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── 1) Licitações: a grade para a TV ─────────────────────────────────────
-- [id, edital, fase, responsavel, cidade, uf, data (abertura), objeto,
--  qtd_pessoas, valor_global (texto, como na grade), posicao, created_at,
--  updated_at, empresa (código)]
CREATE OR REPLACE FUNCTION public.tv_licitacao_dados()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'itens', COALESCE((
      SELECT jsonb_agg(jsonb_build_array(g.id, g.edital, g.fase, g.responsavel, g.cidade, g.uf, g.data, left(g.objeto, 160),
                                         g.qtd_pessoas, g.valor_global, g.posicao, g.created_at, g.updated_at, e.codigo)
                       ORDER BY g.data NULLS LAST, g.created_at)
        FROM public.grade g LEFT JOIN public.empresas e ON e.id = g.empresa_id), '[]'::jsonb),
    'gerado_em', now())
$$;
REVOKE ALL ON FUNCTION public.tv_licitacao_dados() FROM PUBLIC, anon, authenticated;

-- Prévia na gestão (Sistemas › TV's): só quem já vê o Painel Executivo.
CREATE OR REPLACE FUNCTION public.tv_licitacao_previa()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'painel-executivo', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso ao Painel Executivo de Licitações.' USING ERRCODE = '42501';
  END IF;
  RETURN public.tv_licitacao_dados();
END $$;
REVOKE ALL ON FUNCTION public.tv_licitacao_previa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tv_licitacao_previa() TO authenticated;

-- ── 2) Treinamentos: a conta do Dashboard sem a checagem ─────────────────
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
    -- Aulas mais concluídas no período.
    'top_aulas', (SELECT coalesce(jsonb_agg(jsonb_build_object('nome', x.nome, 'curso', x.curso, 'n', x.n) ORDER BY x.n DESC), '[]'::jsonb)
                    FROM (SELECT au.nome, cu.nome curso, count(*) n
                            FROM prog p JOIN aulas au ON au.id = p.aula_id JOIN public."TRN_CURSO" cu ON cu.id = au.curso_id
                           WHERE p.concluida GROUP BY au.nome, cu.nome ORDER BY count(*) DESC LIMIT 8) x)
  ) INTO r;
  RETURN r;
END $function$;
REVOKE ALL ON FUNCTION public.trn_dashboard_dados(uuid, date, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trn_dashboard(_curso uuid DEFAULT NULL::uuid, _de date DEFAULT NULL::date, _ate date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.trn_ve_modulo() THEN RAISE EXCEPTION 'Sem acesso ao módulo Treinamentos.'; END IF;
  RETURN public.trn_dashboard_dados(_curso, _de, _ate);
END $function$;

-- ── 3) O item da playlist aceita os dois ─────────────────────────────────
ALTER TABLE public."TV_ITEM" DROP CONSTRAINT IF EXISTS tv_item_relatorio_check;
ALTER TABLE public."TV_ITEM" ADD CONSTRAINT tv_item_relatorio_check CHECK (
  tipo <> 'relatorio' OR (
    relatorio IN ('geral', 'recrutamento', 'demissoes', 'materiais', 'ferias', 'medida-disciplinar', 'chamados',
                  'orientacoes', 'mudanca-funcao', 'colaboradores', 'turnover', 'vagas', 'licitacoes', 'treinamentos')
    AND COALESCE(rel_periodo, '12m') IN ('mes', '3m', '6m', '12m', 'ano')));

-- ── 4) tv_relatorio: Licitações e Treinamentos ───────────────────────────
CREATE OR REPLACE FUNCTION public.tv_relatorio(p_token text, p_item uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  d public."TV_DISPOSITIVO"; i public."TV_ITEM"; v_de date; v_ate date; v_out jsonb; s text;
  v_ano int; v_meses int[]; v_filial text;
BEGIN
  SELECT * INTO d FROM public."TV_DISPOSITIVO"
   WHERE token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') AND pareado_em IS NOT NULL AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'TV não autorizada.'; END IF;
  SELECT * INTO i FROM public."TV_ITEM" WHERE id = p_item AND playlist_id = d.playlist_id AND ativo AND tipo = 'relatorio';
  IF NOT FOUND THEN RAISE EXCEPTION 'Relatório não está na playlist desta TV.'; END IF;

  SELECT p.de, p.ate INTO v_de, v_ate FROM public.tv_rel_periodo(i.rel_periodo) p;

  IF i.relatorio = 'geral' THEN
    v_out := jsonb_build_object('tipo', 'geral', 'periodo', jsonb_build_object('de', v_de, 'ate', v_ate), 'sistemas', '[]'::jsonb);
    FOREACH s IN ARRAY ARRAY['recrutamento', 'demissoes', 'materiais', 'ferias', 'medida-disciplinar', 'mudanca-funcao', 'chamados', 'orientacoes'] LOOP
      v_out := jsonb_set(v_out, '{sistemas}', (v_out->'sistemas') || jsonb_build_array(
        (SELECT jsonb_build_object('slug', s, 'titulo', r->>'titulo', 'kpis', r->'kpis', 'rotulo_item', r->>'rotulo_item',
                                   'mensal', r->'mensal')
           FROM (SELECT public.dir_rel_dados(s, v_de, v_ate, i.rel_contrato, NULL) r) x)));
    END LOOP;
  ELSIF i.relatorio = 'vagas' THEN
    v_out := jsonb_build_object('tipo', 'vagas', 'periodo', jsonb_build_object('de', v_de, 'ate', v_ate),
                                'painel', public.dir_vagas_painel_dados(v_de, v_ate, i.rel_contrato, NULL));
  ELSIF i.relatorio = 'turnover' THEN
    -- Turn-over é por ano: os meses do ano corrente que caem no período.
    v_ano := extract(year FROM v_ate)::int;
    v_meses := ARRAY(SELECT m FROM generate_series(1, 12) m
                      WHERE make_date(v_ano, m, 1) BETWEEN date_trunc('month', v_de)::date AND v_ate);
    v_filial := public.dir_turnover_filial(i.rel_contrato);
    v_out := jsonb_build_object('tipo', 'turnover', 'filial', v_filial,
                                'painel', public.dir_turnover_painel_dados(v_ano, NULL, v_filial, NULL, v_meses));
  ELSIF i.relatorio = 'licitacoes' THEN
    -- Painel Executivo de Licitações (grupo inteiro, como a TV de /app/painel-executivo/tv).
    v_out := jsonb_build_object('tipo', 'licitacoes') || public.tv_licitacao_dados();
  ELSIF i.relatorio = 'treinamentos' THEN
    -- Dashboard de Treinamentos (a base toda, como a tela abre sem filtro).
    v_out := jsonb_build_object('tipo', 'treinamentos', 'painel', public.trn_dashboard_dados(NULL, NULL, NULL));
  ELSE
    v_out := jsonb_build_object('tipo', 'sistema', 'slug', i.relatorio) || public.dir_rel_dados(i.relatorio, v_de, v_ate, i.rel_contrato, NULL);
  END IF;

  RETURN v_out || jsonb_build_object('contrato', (SELECT c.nome FROM public.contratos c WHERE c.id = i.rel_contrato), 'gerado_em', now());
END $$;
REVOKE ALL ON FUNCTION public.tv_relatorio(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tv_relatorio(text, uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- tv_relatorio: reaplicar a da mig 20261008000004.
-- trn_dashboard: reaplicar o corpo da trn_dashboard_dados com a linha
--   IF NOT public.trn_ve_modulo() THEN RAISE EXCEPTION 'Sem acesso ao módulo Treinamentos.'; END IF;
--   no começo, e DROP FUNCTION public.trn_dashboard_dados(uuid, date, date);
-- DROP FUNCTION IF EXISTS public.tv_licitacao_previa(), public.tv_licitacao_dados();
-- CHECK tv_item_relatorio_check: recriar sem 'licitacoes' e 'treinamentos' (antes, apagar esses itens).
