-- =========================================================================
-- Treinamentos: quem vê cada curso — por contrato, por cargo, por pessoa
-- ou todo mundo. Publicar deixa de liberar para todos.
--
-- Pedido do Pablo (24/09/2026): "quando o curso tá publicado ele não pode
-- obrigatoriamente liberar pra todos por padrão, por que é destinado a
-- pessoas e contratos específicos". Exemplo dado: marco o contrato X no
-- curso; quem for admitido depois naquele contrato já vê o curso, sem
-- selecionar a pessoa de novo. Idem para cargo inteiro.
--
-- Por que liberava para todos: a sincronização com o EMPREGADOS criava todo
-- aluno com acesso_completo = true (mig 193: "a trilha de NRs é de todos"),
-- e acesso_completo abre TODO curso publicado. Os 13.355 alunos estavam
-- assim — o NR-23 aparecia com "13355 alunos".
--
-- O que muda:
--   1) "TRN_CURSO_LIBERACAO" (curso, contrato?, cargo?): regra DINÂMICA.
--      Só contrato = o contrato inteiro; só cargo = o cargo inteiro; os
--      dois = aquele cargo naquele contrato. Casa com TRN_ALUNO.contrato/
--      cargo, que a sincronização mantém atualizados — admitido amanhã
--      no contrato já entra; transferido sai.
--   2) TRN_CURSO.liberado_para_todos (default false): o "todo mundo"
--      explícito, marcado no curso.
--   3) Pessoa específica continua sendo a matrícula (TRN_MATRICULA).
--   4) acesso_completo volta a ser exceção individual: todos os alunos
--      passam para false e a sincronização cria novos com false. Seguro:
--      nenhum aluno tinha progresso nem certificado (conferido: 0 e 0).
--   5) col_cursos / col_trn_exige_curso (portal) e trn_cursos_lista
--      (contagem "N alunos") usam a mesma regra: matrícula OU acesso
--      completo OU liberado_para_todos OU regra de contrato/cargo.
--   6) RPCs para a tela do curso: trn_curso_publico (regras + alcance),
--      trn_liberacao_opcoes (contratos/cargos de quem está Trabalhando) e
--      trn_alunos_do_curso (filtro por curso na lista de alunos).
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── 1) Estrutura ─────────────────────────────────────────────────────────
ALTER TABLE public."TRN_CURSO" ADD COLUMN IF NOT EXISTS liberado_para_todos boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public."TRN_CURSO_LIBERACAO" (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curso_id   uuid NOT NULL REFERENCES public."TRN_CURSO"(id) ON DELETE CASCADE,
  contrato   text,
  cargo      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  CONSTRAINT trn_curso_liberacao_algum CHECK (nullif(btrim(contrato), '') IS NOT NULL OR nullif(btrim(cargo), '') IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trn_curso_liberacao
  ON public."TRN_CURSO_LIBERACAO"(curso_id, upper(btrim(coalesce(contrato, ''))), upper(btrim(coalesce(cargo, ''))));
CREATE INDEX IF NOT EXISTS idx_trn_aluno_contrato_up ON public."TRN_ALUNO"(upper(btrim(contrato)));
CREATE INDEX IF NOT EXISTS idx_trn_aluno_cargo_up ON public."TRN_ALUNO"(upper(btrim(cargo)));

-- Mesmas policies do resto do módulo: ler = qualquer porta; gravar = Cursos.
SELECT public.trn_rls('TRN_CURSO_LIBERACAO', 'treinamentos_cursos');

-- ── 2) A regra ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trn_regra_libera(_curso uuid, _contrato text, _cargo text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public."TRN_CURSO_LIBERACAO" l
     WHERE l.curso_id = _curso
       AND (nullif(btrim(l.contrato), '') IS NULL OR upper(btrim(l.contrato)) = upper(btrim(_contrato)))
       AND (nullif(btrim(l.cargo), '') IS NULL OR upper(btrim(l.cargo)) = upper(btrim(_cargo))));
$fn$;

-- "N alunos" do curso: matriculados + ativos que veem por regra/todos/completo.
CREATE OR REPLACE FUNCTION public.trn_curso_alcance(_curso uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT count(*)::int
    FROM public."TRN_ALUNO" a
    JOIN public."TRN_CURSO" c ON c.id = _curso
   WHERE EXISTS (SELECT 1 FROM public."TRN_MATRICULA" m WHERE m.curso_id = c.id AND m.aluno_id = a.id)
      OR (a.status = 'ativo' AND (a.acesso_completo OR c.liberado_para_todos
                                  OR public.trn_regra_libera(c.id, a.contrato, a.cargo)));
$fn$;

REVOKE ALL ON FUNCTION public.trn_regra_libera(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trn_curso_alcance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_regra_libera(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.trn_curso_alcance(uuid) TO authenticated, service_role;

-- ── 3) acesso_completo volta a ser exceção ───────────────────────────────
UPDATE public."TRN_ALUNO" SET acesso_completo = false WHERE acesso_completo;

CREATE OR REPLACE FUNCTION public.trn_sync_aluno_do_empregado(_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  e          record;
  v_email    text;
  v_status   text;
  v_aluno    uuid;
BEGIN
  SELECT "ID", btrim("Nome") AS nome, regexp_replace(coalesce("CPF", ''), '\D', '', 'g') AS cpf,
         lower(btrim(coalesce(email, ''))) AS email_cad, nullif(btrim(coalesce(telefone, '')), '') AS telefone,
         "Situação" AS situacao,
         btrim(coalesce("Nome Filial", "Descrição do Local", '')) AS contrato,
         btrim(coalesce("Título do Cargo", '')) AS cargo
    INTO e
    FROM public."EMPREGADOS" WHERE "ID" = _id;
  IF e."ID" IS NULL OR e.nome IS NULL OR e.nome = '' THEN RETURN; END IF;

  v_status := CASE WHEN e.situacao = 'Trabalhando' THEN 'ativo' ELSE 'inativo' END;
  SELECT id INTO v_aluno FROM public."TRN_ALUNO" WHERE empregado_id = _id;

  -- E-mail do cadastro, se válido e livre; senão o sintético (estável por ID).
  v_email := CASE
    WHEN e.email_cad ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     AND NOT EXISTS (SELECT 1 FROM public."TRN_ALUNO" a WHERE lower(btrim(a.email)) = e.email_cad AND a.empregado_id IS DISTINCT FROM _id)
      THEN e.email_cad
    ELSE _id::text || '@colaborador.nascimento.local'
  END;

  IF v_aluno IS NULL THEN
    INSERT INTO public."TRN_ALUNO"(nome, email, telefone, documento, status, acesso_completo, empregado_id, origem,
                                   situacao, contrato, cargo, sincronizado_em)
    VALUES (e.nome, v_email, e.telefone, nullif(e.cpf, ''), v_status, false, _id, 'integracao',
            e.situacao, nullif(e.contrato, ''), nullif(e.cargo, ''), now());
  ELSE
    UPDATE public."TRN_ALUNO"
       SET nome = e.nome,
           email = v_email,
           telefone = coalesce(e.telefone, telefone),
           documento = coalesce(nullif(e.cpf, ''), documento),
           -- Bloqueio é decisão de alguém: não é desfeito pelo cadastro.
           status = CASE WHEN status = 'bloqueado' THEN 'bloqueado' ELSE v_status END,
           situacao = e.situacao, contrato = nullif(e.contrato, ''), cargo = nullif(e.cargo, ''),
           sincronizado_em = now(), updated_at = now()
     WHERE id = v_aluno
       AND (nome IS DISTINCT FROM e.nome OR email IS DISTINCT FROM v_email
            OR (e.telefone IS NOT NULL AND telefone IS DISTINCT FROM e.telefone)
            OR situacao IS DISTINCT FROM e.situacao OR contrato IS DISTINCT FROM nullif(e.contrato, '')
            OR cargo IS DISTINCT FROM nullif(e.cargo, '')
            OR (status <> 'bloqueado' AND status IS DISTINCT FROM v_status));
  END IF;
END $function$;

-- ── 4) Portal e contagem usam a regra ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.col_cursos(p_emp bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_aluno uuid; a record; v_hoje date := public.col_hoje(); v_cursos jsonb; v_avisos jsonb; v_notif jsonb; v_ev jsonb; v_expirado boolean;
BEGIN
  v_aluno := public.col_trn_aluno(p_emp);
  IF v_aluno IS NULL THEN
    RETURN jsonb_build_object('aluno', NULL, 'cursos', '[]'::jsonb, 'avisos', '[]'::jsonb, 'notificacoes', '[]'::jsonb, 'eventos', '[]'::jsonb);
  END IF;
  SELECT * INTO a FROM public."TRN_ALUNO" WHERE id = v_aluno;
  v_expirado := a.expira_em IS NOT NULL AND a.expira_em < v_hoje;

  WITH meus AS (
    SELECT c.*, m.inscrito_em
      FROM public."TRN_CURSO" c
      LEFT JOIN public."TRN_MATRICULA" m ON m.curso_id = c.id AND m.aluno_id = v_aluno
     WHERE c.publicado AND (m.id IS NOT NULL OR a.acesso_completo OR c.liberado_para_todos
                            OR public.trn_regra_libera(c.id, a.contrato, a.cargo))
  ), aulas AS (
    SELECT mo.curso_id, count(au.id) total,
           count(p.id) FILTER (WHERE p.concluida) concluidas
      FROM public."TRN_MODULO" mo
      JOIN public."TRN_AULA" au ON au.modulo_id = mo.id AND au.publicada
      LEFT JOIN public."TRN_PROGRESSO" p ON p.aula_id = au.id AND p.aluno_id = v_aluno
     GROUP BY mo.curso_id)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'nome', c.nome, 'descricao', c.descricao, 'capa_path', c.capa_path, 'capa_formato', c.capa_formato,
           'categoria', cat.nome, 'carga_horaria_min', c.carga_horaria_min, 'em_breve', c.em_breve,
           'inscrito_em', c.inscrito_em,
           'aulas', coalesce(au.total, 0), 'concluidas', coalesce(au.concluidas, 0),
           'pct', CASE WHEN coalesce(au.total,0) = 0 THEN 0 ELSE round(100.0 * coalesce(au.concluidas,0) / au.total) END,
           'certificado', ce.codigo_validacao,
           'libera_em', greatest(c.liberar_em, CASE WHEN c.inscrito_em IS NOT NULL THEN c.inscrito_em + c.liberar_dias END),
           'expira_em', CASE WHEN c.prazo_acesso_dias IS NOT NULL AND c.inscrito_em IS NOT NULL THEN c.inscrito_em + c.prazo_acesso_dias END,
           'bloqueado', a.status = 'bloqueado' OR v_expirado OR c.em_breve
                        OR coalesce(greatest(c.liberar_em, CASE WHEN c.inscrito_em IS NOT NULL THEN c.inscrito_em + c.liberar_dias END) > v_hoje, false)
                        OR (c.prazo_acesso_dias IS NOT NULL AND c.inscrito_em IS NOT NULL AND c.inscrito_em + c.prazo_acesso_dias < v_hoje)
         ) ORDER BY coalesce(c.ordem_vitrine, 9999), c.nome), '[]'::jsonb)
    INTO v_cursos
    FROM meus c
    LEFT JOIN public."TRN_CATEGORIA" cat ON cat.id = c.categoria_id
    LEFT JOIN aulas au ON au.curso_id = c.id
    LEFT JOIN public."TRN_CERTIFICADO" ce ON ce.curso_id = c.id AND ce.aluno_id = v_aluno;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id, 'titulo', v.titulo, 'url', v.url, 'tipo', v.tipo_conteudo, 'mensagem', v.mensagem,
           'imagem_path', v.imagem_path, 'video_url', v.video_url, 'criado_em', v.created_at) ORDER BY v.created_at DESC), '[]'::jsonb)
    INTO v_avisos
    FROM public."TRN_AVISO" v
   WHERE v.publicado AND (v.inicio_em IS NULL OR v.inicio_em <= v_hoje) AND (v.fim_em IS NULL OR v.fim_em >= v_hoje)
     AND public.col_trn_publico_ok(v.publico, ARRAY(SELECT tag_id FROM public."TRN_AVISO_TAG" WHERE aviso_id = v.id), v_aluno);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'titulo', x.titulo, 'mensagem', x.mensagem, 'url', x.url,
           'enviada_em', x.enviada_em, 'lida', x.lida_em IS NOT NULL) ORDER BY x.enviada_em DESC), '[]'::jsonb)
    INTO v_notif
    FROM (SELECT n.id, n.titulo, n.mensagem, n.url, n.enviada_em, na.lida_em
            FROM public."TRN_NOTIFICACAO_ALUNO" na
            JOIN public."TRN_NOTIFICACAO" n ON n.id = na.notificacao_id
           WHERE na.aluno_id = v_aluno
           ORDER BY n.enviada_em DESC LIMIT 30) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', ev.id, 'titulo', ev.titulo, 'descricao', ev.descricao, 'inicio_em', ev.inicio_em, 'fim_em', ev.fim_em,
           'dia_inteiro', ev.dia_inteiro, 'local', ev.local, 'url', ev.url, 'cor', ev.cor) ORDER BY ev.inicio_em), '[]'::jsonb)
    INTO v_ev
    FROM public."TRN_EVENTO" ev
   WHERE ev.inicio_em >= v_hoje::timestamptz - interval '1 day' AND ev.inicio_em < v_hoje::timestamptz + interval '60 days'
     AND public.col_trn_publico_ok(ev.publico, ARRAY(SELECT tag_id FROM public."TRN_EVENTO_TAG" WHERE evento_id = ev.id), v_aluno);

  RETURN jsonb_build_object(
    'aluno', jsonb_build_object('id', a.id, 'nome', a.nome, 'status', a.status, 'expira_em', a.expira_em,
                                'acesso_completo', a.acesso_completo, 'expirado', v_expirado),
    'cursos', v_cursos, 'avisos', v_avisos, 'notificacoes', v_notif, 'eventos', v_ev);
END $function$;

CREATE OR REPLACE FUNCTION public.col_trn_exige_curso(p_aluno uuid, p_curso uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE a record; c record; v_insc date; v_hoje date := public.col_hoje(); v_lib date;
BEGIN
  SELECT * INTO a FROM public."TRN_ALUNO" WHERE id = p_aluno;
  SELECT * INTO c FROM public."TRN_CURSO" WHERE id = p_curso AND publicado;
  IF NOT FOUND THEN RAISE EXCEPTION 'Curso não encontrado.'; END IF;
  IF a.status = 'bloqueado' THEN RAISE EXCEPTION 'Seu acesso aos treinamentos está bloqueado. Procure o RH.'; END IF;
  IF a.expira_em IS NOT NULL AND a.expira_em < v_hoje THEN RAISE EXCEPTION 'Seu acesso aos treinamentos expirou em %.', to_char(a.expira_em, 'DD/MM/YYYY'); END IF;
  SELECT inscrito_em INTO v_insc FROM public."TRN_MATRICULA" WHERE aluno_id = p_aluno AND curso_id = p_curso;
  IF v_insc IS NULL AND NOT a.acesso_completo AND NOT c.liberado_para_todos
     AND NOT public.trn_regra_libera(p_curso, a.contrato, a.cargo) THEN
    RAISE EXCEPTION 'Este curso não está liberado para você.';
  END IF;
  IF c.em_breve THEN RAISE EXCEPTION 'Este curso ainda não foi liberado.'; END IF;
  v_lib := greatest(c.liberar_em, CASE WHEN v_insc IS NOT NULL THEN v_insc + c.liberar_dias END);
  IF v_lib > v_hoje THEN RAISE EXCEPTION 'Este curso será liberado em %.', to_char(v_lib, 'DD/MM/YYYY'); END IF;
  IF c.prazo_acesso_dias IS NOT NULL AND v_insc IS NOT NULL AND v_insc + c.prazo_acesso_dias < v_hoje THEN
    RAISE EXCEPTION 'O prazo de acesso a este curso terminou em %.', to_char(v_insc + c.prazo_acesso_dias, 'DD/MM/YYYY');
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.trn_cursos_lista()
 RETURNS TABLE(id uuid, nome text, descricao text, slug text, capa_path text, categoria_id uuid, categoria text, publicado boolean, em_breve boolean, comentarios_habilitados boolean, modulos_como_cursos boolean, ordem_vitrine integer, created_at timestamp with time zone, alunos integer, modulos integer, aulas integer, avaliacao numeric, avaliacoes integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT c.id, c.nome, c.descricao, c.slug, c.capa_path, c.categoria_id, cat.nome,
         c.publicado, c.em_breve, c.comentarios_habilitados, c.modulos_como_cursos, c.ordem_vitrine, c.created_at,
         public.trn_curso_alcance(c.id),
         (SELECT count(*)::int FROM public."TRN_MODULO" mo WHERE mo.curso_id = c.id),
         (SELECT count(*)::int FROM public."TRN_AULA" au JOIN public."TRN_MODULO" mo ON mo.id = au.modulo_id WHERE mo.curso_id = c.id),
         (SELECT round(avg(p.avaliacao)::numeric,1) FROM public."TRN_PROGRESSO" p JOIN public."TRN_AULA" au ON au.id = p.aula_id JOIN public."TRN_MODULO" mo ON mo.id = au.modulo_id WHERE mo.curso_id = c.id AND p.avaliacao IS NOT NULL),
         (SELECT count(*)::int FROM public."TRN_PROGRESSO" p JOIN public."TRN_AULA" au ON au.id = p.aula_id JOIN public."TRN_MODULO" mo ON mo.id = au.modulo_id WHERE mo.curso_id = c.id AND p.avaliacao IS NOT NULL)
    FROM public."TRN_CURSO" c LEFT JOIN public."TRN_CATEGORIA" cat ON cat.id = c.categoria_id
   WHERE public.trn_ve_modulo()
   ORDER BY coalesce(c.ordem_vitrine, 9999), c.created_at DESC;
$function$;

-- ── 5) RPCs da tela "Quem vê este curso" ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.trn_curso_publico(_curso uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT public.trn_acesso('treinamentos_cursos') THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'liberado_para_todos', (SELECT liberado_para_todos FROM public."TRN_CURSO" WHERE id = _curso),
    'regras', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'id', l.id, 'contrato', l.contrato, 'cargo', l.cargo,
                  'ativos', (SELECT count(*) FROM public."TRN_ALUNO" a
                              WHERE a.status = 'ativo'
                                AND (nullif(btrim(l.contrato), '') IS NULL OR upper(btrim(l.contrato)) = upper(btrim(a.contrato)))
                                AND (nullif(btrim(l.cargo), '') IS NULL OR upper(btrim(l.cargo)) = upper(btrim(a.cargo))))
                ) ORDER BY l.contrato NULLS LAST, l.cargo NULLS LAST), '[]'::jsonb)
                 FROM public."TRN_CURSO_LIBERACAO" l WHERE l.curso_id = _curso),
    'individuais', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'matricula_id', m.id, 'aluno_id', a.id, 'nome', a.nome, 'contrato', a.contrato, 'cargo', a.cargo,
                  'status', a.status, 'inscrito_em', m.inscrito_em) ORDER BY a.nome), '[]'::jsonb)
                 FROM public."TRN_MATRICULA" m JOIN public."TRN_ALUNO" a ON a.id = m.aluno_id WHERE m.curso_id = _curso),
    'alcance', public.trn_curso_alcance(_curso));
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
  -- Só quem está Trabalhando: contrato/cargo de quem saiu não é de ninguém hoje.
  RETURN jsonb_build_object(
    'contratos', (SELECT coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'ativos', n) ORDER BY nome), '[]'::jsonb)
                    FROM (SELECT contrato nome, count(*) n FROM public."TRN_ALUNO"
                           WHERE status = 'ativo' AND nullif(btrim(contrato), '') IS NOT NULL GROUP BY 1) x),
    'cargos', (SELECT coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'ativos', n) ORDER BY nome), '[]'::jsonb)
                 FROM (SELECT cargo nome, count(*) n FROM public."TRN_ALUNO"
                        WHERE status = 'ativo' AND nullif(btrim(cargo), '') IS NOT NULL GROUP BY 1) y));
END $fn$;

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
     WHERE EXISTS (SELECT 1 FROM public."TRN_MATRICULA" m WHERE m.curso_id = c.id AND m.aluno_id = a.id)
        OR (c.publicado AND (a.acesso_completo OR c.liberado_para_todos OR public.trn_regra_libera(c.id, a.contrato, a.cargo))));
END $fn$;

REVOKE ALL ON FUNCTION public.trn_curso_publico(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trn_liberacao_opcoes() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trn_alunos_do_curso(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_curso_publico(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.trn_liberacao_opcoes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trn_alunos_do_curso(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- UPDATE public."TRN_ALUNO" SET acesso_completo = true;   -- volta "todo mundo vê tudo"
-- Reaplicar trn_sync_aluno_do_empregado (mig 194), col_cursos e
-- col_trn_exige_curso (mig 196) e trn_cursos_lista (mig 190).
-- DROP FUNCTION IF EXISTS public.trn_curso_publico(uuid);
-- DROP FUNCTION IF EXISTS public.trn_liberacao_opcoes();
-- DROP FUNCTION IF EXISTS public.trn_alunos_do_curso(uuid);
-- DROP TABLE IF EXISTS public."TRN_CURSO_LIBERACAO";
-- DROP FUNCTION IF EXISTS public.trn_curso_alcance(uuid);
-- DROP FUNCTION IF EXISTS public.trn_regra_libera(uuid, text, text);
-- ALTER TABLE public."TRN_CURSO" DROP COLUMN IF EXISTS liberado_para_todos;
-- NOTIFY pgrst, 'reload schema';
