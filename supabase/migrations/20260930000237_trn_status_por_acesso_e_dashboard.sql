-- =========================================================================
-- Treinamentos: status do aluno pelo ACESSO, não pela situação na Senior —
-- e o Dashboard com números reais
--
-- PEDIDO DO PABLO (24/09/2026)
--   "Número de alunos tem que ser real, e o número de alunos ativos também.
--   Todos estão como ativos, mas vamos deixar o aluno ativo apenas quando ele
--   fizer o primeiro acesso ... se tiver demitido obviamente vai ser Demitido.
--   Os inativos são os que não entraram ainda e os ativos os que já acessaram."
--
-- O QUE ESTAVA ERRADO
--   · Desde a 20260930000193, status = 'ativo' se a Senior dizia
--     "Trabalhando" e 'inativo' para o resto. "Ativo" media vínculo, não uso:
--     os 2,2 mil colaboradores apareciam ativos sem ninguém ter entrado.
--   · O card "Número de alunos" contava 13.355 — 10,8 mil são demitidos que
--     a sincronização trouxe e ficam só como histórico.
--   · "Cursos com mais alunos matriculados" mostrava o NR-23 com 13.355: a
--     ação em massa de 24/09 matriculou demitidos (a 20260930000235 parou
--     de matricular, mas as linhas antigas ficaram).
--
-- A REGRA NOVA (uma só, no gatilho trn_aluno_normaliza)
--     bloqueado                        → 'bloqueado'  (decisão de alguém; vence tudo)
--     situacao = 'Demitido' na Senior  → 'demitido'
--     primeiro_acesso_em preenchido    → 'ativo'      (já entrou na área do aluno)
--     o resto                          → 'inativo'    (ainda não entrou)
--   Afastado (férias, atestado, licença) segue a regra do acesso: continua
--   podendo entrar, e o vínculo não foi desfeito.
--   Quem escreve status ('ativo' ao desbloquear, 'inativo' na sincronização,
--   'pendente' no cadastro manual) não precisa saber da regra: o gatilho
--   recalcula. 'pendente' deixa de existir — era "ainda não acessou", que
--   agora é 'inativo'.
--
-- O QUE MUDA
--   1. TRN_ALUNO.primeiro_acesso_em (+ carga: histórico "Primeiro acesso",
--      primeiro progresso ou último acesso — o que vier antes).
--   2. trn_aluno_normaliza aplica a regra; CHECK passa a
--      ('ativo','inativo','bloqueado','demitido'). Carga dos 13 mil com o
--      gatilho de histórico DESLIGADO — senão seriam 13 mil linhas
--      "Status alterado" que não aconteceram de verdade.
--   3. trn_aluno_historico_auto: "Primeiro acesso", "Demitido no cadastro",
--      "Readmitido", "Aluno desbloqueado" — no lugar do "Status alterado"
--      genérico. col_trn_aluno deixa de gravar o próprio histórico e de
--      mexer no status (o gatilho faz as duas coisas).
--   4. trn_sync_aluno_do_empregado não compara mais status (é derivado).
--   5. Listas: o "sem os inativos" padrão vira "sem os demitidos"
--      (trn_alunos_lista), e o resumo do Gerenciar conta pela regra nova.
--      trn_alunos_recorte devolve também a situação, porque os recortes por
--      contrato/cargo da ação em massa querem "quem está Trabalhando".
--   6. trn_dashboard reescrita (mesma assinatura, mais campos).
--
-- Idempotente. Aplicar no banco do app (SQL Editor) — não se auto-aplica.
-- =========================================================================

-- ── 1) Primeiro acesso ───────────────────────────────────────────────────
ALTER TABLE public."TRN_ALUNO" ADD COLUMN IF NOT EXISTS primeiro_acesso_em timestamptz;
COMMENT ON COLUMN public."TRN_ALUNO".primeiro_acesso_em IS
  'Primeira vez que o aluno entrou na área de treinamentos (Portal do Colaborador). Preenchido = status ativo.';
CREATE INDEX IF NOT EXISTS idx_trn_aluno_primeiro_acesso ON public."TRN_ALUNO"(primeiro_acesso_em)
  WHERE primeiro_acesso_em IS NOT NULL;

-- ── 2) A regra, no gatilho que já normaliza o aluno ──────────────────────
-- BEFORE: roda antes do CHECK, então quem ainda gravar 'pendente' não quebra.
CREATE OR REPLACE FUNCTION public.trn_aluno_normaliza() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.email := lower(btrim(NEW.email));
  NEW.nome  := btrim(NEW.nome);
  IF NEW.prazo_acesso_dias IS NOT NULL AND NEW.expira_em IS NULL THEN
    NEW.expira_em := (coalesce(NEW.created_at, now()) AT TIME ZONE 'America/Sao_Paulo')::date + NEW.prazo_acesso_dias;
  END IF;

  -- Acesso registrado sem o primeiro? O primeiro é este.
  IF NEW.primeiro_acesso_em IS NULL AND NEW.ultimo_acesso_em IS NOT NULL THEN
    NEW.primeiro_acesso_em := NEW.ultimo_acesso_em;
  END IF;

  NEW.status := CASE
    WHEN NEW.status = 'bloqueado'            THEN 'bloqueado'
    WHEN NEW.situacao = 'Demitido'           THEN 'demitido'
    WHEN NEW.primeiro_acesso_em IS NOT NULL  THEN 'ativo'
    ELSE 'inativo'
  END;
  RETURN NEW;
END $$;

-- Histórico com o que de fato aconteceu.
CREATE OR REPLACE FUNCTION public.trn_aluno_historico_auto() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public."TRN_ALUNO_HISTORICO"(aluno_id, acao, detalhes, autor_nome)
    VALUES (NEW.id, 'Aluno cadastrado', 'Origem: ' || NEW.origem, public.trn_nome_autor());
    RETURN NEW;
  END IF;

  IF OLD.primeiro_acesso_em IS NULL AND NEW.primeiro_acesso_em IS NOT NULL THEN
    INSERT INTO public."TRN_ALUNO_HISTORICO"(aluno_id, acao, detalhes, origem, autor_nome)
    VALUES (NEW.id, 'Primeiro acesso', 'Pelo Portal do Colaborador', 'plataforma', NEW.nome);
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public."TRN_ALUNO_HISTORICO"(aluno_id, acao, detalhes, origem, autor_nome)
    SELECT NEW.id, x.acao, OLD.status || ' → ' || NEW.status, x.origem, x.autor
      FROM (SELECT CASE
                     WHEN NEW.status = 'bloqueado' THEN 'Aluno bloqueado'
                     WHEN OLD.status = 'bloqueado' THEN 'Aluno desbloqueado'
                     WHEN NEW.status = 'demitido'  THEN 'Demitido no cadastro'
                     WHEN OLD.status = 'demitido'  THEN 'Readmitido no cadastro'
                   END AS acao,
                   CASE WHEN NEW.status = 'demitido' OR OLD.status = 'demitido' THEN 'sistema' ELSE 'gestao' END AS origem,
                   CASE WHEN NEW.status = 'demitido' OR OLD.status = 'demitido' THEN 'Cadastro (Senior)'
                        ELSE public.trn_nome_autor() END AS autor) x
     -- inativo → ativo já foi registrado acima como "Primeiro acesso".
     WHERE x.acao IS NOT NULL;
  END IF;
  RETURN NEW;
END $$;

-- ── 2b) Carga: primeiro acesso e status dos alunos que já existem ────────
-- Histórico desligado na carga inteira: o primeiro acesso de quem já entrou
-- já está no histórico (ou nunca foi registrado), e 13 mil "Status alterado"
-- descreveriam uma mudança de regra, não algo que o aluno fez.
ALTER TABLE public."TRN_ALUNO" DISABLE TRIGGER trn_aluno_historico_trg;
-- O CHECK antigo sai ANTES de qualquer UPDATE: o gatilho novo já recalcula
-- o status, e um demitido que tinha acessado viraria 'demitido' contra a
-- lista antiga.
ALTER TABLE public."TRN_ALUNO" DROP CONSTRAINT IF EXISTS "TRN_ALUNO_status_check";

UPDATE public."TRN_ALUNO" a
   SET primeiro_acesso_em = x.primeiro
  FROM (SELECT a2.id,
               least(
                 (SELECT min(h.created_at) FROM public."TRN_ALUNO_HISTORICO" h
                   WHERE h.aluno_id = a2.id AND h.acao = 'Primeiro acesso'),
                 (SELECT min(p.updated_at) FROM public."TRN_PROGRESSO" p WHERE p.aluno_id = a2.id),
                 a2.ultimo_acesso_em) AS primeiro
          FROM public."TRN_ALUNO" a2
         WHERE a2.primeiro_acesso_em IS NULL) x
 WHERE a.id = x.id AND x.primeiro IS NOT NULL;

-- `SET status = status` basta: o gatilho BEFORE recalcula pela regra.
UPDATE public."TRN_ALUNO" SET status = status;
ALTER TABLE public."TRN_ALUNO" ENABLE TRIGGER trn_aluno_historico_trg;

ALTER TABLE public."TRN_ALUNO"
  ADD CONSTRAINT "TRN_ALUNO_status_check" CHECK (status IN ('ativo','inativo','bloqueado','demitido'));
COMMENT ON COLUMN public."TRN_ALUNO".status IS
  'Derivado por trn_aluno_normaliza: bloqueado (decisão) > demitido (Senior) > ativo (já acessou) > inativo (nunca acessou).';

-- ── 3) Portal: registrar o acesso é tudo o que precisa ───────────────────
-- Antes: pendente → ativo + histórico à mão. Agora o gatilho deriva o
-- primeiro acesso, o status e o histórico de `ultimo_acesso_em`.
CREATE OR REPLACE FUNCTION public.col_trn_aluno(p_emp bigint)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e record; a record;
BEGIN
  SELECT x."ID", public.col_digitos(x."CPF") cpf, lower(btrim(x."email")) email INTO e
    FROM public."EMPREGADOS" x WHERE x."ID" = p_emp;
  SELECT * INTO a FROM public."TRN_ALUNO" WHERE empregado_id = p_emp ORDER BY created_at LIMIT 1;
  IF NOT FOUND AND e.cpf <> '' THEN
    SELECT * INTO a FROM public."TRN_ALUNO" WHERE empregado_id IS NULL AND public.col_digitos(documento) = e.cpf ORDER BY created_at LIMIT 1;
  END IF;
  IF NOT FOUND AND coalesce(e.email,'') <> '' THEN
    SELECT * INTO a FROM public."TRN_ALUNO" WHERE empregado_id IS NULL AND email = e.email ORDER BY created_at LIMIT 1;
  END IF;
  IF a.id IS NULL THEN RETURN NULL; END IF;
  UPDATE public."TRN_ALUNO"
     SET empregado_id = coalesce(empregado_id, p_emp),
         ultimo_acesso_em = now()
   WHERE id = a.id;
  RETURN a.id;
END $$;

-- ── 4) Sincronização com a Senior: status é derivado, não comparado ──────
CREATE OR REPLACE FUNCTION public.trn_sync_aluno_do_empregado(_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  e          record;
  v_email    text;
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

  SELECT id INTO v_aluno FROM public."TRN_ALUNO" WHERE empregado_id = _id;

  -- E-mail do cadastro, se válido e livre; senão o sintético (estável por ID).
  v_email := CASE
    WHEN e.email_cad ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     AND NOT EXISTS (SELECT 1 FROM public."TRN_ALUNO" a WHERE lower(btrim(a.email)) = e.email_cad AND a.empregado_id IS DISTINCT FROM _id)
      THEN e.email_cad
    ELSE _id::text || '@colaborador.nascimento.local'
  END;

  IF v_aluno IS NULL THEN
    -- 'inativo' é só o ponto de partida: trn_aluno_normaliza vira
    -- 'demitido' se a Senior disser Demitido.
    INSERT INTO public."TRN_ALUNO"(nome, email, telefone, documento, status, acesso_completo, empregado_id, origem,
                                   situacao, contrato, cargo, sincronizado_em)
    VALUES (e.nome, v_email, e.telefone, nullif(e.cpf, ''), 'inativo', false, _id, 'integracao',
            e.situacao, nullif(e.contrato, ''), nullif(e.cargo, ''), now());
  ELSE
    -- Status fica de fora do SET e do WHERE: ele sai da situação e do
    -- acesso, e o gatilho recalcula quando a situação muda.
    UPDATE public."TRN_ALUNO"
       SET nome = e.nome,
           email = v_email,
           telefone = coalesce(e.telefone, telefone),
           documento = coalesce(nullif(e.cpf, ''), documento),
           situacao = e.situacao, contrato = nullif(e.contrato, ''), cargo = nullif(e.cargo, ''),
           sincronizado_em = now(), updated_at = now()
     WHERE id = v_aluno
       AND (nome IS DISTINCT FROM e.nome OR email IS DISTINCT FROM v_email
            OR (e.telefone IS NOT NULL AND telefone IS DISTINCT FROM e.telefone)
            OR situacao IS DISTINCT FROM e.situacao OR contrato IS DISTINCT FROM nullif(e.contrato, '')
            OR cargo IS DISTINCT FROM nullif(e.cargo, ''));
  END IF;
END $function$;
REVOKE ALL ON FUNCTION public.trn_sync_aluno_do_empregado(bigint) FROM PUBLIC, anon, authenticated;

-- ── 5) Listas ────────────────────────────────────────────────────────────
-- O parâmetro guarda o nome antigo (trocar nome de parâmetro exige DROP e
-- quebraria a tela durante a janela entre migration e deploy), mas agora
-- quer dizer "incluir os DEMITIDOS" — os 10,8 mil que deixavam a lista lenta.
CREATE OR REPLACE FUNCTION public.trn_alunos_lista(_incluir_inativos boolean DEFAULT false)
RETURNS TABLE (
  id uuid, nome text, email text, telefone text, documento text, status text,
  acesso_completo boolean, expira_em date, created_at timestamptz, ultimo_acesso_em timestamptz,
  tags jsonb, tag_ids uuid[], cursos int, aulas_concluidas int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.id, a.nome, a.email, a.telefone, a.documento, a.status,
         a.acesso_completo, a.expira_em, a.created_at, a.ultimo_acesso_em,
         coalesce((SELECT jsonb_agg(t.nome ORDER BY t.nome) FROM public."TRN_ALUNO_TAG" at JOIN public."TRN_TAG" t ON t.id = at.tag_id WHERE at.aluno_id = a.id), '[]'::jsonb),
         coalesce((SELECT array_agg(at.tag_id) FROM public."TRN_ALUNO_TAG" at WHERE at.aluno_id = a.id), '{}'::uuid[]),
         (SELECT count(*)::int FROM public."TRN_MATRICULA" m WHERE m.aluno_id = a.id),
         (SELECT count(*)::int FROM public."TRN_PROGRESSO" p WHERE p.aluno_id = a.id AND p.concluida)
    FROM public."TRN_ALUNO" a
   WHERE public.trn_ve_modulo()
     AND (_incluir_inativos OR a.status <> 'demitido')
   ORDER BY a.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.trn_alunos_lista(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_alunos_lista(boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.trn_alunos_gerenciar_resumo()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT (public.trn_acesso('treinamentos_alunos_novo') OR public.trn_acesso('treinamentos_alunos')) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'ativos',     (SELECT count(*) FROM public."TRN_ALUNO" WHERE status = 'ativo'),
    'inativos',   (SELECT count(*) FROM public."TRN_ALUNO" WHERE status = 'inativo'),
    'afastados',  (SELECT count(*) FROM public."TRN_ALUNO"
                    WHERE status <> 'demitido' AND situacao IS NOT NULL AND situacao <> 'Trabalhando'),
    'demitidos',  (SELECT count(*) FROM public."TRN_ALUNO" WHERE status = 'demitido'),
    'bloqueados', (SELECT count(*) FROM public."TRN_ALUNO" WHERE status = 'bloqueado'),
    -- Só quem não foi demitido: demitido sem e-mail não é pendência de ninguém.
    'sem_email_ativos', (SELECT count(*) FROM public."TRN_ALUNO"
                          WHERE status <> 'demitido' AND email LIKE '%@colaborador.nascimento.local'),
    'ultima_sync', (SELECT max(sincronizado_em) FROM public."TRN_ALUNO"),
    'contratos', (SELECT coalesce(jsonb_agg(jsonb_build_object('nome', contrato, 'n', n, 'ativos', ativos) ORDER BY contrato), '[]'::jsonb)
                    FROM (SELECT contrato, count(*) n, count(*) FILTER (WHERE status = 'ativo') ativos
                            FROM public."TRN_ALUNO" WHERE contrato IS NOT NULL GROUP BY contrato) c),
    'situacoes', (SELECT coalesce(jsonb_agg(DISTINCT situacao ORDER BY situacao), '[]'::jsonb) FROM public."TRN_ALUNO" WHERE situacao IS NOT NULL)
  );
END $fn$;
REVOKE ALL ON FUNCTION public.trn_alunos_gerenciar_resumo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_alunos_gerenciar_resumo() TO authenticated;

CREATE OR REPLACE FUNCTION public.trn_alunos_recorte()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.trn_acesso('treinamentos_alunos', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'contrato', contrato, 'cargo', cargo,
                                                       'status', status, 'situacao', situacao)), '[]'::jsonb)
            FROM public."TRN_ALUNO");
END $fn$;
REVOKE ALL ON FUNCTION public.trn_alunos_recorte() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_alunos_recorte() TO authenticated;

-- ── 6) Dashboard ─────────────────────────────────────────────────────────
-- Base = quem NÃO é demitido (é quem pode entrar). Com curso filtrado, a
-- base é o alcance do curso — a mesma conta de trn_curso_alcance
-- (matrícula, acesso completo, liberado para todos ou regra de
-- contrato/cargo). O período filtra ATIVIDADE (aulas, avaliações,
-- comentários, primeiros acessos, certificados), não o tamanho da base.
CREATE OR REPLACE FUNCTION public.trn_dashboard(_curso uuid DEFAULT NULL, _de date DEFAULT NULL, _ate date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  r   jsonb;
  ano int := extract(year FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int;
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT public.trn_ve_modulo() THEN RAISE EXCEPTION 'Sem acesso ao módulo Treinamentos.'; END IF;

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
END $$;
REVOKE ALL ON FUNCTION public.trn_dashboard(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_dashboard(uuid, date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────────
-- SELECT status, count(*) FROM public."TRN_ALUNO" GROUP BY 1 ORDER BY 1;
--   esperado: demitido ≈ 10,8 mil; ativo = quem já entrou; inativo = o resto.
-- SELECT public.trn_dashboard();

-- =========================================================================
-- ROLLBACK (volta a regra "Trabalhando = ativo")
-- =========================================================================
-- ALTER TABLE public."TRN_ALUNO" DROP CONSTRAINT IF EXISTS "TRN_ALUNO_status_check";
-- Reaplicar trn_aluno_normaliza e trn_aluno_historico_auto da 20260930000190,
--   col_trn_aluno da 20260930000196, trn_sync_aluno_do_empregado da
--   20260930000231, trn_alunos_lista da 20260930000203,
--   trn_alunos_gerenciar_resumo da 20260930000195, trn_alunos_recorte da
--   20260930000216 e trn_dashboard da 20260930000190.
-- ALTER TABLE public."TRN_ALUNO" DISABLE TRIGGER trn_aluno_historico_trg;
-- UPDATE public."TRN_ALUNO" SET status = CASE WHEN status = 'bloqueado' THEN 'bloqueado'
--          WHEN situacao = 'Trabalhando' THEN 'ativo' ELSE 'inativo' END;
-- ALTER TABLE public."TRN_ALUNO" ENABLE TRIGGER trn_aluno_historico_trg;
-- ALTER TABLE public."TRN_ALUNO" ADD CONSTRAINT "TRN_ALUNO_status_check"
--   CHECK (status IN ('pendente','ativo','bloqueado','inativo'));
-- (a coluna primeiro_acesso_em pode ficar — não atrapalha a regra antiga)
-- NOTIFY pgrst, 'reload schema';
