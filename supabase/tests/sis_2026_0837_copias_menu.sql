-- Rodar apenas em PostgreSQL 18 descartavel chamado sis_0837_copias.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() <> 'sis_0837_copias' THEN
    RAISE EXCEPTION 'Use o banco descartavel sis_0837_copias';
  END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('test.uid', true), '')::uuid
$$;

CREATE TYPE public.app_acao AS ENUM ('visualizar', 'incluir', 'alterar', 'excluir', 'aprovar', 'exportar');
CREATE TABLE public.app_modulo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), codigo text UNIQUE NOT NULL,
  nome text NOT NULL, descricao text, icone text, ordem integer, ativo boolean NOT NULL DEFAULT true
);
CREATE TABLE public.app_menu (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), modulo_id uuid NOT NULL,
  codigo text NOT NULL, nome text NOT NULL, rota text, ordem integer NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true, concede_tudo_alcanca boolean NOT NULL DEFAULT false,
  UNIQUE (modulo_id, codigo)
);
CREATE TABLE public.app_menu_acao (
  menu_codigo text NOT NULL, acao public.app_acao NOT NULL,
  PRIMARY KEY (menu_codigo, acao)
);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, display_name text
);
CREATE TABLE public.perfil_acesso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nome text UNIQUE NOT NULL,
  descricao text, concede_tudo boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true, modulo_codigo text UNIQUE
);
CREATE TABLE public.usuario_perfil_acesso (
  user_id uuid NOT NULL, perfil_id uuid NOT NULL, UNIQUE (user_id, perfil_id)
);
CREATE TABLE public.perfil_acesso_permissao (
  perfil_id uuid NOT NULL, menu_codigo text NOT NULL, acao public.app_acao NOT NULL,
  allow boolean NOT NULL DEFAULT true, UNIQUE (perfil_id, menu_codigo, acao)
);
CREATE TABLE public.screen_permission_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  menu_codigo text NOT NULL, acao public.app_acao NOT NULL, allow boolean NOT NULL,
  empresa_id uuid, motivo text, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (user_id, menu_codigo, acao, empresa_id)
);
CREATE TABLE public."MENU_LATERAL_VERSAO" (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  versao integer NOT NULL UNIQUE, estrutura jsonb NOT NULL, resumo text,
  alteracoes jsonb NOT NULL DEFAULT '[]', autor_id uuid NOT NULL,
  autor_nome text, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.erp_login_bloqueado(uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.concede_tudo_alcanca(_menu text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_menu WHERE codigo = _menu AND concede_tudo_alcanca)
$$;
CREATE FUNCTION public.has_screen_access(
  _user uuid, _menu text, _acao public.app_acao, _empresa uuid DEFAULT NULL
) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce((
    SELECT allow FROM public.screen_permission_user
     WHERE user_id = _user AND menu_codigo = _menu AND acao = _acao
     ORDER BY updated_at DESC LIMIT 1
  ), false)
$$;

INSERT INTO public.app_modulo (id, codigo, nome, ordem) VALUES
  ('10000000-0000-4000-8000-000000000001', 'financeiro', 'Financeiro', 1),
  ('10000000-0000-4000-8000-000000000002', 'menu_lateral', 'Organizacao do Menu', 2);
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo) VALUES
  ('10000000-0000-4000-8000-000000000001', 'fluxo', 'Fluxo de Caixa', '/app/financeiro/fluxo', 1, true),
  ('10000000-0000-4000-8000-000000000002', 'menu_lateral', 'Organizar Menu Lateral', '/app/sistemas/menu-lateral', 1, true);
INSERT INTO public.profiles (id, display_name) VALUES
  ('20000000-0000-4000-8000-000000000001', 'Com acesso original'),
  ('20000000-0000-4000-8000-000000000002', 'Sem acesso original'),
  ('20000000-0000-4000-8000-000000000003', 'Administrador do menu');
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow) VALUES
  ('20000000-0000-4000-8000-000000000001', 'fluxo', 'visualizar', true),
  ('20000000-0000-4000-8000-000000000002', 'fluxo', 'visualizar', false),
  ('20000000-0000-4000-8000-000000000003', 'menu_lateral', 'alterar', true);

-- Duas copias legadas da mesma rota, ainda sem menuCodigo.
INSERT INTO public."MENU_LATERAL_VERSAO" (versao, estrutura, autor_id)
VALUES (1, $$
{
  "rotasConhecidas":["/app/financeiro/fluxo"],
  "modulos":[
    {"id":"m:fin","rotulo":"Financeiro","origem":"financeiro","categorias":[{"id":"c:fin","rotulo":"Gestao","itens":[{"id":"origem","rota":"/app/financeiro/fluxo","ref":"financeiro|/app/financeiro/fluxo"}]}]},
    {"id":"m:cont","rotulo":"Contabil","origem":"contabil","categorias":[{"id":"c:cont","rotulo":"Gestao","itens":[{"id":"cp:cont","rota":"/app/financeiro/fluxo","ref":"financeiro|/app/financeiro/fluxo","copiaDe":"origem"}]}]},
    {"id":"m:dir","rotulo":"Diretoria","origem":"diretoria","categorias":[{"id":"c:dir","rotulo":"Gestao","itens":[{"id":"cp:dir","rota":"/app/financeiro/fluxo","ref":"financeiro|/app/financeiro/fluxo","copiaDe":"origem"}]}]},
    {"id":"m:ope","rotulo":"Operacional","origem":"operacional","categorias":[{"id":"c:ope","rotulo":"Gestao","itens":[]}]}
  ]
}
$$::jsonb, '20000000-0000-4000-8000-000000000003');

\ir ../migrations/20261115110000_sis_2026_0837_permissao_independente_copias_menu.sql

DO $$
DECLARE
  v_codigos text[];
  v_contabil text;
  v_nova text := 'menu_lateral_copia_cp_ope';
  v_estrutura jsonb;
  v_versao integer;
BEGIN
  SELECT array_agg(i->>'menuCodigo' ORDER BY i->>'id') INTO v_codigos
    FROM public."MENU_LATERAL_VERSAO" v
    CROSS JOIN LATERAL jsonb_array_elements(v.estrutura->'modulos') m
    CROSS JOIN LATERAL jsonb_array_elements(m->'categorias') c
    CROSS JOIN LATERAL jsonb_array_elements(c->'itens') i
   WHERE v.versao = 1 AND i ? 'copiaDe';
  IF cardinality(v_codigos) <> 2 OR v_codigos[1] = v_codigos[2] THEN
    RAISE EXCEPTION 'Backfill nao criou dois codigos independentes: %', v_codigos;
  END IF;
  IF (SELECT count(*) FROM public.app_menu WHERE codigo = ANY(v_codigos) AND ativo) <> 2 THEN
    RAISE EXCEPTION 'Copias nao foram materializadas em app_menu';
  END IF;
  IF (SELECT count(*) FROM public.screen_permission_user
       WHERE user_id = '20000000-0000-4000-8000-000000000001' AND menu_codigo = ANY(v_codigos) AND allow) <> 2 THEN
    RAISE EXCEPTION 'Acesso existente nao foi herdado pelas duas copias';
  END IF;
  IF EXISTS (SELECT 1 FROM public.screen_permission_user
              WHERE user_id = '20000000-0000-4000-8000-000000000002' AND menu_codigo = ANY(v_codigos) AND allow) THEN
    RAISE EXCEPTION 'Usuario sem a tela original ganhou copia';
  END IF;

  v_contabil := v_codigos[1];
  INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow)
  VALUES ('20000000-0000-4000-8000-000000000002', v_contabil, 'visualizar', true);
  IF NOT public.has_screen_access('20000000-0000-4000-8000-000000000002', 'fluxo', 'visualizar') THEN
    RAISE EXCEPTION 'Copia liberada nao abriu a leitura da tela original';
  END IF;
  IF public.has_screen_access('20000000-0000-4000-8000-000000000002', 'fluxo', 'alterar') THEN
    RAISE EXCEPTION 'Copia concedeu acao de negocio da tela original';
  END IF;

  SELECT estrutura INTO v_estrutura FROM public."MENU_LATERAL_VERSAO" WHERE versao = 1;
  v_estrutura := jsonb_insert(
    v_estrutura,
    '{modulos,3,categorias,0,itens,0}',
    jsonb_build_object(
      'id','cp:ope','rota','/app/financeiro/fluxo',
      'ref','financeiro|/app/financeiro/fluxo','copiaDe','origem','menuCodigo',v_nova
    ),
    true
  );
  PERFORM set_config('test.uid', '20000000-0000-4000-8000-000000000003', true);
  v_versao := public.menu_lateral_salvar(v_estrutura, 1, 'Nova copia', '[]');
  IF v_versao <> 2 THEN RAISE EXCEPTION 'Versao inesperada: %', v_versao; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.screen_permission_user
                  WHERE user_id = '20000000-0000-4000-8000-000000000001'
                    AND menu_codigo = v_nova AND allow) THEN
    RAISE EXCEPTION 'Nova copia nao herdou o acesso BASE original';
  END IF;
  IF EXISTS (SELECT 1 FROM public.screen_permission_user
              WHERE user_id = '20000000-0000-4000-8000-000000000002'
                AND menu_codigo = v_nova AND allow) THEN
    RAISE EXCEPTION 'Acesso a uma copia vazou para a nova copia';
  END IF;
END $$;

\echo 'OK SIS-2026-0837: backfill, independencia, ponte de leitura e nova copia validados.'
