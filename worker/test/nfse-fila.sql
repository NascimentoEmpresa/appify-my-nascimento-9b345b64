-- Executar apenas em PostgreSQL 18 descartável: psql -d nfse_0841_teste -f este-arquivo.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() <> 'nfse_0841_teste' THEN RAISE EXCEPTION 'Use um banco descartável chamado nfse_0841_teste'; END IF; END $$;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE TYPE public.app_acao AS ENUM ('visualizar','incluir','alterar','exportar');
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION public.has_screen_access(_uid uuid, _menu text, _acao public.app_acao) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT _uid = '11111111-1111-4111-8111-111111111111'::uuid
    AND NOT (_acao = 'incluir' AND coalesce(current_setting('teste.sem_incluir',true),'0') = '1')
$$;
CREATE TABLE public.app_modulo (id uuid PRIMARY KEY, codigo text, nome text);
CREATE TABLE public.app_menu (id uuid DEFAULT gen_random_uuid(), modulo_id uuid, codigo text, nome text, rota text, ordem integer, UNIQUE(modulo_id,codigo));
CREATE TABLE public.app_menu_acao (menu_codigo text, acao public.app_acao, PRIMARY KEY(menu_codigo,acao));
CREATE TABLE public.perfil_acesso (id uuid PRIMARY KEY, nome text, ativo boolean, concede_tudo boolean);
CREATE TABLE public.perfil_acesso_permissao (perfil_id uuid, menu_codigo text, acao public.app_acao, allow boolean, UNIQUE(perfil_id,menu_codigo,acao));
CREATE TABLE public.empresas (id uuid PRIMARY KEY, cnpj text, razao_social text, ativa boolean);
CREATE TABLE public.nf_emissao (id uuid PRIMARY KEY, empresa_id uuid, status text, deleted_at timestamptz,
  competencia date, descricao text, numero_nf text, vlr_bruto_total numeric, vlr_liquido_total numeric,
  issqn_total numeric, inss_total numeric, ir_total numeric, pis_total numeric, cofins_total numeric, csll_total numeric);
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint);
CREATE TABLE storage.objects (id uuid DEFAULT gen_random_uuid(), bucket_id text, name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated,service_role;
GRANT SELECT ON storage.objects TO authenticated;
INSERT INTO public.app_modulo VALUES ('22222222-2222-4222-8222-222222222222','financeiro','Financeiro');
INSERT INTO public.perfil_acesso VALUES ('33333333-3333-4333-8333-333333333333','Financeiro',true,false);
INSERT INTO auth.users VALUES ('11111111-1111-4111-8111-111111111111'),('99999999-9999-4999-8999-999999999999');
INSERT INTO public.empresas VALUES ('44444444-4444-4444-8444-444444444444','12.345.678/0001-95','EMPRESA DE TESTES',true);
INSERT INTO public.nf_emissao VALUES ('55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444','enviada',NULL,'2026-10-01','Teste',NULL,100,82.2,2,11,4.8,0,0,0);

\ir ../../supabase/migrations/20261110104100_sis_2026_0841_nfse_homologacao.sql
\ir ../../supabase/migrations/20261110150000_sis_2026_0841_nfse_acoes_painel.sql
DO $$ BEGIN IF (SELECT count(*) FROM public.app_menu_acao WHERE menu_codigo='financeiro-nfse') <> 4 THEN RAISE EXCEPTION 'Ações do piloto ausentes no Gerenciamento de Acesso'; END IF; END $$;

SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
SELECT set_config('teste.sem_incluir','0',false);
SET ROLE authenticated;
SELECT public.nfse_solicitar_homologacao('55555555-5555-4555-8555-555555555555','{"serie":"123","confirmacao_fiscal":true,"vlr_bruto_total":999999}');
SELECT public.nfse_solicitar_homologacao('55555555-5555-4555-8555-555555555555','{"serie":"123","confirmacao_fiscal":true}');
DO $$ BEGIN
  IF (SELECT count(*) FROM public."NFSE_SOLICITACAO") <> 1 THEN RAISE EXCEPTION 'Duplo clique criou duas solicitações'; END IF;
  IF (SELECT dados#>>'{nota,vlr_bruto_total}' FROM public."NFSE_SOLICITACAO") <> '100' THEN RAISE EXCEPTION 'Valores do navegador sobrescreveram o banco'; END IF;
  BEGIN UPDATE public."NFSE_SOLICITACAO" SET estado = 'autorizada'; RAISE EXCEPTION 'Escrita direta liberada'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.nfse_reservar_trabalho(); RAISE EXCEPTION 'RPC do worker acessível ao navegador'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('teste.sem_incluir','1',false);
DO $$ BEGIN
  BEGIN
    PERFORM public.nfse_solicitar_homologacao('55555555-5555-4555-8555-555555555555','{"serie":"123"}');
    RAISE EXCEPTION 'Ação incluir foi ignorada';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Sem permissão%' THEN RAISE; END IF; END;
END $$;
SELECT set_config('teste.sem_incluir','0',false);
SELECT set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999999',false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public."NFSE_SOLICITACAO") <> 0 THEN RAISE EXCEPTION 'RLS expôs nota a usuário sem acesso'; END IF;
END $$;
RESET ROLE;
SET ROLE service_role;
SELECT count(*) AS primeira_reserva FROM public.nfse_reservar_trabalho();
DO $$ DECLARE v_s public."NFSE_SOLICITACAO"%ROWTYPE;
BEGIN
  IF (SELECT count(*) FROM public.nfse_reservar_trabalho()) <> 0 THEN RAISE EXCEPTION 'Lease permitiu segundo processamento'; END IF;
  SELECT * INTO STRICT v_s FROM public."NFSE_SOLICITACAO";
  IF NOT public.nfse_marcar_envio(v_s.id,v_s.reserva,'empresa/solicitacao/dps.xml') THEN RAISE EXCEPTION 'Não marcou envio'; END IF;
  IF public.nfse_marcar_envio(v_s.id,v_s.reserva,'empresa/solicitacao/dps.xml') THEN RAISE EXCEPTION 'Marcou envio duas vezes'; END IF;
END $$;
-- Simula queda do processo e tomada de trabalho por outra instância.
CREATE TEMP TABLE reserva_antiga AS SELECT id,reserva FROM public."NFSE_SOLICITACAO";
UPDATE public."NFSE_SOLICITACAO" SET reservado_ate = now()-interval '1 minute',proxima_tentativa=now()-interval '1 minute';
SELECT count(*) AS reserva_apos_queda FROM public.nfse_reservar_trabalho();
DO $$ DECLARE v_s public."NFSE_SOLICITACAO"%ROWTYPE; v_antiga uuid;
BEGIN
  SELECT * INTO STRICT v_s FROM public."NFSE_SOLICITACAO";
  SELECT reserva INTO v_antiga FROM reserva_antiga;
  IF v_s.envio_iniciado_em IS NULL THEN RAISE EXCEPTION 'A queda apagou a marca de envio'; END IF;
  IF public.nfse_registrar_resultado(v_s.id,v_antiga,'{"estado":"erro"}') THEN RAISE EXCEPTION 'Worker antigo atualizou após perder o lease'; END IF;
  IF NOT public.nfse_registrar_resultado(v_s.id,v_s.reserva,jsonb_build_object('estado','autorizada','chave',repeat('4',50),'numero_nf','900','xml_retorno_path','empresa/solicitacao/nota.xml')) THEN
    RAISE EXCEPTION 'Não registrou autorização';
  END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.nf_emissao WHERE numero_nf IS NOT NULL OR status <> 'enviada') THEN RAISE EXCEPTION 'Homologação alterou a nota real'; END IF;
END $$;
INSERT INTO storage.objects (bucket_id,name) VALUES ('nfse-integracao','empresa/solicitacao/nota.xml'),('nfse-integracao','outro/arquivo.xml');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
DO $$ BEGIN
  IF (SELECT count(*) FROM storage.objects) <> 1 THEN RAISE EXCEPTION 'Storage não limitou o arquivo à solicitação autorizada'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999999',false);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects) THEN RAISE EXCEPTION 'Storage expôs XML sem permissão'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
SELECT public.nfse_reprocessar((SELECT id FROM public."NFSE_SOLICITACAO"));
DO $$ BEGIN
  IF (SELECT estado FROM public."NFSE_SOLICITACAO") <> 'autorizada' THEN RAISE EXCEPTION 'Recuperação do PDF regrediu a autorização'; END IF;
END $$;
RESET ROLE;
\echo 'OK: migration, permissões, RLS, duplo clique, valores canônicos, lease, recuperação e separação da homologação.'
