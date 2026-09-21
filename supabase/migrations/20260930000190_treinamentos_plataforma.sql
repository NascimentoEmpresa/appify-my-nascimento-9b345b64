-- =========================================================================
-- TREINAMENTOS — plataforma de cursos (porta do membox para dentro do ERP)
--
-- Pedido de 18/09/2026: "desenvolver esse sistema COMPLETO dentro da nossa
-- ERP". O Grupo usa o membox (app.membox.io) para treinar ~1.400 colaboradores
-- (NRs, integração, ética…). Esta migration é a fase 1, exatamente o que foi
-- pedido primeiro: Dashboard, Alunos (lista, novo, importação, tags), Cursos
-- (lista, cadastro, módulos/aulas, comentários, categorias, certificados) e
-- Comunicação (avisos, notificações, calendário). Área do aluno (o portal
-- onde ele assiste), comunidades, gamificação e quizzes ficam para a fase 2.
--
-- O QUE FOI LEVANTADO NO MEMBOX E COMO VIROU TABELA
--   • Aluno = pessoa com nome, e-mail (login lá), telefone, documento,
--     observação, tags, status (Pendente/Ativo/Bloqueado), acesso completo ou
--     por curso, prazo de acesso e "bloquear gamificação". Aqui é "TRN_ALUNO",
--     com `empregado_id` opcional apontando para EMPREGADOS — a maioria dos
--     alunos É colaborador, mas o cadastro do membox é por e-mail e não pode
--     depender do vínculo existir.
--   • Tag = etiqueta livre; lá as tags são os POSTOS/CONTRATOS ("FURG HU",
--     "UFFS ERECHIM", "TJ RS"…) mais "REALIZADOS"/"FALTA". Segmentam avisos,
--     notificações e ações em massa. "TRN_TAG" + "TRN_ALUNO_TAG".
--   • Curso → Módulos → Aulas. Aula tem tipo de conteúdo (texto, vídeo,
--     ao vivo, áudio, link, embed), descrição rica, posição, status,
--     "gratuita", liberação por data/dias, carga horária, materiais e CTA.
--     "TRN_CURSO" / "TRN_MODULO" / "TRN_AULA".
--   • Matrícula: aluno ↔ curso, com data e origem (manual / massa /
--     importação / acesso completo). "TRN_MATRICULA". Progresso por aula
--     (concluída, avaliação 1-5, tempo) em "TRN_PROGRESSO" — a fase 2 grava,
--     mas o dashboard e as métricas do aluno já leem daqui.
--   • Comentário na aula com moderação (pendente/aprovado/rejeitado) e
--     resposta do gestor. "TRN_COMENTARIO".
--   • Categoria de curso ("TRN_CATEGORIA") e Modelo de certificado
--     ("TRN_CERTIFICADO_MODELO": título, textos com ${curso}/${data}, o que
--     exibir, frente/verso, layout, fundo) + o certificado emitido
--     ("TRN_CERTIFICADO", com código de validação).
--   • Histórico do aluno ("TRN_ALUNO_HISTORICO"): quem fez o quê, de onde —
--     o membox chama de "Histórico" e mostra login, curso adicionado, etc.
--   • Comunicação: Aviso (banner na plataforma do aluno, com público todos/
--     tags, período e status), Notificação (disparo único, registrado com a
--     contagem de alunos alcançados) e Evento de calendário.
--
-- ACESSO — um menu por tela, como o resto do ERP (README da raiz). O módulo
-- `treinamentos` JÁ EXISTE (20260925000001, com "Treinamentos ERP"); aqui
-- só ganha os menus novos. Nada nasce liberado: quem administra libera em
-- Administração › Acesso por Usuário. As policies cobram
-- `can_access(auth.uid(), '<menu>', '<ação>')` pelo helper `trn_acesso`.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Menus ─────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem, true
  FROM (VALUES
    ('treinamentos_dashboard',        'Dashboard',              '/app/treinamentos',                        20),
    ('treinamentos_alunos',           'Alunos — Visualizar',    '/app/treinamentos/alunos',                 30),
    ('treinamentos_alunos_novo',      'Alunos — Adicionar novo','/app/treinamentos/alunos/novo',            31),
    ('treinamentos_alunos_importar',  'Alunos — Importar',      '/app/treinamentos/alunos/importar',        32),
    ('treinamentos_alunos_tags',      'Alunos — Tags',          '/app/treinamentos/alunos/tags',            33),
    ('treinamentos_cursos',           'Cursos — Visualizar',    '/app/treinamentos/cursos',                 40),
    ('treinamentos_cursos_novo',      'Cursos — Adicionar novo','/app/treinamentos/cursos/novo',            41),
    ('treinamentos_comentarios',      'Cursos — Comentários',   '/app/treinamentos/cursos/comentarios',     42),
    ('treinamentos_categorias',       'Cursos — Categorias',    '/app/treinamentos/cursos/categorias',      43),
    ('treinamentos_certificados',     'Cursos — Certificados',  '/app/treinamentos/cursos/certificados',    44),
    ('treinamentos_avisos',           'Comunicação — Avisos',   '/app/treinamentos/comunicacao/avisos',     50),
    ('treinamentos_notificacoes',     'Comunicação — Notificações', '/app/treinamentos/comunicacao/notificacoes', 51),
    ('treinamentos_calendario',       'Comunicação — Calendário','/app/treinamentos/comunicacao/calendario', 52)
  ) AS x(codigo, nome, rota, ordem)
  JOIN public.app_modulo m ON m.codigo = 'treinamentos'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

UPDATE public.app_menu SET ativo = true
 WHERE codigo LIKE 'treinamentos_%' AND codigo <> 'treinamentos_gerenciar';

-- ── 2) Helper de acesso ──────────────────────────────────────────────────
-- Uma função só para as policies não repetirem o cast do enum em 60 lugares.
CREATE OR REPLACE FUNCTION public.trn_acesso(_menu text, _acao text DEFAULT 'visualizar')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.can_access(auth.uid(), _menu, _acao::public.app_acao);
$$;
REVOKE EXECUTE ON FUNCTION public.trn_acesso(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.trn_acesso(text, text) TO authenticated;

-- Quem enxerga o módulo por qualquer porta (dashboard lê de tudo).
CREATE OR REPLACE FUNCTION public.trn_ve_modulo()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.trn_acesso('treinamentos_dashboard')
      OR public.trn_acesso('treinamentos_alunos')
      OR public.trn_acesso('treinamentos_cursos')
      OR public.trn_acesso('treinamentos_comentarios')
      OR public.trn_acesso('treinamentos_avisos')
      OR public.trn_acesso('treinamentos_notificacoes')
      OR public.trn_acesso('treinamentos_calendario');
$$;
REVOKE EXECUTE ON FUNCTION public.trn_ve_modulo() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.trn_ve_modulo() TO authenticated;

-- ── 3) Tabelas ───────────────────────────────────────────────────────────

-- 3.1 Tags (postos/contratos, e o que mais quiserem)
CREATE TABLE IF NOT EXISTS public."TRN_TAG" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        text NOT NULL,
  cor         text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid DEFAULT auth.uid()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trn_tag_nome ON public."TRN_TAG" (upper(btrim(nome)));

-- 3.2 Aluno
CREATE TABLE IF NOT EXISTS public."TRN_ALUNO" (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                  text NOT NULL,
  email                 text NOT NULL,
  telefone              text,
  documento             text,
  observacoes           text,
  idioma                text NOT NULL DEFAULT 'padrao',
  status                text NOT NULL DEFAULT 'pendente'
                          CHECK (status IN ('pendente','ativo','bloqueado')),
  -- true = todos os cursos publicados, atuais e futuros; false = só os da
  -- matrícula (o "Acesso personalizado" do membox).
  acesso_completo       boolean NOT NULL DEFAULT false,
  bloquear_gamificacao  boolean NOT NULL DEFAULT false,
  -- Prazo de acesso direto no aluno (dias após o cadastro). NULL = vitalício.
  prazo_acesso_dias     integer CHECK (prazo_acesso_dias IS NULL OR prazo_acesso_dias > 0),
  expira_em             date,
  -- Vínculo opcional com o cadastro da Senior (EMPREGADOS."ID").
  empregado_id          bigint,
  origem                text NOT NULL DEFAULT 'manual'
                          CHECK (origem IN ('manual','importacao','integracao')),
  ultimo_acesso_em      timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid DEFAULT auth.uid()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trn_aluno_email ON public."TRN_ALUNO" (lower(btrim(email)));
CREATE INDEX IF NOT EXISTS idx_trn_aluno_status ON public."TRN_ALUNO"(status);
CREATE INDEX IF NOT EXISTS idx_trn_aluno_nome   ON public."TRN_ALUNO"(nome);

CREATE TABLE IF NOT EXISTS public."TRN_ALUNO_TAG" (
  aluno_id  uuid NOT NULL REFERENCES public."TRN_ALUNO"(id) ON DELETE CASCADE,
  tag_id    uuid NOT NULL REFERENCES public."TRN_TAG"(id) ON DELETE CASCADE,
  PRIMARY KEY (aluno_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_trn_aluno_tag_tag ON public."TRN_ALUNO_TAG"(tag_id);

-- 3.3 Categoria e modelo de certificado (o curso aponta para os dois)
CREATE TABLE IF NOT EXISTS public."TRN_CATEGORIA" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        text NOT NULL,
  ordem       integer NOT NULL DEFAULT 100,
  ativo       boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."TRN_CERTIFICADO_MODELO" (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                    text NOT NULL,
  titulo                  text NOT NULL DEFAULT 'Certificado de conclusão de curso',
  texto_superior          text,
  texto_inferior          text,
  exibir_nome_negocio     boolean NOT NULL DEFAULT true,
  exibir_logo             boolean NOT NULL DEFAULT false,
  exibir_cnpj             boolean NOT NULL DEFAULT false,
  exibir_carga_horaria    boolean NOT NULL DEFAULT true,
  exibir_qr               boolean NOT NULL DEFAULT true,
  exibir_documento        boolean NOT NULL DEFAULT true,
  frente_verso            boolean NOT NULL DEFAULT false,
  verso_somente_modulos   boolean NOT NULL DEFAULT false,
  verso_titulo            text,
  layout                  text NOT NULL DEFAULT 'centro' CHECK (layout IN ('esquerda','centro')),
  fundo_path              text,
  fundo_verso_path        text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- 3.4 Curso → Módulo → Aula
CREATE TABLE IF NOT EXISTS public."TRN_CURSO" (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                    text NOT NULL,
  descricao               text,
  slug                    text NOT NULL,
  capa_path               text,
  capa_formato            text NOT NULL DEFAULT 'paisagem' CHECK (capa_formato IN ('paisagem','retrato','quadrado')),
  categoria_id            uuid REFERENCES public."TRN_CATEGORIA"(id) ON DELETE SET NULL,
  certificado_modelo_id   uuid REFERENCES public."TRN_CERTIFICADO_MODELO"(id) ON DELETE SET NULL,
  ordem_vitrine           integer,
  carga_horaria_min       integer CHECK (carga_horaria_min IS NULL OR carga_horaria_min >= 0),
  url_vendas              text,
  liberar_em              date,
  liberar_dias            integer NOT NULL DEFAULT 0 CHECK (liberar_dias >= 0),
  -- NULL = vitalício; senão dias contados da matrícula.
  prazo_acesso_dias       integer CHECK (prazo_acesso_dias IS NULL OR prazo_acesso_dias > 0),
  modulos_como_cursos     boolean NOT NULL DEFAULT false,
  publicado               boolean NOT NULL DEFAULT false,
  em_breve                boolean NOT NULL DEFAULT false,
  comentarios_habilitados boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid DEFAULT auth.uid()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trn_curso_slug ON public."TRN_CURSO"(slug);
CREATE INDEX IF NOT EXISTS idx_trn_curso_publicado ON public."TRN_CURSO"(publicado);

CREATE TABLE IF NOT EXISTS public."TRN_MODULO" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curso_id     uuid NOT NULL REFERENCES public."TRN_CURSO"(id) ON DELETE CASCADE,
  nome         text NOT NULL,
  posicao      integer NOT NULL DEFAULT 1,
  liberar_dias integer CHECK (liberar_dias IS NULL OR liberar_dias >= 0),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trn_modulo_curso ON public."TRN_MODULO"(curso_id, posicao);

CREATE TABLE IF NOT EXISTS public."TRN_AULA" (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modulo_id          uuid NOT NULL REFERENCES public."TRN_MODULO"(id) ON DELETE CASCADE,
  nome               text NOT NULL,
  tipo_conteudo      text NOT NULL DEFAULT 'video'
                       CHECK (tipo_conteudo IN ('texto','video','ao_vivo','audio','link','embed')),
  -- Vídeo por link (YouTube/Vimeo/embed) OU arquivo no bucket.
  video_url          text,
  video_path         text,
  thumb_path         text,
  descricao          text,
  posicao            integer NOT NULL DEFAULT 1,
  publicada          boolean NOT NULL DEFAULT true,
  gratuita           boolean NOT NULL DEFAULT false,
  gratuita_ate       date,
  liberar_em         date,
  liberar_dias       integer CHECK (liberar_dias IS NULL OR liberar_dias >= 0),
  carga_horaria_min  integer CHECK (carga_horaria_min IS NULL OR carga_horaria_min >= 0),
  -- [{nome, path?, url?}] — materiais complementares.
  materiais          jsonb NOT NULL DEFAULT '[]'::jsonb,
  cta_texto          text,
  cta_url            text,
  -- Quiz depois da aula: mesmo formato de "TREINAMENTOS".prova
  -- [{id, enunciado, opcoes:[texto], correta:<índice>}].
  quiz               jsonb,
  nota_minima        integer NOT NULL DEFAULT 70 CHECK (nota_minima BETWEEN 0 AND 100),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trn_aula_modulo ON public."TRN_AULA"(modulo_id, posicao);

-- 3.5 Matrícula e progresso
CREATE TABLE IF NOT EXISTS public."TRN_MATRICULA" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aluno_id     uuid NOT NULL REFERENCES public."TRN_ALUNO"(id) ON DELETE CASCADE,
  curso_id     uuid NOT NULL REFERENCES public."TRN_CURSO"(id) ON DELETE CASCADE,
  inscrito_em  date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  origem       text NOT NULL DEFAULT 'manual'
                 CHECK (origem IN ('manual','massa','importacao','completo')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid DEFAULT auth.uid(),
  UNIQUE (aluno_id, curso_id)
);
CREATE INDEX IF NOT EXISTS idx_trn_matricula_curso ON public."TRN_MATRICULA"(curso_id);

CREATE TABLE IF NOT EXISTS public."TRN_PROGRESSO" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aluno_id      uuid NOT NULL REFERENCES public."TRN_ALUNO"(id) ON DELETE CASCADE,
  aula_id       uuid NOT NULL REFERENCES public."TRN_AULA"(id) ON DELETE CASCADE,
  concluida     boolean NOT NULL DEFAULT false,
  concluida_em  timestamptz,
  tempo_seg     integer NOT NULL DEFAULT 0,
  avaliacao     integer CHECK (avaliacao IS NULL OR avaliacao BETWEEN 1 AND 5),
  nota_quiz     integer CHECK (nota_quiz IS NULL OR nota_quiz BETWEEN 0 AND 100),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aluno_id, aula_id)
);
CREATE INDEX IF NOT EXISTS idx_trn_progresso_aula ON public."TRN_PROGRESSO"(aula_id);
CREATE INDEX IF NOT EXISTS idx_trn_progresso_concluida ON public."TRN_PROGRESSO"(concluida_em) WHERE concluida;

-- 3.6 Comentário na aula (moderado)
CREATE TABLE IF NOT EXISTS public."TRN_COMENTARIO" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aula_id        uuid NOT NULL REFERENCES public."TRN_AULA"(id) ON DELETE CASCADE,
  aluno_id       uuid NOT NULL REFERENCES public."TRN_ALUNO"(id) ON DELETE CASCADE,
  texto          text NOT NULL,
  status         text NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente','aprovado','rejeitado')),
  resposta       text,
  respondido_por uuid,
  respondido_em  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trn_comentario_status ON public."TRN_COMENTARIO"(status, created_at DESC);

-- 3.7 Certificado emitido
CREATE TABLE IF NOT EXISTS public."TRN_CERTIFICADO" (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aluno_id          uuid NOT NULL REFERENCES public."TRN_ALUNO"(id) ON DELETE CASCADE,
  curso_id          uuid NOT NULL REFERENCES public."TRN_CURSO"(id) ON DELETE CASCADE,
  modelo_id         uuid REFERENCES public."TRN_CERTIFICADO_MODELO"(id) ON DELETE SET NULL,
  codigo_validacao  text NOT NULL,
  carga_horaria_min integer,
  emitido_em        timestamptz NOT NULL DEFAULT now(),
  emitido_por       uuid DEFAULT auth.uid(),
  UNIQUE (aluno_id, curso_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trn_certificado_codigo ON public."TRN_CERTIFICADO"(codigo_validacao);

-- 3.8 Histórico do aluno
CREATE TABLE IF NOT EXISTS public."TRN_ALUNO_HISTORICO" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aluno_id    uuid NOT NULL REFERENCES public."TRN_ALUNO"(id) ON DELETE CASCADE,
  acao        text NOT NULL,
  detalhes    text,
  origem      text NOT NULL DEFAULT 'gestao' CHECK (origem IN ('gestao','plataforma','sistema')),
  autor_id    uuid DEFAULT auth.uid(),
  autor_nome  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trn_historico_aluno ON public."TRN_ALUNO_HISTORICO"(aluno_id, created_at DESC);

-- 3.9 Comunicação
CREATE TABLE IF NOT EXISTS public."TRN_AVISO" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo         text NOT NULL CHECK (char_length(titulo) <= 100),
  url            text,
  tipo_conteudo  text NOT NULL DEFAULT 'texto' CHECK (tipo_conteudo IN ('texto','imagem','video')),
  mensagem       text,
  imagem_path    text,
  video_url      text,
  publico        text NOT NULL DEFAULT 'todos' CHECK (publico IN ('todos','tags')),
  inicio_em      date,
  fim_em         date,
  publicado      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid DEFAULT auth.uid()
);
CREATE TABLE IF NOT EXISTS public."TRN_AVISO_TAG" (
  aviso_id uuid NOT NULL REFERENCES public."TRN_AVISO"(id) ON DELETE CASCADE,
  tag_id   uuid NOT NULL REFERENCES public."TRN_TAG"(id) ON DELETE CASCADE,
  PRIMARY KEY (aviso_id, tag_id)
);

CREATE TABLE IF NOT EXISTS public."TRN_NOTIFICACAO" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo       text NOT NULL,
  mensagem     text NOT NULL,
  url          text,
  publico      text NOT NULL DEFAULT 'todos' CHECK (publico IN ('todos','tags')),
  alcance      integer NOT NULL DEFAULT 0,
  enviada_em   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid DEFAULT auth.uid(),
  autor_nome   text
);
CREATE TABLE IF NOT EXISTS public."TRN_NOTIFICACAO_TAG" (
  notificacao_id uuid NOT NULL REFERENCES public."TRN_NOTIFICACAO"(id) ON DELETE CASCADE,
  tag_id         uuid NOT NULL REFERENCES public."TRN_TAG"(id) ON DELETE CASCADE,
  PRIMARY KEY (notificacao_id, tag_id)
);
-- Entrega individual (o que a área do aluno lê na fase 2; hoje conta o alcance).
CREATE TABLE IF NOT EXISTS public."TRN_NOTIFICACAO_ALUNO" (
  notificacao_id uuid NOT NULL REFERENCES public."TRN_NOTIFICACAO"(id) ON DELETE CASCADE,
  aluno_id       uuid NOT NULL REFERENCES public."TRN_ALUNO"(id) ON DELETE CASCADE,
  lida_em        timestamptz,
  PRIMARY KEY (notificacao_id, aluno_id)
);

CREATE TABLE IF NOT EXISTS public."TRN_EVENTO" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo      text NOT NULL,
  descricao   text,
  inicio_em   timestamptz NOT NULL,
  fim_em      timestamptz,
  dia_inteiro boolean NOT NULL DEFAULT false,
  local       text,
  url         text,
  cor         text,
  publico     text NOT NULL DEFAULT 'todos' CHECK (publico IN ('todos','tags')),
  curso_id    uuid REFERENCES public."TRN_CURSO"(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid DEFAULT auth.uid(),
  CHECK (fim_em IS NULL OR fim_em >= inicio_em)
);
CREATE INDEX IF NOT EXISTS idx_trn_evento_inicio ON public."TRN_EVENTO"(inicio_em);
CREATE TABLE IF NOT EXISTS public."TRN_EVENTO_TAG" (
  evento_id uuid NOT NULL REFERENCES public."TRN_EVENTO"(id) ON DELETE CASCADE,
  tag_id    uuid NOT NULL REFERENCES public."TRN_TAG"(id) ON DELETE CASCADE,
  PRIMARY KEY (evento_id, tag_id)
);

-- ── 4) Triggers ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trn_touch() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['TRN_ALUNO','TRN_CERTIFICADO_MODELO','TRN_CURSO','TRN_AULA','TRN_PROGRESSO','TRN_AVISO','TRN_EVENTO'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trn_touch_trg ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trn_touch_trg BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.trn_touch()', t);
  END LOOP;
END $$;

-- Slug do curso: gerado do nome quando vier vazio, e único (sufixo -2, -3…).
CREATE OR REPLACE FUNCTION public.trn_slugify(_txt text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT nullif(regexp_replace(regexp_replace(
           lower(translate(coalesce(_txt,''),
             'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
             'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
           '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), '');
$$;

CREATE OR REPLACE FUNCTION public.trn_curso_slug() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE base text; cand text; n int := 1;
BEGIN
  base := coalesce(public.trn_slugify(NEW.slug), public.trn_slugify(NEW.nome), 'curso');
  cand := base;
  WHILE EXISTS (SELECT 1 FROM public."TRN_CURSO" WHERE slug = cand AND id <> NEW.id) LOOP
    n := n + 1; cand := base || '-' || n;
  END LOOP;
  NEW.slug := cand;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trn_curso_slug_trg ON public."TRN_CURSO";
CREATE TRIGGER trn_curso_slug_trg BEFORE INSERT OR UPDATE OF nome, slug ON public."TRN_CURSO"
  FOR EACH ROW EXECUTE FUNCTION public.trn_curso_slug();

-- E-mail do aluno sempre minúsculo e sem espaço — é a chave da importação.
CREATE OR REPLACE FUNCTION public.trn_aluno_normaliza() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.email := lower(btrim(NEW.email));
  NEW.nome  := btrim(NEW.nome);
  IF NEW.prazo_acesso_dias IS NOT NULL AND NEW.expira_em IS NULL THEN
    NEW.expira_em := (coalesce(NEW.created_at, now()) AT TIME ZONE 'America/Sao_Paulo')::date + NEW.prazo_acesso_dias;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trn_aluno_normaliza_trg ON public."TRN_ALUNO";
CREATE TRIGGER trn_aluno_normaliza_trg BEFORE INSERT OR UPDATE ON public."TRN_ALUNO"
  FOR EACH ROW EXECUTE FUNCTION public.trn_aluno_normaliza();

-- Histórico automático: cadastro, bloqueio e matrícula.
CREATE OR REPLACE FUNCTION public.trn_nome_autor() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(p.display_name, p.email, 'Sistema') FROM public.profiles p WHERE p.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.trn_aluno_historico_auto() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public."TRN_ALUNO_HISTORICO"(aluno_id, acao, detalhes, autor_nome)
    VALUES (NEW.id, 'Aluno cadastrado', 'Origem: ' || NEW.origem, public.trn_nome_autor());
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public."TRN_ALUNO_HISTORICO"(aluno_id, acao, detalhes, autor_nome)
    VALUES (NEW.id, CASE NEW.status WHEN 'bloqueado' THEN 'Aluno bloqueado'
                                    WHEN 'ativo' THEN 'Aluno ativado'
                                    ELSE 'Status alterado' END,
            OLD.status || ' → ' || NEW.status, public.trn_nome_autor());
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trn_aluno_historico_trg ON public."TRN_ALUNO";
CREATE TRIGGER trn_aluno_historico_trg AFTER INSERT OR UPDATE ON public."TRN_ALUNO"
  FOR EACH ROW EXECUTE FUNCTION public.trn_aluno_historico_auto();

CREATE OR REPLACE FUNCTION public.trn_matricula_historico() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE c text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT nome INTO c FROM public."TRN_CURSO" WHERE id = NEW.curso_id;
    INSERT INTO public."TRN_ALUNO_HISTORICO"(aluno_id, acao, detalhes, autor_nome)
    VALUES (NEW.aluno_id, 'Curso adicionado',
            'Curso: ' || coalesce(c,'?') || ' (via ' || NEW.origem || ')', public.trn_nome_autor());
    RETURN NEW;
  ELSE
    SELECT nome INTO c FROM public."TRN_CURSO" WHERE id = OLD.curso_id;
    INSERT INTO public."TRN_ALUNO_HISTORICO"(aluno_id, acao, detalhes, autor_nome)
    VALUES (OLD.aluno_id, 'Curso removido', 'Curso: ' || coalesce(c,'?'), public.trn_nome_autor());
    RETURN OLD;
  END IF;
END $$;
DROP TRIGGER IF EXISTS trn_matricula_historico_trg ON public."TRN_MATRICULA";
CREATE TRIGGER trn_matricula_historico_trg AFTER INSERT OR DELETE ON public."TRN_MATRICULA"
  FOR EACH ROW EXECUTE FUNCTION public.trn_matricula_historico();

-- ── 5) RLS ───────────────────────────────────────────────────────────────
-- Um bloco por tabela, sempre o mesmo desenho: ver = visualizar do menu da
-- tela; escrever = incluir/alterar; apagar = excluir. `trn_rls` monta as
-- quatro policies para não repetir 60 CREATE POLICY à mão.
CREATE OR REPLACE FUNCTION public.trn_rls(_tabela text, _menu text) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', _tabela);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', _tabela);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', _tabela);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', lower(_tabela) || '_select', _tabela);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', lower(_tabela) || '_insert', _tabela);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', lower(_tabela) || '_update', _tabela);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', lower(_tabela) || '_delete', _tabela);
  -- Ler: qualquer porta do módulo (o dashboard e as métricas cruzam tudo).
  EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.trn_ve_modulo())',
                 lower(_tabela) || '_select', _tabela);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.trn_acesso(%L,''incluir'') OR public.trn_acesso(%L,''alterar''))',
                 lower(_tabela) || '_insert', _tabela, _menu, _menu);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.trn_acesso(%L,''alterar'')) WITH CHECK (public.trn_acesso(%L,''alterar''))',
                 lower(_tabela) || '_update', _tabela, _menu, _menu);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.trn_acesso(%L,''excluir''))',
                 lower(_tabela) || '_delete', _tabela, _menu);
END $$;

SELECT public.trn_rls('TRN_TAG',                'treinamentos_alunos_tags');
SELECT public.trn_rls('TRN_ALUNO',              'treinamentos_alunos');
SELECT public.trn_rls('TRN_ALUNO_TAG',          'treinamentos_alunos');
SELECT public.trn_rls('TRN_ALUNO_HISTORICO',    'treinamentos_alunos');
SELECT public.trn_rls('TRN_MATRICULA',          'treinamentos_alunos');
SELECT public.trn_rls('TRN_PROGRESSO',          'treinamentos_alunos');
SELECT public.trn_rls('TRN_CERTIFICADO',        'treinamentos_alunos');
SELECT public.trn_rls('TRN_CATEGORIA',          'treinamentos_categorias');
SELECT public.trn_rls('TRN_CERTIFICADO_MODELO', 'treinamentos_certificados');
SELECT public.trn_rls('TRN_CURSO',              'treinamentos_cursos');
SELECT public.trn_rls('TRN_MODULO',             'treinamentos_cursos');
SELECT public.trn_rls('TRN_AULA',               'treinamentos_cursos');
SELECT public.trn_rls('TRN_COMENTARIO',         'treinamentos_comentarios');
SELECT public.trn_rls('TRN_AVISO',              'treinamentos_avisos');
SELECT public.trn_rls('TRN_AVISO_TAG',          'treinamentos_avisos');
SELECT public.trn_rls('TRN_NOTIFICACAO',        'treinamentos_notificacoes');
SELECT public.trn_rls('TRN_NOTIFICACAO_TAG',    'treinamentos_notificacoes');
SELECT public.trn_rls('TRN_NOTIFICACAO_ALUNO',  'treinamentos_notificacoes');
SELECT public.trn_rls('TRN_EVENTO',             'treinamentos_calendario');
SELECT public.trn_rls('TRN_EVENTO_TAG',         'treinamentos_calendario');

-- "Adicionar novo" e "Importar" são menus próprios (como no membox), mas a
-- linha nasce na MESMA tabela do "Visualizar": quem tem incluir em qualquer
-- um dos dois cadastra aluno. Idem curso.
DROP POLICY IF EXISTS trn_aluno_insert ON public."TRN_ALUNO";
CREATE POLICY trn_aluno_insert ON public."TRN_ALUNO" FOR INSERT TO authenticated
  WITH CHECK (public.trn_acesso('treinamentos_alunos','incluir')
           OR public.trn_acesso('treinamentos_alunos_novo','incluir')
           OR public.trn_acesso('treinamentos_alunos_importar','incluir'));
DROP POLICY IF EXISTS trn_aluno_tag_insert ON public."TRN_ALUNO_TAG";
CREATE POLICY trn_aluno_tag_insert ON public."TRN_ALUNO_TAG" FOR INSERT TO authenticated
  WITH CHECK (public.trn_acesso('treinamentos_alunos','incluir')
           OR public.trn_acesso('treinamentos_alunos','alterar')
           OR public.trn_acesso('treinamentos_alunos_novo','incluir')
           OR public.trn_acesso('treinamentos_alunos_importar','incluir'));
DROP POLICY IF EXISTS trn_matricula_insert ON public."TRN_MATRICULA";
CREATE POLICY trn_matricula_insert ON public."TRN_MATRICULA" FOR INSERT TO authenticated
  WITH CHECK (public.trn_acesso('treinamentos_alunos','incluir')
           OR public.trn_acesso('treinamentos_alunos','alterar')
           OR public.trn_acesso('treinamentos_alunos_novo','incluir')
           OR public.trn_acesso('treinamentos_alunos_importar','incluir'));
DROP POLICY IF EXISTS trn_curso_insert ON public."TRN_CURSO";
CREATE POLICY trn_curso_insert ON public."TRN_CURSO" FOR INSERT TO authenticated
  WITH CHECK (public.trn_acesso('treinamentos_cursos','incluir')
           OR public.trn_acesso('treinamentos_cursos_novo','incluir'));

-- ── 6) Storage ───────────────────────────────────────────────────────────
-- Capas, thumbnails, materiais, fundos de certificado e imagens de aviso.
-- Público: capa de curso e banner de aviso são vistos pelo aluno sem login
-- no portal (fase 2), e nada aqui é sensível.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('trn-midia', 'trn-midia', true, 524288000) -- 500 MB (vídeo de aula)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "trn midia select" ON storage.objects;
DROP POLICY IF EXISTS "trn midia insert" ON storage.objects;
DROP POLICY IF EXISTS "trn midia update" ON storage.objects;
DROP POLICY IF EXISTS "trn midia delete" ON storage.objects;
CREATE POLICY "trn midia select" ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'trn-midia');
CREATE POLICY "trn midia insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'trn-midia' AND public.trn_ve_modulo());
CREATE POLICY "trn midia update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'trn-midia' AND public.trn_ve_modulo());
CREATE POLICY "trn midia delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'trn-midia' AND public.trn_ve_modulo());

-- ── 7) RPCs ──────────────────────────────────────────────────────────────

-- 7.1 Dashboard: os números da Home do membox, filtráveis por curso/período.
CREATE OR REPLACE FUNCTION public.trn_dashboard(_curso uuid DEFAULT NULL, _de date DEFAULT NULL, _ate date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE r jsonb; ano int := extract(year FROM now())::int;
BEGIN
  IF NOT public.trn_ve_modulo() THEN RAISE EXCEPTION 'Sem acesso ao módulo Treinamentos.'; END IF;

  WITH alunos AS (
    SELECT a.* FROM public."TRN_ALUNO" a
     WHERE (_curso IS NULL OR a.acesso_completo
            OR EXISTS (SELECT 1 FROM public."TRN_MATRICULA" m WHERE m.aluno_id = a.id AND m.curso_id = _curso))
  ),
  aulas AS (
    SELECT au.id FROM public."TRN_AULA" au JOIN public."TRN_MODULO" mo ON mo.id = au.modulo_id
     WHERE (_curso IS NULL OR mo.curso_id = _curso)
  ),
  prog AS (
    SELECT p.* FROM public."TRN_PROGRESSO" p JOIN aulas ON aulas.id = p.aula_id
     WHERE (_de IS NULL OR p.updated_at::date >= _de) AND (_ate IS NULL OR p.updated_at::date <= _ate)
  ),
  coment AS (
    SELECT c.* FROM public."TRN_COMENTARIO" c JOIN aulas ON aulas.id = c.aula_id
     WHERE (_de IS NULL OR c.created_at::date >= _de) AND (_ate IS NULL OR c.created_at::date <= _ate)
  ),
  por_mes AS (
    SELECT extract(month FROM a.created_at)::int AS mes, count(*) AS n
      FROM alunos a WHERE extract(year FROM a.created_at) = ano GROUP BY 1
  ),
  interagiram AS (SELECT DISTINCT aluno_id FROM prog),
  concluiram  AS (SELECT DISTINCT aluno_id FROM prog WHERE concluida)
  SELECT jsonb_build_object(
    'alunos',            (SELECT count(*) FROM alunos),
    'alunos_ativos',     (SELECT count(*) FROM alunos WHERE status = 'ativo'),
    'alunos_pendentes',  (SELECT count(*) FROM alunos WHERE status = 'pendente'),
    'alunos_bloqueados', (SELECT count(*) FROM alunos WHERE status = 'bloqueado'),
    'aulas_concluidas',  (SELECT count(*) FROM prog WHERE concluida),
    'avaliacao_media',   (SELECT round(avg(avaliacao)::numeric, 1) FROM prog WHERE avaliacao IS NOT NULL),
    'avaliacoes',        (SELECT count(*) FROM prog WHERE avaliacao IS NOT NULL),
    'comentarios',       (SELECT count(*) FROM coment),
    'comentarios_pendentes', (SELECT count(*) FROM public."TRN_COMENTARIO" WHERE status = 'pendente'),
    'cursos_publicados', (SELECT count(*) FROM public."TRN_CURSO" WHERE publicado),
    'cursos_total',      (SELECT count(*) FROM public."TRN_CURSO"),
    'certificados',      (SELECT count(*) FROM public."TRN_CERTIFICADO" c WHERE (_curso IS NULL OR c.curso_id = _curso)),
    'interacao_real',    (SELECT count(*) FROM interagiram),
    'concluidos',        (SELECT count(*) FROM concluiram),
    'ano',               ano,
    'novos_por_mes',     (SELECT jsonb_agg(coalesce(pm.n,0) ORDER BY g.m)
                            FROM generate_series(1,12) g(m) LEFT JOIN por_mes pm ON pm.mes = g.m),
    'top_cursos',        (SELECT coalesce(jsonb_agg(jsonb_build_object('nome', c.nome, 'alunos', x.n) ORDER BY x.n DESC), '[]'::jsonb)
                            FROM (SELECT curso_id, count(*) n FROM public."TRN_MATRICULA" GROUP BY curso_id ORDER BY n DESC LIMIT 8) x
                            JOIN public."TRN_CURSO" c ON c.id = x.curso_id)
  ) INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.trn_dashboard(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_dashboard(uuid, date, date) TO authenticated;

-- 7.2 Lista de alunos com tags, nº de cursos e progresso — uma consulta só
-- para a tabela (a lista do membox mostra nome, e-mail, telefone, documento,
-- status, expiração e, nas colunas opcionais, tags e cursos).
CREATE OR REPLACE FUNCTION public.trn_alunos_lista()
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
   ORDER BY a.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.trn_alunos_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_alunos_lista() TO authenticated;

-- 7.3 Importação em massa (planilha → jsonb). Uma linha = {nome, email,
-- telefone, documento, observacoes, tags:"A;B", cursos:"slug;slug"}.
-- Aluno existente (mesmo e-mail) é ATUALIZADO; tags somam ou substituem
-- conforme `_substituir_tags`, igual ao toggle do membox.
CREATE OR REPLACE FUNCTION public.trn_importar_alunos(_linhas jsonb, _substituir_tags boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  l jsonb; v_email text; v_id uuid; v_novo boolean;
  criados int := 0; atualizados int := 0; erros jsonb := '[]'::jsonb; i int := 0;
  t text; tid uuid; s text; cid uuid;
BEGIN
  IF NOT (public.trn_acesso('treinamentos_alunos_importar','incluir') OR public.trn_acesso('treinamentos_alunos','incluir')) THEN
    RAISE EXCEPTION 'Você não tem permissão para importar alunos.';
  END IF;

  FOR l IN SELECT * FROM jsonb_array_elements(_linhas) LOOP
    i := i + 1;
    BEGIN
      v_email := lower(btrim(coalesce(l->>'email','')));
      IF v_email = '' OR position('@' in v_email) = 0 THEN
        erros := erros || jsonb_build_object('linha', i, 'erro', 'E-mail inválido');
        CONTINUE;
      END IF;
      IF btrim(coalesce(l->>'nome','')) = '' THEN
        erros := erros || jsonb_build_object('linha', i, 'erro', 'Nome vazio');
        CONTINUE;
      END IF;

      SELECT id INTO v_id FROM public."TRN_ALUNO" WHERE lower(btrim(email)) = v_email;
      v_novo := v_id IS NULL;
      IF v_novo THEN
        INSERT INTO public."TRN_ALUNO"(nome, email, telefone, documento, observacoes, origem, status)
        VALUES (l->>'nome', v_email, nullif(btrim(l->>'telefone'),''), nullif(btrim(l->>'documento'),''),
                nullif(btrim(l->>'observacoes'),''), 'importacao', 'pendente')
        RETURNING id INTO v_id;
        criados := criados + 1;
      ELSE
        UPDATE public."TRN_ALUNO"
           SET nome = l->>'nome',
               telefone = coalesce(nullif(btrim(l->>'telefone'),''), telefone),
               documento = coalesce(nullif(btrim(l->>'documento'),''), documento),
               observacoes = coalesce(nullif(btrim(l->>'observacoes'),''), observacoes)
         WHERE id = v_id;
        atualizados := atualizados + 1;
      END IF;

      -- Tags: "A;B;C" — cria a que não existe.
      IF _substituir_tags AND NOT v_novo THEN
        DELETE FROM public."TRN_ALUNO_TAG" WHERE aluno_id = v_id;
      END IF;
      FOREACH t IN ARRAY regexp_split_to_array(coalesce(l->>'tags',''), '\s*[;,]\s*') LOOP
        t := btrim(t);
        IF t = '' THEN CONTINUE; END IF;
        SELECT id INTO tid FROM public."TRN_TAG" WHERE upper(btrim(nome)) = upper(t);
        IF tid IS NULL THEN
          INSERT INTO public."TRN_TAG"(nome) VALUES (t) RETURNING id INTO tid;
        END IF;
        INSERT INTO public."TRN_ALUNO_TAG"(aluno_id, tag_id) VALUES (v_id, tid) ON CONFLICT DO NOTHING;
      END LOOP;

      -- Cursos: por slug OU nome.
      FOREACH s IN ARRAY regexp_split_to_array(coalesce(l->>'cursos',''), '\s*[;,]\s*') LOOP
        s := btrim(s);
        IF s = '' THEN CONTINUE; END IF;
        SELECT id INTO cid FROM public."TRN_CURSO" WHERE slug = public.trn_slugify(s) OR upper(nome) = upper(s) LIMIT 1;
        IF cid IS NOT NULL THEN
          INSERT INTO public."TRN_MATRICULA"(aluno_id, curso_id, origem) VALUES (v_id, cid, 'importacao') ON CONFLICT DO NOTHING;
        END IF;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      erros := erros || jsonb_build_object('linha', i, 'erro', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('criados', criados, 'atualizados', atualizados, 'erros', erros);
END $$;
REVOKE ALL ON FUNCTION public.trn_importar_alunos(jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_importar_alunos(jsonb, boolean) TO authenticated;

-- 7.4 Ação em massa — as mesmas do membox, sobre um recorte (tag ou lista de ids).
CREATE OR REPLACE FUNCTION public.trn_acao_massa(_acao text, _alunos uuid[] DEFAULT NULL, _tag uuid DEFAULT NULL, _param jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
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
      INSERT INTO public."TRN_MATRICULA"(aluno_id, curso_id, origem)
      SELECT a, (_param->>'curso_id')::uuid, 'massa' FROM unnest(alvo) a ON CONFLICT DO NOTHING;
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
END $$;
REVOKE ALL ON FUNCTION public.trn_acao_massa(text, uuid[], uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_acao_massa(text, uuid[], uuid, jsonb) TO authenticated;

-- 7.5 Notificação: registra o disparo e grava a entrega por aluno do público.
CREATE OR REPLACE FUNCTION public.trn_enviar_notificacao(_titulo text, _mensagem text, _url text, _publico text, _tags uuid[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE nid uuid; n int;
BEGIN
  IF NOT public.trn_acesso('treinamentos_notificacoes','incluir') THEN
    RAISE EXCEPTION 'Você não tem permissão para enviar notificações.';
  END IF;
  -- Limite do membox (1 a cada 5 min) preservado: evita disparo duplo por clique.
  IF EXISTS (SELECT 1 FROM public."TRN_NOTIFICACAO" WHERE enviada_em > now() - interval '5 minutes') THEN
    RAISE EXCEPTION 'Aguarde 5 minutos entre uma notificação e outra.';
  END IF;

  INSERT INTO public."TRN_NOTIFICACAO"(titulo, mensagem, url, publico, autor_nome)
  VALUES (_titulo, _mensagem, nullif(btrim(_url),''), _publico, public.trn_nome_autor())
  RETURNING id INTO nid;

  IF _publico = 'tags' AND _tags IS NOT NULL THEN
    INSERT INTO public."TRN_NOTIFICACAO_TAG"(notificacao_id, tag_id) SELECT nid, unnest(_tags) ON CONFLICT DO NOTHING;
    INSERT INTO public."TRN_NOTIFICACAO_ALUNO"(notificacao_id, aluno_id)
    SELECT DISTINCT nid, at.aluno_id FROM public."TRN_ALUNO_TAG" at
      JOIN public."TRN_ALUNO" a ON a.id = at.aluno_id AND a.status <> 'bloqueado'
     WHERE at.tag_id = ANY(_tags);
  ELSE
    INSERT INTO public."TRN_NOTIFICACAO_ALUNO"(notificacao_id, aluno_id)
    SELECT nid, a.id FROM public."TRN_ALUNO" a WHERE a.status <> 'bloqueado';
  END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public."TRN_NOTIFICACAO" SET alcance = n WHERE id = nid;
  RETURN jsonb_build_object('id', nid, 'alcance', n);
END $$;
REVOKE ALL ON FUNCTION public.trn_enviar_notificacao(text, text, text, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_enviar_notificacao(text, text, text, text, uuid[]) TO authenticated;

-- 7.6 Quantos alunos um público alcança (o "Esta notificação será disparada para: N alunos").
CREATE OR REPLACE FUNCTION public.trn_alcance(_publico text, _tags uuid[] DEFAULT NULL)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN _publico = 'tags' AND _tags IS NOT NULL THEN
    (SELECT count(DISTINCT at.aluno_id)::int FROM public."TRN_ALUNO_TAG" at JOIN public."TRN_ALUNO" a ON a.id = at.aluno_id AND a.status <> 'bloqueado' WHERE at.tag_id = ANY(_tags))
  ELSE (SELECT count(*)::int FROM public."TRN_ALUNO" WHERE status <> 'bloqueado') END
  WHERE public.trn_ve_modulo();
$$;
REVOKE ALL ON FUNCTION public.trn_alcance(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_alcance(text, uuid[]) TO authenticated;

-- 7.7 Emitir certificado (gestão): gera o código de validação e trava dupla emissão.
CREATE OR REPLACE FUNCTION public.trn_emitir_certificado(_aluno uuid, _curso uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE cid uuid; modelo uuid; ch int; cod text;
BEGIN
  IF NOT (public.trn_acesso('treinamentos_alunos','alterar') OR public.trn_acesso('treinamentos_certificados','incluir')) THEN
    RAISE EXCEPTION 'Você não tem permissão para emitir certificado.';
  END IF;
  SELECT id INTO cid FROM public."TRN_CERTIFICADO" WHERE aluno_id = _aluno AND curso_id = _curso;
  IF cid IS NOT NULL THEN RETURN cid; END IF;
  SELECT certificado_modelo_id, carga_horaria_min INTO modelo, ch FROM public."TRN_CURSO" WHERE id = _curso;
  IF modelo IS NULL THEN RAISE EXCEPTION 'Este curso não emite certificado (sem modelo em Editar curso).'; END IF;
  cod := upper(substr(md5(gen_random_uuid()::text), 1, 15));
  INSERT INTO public."TRN_CERTIFICADO"(aluno_id, curso_id, modelo_id, codigo_validacao, carga_horaria_min)
  VALUES (_aluno, _curso, modelo, cod, ch) RETURNING id INTO cid;
  INSERT INTO public."TRN_ALUNO_HISTORICO"(aluno_id, acao, detalhes, autor_nome)
  SELECT _aluno, 'Certificado emitido', 'Curso: ' || nome || ' · ' || cod, public.trn_nome_autor()
    FROM public."TRN_CURSO" WHERE id = _curso;
  RETURN cid;
END $$;
REVOKE ALL ON FUNCTION public.trn_emitir_certificado(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_emitir_certificado(uuid, uuid) TO authenticated;

-- 7.8 Progresso do aluno por curso → módulo → aula (a tela "Métricas do aluno").
CREATE OR REPLACE FUNCTION public.trn_aluno_progresso(_aluno uuid)
RETURNS TABLE (curso_id uuid, curso text, modulo_id uuid, modulo text, modulo_posicao int,
               aula_id uuid, aula text, aula_posicao int, concluida boolean, concluida_em timestamptz,
               avaliacao int, tempo_seg int, nota_quiz int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id, c.nome, mo.id, mo.nome, mo.posicao, au.id, au.nome, au.posicao,
         coalesce(p.concluida,false), p.concluida_em, p.avaliacao, coalesce(p.tempo_seg,0), p.nota_quiz
    FROM public."TRN_ALUNO" a
    JOIN public."TRN_CURSO" c ON (a.acesso_completo AND c.publicado)
                              OR EXISTS (SELECT 1 FROM public."TRN_MATRICULA" m WHERE m.aluno_id = a.id AND m.curso_id = c.id)
    JOIN public."TRN_MODULO" mo ON mo.curso_id = c.id
    JOIN public."TRN_AULA" au ON au.modulo_id = mo.id
    LEFT JOIN public."TRN_PROGRESSO" p ON p.aluno_id = a.id AND p.aula_id = au.id
   WHERE a.id = _aluno AND public.trn_ve_modulo()
   ORDER BY c.nome, mo.posicao, au.posicao;
$$;
REVOKE ALL ON FUNCTION public.trn_aluno_progresso(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_aluno_progresso(uuid) TO authenticated;

-- 7.9 Métricas por curso para a lista de cursos (alunos, avaliação, aulas).
CREATE OR REPLACE FUNCTION public.trn_cursos_lista()
RETURNS TABLE (id uuid, nome text, descricao text, slug text, capa_path text, categoria_id uuid, categoria text,
               publicado boolean, em_breve boolean, comentarios_habilitados boolean, modulos_como_cursos boolean,
               ordem_vitrine int, created_at timestamptz, alunos int, modulos int, aulas int,
               avaliacao numeric, avaliacoes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id, c.nome, c.descricao, c.slug, c.capa_path, c.categoria_id, cat.nome,
         c.publicado, c.em_breve, c.comentarios_habilitados, c.modulos_como_cursos, c.ordem_vitrine, c.created_at,
         (SELECT count(*)::int FROM public."TRN_MATRICULA" m WHERE m.curso_id = c.id)
           + (SELECT count(*)::int FROM public."TRN_ALUNO" a WHERE a.acesso_completo AND c.publicado
                 AND NOT EXISTS (SELECT 1 FROM public."TRN_MATRICULA" m2 WHERE m2.curso_id = c.id AND m2.aluno_id = a.id)),
         (SELECT count(*)::int FROM public."TRN_MODULO" mo WHERE mo.curso_id = c.id),
         (SELECT count(*)::int FROM public."TRN_AULA" au JOIN public."TRN_MODULO" mo ON mo.id = au.modulo_id WHERE mo.curso_id = c.id),
         (SELECT round(avg(p.avaliacao)::numeric,1) FROM public."TRN_PROGRESSO" p JOIN public."TRN_AULA" au ON au.id = p.aula_id JOIN public."TRN_MODULO" mo ON mo.id = au.modulo_id WHERE mo.curso_id = c.id AND p.avaliacao IS NOT NULL),
         (SELECT count(*)::int FROM public."TRN_PROGRESSO" p JOIN public."TRN_AULA" au ON au.id = p.aula_id JOIN public."TRN_MODULO" mo ON mo.id = au.modulo_id WHERE mo.curso_id = c.id AND p.avaliacao IS NOT NULL)
    FROM public."TRN_CURSO" c LEFT JOIN public."TRN_CATEGORIA" cat ON cat.id = c.categoria_id
   WHERE public.trn_ve_modulo()
   ORDER BY coalesce(c.ordem_vitrine, 9999), c.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.trn_cursos_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_cursos_lista() TO authenticated;

-- 7.10 Duplicar curso (com módulos e aulas) — botão "Duplicar" do membox.
CREATE OR REPLACE FUNCTION public.trn_duplicar_curso(_curso uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE novo uuid; mo record; novo_mo uuid;
BEGIN
  IF NOT (public.trn_acesso('treinamentos_cursos','incluir') OR public.trn_acesso('treinamentos_cursos_novo','incluir')) THEN
    RAISE EXCEPTION 'Você não tem permissão para criar cursos.';
  END IF;
  INSERT INTO public."TRN_CURSO"(nome, descricao, slug, capa_path, capa_formato, categoria_id, certificado_modelo_id,
                                 carga_horaria_min, url_vendas, liberar_dias, prazo_acesso_dias, modulos_como_cursos,
                                 publicado, em_breve, comentarios_habilitados)
  SELECT nome || ' (cópia)', descricao, '', capa_path, capa_formato, categoria_id, certificado_modelo_id,
         carga_horaria_min, url_vendas, liberar_dias, prazo_acesso_dias, modulos_como_cursos,
         false, em_breve, comentarios_habilitados
    FROM public."TRN_CURSO" WHERE id = _curso RETURNING id INTO novo;
  FOR mo IN SELECT * FROM public."TRN_MODULO" WHERE curso_id = _curso ORDER BY posicao LOOP
    INSERT INTO public."TRN_MODULO"(curso_id, nome, posicao, liberar_dias)
    VALUES (novo, mo.nome, mo.posicao, mo.liberar_dias) RETURNING id INTO novo_mo;
    INSERT INTO public."TRN_AULA"(modulo_id, nome, tipo_conteudo, video_url, video_path, thumb_path, descricao, posicao,
                                  publicada, gratuita, gratuita_ate, liberar_em, liberar_dias, carga_horaria_min,
                                  materiais, cta_texto, cta_url, quiz, nota_minima)
    SELECT novo_mo, nome, tipo_conteudo, video_url, video_path, thumb_path, descricao, posicao,
           publicada, gratuita, gratuita_ate, liberar_em, liberar_dias, carga_horaria_min,
           materiais, cta_texto, cta_url, quiz, nota_minima
      FROM public."TRN_AULA" WHERE modulo_id = mo.id;
  END LOOP;
  RETURN novo;
END $$;
REVOKE ALL ON FUNCTION public.trn_duplicar_curso(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_duplicar_curso(uuid) TO authenticated;

-- 7.11 Duplicar módulo para outro curso (ou o mesmo).
CREATE OR REPLACE FUNCTION public.trn_duplicar_modulo(_modulo uuid, _curso_destino uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE novo_mo uuid; pos int;
BEGIN
  IF NOT public.trn_acesso('treinamentos_cursos','alterar') THEN
    RAISE EXCEPTION 'Você não tem permissão para alterar cursos.';
  END IF;
  SELECT coalesce(max(posicao),0) + 1 INTO pos FROM public."TRN_MODULO" WHERE curso_id = _curso_destino;
  INSERT INTO public."TRN_MODULO"(curso_id, nome, posicao, liberar_dias)
  SELECT _curso_destino, nome, pos, liberar_dias FROM public."TRN_MODULO" WHERE id = _modulo RETURNING id INTO novo_mo;
  INSERT INTO public."TRN_AULA"(modulo_id, nome, tipo_conteudo, video_url, video_path, thumb_path, descricao, posicao,
                                publicada, gratuita, gratuita_ate, liberar_em, liberar_dias, carga_horaria_min,
                                materiais, cta_texto, cta_url, quiz, nota_minima)
  SELECT novo_mo, nome, tipo_conteudo, video_url, video_path, thumb_path, descricao, posicao,
         publicada, gratuita, gratuita_ate, liberar_em, liberar_dias, carga_horaria_min,
         materiais, cta_texto, cta_url, quiz, nota_minima
    FROM public."TRN_AULA" WHERE modulo_id = _modulo;
  RETURN novo_mo;
END $$;
REVOKE ALL ON FUNCTION public.trn_duplicar_modulo(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_duplicar_modulo(uuid, uuid) TO authenticated;

-- 7.12 Modelo de certificado padrão (o membox já vem com um).
INSERT INTO public."TRN_CERTIFICADO_MODELO"(nome, titulo, texto_superior, texto_inferior)
SELECT 'Certificado padrão', 'Certificado de conclusão de curso',
       'A instituição de ensino Grupo Nascimento certifica que o(a) aluno(a)',
       'Concluiu o curso de ${curso} no dia ${data}'
 WHERE NOT EXISTS (SELECT 1 FROM public."TRN_CERTIFICADO_MODELO");

-- ── 8) Conferência ───────────────────────────────────────────────────────
SELECT m.codigo AS modulo, x.codigo AS menu, x.rota, x.ativo
  FROM public.app_menu x JOIN public.app_modulo m ON m.id = x.modulo_id
 WHERE m.codigo = 'treinamentos' ORDER BY x.ordem;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- DEPOIS DE RODAR: nada nasce liberado. Em Administração › Acesso por
-- Usuário → módulo Treinamentos, marque as telas para quem gerencia a
-- plataforma (Dashboard, Alunos…, Cursos…, Comunicação…).
--
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.trn_duplicar_modulo(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.trn_duplicar_curso(uuid);
-- DROP FUNCTION IF EXISTS public.trn_cursos_lista();
-- DROP FUNCTION IF EXISTS public.trn_aluno_progresso(uuid);
-- DROP FUNCTION IF EXISTS public.trn_emitir_certificado(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.trn_alcance(text, uuid[]);
-- DROP FUNCTION IF EXISTS public.trn_enviar_notificacao(text, text, text, text, uuid[]);
-- DROP FUNCTION IF EXISTS public.trn_acao_massa(text, uuid[], uuid, jsonb);
-- DROP FUNCTION IF EXISTS public.trn_importar_alunos(jsonb, boolean);
-- DROP FUNCTION IF EXISTS public.trn_alunos_lista();
-- DROP FUNCTION IF EXISTS public.trn_dashboard(uuid, date, date);
-- DROP POLICY IF EXISTS "trn midia select" ON storage.objects; DROP POLICY IF EXISTS "trn midia insert" ON storage.objects;
-- DROP POLICY IF EXISTS "trn midia update" ON storage.objects; DROP POLICY IF EXISTS "trn midia delete" ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'trn-midia';
-- DROP TABLE IF EXISTS public."TRN_EVENTO_TAG", public."TRN_EVENTO", public."TRN_NOTIFICACAO_ALUNO", public."TRN_NOTIFICACAO_TAG",
--   public."TRN_NOTIFICACAO", public."TRN_AVISO_TAG", public."TRN_AVISO", public."TRN_ALUNO_HISTORICO", public."TRN_CERTIFICADO",
--   public."TRN_COMENTARIO", public."TRN_PROGRESSO", public."TRN_MATRICULA", public."TRN_AULA", public."TRN_MODULO",
--   public."TRN_CURSO", public."TRN_CERTIFICADO_MODELO", public."TRN_CATEGORIA", public."TRN_ALUNO_TAG", public."TRN_ALUNO", public."TRN_TAG";
-- DROP FUNCTION IF EXISTS public.trn_rls(text, text), public.trn_matricula_historico(), public.trn_aluno_historico_auto(),
--   public.trn_nome_autor(), public.trn_aluno_normaliza(), public.trn_curso_slug(), public.trn_slugify(text), public.trn_touch(),
--   public.trn_ve_modulo(), public.trn_acesso(text, text);
-- DELETE FROM public.app_menu WHERE codigo IN ('treinamentos_dashboard','treinamentos_alunos','treinamentos_alunos_novo',
--   'treinamentos_alunos_importar','treinamentos_alunos_tags','treinamentos_cursos','treinamentos_cursos_novo',
--   'treinamentos_comentarios','treinamentos_categorias','treinamentos_certificados','treinamentos_avisos',
--   'treinamentos_notificacoes','treinamentos_calendario');
-- NOTIFY pgrst, 'reload schema';
