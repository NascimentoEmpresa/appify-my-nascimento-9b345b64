-- =========================================================================
-- ORGANOGRAMA › ESTRUTURA DE SETORES E PROCESSOS (20/10/2026)
--
-- CHAMADO: "uma tela que tenha um organograma da estrutura dos setores, mas
-- diferente do que já foi criado, mais voltado para a atividade geral de
-- cada um, desde o gerente até o jovem, com detalhamento das funções e os
-- processos do setor conectados em cada colaborador da equipe e conectado
-- nos outros processos e pessoas de outros setores." Referência: o
-- "Processos gerais" (drawio) do RH/Controladoria e duas telas de exemplo.
--
-- É um organograma NOVO: o atual (ORGANOGRAMA_NO, mig 20260930000277) não
-- é tocado. Duas telas no módulo Organograma:
--   /app/organograma/processos          Organograma Geral (leitura)
--   /app/organograma/processos/cadastro Cadastro da Estrutura (canvas)
--
-- MODELO
--   ORG_PROC_UNIDADE  presidência e diretorias (o topo do organograma).
--   ORG_PROC_SETOR    os setores, cada um numa diretoria.
--   ORG_PROC_MEMBRO   a equipe do setor, do gerente ao jovem aprendiz:
--                     cargo, nível, a quem responde e o que faz (funções).
--                     Pode apontar para o cadastro (EMPREGADOS) e o login.
--   ORG_PROC_MACRO    macroprocessos que cruzam setores (Contratos,
--                     Faturamento…) — a faixa de baixo do organograma.
--   ORG_PROC_PROCESSO os processos (P-001…): setor, responsável (membro),
--                     frequência, entrada/saída, status, próxima etapa,
--                     macroprocesso e a posição no canvas.
--   ORG_PROC_CONEXAO  ligações entre processos (fluxo, intersetorial,
--                     retorno/validação, bloqueado, em revisão).
--   ORG_PROC_DOCUMENTO arquivos do processo (bucket org-processos).
--   ORG_PROC_PUBLICACAO o retrato publicado: o Organograma Geral mostra a
--                     última publicação; o cadastro trabalha no rascunho
--                     (as tabelas) e "Publicar estrutura" tira o retrato.
--
-- CARGA INICIAL: setores, equipes e processos lidos do "Processos gerais"
-- (pessoas só pelo nome — o vínculo com o cadastro se faz na tela).
--
-- PERMISSÕES — nenhuma concedida. Menus:
--   organograma_processos          ver o Organograma Geral
--   organograma_processos_cadastro ver o cadastro; incluir/alterar/excluir
--                                  editam; publicar = alterar
-- Idempotente.
-- =========================================================================

-- ── 1) Menus ─────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'organograma_processos', 'Estrutura e Processos', '/app/organograma/processos', 20, true
  FROM public.app_modulo m WHERE m.codigo = 'organograma'
ON CONFLICT (modulo_id, codigo) DO NOTHING;
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'organograma_processos_cadastro', 'Cadastro da Estrutura', '/app/organograma/processos/cadastro', 30, true
  FROM public.app_modulo m WHERE m.codigo = 'organograma'
ON CONFLICT (modulo_id, codigo) DO NOTHING;
INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('organograma_processos_cadastro', 'excluir'::app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

CREATE OR REPLACE FUNCTION public.org_proc_pode(_acao text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND public.has_screen_access(auth.uid(), 'organograma_processos_cadastro', _acao::public.app_acao)
$$;
CREATE OR REPLACE FUNCTION public.org_proc_pode_ver()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND (public.has_screen_access(auth.uid(), 'organograma_processos', 'visualizar'::public.app_acao)
                                     OR public.org_proc_pode('visualizar'))
$$;
REVOKE ALL ON FUNCTION public.org_proc_pode(text), public.org_proc_pode_ver() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_proc_pode(text), public.org_proc_pode_ver() TO authenticated;

-- ── 2) Tabelas ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."ORG_PROC_UNIDADE" (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo            text UNIQUE,
  tipo              text NOT NULL CHECK (tipo IN ('presidencia', 'diretoria')),
  nome              text NOT NULL,
  subtitulo         text,                 -- "Gestão Administrativa e de Suporte"
  responsavel_nome  text,
  responsavel_cargo text,
  empregado_id      bigint,
  user_id           uuid,
  parent_id         uuid REFERENCES public."ORG_PROC_UNIDADE"(id) ON DELETE SET NULL,
  cor               text NOT NULL DEFAULT 'blue',
  ordem             integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."ORG_PROC_SETOR" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo      text UNIQUE,
  nome        text NOT NULL,
  unidade_id  uuid REFERENCES public."ORG_PROC_UNIDADE"(id) ON DELETE SET NULL,
  icone       text NOT NULL DEFAULT 'building',
  cor         text NOT NULL DEFAULT 'blue',
  descricao   text,
  ordem       integer NOT NULL DEFAULT 0,
  ativo       boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."ORG_PROC_MEMBRO" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setor_id      uuid NOT NULL REFERENCES public."ORG_PROC_SETOR"(id) ON DELETE CASCADE,
  nome          text NOT NULL,
  cargo         text NOT NULL,
  -- 1 gerência · 2 supervisão/coordenação · 3 analista/especialista ·
  -- 4 assistente/técnico · 5 auxiliar/estagiário · 6 jovem aprendiz
  nivel         integer NOT NULL DEFAULT 3 CHECK (nivel BETWEEN 1 AND 6),
  parent_id     uuid REFERENCES public."ORG_PROC_MEMBRO"(id) ON DELETE SET NULL,
  responsavel   boolean NOT NULL DEFAULT false,   -- o responsável pelo setor
  atividades    text,                             -- funções, uma por linha
  empregado_id  bigint,
  user_id       uuid,
  ordem         integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_proc_membro_nao_e_chefe_de_si CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX IF NOT EXISTS idx_org_proc_membro_setor ON public."ORG_PROC_MEMBRO"(setor_id, nivel, ordem);

CREATE TABLE IF NOT EXISTS public."ORG_PROC_MACRO" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo      text UNIQUE,
  nome        text NOT NULL,
  cor         text NOT NULL DEFAULT 'slate',
  ordem       integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public.org_proc_processo_seq;

CREATE TABLE IF NOT EXISTS public."ORG_PROC_PROCESSO" (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo                 text UNIQUE,
  setor_id               uuid REFERENCES public."ORG_PROC_SETOR"(id) ON DELETE CASCADE,
  unidade_id             uuid REFERENCES public."ORG_PROC_UNIDADE"(id) ON DELETE CASCADE,  -- processos da presidência
  nome                   text NOT NULL,
  descricao              text,
  responsavel_membro_id  uuid REFERENCES public."ORG_PROC_MEMBRO"(id) ON DELETE SET NULL,
  frequencia             text,
  entrada                text,
  saida                  text,
  status                 text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'em_revisao', 'inativo')),
  proximo_id             uuid REFERENCES public."ORG_PROC_PROCESSO"(id) ON DELETE SET NULL,
  macro_id               uuid REFERENCES public."ORG_PROC_MACRO"(id) ON DELETE SET NULL,
  principal              boolean NOT NULL DEFAULT false,
  exibir_organograma     boolean NOT NULL DEFAULT true,
  permite_intersetorial  boolean NOT NULL DEFAULT true,
  bloquear_posicao       boolean NOT NULL DEFAULT false,
  pos_x                  numeric,
  pos_y                  numeric,
  ordem                  integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_proc_processo_dono CHECK (setor_id IS NOT NULL OR unidade_id IS NOT NULL),
  CONSTRAINT org_proc_processo_nao_e_proximo_de_si CHECK (proximo_id IS NULL OR proximo_id <> id)
);
CREATE INDEX IF NOT EXISTS idx_org_proc_processo_setor ON public."ORG_PROC_PROCESSO"(setor_id, ordem);

CREATE TABLE IF NOT EXISTS public."ORG_PROC_CONEXAO" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origem_id   uuid NOT NULL REFERENCES public."ORG_PROC_PROCESSO"(id) ON DELETE CASCADE,
  destino_id  uuid NOT NULL REFERENCES public."ORG_PROC_PROCESSO"(id) ON DELETE CASCADE,
  tipo        text NOT NULL DEFAULT 'intersetorial'
                CHECK (tipo IN ('fluxo', 'intersetorial', 'retorno', 'bloqueado', 'revisao')),
  rotulo      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_proc_conexao_unica UNIQUE (origem_id, destino_id),
  CONSTRAINT org_proc_conexao_nao_e_si CHECK (origem_id <> destino_id)
);

CREATE TABLE IF NOT EXISTS public."ORG_PROC_DOCUMENTO" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  processo_id   uuid NOT NULL REFERENCES public."ORG_PROC_PROCESSO"(id) ON DELETE CASCADE,
  nome_arquivo  text,
  storage_path  text NOT NULL,
  mime_type     text,
  tamanho_bytes bigint,
  enviado_por   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."ORG_PROC_PUBLICACAO" (
  id             bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  versao         integer NOT NULL,
  dados          jsonb NOT NULL,
  observacao     text,
  publicado_por  text,
  publicado_em   timestamptz NOT NULL DEFAULT now()
);

-- Código P-001… na criação.
CREATE OR REPLACE FUNCTION public.org_proc_processo_codigo()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.codigo IS NULL OR btrim(NEW.codigo) = '' THEN
    NEW.codigo := 'P-' || lpad(nextval('public.org_proc_processo_seq')::text, 3, '0');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_org_proc_processo_codigo ON public."ORG_PROC_PROCESSO";
CREATE TRIGGER trg_org_proc_processo_codigo BEFORE INSERT ON public."ORG_PROC_PROCESSO"
  FOR EACH ROW EXECUTE FUNCTION public.org_proc_processo_codigo();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ORG_PROC_UNIDADE', 'ORG_PROC_SETOR', 'ORG_PROC_MEMBRO', 'ORG_PROC_PROCESSO'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated ON public.%I', lower(t), t);
    EXECUTE format('CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', lower(t), t);
  END LOOP;
END $$;

-- Sem ciclo na equipe (A responde a B que responde a A).
CREATE OR REPLACE FUNCTION public.org_proc_membro_sem_ciclo()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v uuid := NEW.parent_id; n int := 0;
BEGIN
  WHILE v IS NOT NULL LOOP
    IF v = NEW.id THEN RAISE EXCEPTION 'Essa pessoa não pode responder a alguém que está abaixo dela na equipe.'; END IF;
    SELECT parent_id INTO v FROM public."ORG_PROC_MEMBRO" WHERE id = v;
    n := n + 1; IF n > 200 THEN RAISE EXCEPTION 'Equipe com ciclo.'; END IF;
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_org_proc_membro_sem_ciclo ON public."ORG_PROC_MEMBRO";
CREATE TRIGGER trg_org_proc_membro_sem_ciclo BEFORE INSERT OR UPDATE OF parent_id ON public."ORG_PROC_MEMBRO"
  FOR EACH ROW EXECUTE FUNCTION public.org_proc_membro_sem_ciclo();

-- ── 3) RLS: lê quem vê; escreve quem tem a ação no cadastro ──────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ORG_PROC_UNIDADE', 'ORG_PROC_SETOR', 'ORG_PROC_MEMBRO', 'ORG_PROC_MACRO',
                           'ORG_PROC_PROCESSO', 'ORG_PROC_CONEXAO', 'ORG_PROC_DOCUMENTO'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS org_proc_sel ON public.%I', t);
    EXECUTE format('CREATE POLICY org_proc_sel ON public.%I FOR SELECT TO authenticated USING (public.org_proc_pode_ver())', t);
    EXECUTE format('DROP POLICY IF EXISTS org_proc_ins ON public.%I', t);
    EXECUTE format('CREATE POLICY org_proc_ins ON public.%I FOR INSERT TO authenticated WITH CHECK (public.org_proc_pode(''incluir'') OR public.org_proc_pode(''alterar''))', t);
    EXECUTE format('DROP POLICY IF EXISTS org_proc_upd ON public.%I', t);
    EXECUTE format('CREATE POLICY org_proc_upd ON public.%I FOR UPDATE TO authenticated USING (public.org_proc_pode(''alterar'')) WITH CHECK (public.org_proc_pode(''alterar''))', t);
    EXECUTE format('DROP POLICY IF EXISTS org_proc_del ON public.%I', t);
    EXECUTE format('CREATE POLICY org_proc_del ON public.%I FOR DELETE TO authenticated USING (public.org_proc_pode(''excluir''))', t);
  END LOOP;
END $$;
-- Conexão e documento: incluir já basta para tirar (são ligações, não cadastro).
DROP POLICY IF EXISTS org_proc_del ON public."ORG_PROC_CONEXAO";
CREATE POLICY org_proc_del ON public."ORG_PROC_CONEXAO" FOR DELETE TO authenticated
  USING (public.org_proc_pode('alterar') OR public.org_proc_pode('excluir'));
DROP POLICY IF EXISTS org_proc_del ON public."ORG_PROC_DOCUMENTO";
CREATE POLICY org_proc_del ON public."ORG_PROC_DOCUMENTO" FOR DELETE TO authenticated
  USING (public.org_proc_pode('alterar') OR public.org_proc_pode('excluir'));

ALTER TABLE public."ORG_PROC_PUBLICACAO" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."ORG_PROC_PUBLICACAO" FROM PUBLIC, anon;
GRANT SELECT ON public."ORG_PROC_PUBLICACAO" TO authenticated;
DROP POLICY IF EXISTS org_proc_pub_sel ON public."ORG_PROC_PUBLICACAO";
CREATE POLICY org_proc_pub_sel ON public."ORG_PROC_PUBLICACAO" FOR SELECT TO authenticated USING (public.org_proc_pode_ver());

-- ── 4) Storage dos documentos ────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('org-processos', 'org-processos', false, 20971520)
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "org processos select" ON storage.objects;
CREATE POLICY "org processos select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'org-processos' AND public.org_proc_pode_ver());
DROP POLICY IF EXISTS "org processos insert" ON storage.objects;
CREATE POLICY "org processos insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'org-processos' AND (public.org_proc_pode('incluir') OR public.org_proc_pode('alterar')));
DROP POLICY IF EXISTS "org processos delete" ON storage.objects;
CREATE POLICY "org processos delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'org-processos' AND (public.org_proc_pode('alterar') OR public.org_proc_pode('excluir')));

-- ── 5) Leitura montada (com foto) e publicação ───────────────────────────
-- A estrutura inteira num jsonb: o que as duas telas desenham. Foto: login
-- do membro, senão o login do cadastro (EMPREGADOS.auth_user_id).
CREATE OR REPLACE FUNCTION public.org_proc_montar()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'unidades', COALESCE((SELECT jsonb_agg(to_jsonb(u) || jsonb_build_object('avatar_url',
                   (SELECT p.avatar_url FROM public.profiles p WHERE p.id = COALESCE(u.user_id,
                      (SELECT e.auth_user_id FROM public."EMPREGADOS" e WHERE e."ID" = u.empregado_id))))
                   ORDER BY u.tipo DESC, u.ordem, u.nome) FROM public."ORG_PROC_UNIDADE" u), '[]'::jsonb),
    'setores', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.ordem, s.nome) FROM public."ORG_PROC_SETOR" s WHERE s.ativo), '[]'::jsonb),
    'membros', COALESCE((SELECT jsonb_agg(to_jsonb(m) || jsonb_build_object('avatar_url',
                   (SELECT p.avatar_url FROM public.profiles p WHERE p.id = COALESCE(m.user_id,
                      (SELECT e.auth_user_id FROM public."EMPREGADOS" e WHERE e."ID" = m.empregado_id))))
                   ORDER BY m.nivel, m.ordem, m.nome) FROM public."ORG_PROC_MEMBRO" m), '[]'::jsonb),
    'macros', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.ordem, x.nome) FROM public."ORG_PROC_MACRO" x), '[]'::jsonb),
    'processos', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.ordem, p.codigo) FROM public."ORG_PROC_PROCESSO" p), '[]'::jsonb),
    'conexoes', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM public."ORG_PROC_CONEXAO" c), '[]'::jsonb),
    'documentos', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.created_at) FROM public."ORG_PROC_DOCUMENTO" d), '[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION public.org_proc_montar() FROM PUBLIC, anon, authenticated;

-- p_publicada: a última publicação (o Organograma Geral); sem publicação
-- ainda, ou com false (cadastro e pré-visualização), o rascunho.
CREATE OR REPLACE FUNCTION public.org_proc_estrutura(p_publicada boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v public."ORG_PROC_PUBLICACAO";
BEGIN
  IF NOT public.org_proc_pode_ver() THEN
    RAISE EXCEPTION 'Sem acesso à Estrutura de Setores e Processos.' USING ERRCODE = '42501';
  END IF;
  IF p_publicada THEN
    SELECT * INTO v FROM public."ORG_PROC_PUBLICACAO" ORDER BY versao DESC LIMIT 1;
    IF v.id IS NOT NULL THEN
      RETURN v.dados || jsonb_build_object('publicacao', jsonb_build_object('versao', v.versao, 'em', v.publicado_em, 'por', v.publicado_por));
    END IF;
  END IF;
  -- Rascunho: só quem edita vê o que ainda não foi publicado.
  IF p_publicada OR public.org_proc_pode('visualizar') THEN
    RETURN public.org_proc_montar() || jsonb_build_object('publicacao', NULL, 'rascunho', true);
  END IF;
  RAISE EXCEPTION 'Sem acesso ao rascunho da estrutura.' USING ERRCODE = '42501';
END $fn$;
REVOKE ALL ON FUNCTION public.org_proc_estrutura(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_proc_estrutura(boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.org_proc_publicar(p_observacao text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_versao int;
BEGIN
  IF NOT public.org_proc_pode('alterar') THEN
    RAISE EXCEPTION 'Sem permissão para publicar a estrutura.' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(max(versao), 0) + 1 INTO v_versao FROM public."ORG_PROC_PUBLICACAO";
  INSERT INTO public."ORG_PROC_PUBLICACAO" (versao, dados, observacao, publicado_por)
  VALUES (v_versao, public.org_proc_montar(), NULLIF(btrim(p_observacao), ''),
          (SELECT coalesce(nullif(btrim(p.display_name), ''), p.email) FROM public.profiles p WHERE p.id = auth.uid()));
  RETURN v_versao;
END $fn$;
REVOKE ALL ON FUNCTION public.org_proc_publicar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_proc_publicar(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.org_proc_historico()
RETURNS TABLE(versao int, observacao text, publicado_por text, publicado_em timestamptz, setores int, processos int, conexoes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.versao, p.observacao, p.publicado_por, p.publicado_em,
         jsonb_array_length(p.dados -> 'setores'), jsonb_array_length(p.dados -> 'processos'), jsonb_array_length(p.dados -> 'conexoes')
    FROM public."ORG_PROC_PUBLICACAO" p
   WHERE public.org_proc_pode_ver()
   ORDER BY p.versao DESC
$$;
REVOKE ALL ON FUNCTION public.org_proc_historico() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_proc_historico() TO authenticated;

-- Pessoas do cadastro para vincular a um membro/unidade (nome, cargo, foto).
CREATE OR REPLACE FUNCTION public.org_proc_buscar_pessoas(p_busca text)
RETURNS TABLE(empregado_id bigint, nome text, cargo text, setor text, user_id uuid, avatar_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT (public.org_proc_pode('incluir') OR public.org_proc_pode('alterar')) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT e."ID"::bigint, e."Nome"::text, e."Título do Cargo"::text, e."Setor_ERP"::text, e.auth_user_id,
           (SELECT p.avatar_url FROM public.profiles p WHERE p.id = e.auth_user_id)
      FROM public."EMPREGADOS" e
     WHERE e."Situação" = 'Trabalhando'
       AND length(btrim(coalesce(p_busca, ''))) >= 2
       AND e."Nome" ILIKE '%' || btrim(p_busca) || '%'
     ORDER BY e."Nome"
     LIMIT 20;
END $fn$;
REVOKE ALL ON FUNCTION public.org_proc_buscar_pessoas(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_proc_buscar_pessoas(text) TO authenticated;

-- ── 6) Carga inicial (do "Processos gerais") — só se estiver vazio ───────
DO $seed$
DECLARE
  v_pres uuid; v_adm uuid; v_ope uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public."ORG_PROC_SETOR") THEN RETURN; END IF;

  INSERT INTO public."ORG_PROC_UNIDADE" (codigo, tipo, nome, subtitulo, responsavel_nome, responsavel_cargo, cor, ordem)
  VALUES ('presidencia', 'presidencia', 'Presidência', 'Direção Geral da Empresa', 'Helena', 'Presidência (CEO)', 'green', 0)
  RETURNING id INTO v_pres;
  INSERT INTO public."ORG_PROC_UNIDADE" (codigo, tipo, nome, subtitulo, parent_id, cor, ordem)
  VALUES ('dir_adm', 'diretoria', 'Diretoria Administrativa', 'Gestão Administrativa e de Suporte', v_pres, 'blue', 1)
  RETURNING id INTO v_adm;
  INSERT INTO public."ORG_PROC_UNIDADE" (codigo, tipo, nome, subtitulo, parent_id, cor, ordem)
  VALUES ('dir_ope', 'diretoria', 'Diretoria Operacional', 'Gestão Operacional e de Execução', v_pres, 'orange', 2)
  RETURNING id INTO v_ope;

  INSERT INTO public."ORG_PROC_SETOR" (codigo, nome, unidade_id, icone, cor, ordem) VALUES
    ('controladoria', 'Controladoria', v_adm, 'chart', 'green', 1),
    ('financeiro', 'Financeiro', v_adm, 'money', 'purple', 2),
    ('rh', 'RH', v_adm, 'users', 'blue', 3),
    ('ti', 'TI / Sistemas', v_adm, 'monitor', 'red', 4),
    ('juridico', 'Jurídico', v_adm, 'scale', 'violet', 5),
    ('administrativo', 'Administrativo', v_adm, 'building', 'slate', 6),
    ('treinamentos', 'Treinamentos e R&S', v_ope, 'graduation', 'amber', 7),
    ('compras', 'Compras / Supply', v_ope, 'cart', 'teal', 8),
    ('operacional', 'Operacional', v_ope, 'gear', 'rose', 9),
    ('sst', 'SST', v_ope, 'shield', 'sky', 10);

  INSERT INTO public."ORG_PROC_MACRO" (codigo, nome, cor, ordem) VALUES
    ('planejamento', 'Planejamento Orçamentário', 'slate', 1),
    ('contratos', 'Contratos', 'blue', 2),
    ('execucao', 'Execução de Serviços', 'green', 3),
    ('faturamento', 'Faturamento', 'purple', 4),
    ('fechamento', 'Fechamento/Auditoria', 'sky', 5);

  -- Equipes (nível: 1 gerência … 6 jovem aprendiz)
  INSERT INTO public."ORG_PROC_MEMBRO" (setor_id, nome, cargo, nivel, responsavel, atividades, ordem)
  SELECT s.id, x.nome, x.cargo, x.nivel, x.resp, x.ativ, x.ordem
    FROM (VALUES
      ('controladoria', 'Yuri', 'Gerente de Controladoria', 1, true,
        E'Monitora e garante a confiabilidade das informações econômicas e financeiras\nAnálises de desempenho por contrato, centro de custo e área\nOrçamento empresarial (budget) e projeções\nRelatórios gerenciais com indicadores de rentabilidade, produtividade e margem\nControle interno e prevenção de desvios\nApoia a diretoria na tomada de decisões estratégicas', 1),
      ('controladoria', 'Érica', 'Supervisora de Processos', 2, false,
        E'Mapeamento de processos e geração de POPs\nGestão do Plano de Ações\nGestão de status das ações', 2),
      ('financeiro', 'Gerente Financeiro', 'Gerente Financeiro', 1, true, NULL, 1),
      ('financeiro', 'Cálita', 'Analista de Contas a Pagar', 3, false, E'Pagamento de malote\nComprovantes de pagamento', 2),
      ('financeiro', 'Carol', 'Analista de Contas a Receber', 3, false, E'Cobranças\nEmissão de notas', 3),
      ('financeiro', 'Ruan', 'Analista Financeiro — Contas a Receber', 3, false, NULL, 4),
      ('financeiro', 'Renan', 'Assistente Financeiro', 4, false, E'Conferência e liberação do malote', 5),
      ('financeiro', 'Ana', 'Assistente Financeiro', 4, false, NULL, 6),
      ('financeiro', 'Assistente de documentação', 'Assistente de Documentação', 4, false, E'Juntada de documentação para pagamento de nota', 7),
      ('financeiro', 'Estagiário de documentação', 'Estagiário de Documentação', 5, false, NULL, 8),
      ('financeiro', 'Eduarda', 'Jovem Aprendiz', 6, false, NULL, 9),
      ('rh', 'Alessandra', 'Gerente de RH', 1, true, NULL, 1),
      ('rh', 'Fabricio', 'Consultor Externo Sênior', 2, false, NULL, 2),
      ('rh', 'Tainara', 'Supervisora de DP', 2, false, NULL, 3),
      ('rh', 'Maiara', 'Analista de DP', 3, false, E'Admissão\nAfastamentos', 4),
      ('rh', 'Stefani', 'Assistente II de DP', 4, false, NULL, 5),
      ('rh', 'Dani', 'Assistente I de DP', 4, false, NULL, 6),
      ('rh', 'Larissa', 'Assistente I de DP', 4, false, NULL, 7),
      ('rh', 'Nathaly', 'Estagiária de DP', 5, false, NULL, 8),
      ('ti', 'Iury', 'Líder de TI / Comunicação', 1, true, E'Gestão técnica do TI\nValidação e criação de relatórios no ERP e Power BI', 1),
      ('ti', 'Eduardo', 'Analista de Sistemas', 3, false, E'Programação do ERP', 2),
      ('ti', 'Pablo', 'Analista de Sistemas', 3, false, E'Programação do ERP', 3),
      ('ti', 'Peretti', 'Assistente de TI', 4, false, NULL, 4),
      ('juridico', 'Natália', 'Gerente Jurídico', 1, true, NULL, 1),
      ('juridico', 'Gustavo', 'Analista Júnior', 3, false, NULL, 2),
      ('juridico', 'João', 'Assistente Jurídico', 4, false, NULL, 3),
      ('juridico', 'Higor', 'Assistente Jurídico', 4, false, NULL, 4),
      ('juridico', 'Estagiário — Arquivos', 'Estagiário do Setor de Arquivos', 5, false, NULL, 5),
      ('juridico', 'Thiago', 'Jovem Aprendiz', 6, false, NULL, 6),
      ('administrativo', 'Ellem', 'Assistente Administrativo', 4, true, E'IPTUs, IPVA e seguros\nPagamentos de imóveis\nOrganização dos contratos', 1),
      ('treinamentos', 'Francieli', 'Supervisora de Treinamentos e R&S', 2, true, E'Entrevistas\nSupervisão das contratações\nTreinamentos', 1),
      ('treinamentos', 'Tiane', 'Auxiliar Administrativo', 5, false, NULL, 2),
      ('treinamentos', 'Anita', 'Jovem Aprendiz', 6, false, NULL, 3),
      ('treinamentos', 'Giovana', 'Jovem Aprendiz', 6, false, NULL, 4),
      ('treinamentos', 'Sofia', 'Jovem Aprendiz', 6, false, NULL, 5),
      ('compras', 'Cássio', 'Gerente de Supply', 1, true, E'Garantir que a operação tenha tudo o que precisa'::text, 1),
      ('compras', 'Clei', 'Supervisor de Compras', 2, false, NULL, 2),
      ('compras', 'Isadora', 'Supervisora de Almoxarifado', 2, false, E'Controle de estoque\nAcuracidade, estoque parado, divergências e rupturas', 3),
      ('compras', 'Luis', 'Assistente de Supply', 4, false, E'Gestão de frota', 4),
      ('compras', 'Natana', 'Assistente de Supply', 4, false, NULL, 5),
      ('compras', 'Joel', 'Assistente de Supply', 4, false, NULL, 6),
      ('compras', 'Fernando', 'Almoxarife', 4, false, E'Recebimento e entrega de material', 7),
      ('compras', 'Talis', 'Almoxarife', 4, false, E'Controle de estoque', 8),
      ('compras', 'Mateus', 'Jovem Aprendiz', 6, false, E'Apoio no fornecimento de materiais para contratos', 9),
      ('operacional', 'Daison', 'Gerente Operacional', 1, true,
        E'Reunião semanal da operação (indicadores, execução contratual, desvios)\nAprovação da agenda semanal de visitas\nControle de postos orçados x executados\nRelacionamento com fiscais dos órgãos contratantes', 1),
      ('operacional', 'Gustavo', 'Supervisor Operacional', 2, false,
        E'Relacionamento com os fiscais dos contratos\nAgenda semanal de visitas\nAlinhamento com os encarregados\nAumento e diminuição de postos', 2),
      ('operacional', 'Ismael', 'Supervisor Operacional', 2, false, NULL, 3),
      ('operacional', 'Afranio', 'Analista de Contratos (externo)', 3, false, NULL, 4),
      ('operacional', 'Gustavo', 'Analista de Contratos', 3, false, E'Conferência de pontos\nLevantamento de desvios dos contratos', 5),
      ('operacional', 'Alessandra', 'Analista de Contratos', 3, false, NULL, 6),
      ('operacional', 'Ane', 'Analista de Contratos', 3, false, NULL, 7),
      ('operacional', 'Encarregados', 'Encarregados / Prepostos', 5, false, E'Execução dos serviços nos postos\nPontos e absenteísmo da equipe', 8),
      ('sst', 'Milena', 'Supervisora de SST', 2, true,
        E'Gestão completa da Saúde e Segurança do Trabalho\nExames ocupacionais e treinamentos do setor\nInvestigação de acidentes e indicadores', 1),
      ('sst', 'Priscila', 'Técnica de Segurança do Trabalho', 4, false, NULL, 2),
      ('sst', 'Viviane', 'Técnica de Segurança do Trabalho', 4, false, NULL, 3),
      ('sst', 'Enfermeira', 'Enfermeira do Trabalho', 3, false,
        E'Análise de atestados médicos\nMonitoramento de gestantes\nAcompanhamento de afastados pelo INSS\nCampanhas mensais de saúde', 4),
      ('sst', 'Alexandra', 'Estagiária', 5, false, NULL, 5)
    ) AS x(setor, nome, cargo, nivel, resp, ativ, ordem)
    JOIN public."ORG_PROC_SETOR" s ON s.codigo = x.setor;

  -- Quem responde a quem: cada um ao responsável do setor (ajustável na tela).
  UPDATE public."ORG_PROC_MEMBRO" m SET parent_id = r.id
    FROM public."ORG_PROC_MEMBRO" r
   WHERE r.setor_id = m.setor_id AND r.responsavel AND m.id <> r.id AND NOT m.responsavel;

  -- Processos (na ordem do fluxo de cada setor)
  INSERT INTO public."ORG_PROC_PROCESSO" (unidade_id, nome, frequencia, ordem, principal)
  VALUES (v_pres, 'Planejamento Estratégico', 'Anual', 1, true),
         (v_pres, 'Definição de Diretrizes', 'Anual', 2, true),
         (v_pres, 'Aprovação de Projetos', 'Sob demanda', 3, true),
         (v_pres, 'Monitoramento de Resultados', 'Mensal', 4, true);

  INSERT INTO public."ORG_PROC_PROCESSO" (setor_id, nome, frequencia, macro_id, ordem, principal, responsavel_membro_id)
  SELECT s.id, x.nome, x.freq, (SELECT id FROM public."ORG_PROC_MACRO" WHERE codigo = x.macro), x.ordem, x.ordem <= 4,
         (SELECT m.id FROM public."ORG_PROC_MEMBRO" m WHERE m.setor_id = s.id AND m.nome = x.resp ORDER BY m.ordem LIMIT 1)
    FROM (VALUES
      ('controladoria', 'Receber dados dos setores', 'Mensal', 'fechamento', 1, 'Yuri'),
      ('controladoria', 'Validar informações', 'Mensal', 'fechamento', 2, 'Yuri'),
      ('controladoria', 'Consolidar relatórios gerenciais', 'Mensal', 'planejamento', 3, 'Yuri'),
      ('controladoria', 'Acompanhamento de fechamentos', 'Mensal', 'fechamento', 4, 'Yuri'),
      ('controladoria', 'Geração de POPs', 'Sob demanda', NULL, 5, 'Érica'),
      ('controladoria', 'Gestão do Plano de Ações', 'Semanal', 'planejamento', 6, 'Érica'),
      ('financeiro', 'Pagamento de malote', 'Diária', 'fechamento', 1, 'Cálita'),
      ('financeiro', 'Emissão de notas', 'Mensal', 'faturamento', 2, 'Carol'),
      ('financeiro', 'Cobranças', 'Semanal', 'faturamento', 3, 'Carol'),
      ('financeiro', 'Juntada de documentação para pagamento de nota', 'Mensal', 'faturamento', 4, 'Assistente de documentação'),
      ('financeiro', 'Planilha de apontamentos e glosas e acompanhamento de despachos', 'Mensal', 'faturamento', 5, 'Ruan'),
      ('rh', 'Admissão', 'Sob demanda', 'execucao', 1, 'Maiara'),
      ('rh', 'Afastamento', 'Sob demanda', NULL, 2, 'Maiara'),
      ('rh', 'Óbito', 'Sob demanda', NULL, 3, 'Tainara'),
      ('ti', 'Receber demandas de sistemas', 'Diária', NULL, 1, 'Iury'),
      ('ti', 'Criação de módulos do ERP', 'Sob demanda', NULL, 2, 'Pablo'),
      ('ti', 'Relatórios no ERP e Power BI', 'Semanal', 'planejamento', 3, 'Iury'),
      ('ti', 'Gestão técnica do TI', 'Diária', NULL, 4, 'Iury'),
      ('juridico', 'Pareceres Jurídicos', 'Sob demanda', 'contratos', 1, 'Natália'),
      ('juridico', 'Atuação como Preposta Trabalhista', 'Sob demanda', NULL, 2, 'Natália'),
      ('juridico', 'Apuração e Respostas a Denúncias', 'Sob demanda', NULL, 3, 'Gustavo'),
      ('juridico', 'Sistema de Compliance', 'Mensal', NULL, 4, 'Gustavo'),
      ('juridico', 'Advertências', 'Sob demanda', NULL, 5, 'João'),
      ('juridico', 'Gestão Disciplinar', 'Sob demanda', NULL, 6, 'Natália'),
      ('juridico', 'Defesas Administrativas', 'Sob demanda', 'contratos', 7, 'Gustavo'),
      ('juridico', 'Reclamatórias Trabalhistas', 'Sob demanda', NULL, 8, 'Natália'),
      ('juridico', 'Audiências', 'Sob demanda', NULL, 9, 'Natália'),
      ('juridico', 'Elaboração de Ofícios', 'Sob demanda', NULL, 10, 'Higor'),
      ('juridico', 'Controle e Atualização de Planilhas Jurídicas', 'Semanal', NULL, 11, 'Thiago'),
      ('administrativo', 'Organização dos Contratos', 'Mensal', 'contratos', 1, 'Ellem'),
      ('administrativo', 'IPTUs e IPVA', 'Anual', NULL, 2, 'Ellem'),
      ('administrativo', 'Seguros', 'Anual', NULL, 3, 'Ellem'),
      ('administrativo', 'Pagamentos e Parcelamentos de Imóveis', 'Mensal', 'fechamento', 4, 'Ellem'),
      ('administrativo', 'Prédio Novo e RGE', 'Mensal', NULL, 5, 'Ellem'),
      ('treinamentos', 'Recrutamento e Seleção', 'Sob demanda', 'execucao', 1, 'Francieli'),
      ('treinamentos', 'Treinamentos', 'Semanal', 'execucao', 2, 'Francieli'),
      ('treinamentos', 'Solicitação de Uniformes', 'Sob demanda', NULL, 3, 'Tiane'),
      ('treinamentos', 'Material de treinamentos', 'Mensal', NULL, 4, 'Francieli'),
      ('compras', 'Solicitação de cotação', 'Diária', 'execucao', 1, 'Clei'),
      ('compras', 'Compras', 'Diária', 'execucao', 2, 'Clei'),
      ('compras', 'Recebimento e armazenamento de material', 'Diária', NULL, 3, 'Fernando'),
      ('compras', 'Entrega de material', 'Diária', 'execucao', 4, 'Fernando'),
      ('compras', 'Conferência de estoque', 'Semanal', NULL, 5, 'Isadora'),
      ('compras', 'Política de estoque mínimo', 'Mensal', 'planejamento', 6, 'Cássio'),
      ('compras', 'Gestão de frota', 'Diária', NULL, 7, 'Luis'),
      ('operacional', 'Solicitação de contratação', 'Sob demanda', 'contratos', 1, 'Daison'),
      ('operacional', 'Conferência de pontos', 'Mensal', 'execucao', 2, 'Gustavo'),
      ('operacional', 'Elaboração de planos de ação', 'Semanal', 'execucao', 3, 'Daison'),
      ('operacional', 'Geração de ordem de faturamento', 'Mensal', 'faturamento', 4, 'Alessandra'),
      ('operacional', 'Conferência e liberação de pontos', 'Mensal', 'execucao', 5, 'Gustavo'),
      ('operacional', 'Diárias e horas extras', 'Mensal', 'execucao', 6, 'Ane'),
      ('operacional', 'Lista de colaboradores CGU e CNJ', 'Mensal', 'contratos', 7, 'Afranio'),
      ('operacional', 'Advertências', 'Sob demanda', NULL, 8, 'Ismael'),
      ('operacional', 'Gestão de férias e absenteísmo', 'Semanal', 'execucao', 9, 'Ismael'),
      ('operacional', 'Gestão de demissão', 'Sob demanda', NULL, 10, 'Daison'),
      ('operacional', 'Materiais, EPIs e uniformes', 'Sob demanda', 'execucao', 11, 'Encarregados'),
      ('sst', 'Saúde ocupacional', 'Diária', NULL, 1, 'Enfermeira'),
      ('sst', 'Agendamento de ASO', 'Diária', 'execucao', 2, 'Milena'),
      ('sst', 'Gestão de PCD', 'Mensal', NULL, 3, 'Milena'),
      ('sst', 'PPP, PCMSO, PGR e LTCAT', 'Anual', NULL, 4, 'Priscila'),
      ('sst', 'Campanhas mensais de saúde', 'Mensal', NULL, 5, 'Enfermeira'),
      ('sst', 'Acompanhamento de perícia judicial', 'Sob demanda', NULL, 6, 'Viviane')
    ) AS x(setor, nome, freq, macro, ordem, resp)
    JOIN public."ORG_PROC_SETOR" s ON s.codigo = x.setor;

  -- Fluxo interno: cada processo aponta para o seguinte do mesmo setor.
  UPDATE public."ORG_PROC_PROCESSO" p SET proximo_id = n.id
    FROM public."ORG_PROC_PROCESSO" n
   WHERE n.ordem = p.ordem + 1
     AND ((p.setor_id IS NOT NULL AND n.setor_id = p.setor_id) OR (p.setor_id IS NULL AND n.setor_id IS NULL AND n.unidade_id = p.unidade_id));

  -- Conexões entre setores (as do "Processos gerais": malote, jurídico, contratação…)
  INSERT INTO public."ORG_PROC_CONEXAO" (origem_id, destino_id, tipo, rotulo)
  SELECT o.id, d.id, x.tipo, x.rotulo
    FROM (VALUES
      ('operacional', 'Solicitação de contratação', 'treinamentos', 'Recrutamento e Seleção', 'intersetorial', 'Pedido de vaga'),
      ('treinamentos', 'Recrutamento e Seleção', 'sst', 'Agendamento de ASO', 'intersetorial', 'ASO admissional'),
      ('treinamentos', 'Recrutamento e Seleção', 'rh', 'Admissão', 'intersetorial', 'Candidato aprovado'),
      ('sst', 'Agendamento de ASO', 'rh', 'Admissão', 'retorno', 'ASO apto'),
      ('operacional', 'Geração de ordem de faturamento', 'financeiro', 'Emissão de notas', 'intersetorial', 'Ordem de faturamento'),
      ('operacional', 'Conferência e liberação de pontos', 'rh', 'Afastamento', 'revisao', 'Atestados e afastamentos'),
      ('operacional', 'Advertências', 'juridico', 'Advertências', 'intersetorial', 'Advertência'),
      ('operacional', 'Materiais, EPIs e uniformes', 'compras', 'Solicitação de cotação', 'intersetorial', 'Requisição'),
      ('compras', 'Compras', 'financeiro', 'Pagamento de malote', 'intersetorial', 'Malote de compras'),
      ('sst', 'Saúde ocupacional', 'financeiro', 'Pagamento de malote', 'intersetorial', 'Malote do SST'),
      ('sst', 'Acompanhamento de perícia judicial', 'juridico', 'Audiências', 'intersetorial', 'Envia ao Jurídico'),
      ('administrativo', 'Pagamentos e Parcelamentos de Imóveis', 'financeiro', 'Pagamento de malote', 'intersetorial', 'Malote'),
      ('financeiro', 'Pagamento de malote', 'controladoria', 'Receber dados dos setores', 'intersetorial', 'Despesas pagas'),
      ('operacional', 'Elaboração de planos de ação', 'controladoria', 'Receber dados dos setores', 'intersetorial', 'Planos de ação'),
      ('controladoria', 'Validar informações', 'operacional', 'Elaboração de planos de ação', 'retorno', 'Desvios para corrigir'),
      ('ti', 'Relatórios no ERP e Power BI', 'controladoria', 'Consolidar relatórios gerenciais', 'intersetorial', 'Relatórios e BI'),
      ('controladoria', 'Geração de POPs', 'ti', 'Receber demandas de sistemas', 'revisao', 'Solicitações de sistema'),
      ('treinamentos', 'Solicitação de Uniformes', 'compras', 'Entrega de material', 'intersetorial', 'Uniformes')
    ) AS x(so, po, sd, pd, tipo, rotulo)
    JOIN public."ORG_PROC_SETOR" s1 ON s1.codigo = x.so
    JOIN public."ORG_PROC_PROCESSO" o ON o.setor_id = s1.id AND o.nome = x.po
    JOIN public."ORG_PROC_SETOR" s2 ON s2.codigo = x.sd
    JOIN public."ORG_PROC_PROCESSO" d ON d.setor_id = s2.id AND d.nome = x.pd
  ON CONFLICT (origem_id, destino_id) DO NOTHING;
END $seed$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.org_proc_buscar_pessoas(text), public.org_proc_historico(), public.org_proc_publicar(text),
--   public.org_proc_estrutura(boolean), public.org_proc_montar(), public.org_proc_membro_sem_ciclo(),
--   public.org_proc_processo_codigo(), public.org_proc_pode_ver(), public.org_proc_pode(text);
-- DROP POLICY IF EXISTS "org processos select" ON storage.objects;
-- DROP POLICY IF EXISTS "org processos insert" ON storage.objects;
-- DROP POLICY IF EXISTS "org processos delete" ON storage.objects;
-- DROP TABLE IF EXISTS public."ORG_PROC_PUBLICACAO", public."ORG_PROC_DOCUMENTO", public."ORG_PROC_CONEXAO", public."ORG_PROC_PROCESSO",
--   public."ORG_PROC_MACRO", public."ORG_PROC_MEMBRO", public."ORG_PROC_SETOR", public."ORG_PROC_UNIDADE";
-- DROP SEQUENCE IF EXISTS public.org_proc_processo_seq;
-- DELETE FROM public.app_menu WHERE codigo IN ('organograma_processos', 'organograma_processos_cadastro');
