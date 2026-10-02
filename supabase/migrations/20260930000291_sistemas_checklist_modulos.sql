-- =========================================================================
-- Sistemas › CHECKLIST DE MÓDULOS (02/10/2026)
--
-- Solicitação: "Criar módulo para acompanhar criação, implantação,
-- treinamento, medição de uso de cada módulo por cada usuário, cadastro de
-- bugs e encaminhamento inicial de chamados e demais ferramentas que acharem
-- necessário." Pedido do Pablo: "um checklist completo de todos os sistemas
-- — ao clicar no módulo aparecem todos os submódulos e o status de tudo.
-- Deixa pendente de preenchimento: o gerente de sistemas vai preencher."
--
-- O CATÁLOGO não é cadastrado à mão: são os módulos (app_modulo) e as telas
-- (app_menu com rota) que já governam o acesso. Tela nova entra sozinha no
-- checklist, como "pendente de preenchimento". Capacidade (menu fantasma,
-- rota NULL) não é tela e fica de fora.
--
-- Tabelas:
--   SIS_CHECKLIST            status de cada tela (menu_id) e dados do módulo
--                            (menu_id NULL): desenvolvimento, implantação,
--                            treinamento, validação do usuário-chave,
--                            responsável, datas, observações. NULL = pendente.
--   SIS_CHECKLIST_HIST       cada mudança de status, gravada por gatilho.
--   SIS_USO_TELA             acessos por usuário × tela × dia (RouteGuard →
--                            sis_registrar_uso). É a "medição de uso".
--   SIS_TREINAMENTO_USUARIO  quem foi treinado em cada módulo/tela.
--   SIS_BUG                  bugs por módulo/tela; "Encaminhar" abre o
--                            chamado de sistemas (CHAMADO_SISTEMA) já
--                            preenchido e guarda o vínculo.
--
-- Acesso (tela sistemas_checklist_modulos, em Sistemas):
--   visualizar → vê tudo;   incluir → registra bug;
--   alterar    → preenche o checklist, treinamentos, triagem e encaminhamento
--                de bug;     excluir → apaga bug / treinamento.
-- Semeado: quem tem "Gerente de Sistemas" ganha tudo; quem tem o Painel do
-- Desenvolvedor ganha ver + registrar bug.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── A tela ───────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sistemas_checklist_modulos', 'Checklist de Módulos', '/app/sistemas/checklist-modulos', 5, true
  FROM public.app_modulo m
 WHERE m.codigo = 'sistemas'
ON CONFLICT (modulo_id, codigo) DO NOTHING;
UPDATE public.app_menu SET ativo = true WHERE codigo = 'sistemas_checklist_modulos';

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT DISTINCT s.user_id, 'sistemas_checklist_modulos', a.acao, true,
       'Migração 20260930000291: Gerente de Sistemas'
  FROM public.screen_permission_user s
 CROSS JOIN (VALUES ('visualizar'::public.app_acao), ('incluir'::public.app_acao), ('alterar'::public.app_acao),
                    ('excluir'::public.app_acao), ('exportar'::public.app_acao)) AS a(acao)
 WHERE s.menu_codigo = 'sistemas_gerente_sistemas' AND s.allow AND s.acao = 'visualizar'::public.app_acao
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id AND x.menu_codigo = 'sistemas_checklist_modulos' AND x.acao = a.acao);

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT DISTINCT s.user_id, 'sistemas_checklist_modulos', a.acao, true,
       'Migração 20260930000291: Painel do Desenvolvedor'
  FROM public.screen_permission_user s
 CROSS JOIN (VALUES ('visualizar'::public.app_acao), ('incluir'::public.app_acao)) AS a(acao)
 WHERE s.menu_codigo = 'chamados_sistemas_dev' AND s.allow AND s.acao = 'visualizar'::public.app_acao
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id AND x.menu_codigo = 'sistemas_checklist_modulos' AND x.acao = a.acao);

CREATE OR REPLACE FUNCTION public.sis_ck_pode(_acao public.app_acao)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND public.has_screen_access(auth.uid(), 'sistemas_checklist_modulos', _acao);
$f$;
REVOKE ALL ON FUNCTION public.sis_ck_pode(public.app_acao) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sis_ck_pode(public.app_acao) TO authenticated;

CREATE OR REPLACE FUNCTION public.sis_ck_nome_usuario(_uid uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT coalesce(nullif(btrim(display_name), ''), email) FROM public.profiles WHERE id = _uid;
$f$;
REVOKE ALL ON FUNCTION public.sis_ck_nome_usuario(uuid) FROM PUBLIC, anon;

-- ── Checklist ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SIS_CHECKLIST" (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modulo_id           uuid NOT NULL REFERENCES public.app_modulo(id) ON DELETE CASCADE,
  menu_id             uuid REFERENCES public.app_menu(id) ON DELETE CASCADE,
  status_dev          text CHECK (status_dev IN ('nao_iniciado', 'em_desenvolvimento', 'em_homologacao', 'pronto')),
  status_implantacao  text CHECK (status_implantacao IN ('nao_implantado', 'em_implantacao', 'implantado')),
  status_treinamento  text CHECK (status_treinamento IN ('pendente', 'agendado', 'treinado', 'nao_se_aplica')),
  status_validacao    text CHECK (status_validacao IN ('pendente', 'em_validacao', 'validado', 'reprovado')),
  responsavel_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  usuario_chave_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  previsao_entrega    date,
  data_implantacao    date,
  data_treinamento    date,
  data_validacao      date,
  observacoes         text,
  atualizado_por      text,
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public."SIS_CHECKLIST" IS
  'Sistemas › Checklist de Módulos: status de cada tela (menu_id) e dados do módulo (menu_id NULL). Status NULL = pendente de preenchimento. Mig 291.';
CREATE UNIQUE INDEX IF NOT EXISTS sis_checklist_alvo_uq
  ON public."SIS_CHECKLIST" (modulo_id, coalesce(menu_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE IF NOT EXISTS public."SIS_CHECKLIST_HIST" (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  checklist_id  uuid,
  modulo_id     uuid,
  menu_id       uuid,
  campo         text NOT NULL,
  de            text,
  para          text,
  usuario_id    uuid,
  usuario_nome  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sis_checklist_hist_quando_idx ON public."SIS_CHECKLIST_HIST" (created_at DESC);
CREATE INDEX IF NOT EXISTS sis_checklist_hist_modulo_idx ON public."SIS_CHECKLIST_HIST" (modulo_id, created_at DESC);

-- Carimbo + histórico de cada campo de status/responsável/data.
CREATE OR REPLACE FUNCTION public.sis_checklist_carimbo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  NEW.atualizado_por := coalesce(public.sis_ck_nome_usuario(auth.uid()), 'Sistema');
  NEW.atualizado_em := now();
  RETURN NEW;
END $f$;

CREATE OR REPLACE FUNCTION public.sis_checklist_historico()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_nome text := coalesce(public.sis_ck_nome_usuario(auth.uid()), 'Sistema');
  k text;
  v_de text;
  v_para text;
  v_campos text[] := ARRAY['status_dev', 'status_implantacao', 'status_treinamento', 'status_validacao',
                           'responsavel_id', 'usuario_chave_id', 'previsao_entrega', 'data_implantacao',
                           'data_treinamento', 'data_validacao', 'observacoes'];
BEGIN
  FOREACH k IN ARRAY v_campos LOOP
    v_para := to_jsonb(NEW) ->> k;
    v_de := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ->> k END;
    IF v_para IS DISTINCT FROM v_de AND NOT (TG_OP = 'INSERT' AND v_para IS NULL) THEN
      -- Pessoa: grava o nome, não o uuid.
      IF k IN ('responsavel_id', 'usuario_chave_id') THEN
        v_de := public.sis_ck_nome_usuario(v_de::uuid);
        v_para := public.sis_ck_nome_usuario(v_para::uuid);
      END IF;
      INSERT INTO public."SIS_CHECKLIST_HIST"(checklist_id, modulo_id, menu_id, campo, de, para, usuario_id, usuario_nome)
      VALUES (NEW.id, NEW.modulo_id, NEW.menu_id, k, left(v_de, 300), left(v_para, 300), auth.uid(), v_nome);
    END IF;
  END LOOP;
  RETURN NEW;
END $f$;

DROP TRIGGER IF EXISTS trg_sis_checklist_carimbo ON public."SIS_CHECKLIST";
CREATE TRIGGER trg_sis_checklist_carimbo BEFORE INSERT OR UPDATE ON public."SIS_CHECKLIST"
  FOR EACH ROW EXECUTE FUNCTION public.sis_checklist_carimbo();
DROP TRIGGER IF EXISTS trg_sis_checklist_historico ON public."SIS_CHECKLIST";
CREATE TRIGGER trg_sis_checklist_historico AFTER INSERT OR UPDATE ON public."SIS_CHECKLIST"
  FOR EACH ROW EXECUTE FUNCTION public.sis_checklist_historico();

-- ── Uso (medição) ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SIS_USO_TELA" (
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  menu_id     uuid NOT NULL REFERENCES public.app_menu(id) ON DELETE CASCADE,
  modulo_id   uuid NOT NULL REFERENCES public.app_modulo(id) ON DELETE CASCADE,
  dia         date NOT NULL,
  acessos     integer NOT NULL DEFAULT 1,
  primeiro_em timestamptz NOT NULL DEFAULT now(),
  ultimo_em   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, menu_id, dia)
);
COMMENT ON TABLE public."SIS_USO_TELA" IS
  'Acessos por usuário × tela × dia, gravados pelo RouteGuard (sis_registrar_uso). Medição de uso do Checklist de Módulos. Mig 291.';
CREATE INDEX IF NOT EXISTS sis_uso_tela_menu_dia_idx ON public."SIS_USO_TELA" (menu_id, dia);
CREATE INDEX IF NOT EXISTS sis_uso_tela_modulo_dia_idx ON public."SIS_USO_TELA" (modulo_id, dia);

-- O RouteGuard chama a cada tela aberta com acesso. O código do menu só é
-- único dentro do módulo: desempata pela rota, como o matchMenuCode da tela.
CREATE OR REPLACE FUNCTION public.sis_registrar_uso(_menu text, _rota text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); m record;
BEGIN
  IF v_uid IS NULL OR nullif(btrim(coalesce(_menu, '')), '') IS NULL THEN RETURN; END IF;
  SELECT a.id, a.modulo_id INTO m FROM public.app_menu a
   WHERE a.codigo = _menu AND a.rota IS NOT NULL
   ORDER BY (coalesce(_rota, '') LIKE a.rota || '%') DESC, length(a.rota) DESC, a.ativo DESC
   LIMIT 1;
  IF m.id IS NULL THEN RETURN; END IF;
  INSERT INTO public."SIS_USO_TELA"(user_id, menu_id, modulo_id, dia)
  VALUES (v_uid, m.id, m.modulo_id, (now() AT TIME ZONE 'America/Sao_Paulo')::date)
  ON CONFLICT (user_id, menu_id, dia) DO UPDATE
    SET acessos = public."SIS_USO_TELA".acessos + 1, ultimo_em = now();
END $f$;
REVOKE ALL ON FUNCTION public.sis_registrar_uso(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sis_registrar_uso(text, text) TO authenticated;

-- ── Treinamentos por usuário ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SIS_TREINAMENTO_USUARIO" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modulo_id     uuid NOT NULL REFERENCES public.app_modulo(id) ON DELETE CASCADE,
  menu_id       uuid REFERENCES public.app_menu(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  treinado_em   date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  instrutor     text,
  observacao    text,
  registrado_por text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sis_treinamento_usuario_uq
  ON public."SIS_TREINAMENTO_USUARIO" (modulo_id, coalesce(menu_id, '00000000-0000-0000-0000-000000000000'::uuid), user_id);

CREATE OR REPLACE FUNCTION public.sis_treinamento_carimbo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  NEW.registrado_por := coalesce(public.sis_ck_nome_usuario(auth.uid()), NEW.registrado_por);
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS trg_sis_treinamento_carimbo ON public."SIS_TREINAMENTO_USUARIO";
CREATE TRIGGER trg_sis_treinamento_carimbo BEFORE INSERT ON public."SIS_TREINAMENTO_USUARIO"
  FOR EACH ROW EXECUTE FUNCTION public.sis_treinamento_carimbo();

-- ── Bugs ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SIS_BUG" (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  modulo_id          uuid NOT NULL REFERENCES public.app_modulo(id) ON DELETE CASCADE,
  menu_id            uuid REFERENCES public.app_menu(id) ON DELETE SET NULL,
  titulo             text NOT NULL CHECK (length(btrim(titulo)) >= 5),
  descricao          text NOT NULL CHECK (length(btrim(descricao)) >= 10),
  como_reproduzir    text,
  severidade         text NOT NULL DEFAULT 'media' CHECK (severidade IN ('baixa', 'media', 'alta', 'critica')),
  status             text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'em_analise', 'encaminhado', 'resolvido', 'descartado')),
  reportado_por_id   uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  reportado_por_nome text,
  responsavel_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  chamado_id         uuid REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE SET NULL,
  chamado_numero     text,
  resolucao          text,
  resolvido_em       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public."SIS_BUG" IS 'Bugs por módulo/tela do Checklist de Módulos; "Encaminhar" abre o CHAMADO_SISTEMA. Mig 291.';
CREATE INDEX IF NOT EXISTS sis_bug_modulo_idx ON public."SIS_BUG" (modulo_id, status);

CREATE OR REPLACE FUNCTION public.sis_bug_carimbo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.reportado_por_id := coalesce(auth.uid(), NEW.reportado_por_id);
    NEW.reportado_por_nome := coalesce(public.sis_ck_nome_usuario(NEW.reportado_por_id), NEW.reportado_por_nome);
  END IF;
  IF NEW.status IN ('resolvido', 'descartado') AND (TG_OP = 'INSERT' OR OLD.status NOT IN ('resolvido', 'descartado')) THEN
    NEW.resolvido_em := now();
  ELSIF NEW.status NOT IN ('resolvido', 'descartado') THEN
    NEW.resolvido_em := NULL;
  END IF;
  NEW.atualizado_em := now();
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS trg_sis_bug_carimbo ON public."SIS_BUG";
CREATE TRIGGER trg_sis_bug_carimbo BEFORE INSERT OR UPDATE ON public."SIS_BUG"
  FOR EACH ROW EXECUTE FUNCTION public.sis_bug_carimbo();

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public."SIS_CHECKLIST" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SIS_CHECKLIST_HIST" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SIS_USO_TELA" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SIS_TREINAMENTO_USUARIO" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SIS_BUG" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sis_checklist_select ON public."SIS_CHECKLIST";
CREATE POLICY sis_checklist_select ON public."SIS_CHECKLIST" FOR SELECT TO authenticated USING (public.sis_ck_pode('visualizar'));
DROP POLICY IF EXISTS sis_checklist_escrever ON public."SIS_CHECKLIST";
CREATE POLICY sis_checklist_escrever ON public."SIS_CHECKLIST" FOR ALL TO authenticated
  USING (public.sis_ck_pode('alterar')) WITH CHECK (public.sis_ck_pode('alterar'));

DROP POLICY IF EXISTS sis_checklist_hist_select ON public."SIS_CHECKLIST_HIST";
CREATE POLICY sis_checklist_hist_select ON public."SIS_CHECKLIST_HIST" FOR SELECT TO authenticated USING (public.sis_ck_pode('visualizar'));
-- (escrita só pelo gatilho, SECURITY DEFINER)

-- SIS_USO_TELA: sem policy de leitura direta — só pelas RPCs abaixo.

DROP POLICY IF EXISTS sis_treinamento_select ON public."SIS_TREINAMENTO_USUARIO";
CREATE POLICY sis_treinamento_select ON public."SIS_TREINAMENTO_USUARIO" FOR SELECT TO authenticated USING (public.sis_ck_pode('visualizar'));
DROP POLICY IF EXISTS sis_treinamento_incluir ON public."SIS_TREINAMENTO_USUARIO";
CREATE POLICY sis_treinamento_incluir ON public."SIS_TREINAMENTO_USUARIO" FOR INSERT TO authenticated WITH CHECK (public.sis_ck_pode('alterar'));
DROP POLICY IF EXISTS sis_treinamento_alterar ON public."SIS_TREINAMENTO_USUARIO";
CREATE POLICY sis_treinamento_alterar ON public."SIS_TREINAMENTO_USUARIO" FOR UPDATE TO authenticated
  USING (public.sis_ck_pode('alterar')) WITH CHECK (public.sis_ck_pode('alterar'));
DROP POLICY IF EXISTS sis_treinamento_excluir ON public."SIS_TREINAMENTO_USUARIO";
CREATE POLICY sis_treinamento_excluir ON public."SIS_TREINAMENTO_USUARIO" FOR DELETE TO authenticated
  USING (public.sis_ck_pode('alterar') OR public.sis_ck_pode('excluir'));

DROP POLICY IF EXISTS sis_bug_select ON public."SIS_BUG";
CREATE POLICY sis_bug_select ON public."SIS_BUG" FOR SELECT TO authenticated USING (public.sis_ck_pode('visualizar'));
DROP POLICY IF EXISTS sis_bug_incluir ON public."SIS_BUG";
CREATE POLICY sis_bug_incluir ON public."SIS_BUG" FOR INSERT TO authenticated
  WITH CHECK (public.sis_ck_pode('incluir') AND status = 'aberto' AND chamado_id IS NULL);
DROP POLICY IF EXISTS sis_bug_alterar ON public."SIS_BUG";
CREATE POLICY sis_bug_alterar ON public."SIS_BUG" FOR UPDATE TO authenticated
  USING (public.sis_ck_pode('alterar')) WITH CHECK (public.sis_ck_pode('alterar'));
DROP POLICY IF EXISTS sis_bug_excluir ON public."SIS_BUG";
CREATE POLICY sis_bug_excluir ON public."SIS_BUG" FOR DELETE TO authenticated USING (public.sis_ck_pode('excluir'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public."SIS_CHECKLIST" TO authenticated;
GRANT SELECT ON public."SIS_CHECKLIST_HIST" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."SIS_TREINAMENTO_USUARIO" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."SIS_BUG" TO authenticated;

-- ── Leitura: o painel inteiro numa chamada ───────────────────────────────
-- Uso: últimos 30 dias. "Com acesso" = permissão individual de visualizar a
-- tela (screen_permission_user) — o acesso no ERP é por usuário (README).
CREATE OR REPLACE FUNCTION public.sis_checklist_dados()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_desde date := (now() AT TIME ZONE 'America/Sao_Paulo')::date - 29;
BEGIN
  IF NOT public.sis_ck_pode('visualizar') THEN
    RAISE EXCEPTION 'Sem acesso ao Checklist de Módulos.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    -- Por módulo, pessoas DISTINTAS (com acesso a alguma tela / que usaram).
    'modulos', coalesce((SELECT jsonb_agg(jsonb_build_object(
                           'id', m.id, 'codigo', m.codigo, 'nome', m.nome, 'ordem', m.ordem, 'ativo', m.ativo,
                           'com_acesso', (SELECT count(DISTINCT s.user_id) FROM public.screen_permission_user s
                                           JOIN public.app_menu a ON a.codigo = s.menu_codigo AND a.modulo_id = m.id AND a.rota IS NOT NULL
                                          WHERE s.allow AND s.acao = 'visualizar'::public.app_acao),
                           'ativos_30d', (SELECT count(DISTINCT u.user_id) FROM public."SIS_USO_TELA" u WHERE u.modulo_id = m.id AND u.dia >= v_desde))
                           ORDER BY m.ordem NULLS LAST, m.nome)
                           FROM public.app_modulo m), '[]'::jsonb),
    'telas', coalesce((SELECT jsonb_agg(jsonb_build_object(
                         'id', a.id, 'modulo_id', a.modulo_id, 'codigo', a.codigo, 'nome', a.nome, 'rota', a.rota,
                         'ordem', a.ordem, 'ativo', a.ativo,
                         'com_acesso', (SELECT count(DISTINCT s.user_id) FROM public.screen_permission_user s
                                         WHERE s.menu_codigo = a.codigo AND s.allow AND s.acao = 'visualizar'::public.app_acao),
                         'ativos_30d', (SELECT count(DISTINCT u.user_id) FROM public."SIS_USO_TELA" u WHERE u.menu_id = a.id AND u.dia >= v_desde),
                         'acessos_30d', (SELECT coalesce(sum(u.acessos), 0) FROM public."SIS_USO_TELA" u WHERE u.menu_id = a.id AND u.dia >= v_desde),
                         'ultimo_uso', (SELECT max(u.ultimo_em) FROM public."SIS_USO_TELA" u WHERE u.menu_id = a.id))
                         ORDER BY a.ordem NULLS LAST, a.nome)
                         FROM public.app_menu a WHERE a.rota IS NOT NULL), '[]'::jsonb),
    'checklist', coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM public."SIS_CHECKLIST" c), '[]'::jsonb),
    'bugs', coalesce((SELECT jsonb_agg(jsonb_build_object('modulo_id', b.modulo_id, 'menu_id', b.menu_id, 'status', b.status, 'severidade', b.severidade))
                        FROM public."SIS_BUG" b), '[]'::jsonb),
    'chamados', coalesce((SELECT jsonb_agg(jsonb_build_object('modulo', x.modulo, 'abertos', x.abertos, 'total', x.total))
                            FROM (SELECT ch.modulo_sistema AS modulo,
                                         count(*) FILTER (WHERE ch.status NOT IN ('concluido', 'reprovado', 'cancelado')) AS abertos,
                                         count(*) AS total
                                    FROM public."CHAMADO_SISTEMA" ch GROUP BY ch.modulo_sistema) x), '[]'::jsonb),
    'treinados', coalesce((SELECT jsonb_agg(jsonb_build_object('modulo_id', t.modulo_id, 'menu_id', t.menu_id, 'qtd', t.qtd))
                             FROM (SELECT modulo_id, menu_id, count(*) qtd FROM public."SIS_TREINAMENTO_USUARIO" GROUP BY 1, 2) t), '[]'::jsonb),
    'historico', coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.created_at DESC)
                             FROM (SELECT * FROM public."SIS_CHECKLIST_HIST" ORDER BY created_at DESC LIMIT 40) h), '[]'::jsonb),
    'usuarios', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'nome', coalesce(nullif(btrim(p.display_name), ''), p.email), 'email', p.email)
                                           ORDER BY coalesce(nullif(btrim(p.display_name), ''), p.email))
                            FROM public.profiles p WHERE coalesce(p.ativo, true)), '[]'::jsonb),
    'uso_total_30d', (SELECT jsonb_build_object('usuarios', count(DISTINCT user_id), 'acessos', coalesce(sum(acessos), 0))
                        FROM public."SIS_USO_TELA" WHERE dia >= v_desde),
    'uso_desde', (SELECT min(dia) FROM public."SIS_USO_TELA")
  );
END $f$;
REVOKE ALL ON FUNCTION public.sis_checklist_dados() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sis_checklist_dados() TO authenticated;

-- Uso de um módulo, pessoa a pessoa: quem tem acesso a alguma tela dele,
-- quantos acessos e dias nos últimos N dias, último acesso, telas usadas e
-- se foi treinado (no módulo ou em alguma tela dele).
CREATE OR REPLACE FUNCTION public.sis_uso_modulo(_modulo uuid, _dias integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_desde date := (now() AT TIME ZONE 'America/Sao_Paulo')::date - greatest(coalesce(_dias, 30), 1) + 1;
BEGIN
  IF NOT public.sis_ck_pode('visualizar') THEN
    RAISE EXCEPTION 'Sem acesso ao Checklist de Módulos.' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    WITH telas AS (SELECT id, codigo, nome FROM public.app_menu WHERE modulo_id = _modulo AND rota IS NOT NULL),
    acesso AS (SELECT DISTINCT s.user_id FROM public.screen_permission_user s JOIN telas t ON t.codigo = s.menu_codigo
                WHERE s.allow AND s.acao = 'visualizar'::public.app_acao),
    uso AS (SELECT u.user_id, sum(u.acessos) acessos, count(DISTINCT u.dia) dias, max(u.ultimo_em) ultimo,
                   jsonb_agg(DISTINCT t.nome) telas
              FROM public."SIS_USO_TELA" u JOIN telas t ON t.id = u.menu_id
             WHERE u.dia >= v_desde GROUP BY u.user_id),
    ultimo_geral AS (SELECT u.user_id, max(u.ultimo_em) ultimo FROM public."SIS_USO_TELA" u WHERE u.modulo_id = _modulo GROUP BY 1),
    trein AS (SELECT DISTINCT ON (user_id) user_id, treinado_em FROM public."SIS_TREINAMENTO_USUARIO"
               WHERE modulo_id = _modulo ORDER BY user_id, treinado_em DESC),
    pessoas AS (SELECT user_id FROM acesso UNION SELECT user_id FROM uso UNION SELECT user_id FROM trein)
    SELECT jsonb_agg(jsonb_build_object(
             'user_id', p.user_id, 'nome', public.sis_ck_nome_usuario(p.user_id),
             'tem_acesso', p.user_id IN (SELECT user_id FROM acesso),
             'acessos', coalesce(u.acessos, 0), 'dias', coalesce(u.dias, 0),
             'ultimo', coalesce(u.ultimo, g.ultimo), 'telas', coalesce(u.telas, '[]'::jsonb),
             'treinado_em', tr.treinado_em)
           ORDER BY coalesce(u.acessos, 0) DESC, public.sis_ck_nome_usuario(p.user_id))
      FROM pessoas p
      LEFT JOIN uso u ON u.user_id = p.user_id
      LEFT JOIN ultimo_geral g ON g.user_id = p.user_id
      LEFT JOIN trein tr ON tr.user_id = p.user_id
  ), '[]'::jsonb);
END $f$;
REVOKE ALL ON FUNCTION public.sis_uso_modulo(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sis_uso_modulo(uuid, integer) TO authenticated;

-- Uso por dia (gráfico): acessos e usuários distintos, geral ou de um módulo.
CREATE OR REPLACE FUNCTION public.sis_uso_por_dia(_modulo uuid DEFAULT NULL, _dias integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_ate date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT public.sis_ck_pode('visualizar') THEN
    RAISE EXCEPTION 'Sem acesso ao Checklist de Módulos.' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('dia', d.dia, 'acessos', coalesce(x.acessos, 0), 'usuarios', coalesce(x.usuarios, 0)) ORDER BY d.dia)
      FROM generate_series(v_ate - greatest(coalesce(_dias, 30), 1) + 1, v_ate, interval '1 day') AS d(dia)
      LEFT JOIN (SELECT u.dia, sum(u.acessos) acessos, count(DISTINCT u.user_id) usuarios
                   FROM public."SIS_USO_TELA" u
                  WHERE (_modulo IS NULL OR u.modulo_id = _modulo)
                  GROUP BY u.dia) x ON x.dia = d.dia::date
  ), '[]'::jsonb);
END $f$;
REVOKE ALL ON FUNCTION public.sis_uso_por_dia(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sis_uso_por_dia(uuid, integer) TO authenticated;

-- Os chamados de sistemas de um módulo (RLS do chamado é por solicitante;
-- aqui a leitura é de quem acompanha o módulo).
CREATE OR REPLACE FUNCTION public.sis_chamados_modulo(_modulo_codigo text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  IF NOT public.sis_ck_pode('visualizar') THEN
    RAISE EXCEPTION 'Sem acesso ao Checklist de Módulos.' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', c.id, 'numero', c.numero, 'assunto', c.assunto, 'status', c.status,
                                        'prioridade', c.prioridade, 'tipo', c.tipo_solicitacao, 'solicitante', c.solicitante_nome,
                                        'created_at', c.created_at, 'concluido_em', c.concluido_em)
                     ORDER BY c.created_at DESC)
      FROM (SELECT * FROM public."CHAMADO_SISTEMA" WHERE modulo_sistema = _modulo_codigo ORDER BY created_at DESC LIMIT 60) c
  ), '[]'::jsonb);
END $f$;
REVOKE ALL ON FUNCTION public.sis_chamados_modulo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sis_chamados_modulo(text) TO authenticated;

-- ── Encaminhar bug → chamado de sistemas ─────────────────────────────────
-- A trava "avalie os concluídos antes de abrir outro" (mig 269/273) é para
-- quem PEDE. Encaminhar bug é triagem do gerente, não pedido dele: a RPC
-- liga app.chamado_encaminhamento_bug só durante o INSERT (set_config local
-- — não dá para ligar pelo PostgREST), como os outros desvios do chamado.
CREATE OR REPLACE FUNCTION public.chamado_sistema_bloqueia_avaliacao_pendente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF COALESCE(current_setting('app.chamado_encaminhamento_bug', true) = 'on', false) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.chamado_pendencias_solicitante(NEW.solicitante_id)) THEN
    RAISE EXCEPTION 'Você tem chamados concluídos aguardando avaliação. Avalie-os antes de abrir um novo.';
  END IF;
  RETURN NEW;
END;
$function$;

-- Abre o CHAMADO_SISTEMA já preenchido (mesmos campos do formulário de
-- abertura), no nome de quem encaminha, e amarra o bug a ele. O número
-- SIS-AAAA-NNNN e o evento "Chamado aberto" vêm dos gatilhos do chamado.
CREATE OR REPLACE FUNCTION public.sis_bug_encaminhar(_bug bigint, _prioridade text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  b record; m record; t record;
  v_prio text; v_urg text; v_imp text; v_modulo text; v_outro text;
  v_ch record;
  v_desc text;
BEGIN
  IF NOT public.sis_ck_pode('alterar') THEN
    RAISE EXCEPTION 'Você não pode encaminhar bugs (precisa de "alterar" no Checklist de Módulos).' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO b FROM public."SIS_BUG" WHERE id = _bug FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Bug #% não encontrado.', _bug; END IF;
  IF b.chamado_id IS NOT NULL THEN RAISE EXCEPTION 'Este bug já foi encaminhado (chamado %).', b.chamado_numero; END IF;
  IF b.status IN ('resolvido', 'descartado') THEN RAISE EXCEPTION 'Bug já encerrado (%).', b.status; END IF;

  SELECT codigo, nome INTO m FROM public.app_modulo WHERE id = b.modulo_id;
  SELECT nome, rota INTO t FROM public.app_menu WHERE id = b.menu_id;

  v_prio := coalesce(_prioridade, CASE b.severidade WHEN 'critica' THEN 'alta' WHEN 'alta' THEN 'alta' WHEN 'media' THEN 'media' ELSE 'baixa' END);
  IF v_prio NOT IN ('alta', 'media', 'baixa') THEN v_prio := 'media'; END IF;
  v_urg := CASE b.severidade WHEN 'critica' THEN 'ate_1d' WHEN 'alta' THEN 'ate_3d' WHEN 'media' THEN 'ate_5d' ELSE 'mais_5d' END;
  v_imp := CASE b.severidade WHEN 'critica' THEN 'impede' WHEN 'alta' THEN 'atraso_significativo' WHEN 'media' THEN 'atraso_leve' ELSE 'nao_impacta' END;
  -- O campo "Módulo / Sistema" do chamado usa os mesmos códigos dos módulos;
  -- o que não está na lista do formulário vai como "outro".
  v_modulo := CASE WHEN m.codigo IN ('bi', 'licitacoes', 'controladoria', 'suprimentos', 'financeiro', 'fiscal', 'contabil', 'rh',
                                     'recrutamento', 'juridico', 'sst', 'encarregados', 'central_servicos', 'sistemas',
                                     'plano_acoes', 'malote') THEN m.codigo ELSE 'outro' END;
  v_outro := CASE WHEN v_modulo = 'outro' THEN m.nome END;
  v_desc := concat_ws(E'\n\n',
    b.descricao,
    CASE WHEN nullif(btrim(coalesce(b.como_reproduzir, '')), '') IS NOT NULL THEN 'Como reproduzir:' || E'\n' || b.como_reproduzir END,
    'Tela: ' || coalesce(m.nome || ' › ' || t.nome, m.nome) || coalesce(' (' || t.rota || ')', ''),
    'Encaminhado do Checklist de Módulos — bug #' || b.id || ', severidade ' || b.severidade
      || coalesce(', reportado por ' || b.reportado_por_nome, '') || '.');

  PERFORM set_config('app.chamado_encaminhamento_bug', 'on', true);
  INSERT INTO public."CHAMADO_SISTEMA"
    (assunto, categorias, tipo_solicitacao, prioridade, descricao, impacto_trabalho, urgencia,
     modulo_sistema, modulo_sistema_outro, ambiente, solicitante_id, solicitante_nome, status)
  VALUES
    (left('[Bug] ' || b.titulo, 200), ARRAY['correcao_erro'], 'correcao', v_prio, v_desc, v_imp, v_urg,
     v_modulo, v_outro, 'producao', auth.uid(), public.sis_ck_nome_usuario(auth.uid()), 'aberto')
  RETURNING id, numero INTO v_ch;
  PERFORM set_config('app.chamado_encaminhamento_bug', 'off', true);

  UPDATE public."SIS_BUG" SET status = 'encaminhado', chamado_id = v_ch.id, chamado_numero = v_ch.numero WHERE id = b.id;
  RETURN jsonb_build_object('chamado_id', v_ch.id, 'numero', v_ch.numero);
END $f$;
REVOKE ALL ON FUNCTION public.sis_bug_encaminhar(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sis_bug_encaminhar(bigint, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reaplicar chamado_sistema_bloqueia_avaliacao_pendente sem o desvio app.chamado_encaminhamento_bug.
-- DROP FUNCTION IF EXISTS public.sis_bug_encaminhar(bigint, text);
-- DROP FUNCTION IF EXISTS public.sis_chamados_modulo(text);
-- DROP FUNCTION IF EXISTS public.sis_uso_por_dia(uuid, integer);
-- DROP FUNCTION IF EXISTS public.sis_uso_modulo(uuid, integer);
-- DROP FUNCTION IF EXISTS public.sis_checklist_dados();
-- DROP FUNCTION IF EXISTS public.sis_registrar_uso(text, text);
-- Remover (nesta ordem) as tabelas novas SIS_BUG, SIS_TREINAMENTO_USUARIO,
-- SIS_USO_TELA, SIS_CHECKLIST_HIST e SIS_CHECKLIST — só se ainda estiverem
-- vazias; com dado, exportar antes.
-- DROP FUNCTION IF EXISTS public.sis_checklist_carimbo();
-- DROP FUNCTION IF EXISTS public.sis_checklist_historico();
-- DROP FUNCTION IF EXISTS public.sis_treinamento_carimbo();
-- DROP FUNCTION IF EXISTS public.sis_bug_carimbo();
-- DROP FUNCTION IF EXISTS public.sis_ck_pode(public.app_acao);
-- DROP FUNCTION IF EXISTS public.sis_ck_nome_usuario(uuid);
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'sistemas_checklist_modulos';
-- DELETE FROM public.app_menu WHERE codigo = 'sistemas_checklist_modulos';
-- NOTIFY pgrst, 'reload schema';
