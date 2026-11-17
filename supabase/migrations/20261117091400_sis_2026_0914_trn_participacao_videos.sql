-- =========================================================================
-- SIS-2026-0914 — Treinamentos › Participação nos vídeos (17/11/2026)
--
-- PEDIDO: o Jurídico precisa responder a uma notificação (prazo 25/11/2026)
-- comprovando a capacitação: por vídeo, quantos colaboradores deveriam ter
-- feito o treinamento, quantos acessaram, quantos assistiram até o fim,
-- quantos acessaram e não concluíram, quantos não acessaram e o % de
-- conclusão; filtros por treinamento/vídeo, empresa (HAGG/SN/NH), contrato e
-- cargo; relatório individual exportável; e a CONSULTA POR DATA — a situação
-- ATÉ um dia escolhido, sem contar o que aconteceu depois. Acesso repetido
-- não pode virar pessoa a mais.
--
-- O QUE JÁ EXISTIA (e o que dá para afirmar com data)
--   · Vídeo = TRN_AULA (de TRN_MODULO → TRN_CURSO, o "treinamento"), da
--     plataforma de cursos online do Portal do Colaborador (mig 190).
--   · Aluno = TRN_ALUNO, 1 por linha da EMPREGADOS (empregado_id), com
--     contrato ("Nome Filial") e cargo espelhados (mig 193).
--   · Público do curso (mig 231/235): matrícula individual (TRN_MATRICULA,
--     com inscrito_em) OU aluno.acesso_completo OU curso.liberado_para_todos
--     OU regra de contrato/cargo (TRN_CURSO_LIBERACAO, com created_at).
--   · Primeiro acesso ao vídeo: TRN_AULA_VISUALIZACAO.primeira_em — existe
--     desde 05/10/2026 (mig 20261005000004). Antes disso, o que há é a linha
--     de TRN_PROGRESSO (criada ao contar tempo / marcar vídeo / concluir),
--     cujo updated_at é sempre >= o primeiro contato. Usamos o MENOR dos
--     três (primeira_em, updated_at, concluida_em): nunca fica ANTES do
--     acesso real — no pior caso a data sai um pouco depois (conservador).
--   · Conclusão da aula: TRN_PROGRESSO.concluida_em (gravada uma vez,
--     nunca reescrita — col_concluir_aula usa coalesce). Desde 02/10/2026
--     (mig 290) aula com vídeo só conclui depois do vídeo visto até o fim.
--   · "Vídeo assistido até o fim": TRN_PROGRESSO.video_assistido (mig 205)
--     — só um boolean, SEM DATA. É o buraco do "até a data".
--
-- O QUE ESTA MIGRATION FAZ
--   1) TRN_PROGRESSO.video_assistido_em + gatilho que carimba now() quando
--      video_assistido vira true (daqui para a frente, data exata). As
--      linhas que já estão true recebem updated_at — que o col_video_assistido
--      grava no mesmo instante em que liga o boolean, e que nada mais mexe
--      depois (só pode ser igual ou posterior ao fim do vídeo: conservador).
--   2) trn_participacao_base(...) — uma linha por PESSOA × VÍDEO do público
--      na data, com primeiro acesso e conclusão até a data. Interna (sem
--      GRANT): as duas RPCs abaixo checam o acesso e leem dela.
--   3) trn_participacao_resumo(...) — números por vídeo, por treinamento e
--      totais de pessoas distintas + opções dos filtros.
--   4) trn_participacao_individual(...) — relatório por pessoa × treinamento
--      (ou × vídeo, quando um vídeo é escolhido), paginado, para tela e
--      exportação.
--
-- REGRAS (a mesma coisa está em src/lib/treinamentos/participacaoVideos.ts,
-- com teste em src/test/treinamentos-participacao-videos.test.ts):
--   · Data D = fim do dia D em America/Sao_Paulo (tudo < D+1 00:00 local).
--   · PESSOA = Empresa + Cadastro da Senior (EMPREGADOS), nunca o ID da
--     EMPREGADOS nem o aluno: duas linhas com o mesmo par viram uma pessoa.
--     Aluno sem vínculo com a EMPREGADOS (cadastro manual antigo) fica fora:
--     não tem empresa, admissão nem desligamento para a regra de data.
--   · DEVERIA REALIZAR na data D = colaborador já admitido até D e não
--     desligado até D (Situação "Demitido" com "Data Afastamento" <= D sai;
--     desligado DEPOIS de D conta; "Demitido" sem data sai — não dá para
--     provar que estava ativo). Afastado (férias, licença) conta: tem vínculo.
--     E estar no público do curso em D: matrícula com inscrito_em <= D,
--     regra de contrato/cargo criada até D, curso para todos ou acesso
--     completo — OU ter acessado o vídeo até D (a regra pode ter mudado
--     depois; quem acessou estava liberado).
--   · Vídeo conta a partir do dia em que foi cadastrado (created_at <= D) e
--     da liberação do curso/aula (liberar_em <= D); antes disso ninguém
--     "deveria" tê-lo feito. Só aula publicada de curso publicado, do tipo
--     vídeo ou com vídeo que o player acompanha.
--   · ACESSOU = primeiro acesso <= D. CONCLUIU (= assistiu até o fim) =
--     video_assistido_em <= D OU concluida_em <= D. Conclusão posterior a D
--     não conta (a pessoa aparece como "em andamento" ou "não iniciado").
--   · Contagens são de pessoas distintas (count de linhas pessoa × vídeo,
--     que já são únicas); 50 aberturas do mesmo vídeo = 1 pessoa que acessou.
--   · Situação no treinamento: concluído = concluiu TODOS os vídeos do
--     treinamento que lhe cabiam em D; em andamento = acessou algum;
--     não iniciado = nenhum acesso até D.
--
-- LIMITAÇÕES CONHECIDAS (ditas também na tela):
--   · Contrato e cargo são os ATUAIS do cadastro (não há histórico de
--     transferência): quem mudou de contrato depois de D aparece no novo.
--   · Regra de liberação apagada não deixa rastro (só as existentes têm
--     created_at); "liberado para todos" e "acesso completo" não têm data.
--   · Antes de 05/10/2026 a data do primeiro acesso é estimada para cima.
--
-- ACESSO: quem vê o Dashboard de Treinamentos — has_screen_access(...,
-- 'treinamentos_dashboard', 'visualizar'). A tela nova mora em
-- /app/treinamentos/participacao, debaixo da rota do Dashboard (mesmo
-- menu, nenhuma liberação nova). Sem CPF, sem salário: nome, empresa,
-- cadastro, contrato e cargo.
--
-- DESEMPENHO: PostgREST corta em 8 s. Tudo é set-based (nenhuma função por
-- linha × curso) e a base roda com enable_nestloop = off (sem isso, 500
-- pessoas já passavam de 280 s). Medido no PGlite — Postgres em WASM, uma
-- thread, mais lento que o cluster — com 6 mil alunos (4,5 mil ativos) ×
-- 100 vídeos e 240 mil visualizações: resumo 3,8 s; individual inteiro
-- (85 mil linhas) 4,8 s. Índices novos em TRN_PROGRESSO(aluno_id) e
-- TRN_AULA_VISUALIZACAO(aluno_id).
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Data do "vídeo assistido até o fim", daqui para a frente ─────────
ALTER TABLE public."TRN_PROGRESSO" ADD COLUMN IF NOT EXISTS video_assistido_em timestamptz;
COMMENT ON COLUMN public."TRN_PROGRESSO".video_assistido_em IS
  'SIS-2026-0914: quando video_assistido virou true. Linhas anteriores a 17/11/2026 receberam updated_at (igual ou posterior ao fim do vídeo).';

CREATE OR REPLACE FUNCTION public.trn_progresso_video_assistido_em()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.video_assistido AND NEW.video_assistido_em IS NULL THEN
    NEW.video_assistido_em := now();
  ELSIF NOT NEW.video_assistido THEN
    NEW.video_assistido_em := NULL;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_trn_progresso_video_assistido_em ON public."TRN_PROGRESSO";
CREATE TRIGGER trg_trn_progresso_video_assistido_em
  BEFORE INSERT OR UPDATE OF video_assistido ON public."TRN_PROGRESSO"
  FOR EACH ROW EXECUTE FUNCTION public.trn_progresso_video_assistido_em();

UPDATE public."TRN_PROGRESSO"
   SET video_assistido_em = updated_at
 WHERE video_assistido AND video_assistido_em IS NULL;

CREATE INDEX IF NOT EXISTS idx_trn_progresso_aluno ON public."TRN_PROGRESSO"(aluno_id);
CREATE INDEX IF NOT EXISTS idx_trn_aula_visualizacao_aluno ON public."TRN_AULA_VISUALIZACAO"(aluno_id);

-- ── 2) Base: pessoa × vídeo do público na data ───────────────────────────
CREATE OR REPLACE FUNCTION public.trn_participacao_base(
  _data date, _curso uuid DEFAULT NULL, _aula uuid DEFAULT NULL,
  _empresa integer DEFAULT NULL, _contrato text DEFAULT NULL, _cargo text DEFAULT NULL)
RETURNS TABLE (
  pessoa text, empresa integer, cadastro bigint, nome text, contrato text, cargo text,
  curso_id uuid, aula_id uuid, primeiro_acesso timestamptz, conclusao timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
-- Medido num Postgres descartável (PGlite) com 500 pessoas × 100 vídeos: sem
-- isto o planejador estima poucas linhas nos CTEs materializados e encadeia
-- nested loops — passou de 280 s sem terminar. Com hash join: ~0,3 s (6 mil
-- pessoas: ver o resumo da PR). Só vale dentro desta função; o join da regra
-- de contrato/cargo (condição com OR) continua em nested loop, que é o único
-- possível para ele.
SET enable_nestloop = off
AS $fn$
  WITH
  lim AS (SELECT ((_data + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo') AS fim),
  -- Vídeos que já existiam e estavam liberados em D.
  aulas AS (
    SELECT au.id AS aula_id, mo.curso_id
      FROM public."TRN_AULA" au
      JOIN public."TRN_MODULO" mo ON mo.id = au.modulo_id
      JOIN public."TRN_CURSO" c ON c.id = mo.curso_id
      CROSS JOIN lim
     WHERE au.publicada AND c.publicado
       AND (au.tipo_conteudo = 'video'
            OR public.trn_aula_video_obrigatorio(au.video_url, au.video_path, au.tipo_conteudo))
       AND au.created_at < lim.fim
       AND (c.liberar_em IS NULL OR c.liberar_em <= _data)
       AND (au.liberar_em IS NULL OR au.liberar_em <= _data)
       AND (_curso IS NULL OR mo.curso_id = _curso)
       AND (_aula IS NULL OR au.id = _aula)
  ),
  cursos AS (SELECT DISTINCT curso_id FROM aulas),
  -- Colaboradores ativos e já admitidos em D (um aluno por linha da EMPREGADOS).
  pessoas AS (
    SELECT a.id AS aluno_id, x.emp, x.cad, a.nome, a.contrato, a.cargo, a.acesso_completo
      FROM public."TRN_ALUNO" a
      JOIN public."EMPREGADOS" e ON e."ID" = a.empregado_id
      CROSS JOIN LATERAL (
        SELECT nullif(regexp_replace(coalesce(e."Empresa"::text, ''), '\D', '', 'g'), '')::int AS emp,
               nullif(regexp_replace(coalesce(e."Cadastro"::text, ''), '\D', '', 'g'), '')::bigint AS cad,
               public.data_universal(e."Admissão"::text) AS adm,
               (e."Situação" = 'Demitido') AS demitido,
               CASE WHEN e."Situação" = 'Demitido' THEN public.data_universal(e."Data Afastamento"::text) END AS dem
      ) x
     WHERE x.emp IS NOT NULL AND x.cad IS NOT NULL
       AND x.adm IS NOT NULL AND x.adm <= _data
       AND NOT (x.demitido AND (x.dem IS NULL OR x.dem <= _data))
       AND (_empresa IS NULL OR x.emp = _empresa)
       AND (nullif(btrim(coalesce(_contrato, '')), '') IS NULL OR upper(btrim(a.contrato)) = upper(btrim(_contrato)))
       AND (nullif(btrim(coalesce(_cargo, '')), '') IS NULL OR upper(btrim(a.cargo)) = upper(btrim(_cargo)))
  ),
  -- Primeiro contato com o vídeo até D (o menor dos registros — ver cabeçalho).
  acesso AS (
    SELECT t.aluno_id, t.aula_id, min(t.em) AS primeiro
      FROM (
        SELECT v.aluno_id, v.aula_id, v.primeira_em AS em
          FROM public."TRN_AULA_VISUALIZACAO" v
          JOIN aulas au ON au.aula_id = v.aula_id
          JOIN pessoas p ON p.aluno_id = v.aluno_id
        UNION ALL
        SELECT pr.aluno_id, pr.aula_id, least(pr.updated_at, pr.concluida_em, pr.video_assistido_em)
          FROM public."TRN_PROGRESSO" pr
          JOIN aulas au ON au.aula_id = pr.aula_id
          JOIN pessoas p ON p.aluno_id = pr.aluno_id
      ) t, lim
     WHERE t.em < lim.fim
     GROUP BY t.aluno_id, t.aula_id
  ),
  -- Assistiu até o fim / concluiu até D.
  concl AS (
    SELECT pr.aluno_id, pr.aula_id,
           least(pr.video_assistido_em, CASE WHEN pr.concluida THEN pr.concluida_em END) AS em
      FROM public."TRN_PROGRESSO" pr
      JOIN aulas au ON au.aula_id = pr.aula_id
      JOIN pessoas p ON p.aluno_id = pr.aluno_id
      CROSS JOIN lim
     WHERE least(pr.video_assistido_em, CASE WHEN pr.concluida THEN pr.concluida_em END) < lim.fim
  ),
  -- Público de cada curso em D.
  publico AS (
    SELECT p.aluno_id, c.curso_id
      FROM pessoas p CROSS JOIN cursos c JOIN public."TRN_CURSO" cu ON cu.id = c.curso_id
     WHERE p.acesso_completo OR cu.liberado_para_todos
    UNION
    SELECT m.aluno_id, m.curso_id
      FROM public."TRN_MATRICULA" m
      JOIN pessoas p ON p.aluno_id = m.aluno_id
      JOIN cursos c ON c.curso_id = m.curso_id
     WHERE m.inscrito_em <= _data
    UNION
    SELECT p.aluno_id, l.curso_id
      FROM public."TRN_CURSO_LIBERACAO" l
      JOIN cursos c ON c.curso_id = l.curso_id
      CROSS JOIN lim
      JOIN pessoas p
        ON (nullif(btrim(l.contrato), '') IS NULL OR upper(btrim(l.contrato)) = upper(btrim(p.contrato)))
       AND (nullif(btrim(l.cargo), '') IS NULL OR upper(btrim(l.cargo)) = upper(btrim(p.cargo)))
     WHERE l.created_at < lim.fim
    UNION
    SELECT ac.aluno_id, au.curso_id FROM acesso ac JOIN aulas au ON au.aula_id = ac.aula_id
  )
  SELECT p.emp || '-' || p.cad, p.emp, p.cad, max(p.nome), max(p.contrato), max(p.cargo),
         au.curso_id, au.aula_id, min(ac.primeiro), min(co.em)
    FROM publico pu
    JOIN pessoas p ON p.aluno_id = pu.aluno_id
    JOIN aulas au ON au.curso_id = pu.curso_id
    LEFT JOIN acesso ac ON ac.aluno_id = pu.aluno_id AND ac.aula_id = au.aula_id
    LEFT JOIN concl co ON co.aluno_id = pu.aluno_id AND co.aula_id = au.aula_id
   GROUP BY p.emp, p.cad, au.curso_id, au.aula_id;
$fn$;
REVOKE ALL ON FUNCTION public.trn_participacao_base(date, uuid, uuid, integer, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trn_participacao_sigla(_empresa integer)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  -- Mesmo mapa de src/lib/rh/colaboradoresUtils.ts (EMPRESA_MAP).
  SELECT CASE _empresa WHEN 1 THEN 'HAGG' WHEN 2 THEN 'SN' WHEN 5 THEN 'NH' WHEN 3 THEN 'CANAÃ'
                       ELSE 'Empresa ' || _empresa END;
$fn$;
GRANT EXECUTE ON FUNCTION public.trn_participacao_sigla(integer) TO authenticated;

-- ── 3) Resumo: por vídeo, por treinamento e totais ───────────────────────
CREATE OR REPLACE FUNCTION public.trn_participacao_resumo(
  _data date DEFAULT NULL, _curso uuid DEFAULT NULL, _aula uuid DEFAULT NULL,
  _empresa integer DEFAULT NULL, _contrato text DEFAULT NULL, _cargo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  d    date := least(coalesce(_data, hoje), hoje);
  r    jsonb;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'treinamentos_dashboard', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para o Dashboard de Treinamentos.' USING ERRCODE = '42501';
  END IF;

  WITH b AS MATERIALIZED (SELECT * FROM public.trn_participacao_base(d, _curso, _aula, _empresa, _contrato, _cargo)),
  pc AS (  -- pessoa × treinamento
    SELECT pessoa, curso_id, count(*) AS videos,
           count(primeiro_acesso) AS acessados, count(conclusao) AS concluidos
      FROM b GROUP BY pessoa, curso_id
  ),
  pp AS (  -- pessoa no recorte inteiro
    SELECT pessoa, count(*) AS videos, count(primeiro_acesso) AS acessados, count(conclusao) AS concluidos
      FROM b GROUP BY pessoa
  )
  SELECT jsonb_build_object(
    'data', d,
    'totais', (SELECT jsonb_build_object(
                 'pessoas', count(*),
                 'acessaram', count(*) FILTER (WHERE acessados > 0),
                 'concluiram_tudo', count(*) FILTER (WHERE concluidos = videos),
                 'em_andamento', count(*) FILTER (WHERE acessados > 0 AND concluidos < videos),
                 'nao_acessaram', count(*) FILTER (WHERE acessados = 0),
                 'videos', (SELECT count(DISTINCT aula_id) FROM b),
                 'treinamentos', (SELECT count(DISTINCT curso_id) FROM b))
               FROM pp),
    'por_video', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'aula_id', v.aula_id, 'aula', au.nome, 'curso_id', v.curso_id, 'curso', cu.nome,
                    'publico', v.publico, 'acessaram', v.acessaram, 'concluiram', v.concluiram,
                    'acessaram_nao_concluiram', v.acessaram - v.concluiram,
                    'nao_acessaram', v.publico - v.acessaram)
                    ORDER BY cu.nome, mo.posicao, au.posicao, au.nome), '[]'::jsonb)
                    FROM (SELECT aula_id, curso_id, count(*) publico, count(primeiro_acesso) acessaram,
                                 count(conclusao) concluiram
                            FROM b GROUP BY aula_id, curso_id) v
                    JOIN public."TRN_AULA" au ON au.id = v.aula_id
                    JOIN public."TRN_MODULO" mo ON mo.id = au.modulo_id
                    JOIN public."TRN_CURSO" cu ON cu.id = v.curso_id),
    'por_treinamento', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'curso_id', t.curso_id, 'curso', cu.nome, 'videos', t.videos,
                    'publico', t.publico, 'acessaram', t.acessaram, 'concluiram', t.concluiram,
                    'acessaram_nao_concluiram', t.acessaram - t.concluiram,
                    'nao_acessaram', t.publico - t.acessaram) ORDER BY cu.nome), '[]'::jsonb)
                    FROM (SELECT curso_id, max(videos) videos, count(*) publico,
                                 count(*) FILTER (WHERE acessados > 0) acessaram,
                                 count(*) FILTER (WHERE concluidos = videos) concluiram
                            FROM pc GROUP BY curso_id) t
                    JOIN public."TRN_CURSO" cu ON cu.id = t.curso_id),
    -- Opções dos filtros: tudo o que existe no cadastro dos alunos (a lista
    -- não encolhe conforme o próprio filtro — dá para trocar de contrato).
    'opcoes', jsonb_build_object(
      'contratos', (SELECT coalesce(jsonb_agg(c ORDER BY c), '[]'::jsonb)
                      FROM (SELECT DISTINCT btrim(contrato) c FROM public."TRN_ALUNO"
                             WHERE empregado_id IS NOT NULL AND nullif(btrim(contrato), '') IS NOT NULL) x),
      'cargos', (SELECT coalesce(jsonb_agg(c ORDER BY c), '[]'::jsonb)
                   FROM (SELECT DISTINCT btrim(cargo) c FROM public."TRN_ALUNO"
                          WHERE empregado_id IS NOT NULL AND nullif(btrim(cargo), '') IS NOT NULL) x),
      'videos', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', au.id, 'nome', au.nome, 'curso_id', mo.curso_id)
                                           ORDER BY mo.posicao, au.posicao, au.nome), '[]'::jsonb)
                   FROM public."TRN_AULA" au JOIN public."TRN_MODULO" mo ON mo.id = au.modulo_id
                   JOIN public."TRN_CURSO" c ON c.id = mo.curso_id
                  WHERE au.publicada AND c.publicado
                    AND (au.tipo_conteudo = 'video'
                         OR public.trn_aula_video_obrigatorio(au.video_url, au.video_path, au.tipo_conteudo))))
  ) INTO r;
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.trn_participacao_resumo(date, uuid, uuid, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_participacao_resumo(date, uuid, uuid, integer, text, text) TO authenticated;

-- ── 4) Relatório individual (pessoa × treinamento, ou × vídeo) ───────────
CREATE OR REPLACE FUNCTION public.trn_participacao_individual(
  _data date DEFAULT NULL, _curso uuid DEFAULT NULL, _aula uuid DEFAULT NULL,
  _empresa integer DEFAULT NULL, _contrato text DEFAULT NULL, _cargo text DEFAULT NULL,
  _situacao text DEFAULT NULL, _busca text DEFAULT NULL,
  _limite integer DEFAULT 100, _offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  hoje  date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  d     date := least(coalesce(_data, hoje), hoje);
  busca text := nullif(btrim(coalesce(_busca, '')), '');
  lim   int  := least(greatest(coalesce(_limite, 100), 1), 50000);
  r     jsonb;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'treinamentos_dashboard', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para o Dashboard de Treinamentos.' USING ERRCODE = '42501';
  END IF;
  IF _situacao IS NOT NULL AND _situacao NOT IN ('nao_iniciado', 'em_andamento', 'concluido') THEN
    RAISE EXCEPTION 'Situação inválida: %', _situacao;
  END IF;

  WITH b AS MATERIALIZED (SELECT * FROM public.trn_participacao_base(d, _curso, _aula, _empresa, _contrato, _cargo)),
  linhas AS (
    SELECT g.*,
           CASE WHEN g.concluidos = g.videos THEN 'concluido'
                WHEN g.acessados > 0 THEN 'em_andamento'
                ELSE 'nao_iniciado' END AS situacao
      FROM (SELECT b.pessoa, b.empresa, b.cadastro, max(b.nome) nome, max(b.contrato) contrato, max(b.cargo) cargo,
                   b.curso_id, count(*) videos, count(b.primeiro_acesso) acessados, count(b.conclusao) concluidos,
                   min(b.primeiro_acesso) primeiro_acesso,
                   CASE WHEN count(b.conclusao) = count(*) THEN max(b.conclusao) END conclusao
              FROM b GROUP BY b.pessoa, b.empresa, b.cadastro, b.curso_id) g
  ),
  filtradas AS (
    SELECT l.*, cu.nome AS curso
      FROM linhas l JOIN public."TRN_CURSO" cu ON cu.id = l.curso_id
     WHERE (_situacao IS NULL OR l.situacao = _situacao)
       AND (busca IS NULL OR l.nome ILIKE '%' || busca || '%' OR l.cadastro::text = busca)
  )
  SELECT jsonb_build_object(
    'data', d,
    'total', (SELECT count(*) FROM filtradas),
    'linhas', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'pessoa', f.pessoa, 'empresa', public.trn_participacao_sigla(f.empresa), 'cadastro', f.cadastro,
                 'nome', f.nome, 'contrato', f.contrato, 'cargo', f.cargo,
                 'curso_id', f.curso_id, 'curso', f.curso,
                 'videos', f.videos, 'acessados', f.acessados, 'concluidos', f.concluidos,
                 'primeiro_acesso', f.primeiro_acesso, 'conclusao', f.conclusao, 'situacao', f.situacao)
                 ORDER BY f.nome, f.empresa, f.cadastro, f.curso), '[]'::jsonb)
                 FROM (SELECT * FROM filtradas ORDER BY nome, empresa, cadastro, curso
                        LIMIT lim OFFSET greatest(coalesce(_offset, 0), 0)) f)
  ) INTO r;
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.trn_participacao_individual(date, uuid, uuid, integer, text, text, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_participacao_individual(date, uuid, uuid, integer, text, text, text, text, integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.trn_participacao_individual(date, uuid, uuid, integer, text, text, text, text, integer, integer);
-- DROP FUNCTION IF EXISTS public.trn_participacao_resumo(date, uuid, uuid, integer, text, text);
-- DROP FUNCTION IF EXISTS public.trn_participacao_sigla(integer);
-- DROP FUNCTION IF EXISTS public.trn_participacao_base(date, uuid, uuid, integer, text, text);
-- DROP TRIGGER IF EXISTS trg_trn_progresso_video_assistido_em ON public."TRN_PROGRESSO";
-- DROP FUNCTION IF EXISTS public.trn_progresso_video_assistido_em();
-- DROP INDEX IF EXISTS public.idx_trn_progresso_aluno;
-- DROP INDEX IF EXISTS public.idx_trn_aula_visualizacao_aluno;
-- ALTER TABLE public."TRN_PROGRESSO" DROP COLUMN IF EXISTS video_assistido_em;
-- NOTIFY pgrst, 'reload schema';
