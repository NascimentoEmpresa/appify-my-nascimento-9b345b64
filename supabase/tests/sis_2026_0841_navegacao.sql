-- Rodar apenas em PostgreSQL descartável chamado nfse_0841_navegacao.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() <> 'nfse_0841_navegacao' THEN RAISE EXCEPTION 'Use nfse_0841_navegacao descartável'; END IF; END $$;
CREATE TYPE public.app_acao AS ENUM ('visualizar','incluir','alterar','exportar');
CREATE TABLE public.app_modulo(id uuid PRIMARY KEY, codigo text, nome text);
CREATE TABLE public.app_menu(id uuid DEFAULT gen_random_uuid(),modulo_id uuid,codigo text,nome text,rota text,ordem integer,ativo boolean,concede_tudo_alcanca boolean DEFAULT false,UNIQUE(modulo_id,codigo));
CREATE TABLE public.perfil_acesso(id uuid PRIMARY KEY,nome text,ativo boolean,concede_tudo boolean);
CREATE TABLE public.perfil_acesso_permissao(perfil_id uuid,menu_codigo text,acao public.app_acao,allow boolean,UNIQUE(perfil_id,menu_codigo,acao));
CREATE TABLE public.app_menu_acao(menu_codigo text,acao public.app_acao,PRIMARY KEY(menu_codigo,acao));
INSERT INTO public.app_modulo VALUES('11111111-1111-4111-8111-111111111111','financeiro','Financeiro');
INSERT INTO public.perfil_acesso VALUES('22222222-2222-4222-8222-222222222222','Financeiro',true,false),('33333333-3333-4333-8333-333333333333','Outro módulo',true,false);
INSERT INTO public.app_menu(modulo_id,codigo,nome,rota,ordem,ativo,concede_tudo_alcanca) VALUES
('11111111-1111-4111-8111-111111111111','nf-emissao','Emissão de NF','/app/financeiro/nf-emissao',1,true,true),
('11111111-1111-4111-8111-111111111111','nf_emissao_controle','Emissão de NF — Controle','/app/financeiro/emissao-nf/controle-notas',2,false,false);
INSERT INTO public.perfil_acesso_permissao VALUES('22222222-2222-4222-8222-222222222222','nf_emissao_controle','visualizar',false);
\ir ../migrations/20261110203100_sis_2026_0841_controle_notas_navegacao.sql
\ir ../migrations/20261110203100_sis_2026_0841_controle_notas_navegacao.sql
DO $$ BEGIN
 IF (SELECT count(*) FROM public.app_menu) <> 3 THEN RAISE EXCEPTION 'Reexecução duplicou menus'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.app_menu WHERE codigo='nf-emissao' AND nome='Controle de Notas' AND rota='/app/financeiro/emissao-nf' AND concede_tudo_alcanca) THEN RAISE EXCEPTION 'Entrada ou regra existente do pai foi perdida'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.app_menu WHERE codigo='nf_emissao_controle' AND nome='Validação de Notas' AND NOT ativo) THEN RAISE EXCEPTION 'Nome incorreto ou menu reativado indevidamente'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.perfil_acesso_permissao WHERE menu_codigo='nf_emissao_controle' AND NOT allow) THEN RAISE EXCEPTION 'Negativa existente sobrescrita'; END IF;
 IF EXISTS(SELECT 1 FROM public.perfil_acesso_permissao WHERE perfil_id='33333333-3333-4333-8333-333333333333') THEN RAISE EXCEPTION 'Acesso concedido a outro módulo'; END IF;
 IF (SELECT count(*) FROM public.app_menu_acao WHERE acao='visualizar') <> 3 THEN RAISE EXCEPTION 'Ações ausentes do Gerenciamento de Acesso'; END IF;
END $$;
\echo 'OK: entrada, rótulos, idempotência, catálogo de ações e permissões preservadas.'
