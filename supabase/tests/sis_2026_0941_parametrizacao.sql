-- SIS-2026-0941: prova da parametrização fiscal da NFS-e.
-- Executar SOMENTE em PostgreSQL 18 descartável chamado nfse_0941_teste:
--   psql -d nfse_0941_teste -v ON_ERROR_STOP=1 -f supabase/tests/sis_2026_0941_parametrizacao.sql
-- Cobre: carga inicial (só a autorizada mais recente do MESMO contrato),
-- gatilho na autorização, edição manual prevalecendo sobre pedido mais antigo,
-- gatilho que nunca derruba o registro do resultado, RLS e RPC, reexecução.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() <> 'nfse_0941_teste' THEN RAISE EXCEPTION 'Use um banco descartável chamado nfse_0941_teste'; END IF; END $$;
SET client_min_messages = error;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE TYPE public.app_acao AS ENUM ('visualizar','incluir','alterar','exportar','aprovar','excluir');
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
-- Permissões do teste: uma linha por usuário × menu × ação.
CREATE TABLE public.teste_permissao (user_id uuid, menu text, acao text);
CREATE FUNCTION public.has_screen_access(_uid uuid, _menu text, _acao public.app_acao) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.teste_permissao WHERE user_id = _uid AND menu = _menu AND acao = _acao::text)
$$;
CREATE TABLE public.app_modulo (id uuid PRIMARY KEY, codigo text, nome text);
CREATE TABLE public.app_menu (id uuid DEFAULT gen_random_uuid(), modulo_id uuid, codigo text, nome text, rota text, ordem integer, ativo boolean DEFAULT true, UNIQUE(modulo_id,codigo));
CREATE TABLE public.app_menu_acao (menu_codigo text, acao public.app_acao, PRIMARY KEY(menu_codigo,acao));
CREATE TABLE public.perfil_acesso (id uuid PRIMARY KEY, nome text, ativo boolean, concede_tudo boolean);
CREATE TABLE public.perfil_acesso_permissao (perfil_id uuid, menu_codigo text, acao public.app_acao, allow boolean, UNIQUE(perfil_id,menu_codigo,acao));
CREATE TABLE public.screen_permission_user (user_id uuid, menu_codigo text, acao public.app_acao, allow boolean, motivo text);
CREATE TABLE public.empresas (id uuid PRIMARY KEY, cnpj text, razao_social text, ativa boolean);
CREATE TABLE public.contratos (id uuid PRIMARY KEY, nome text);
CREATE TABLE public.nf_emissao (id uuid PRIMARY KEY, empresa_id uuid, contrato_id uuid REFERENCES public.contratos(id), status text, deleted_at timestamptz,
  competencia date, descricao text, numero_nf text, vlr_bruto_total numeric, vlr_liquido_total numeric,
  issqn_total numeric, inss_total numeric, ir_total numeric, pis_total numeric, cofins_total numeric, csll_total numeric);
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint);
CREATE TABLE storage.objects (id uuid DEFAULT gen_random_uuid(), bucket_id text, name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated,service_role;
GRANT SELECT ON public.contratos TO authenticated;

-- Usuários: 0 sem acesso; 1 emite (financeiro-nfse); 2 mantém a parametrização.
INSERT INTO auth.users VALUES ('00000000-0000-4000-8000-000000000000'),('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),('8f426a53-fdbb-49f2-ad43-d39532539f2d');
INSERT INTO public.teste_permissao VALUES
  ('11111111-1111-4111-8111-111111111111','financeiro-nfse','visualizar'),
  ('11111111-1111-4111-8111-111111111111','financeiro-nfse','incluir'),
  ('22222222-2222-4222-8222-222222222222','financeiro-nfse-parametros','visualizar'),
  ('22222222-2222-4222-8222-222222222222','financeiro-nfse-parametros','incluir'),
  ('22222222-2222-4222-8222-222222222222','financeiro-nfse-parametros','alterar');
INSERT INTO public.app_modulo VALUES ('33333333-3333-4333-8333-333333333333','financeiro','Financeiro');
INSERT INTO public.empresas VALUES ('44444444-4444-4444-8444-444444444444','03.644.009/0001-23','HAAG',true);
INSERT INTO public.contratos VALUES ('c1000000-0000-4000-8000-000000000001','C1'),('c2000000-0000-4000-8000-000000000002','C2'),
  ('c3000000-0000-4000-8000-000000000003','C3'),('c4000000-0000-4000-8000-000000000004','C4');
INSERT INTO public.nf_emissao (id,empresa_id,contrato_id,status,competencia,vlr_bruto_total,vlr_liquido_total) VALUES
  ('a1000000-0000-4000-8000-000000000001','44444444-4444-4444-8444-444444444444','c1000000-0000-4000-8000-000000000001','enviada','2026-09-01',100,90),
  ('a1000000-0000-4000-8000-000000000002','44444444-4444-4444-8444-444444444444','c1000000-0000-4000-8000-000000000001','enviada','2026-10-01',100,90),
  ('a1000000-0000-4000-8000-000000000003','44444444-4444-4444-8444-444444444444','c1000000-0000-4000-8000-000000000001','enviada','2026-11-01',100,90),
  ('a1000000-0000-4000-8000-000000000004','44444444-4444-4444-8444-444444444444','c1000000-0000-4000-8000-000000000001','enviada','2026-11-01',100,90),
  ('a1000000-0000-4000-8000-000000000005','44444444-4444-4444-8444-444444444444','c1000000-0000-4000-8000-000000000001','enviada','2026-11-01',100,90),
  ('a1000000-0000-4000-8000-000000000006','44444444-4444-4444-8444-444444444444','c1000000-0000-4000-8000-000000000001','enviada','2026-11-01',100,90),
  ('a2000000-0000-4000-8000-000000000001','44444444-4444-4444-8444-444444444444','c2000000-0000-4000-8000-000000000002','enviada','2026-10-01',100,90),
  ('a3000000-0000-4000-8000-000000000001','44444444-4444-4444-8444-444444444444','c3000000-0000-4000-8000-000000000003','enviada','2026-10-01',100,90),
  ('a4000000-0000-4000-8000-000000000001','44444444-4444-4444-8444-444444444444','c4000000-0000-4000-8000-000000000004','enviada','2026-10-01',100,90);

\ir ../migrations/20261110104100_sis_2026_0841_nfse_homologacao.sql
\ir ../migrations/20261110150000_sis_2026_0841_nfse_acoes_painel.sql
\ir ../migrations/20261111140000_sis_2026_0841_nfse_producao.sql

-- Histórico antes da migration nova (a carga inicial lê isto).
CREATE FUNCTION public.teste_p(_doc text, _nome text, _extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('parametros', jsonb_build_object(
    'codigo_tributacao','170501','local_prestacao','4322004','consumidor_final','0','tipo_ente_governamental','1',
    'iss_retido','2','retencao_pis_cofins','1',
    'tomador', jsonb_build_object('documento',_doc,'nome',_nome,'municipio','4322004','cep','95840-000',
      'logradouro','Rua A','numero','1','bairro','Centro','complemento','','email','','inscricao_municipal','')) || _extra)
$$;
GRANT EXECUTE ON FUNCTION public.teste_p(text, text, jsonb) TO authenticated;
INSERT INTO public."NFSE_SOLICITACAO" (id,nf_emissao_id,empresa_id,ambiente,serie,numero_dps,estado,dados,criado_em) VALUES
  -- C1: duas autorizadas (vale a mais recente), uma rejeitada mais nova e uma de homologação ainda mais nova.
  ('51000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','44444444-4444-4444-8444-444444444444','producao',1041,1,'autorizada',public.teste_p('15.126.437/0030-88','TOMADOR ANTIGO'),'2026-11-10 10:00Z'),
  ('51000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002','44444444-4444-4444-8444-444444444444','producao',1041,2,'autorizada',public.teste_p('15.126.437/0030-88','TOMADOR ATUAL'),'2026-11-12 10:00Z'),
  ('51000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000003','44444444-4444-4444-8444-444444444444','producao',1041,3,'rejeitada',public.teste_p('15.126.437/0030-88','TOMADOR REJEITADO'),'2026-11-13 10:00Z'),
  ('51000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000003','44444444-4444-4444-8444-444444444444','homologacao',1041,1,'autorizada',public.teste_p('15.126.437/0030-88','TOMADOR TESTE'),'2026-11-14 10:00Z'),
  -- C2: ente "0" legado e item vindo do código nacional.
  ('52000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','44444444-4444-4444-8444-444444444444','producao',1041,4,'autorizada',public.teste_p('92.969.856/0001-98','PREFEITURA','{"tipo_ente_governamental":"0","codigo_tributacao":"07.10.02"}'),'2026-11-12 11:00Z'),
  -- C3: CNPJ incompleto — não pode parar a migration.
  ('53000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','44444444-4444-4444-8444-444444444444','producao',1041,5,'autorizada',public.teste_p('123','INVALIDO'),'2026-11-12 12:00Z'),
  -- C4: o usuário desmarcou "atualizar o cadastro".
  ('54000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','44444444-4444-4444-8444-444444444444','producao',1041,6,'autorizada',public.teste_p('88.363.189/0001-28','AVULSO','{"atualizar_cadastro_contrato":false}'),'2026-11-12 13:00Z');

\ir ../migrations/20261120020000_sis_2026_0941_nfse_parametrizacao_fiscal.sql
-- Reexecução não duplica nem desfaz.
UPDATE public."NFSE_PARAMETRO_SERVICO" SET descricao = 'EDITADO' WHERE item_lc116 = '17.05';
\ir ../migrations/20261120020000_sis_2026_0941_nfse_parametrizacao_fiscal.sql

DO $$ BEGIN
  IF (SELECT count(*) FROM public."NFSE_PARAMETRO_SERVICO") <> 3 THEN RAISE EXCEPTION 'Seed de parâmetros duplicou ou faltou'; END IF;
  IF (SELECT descricao FROM public."NFSE_PARAMETRO_SERVICO" WHERE item_lc116 = '17.05') <> 'EDITADO' THEN RAISE EXCEPTION 'Reexecução desfez edição'; END IF;
  IF (SELECT count(*) FROM public.app_menu WHERE codigo = 'financeiro-nfse-parametros') <> 1 THEN RAISE EXCEPTION 'Menu duplicado'; END IF;
  IF (SELECT count(*) FROM public.app_menu_acao WHERE menu_codigo = 'financeiro-nfse-parametros') <> 3 THEN RAISE EXCEPTION 'Ações do menu'; END IF;
  -- Só o Jeferson existe neste banco: a Ana (ausente em auth.users) não gera linha órfã.
  IF (SELECT count(*) FROM public.screen_permission_user WHERE menu_codigo = 'financeiro-nfse-parametros') <> 3 THEN RAISE EXCEPTION 'Acesso preparado duplicado ou órfão'; END IF;
  IF (SELECT tomador_nome FROM public."NFSE_DADOS_CONTRATO" WHERE contrato_id = 'c1000000-0000-4000-8000-000000000001') <> 'TOMADOR ATUAL' THEN
    RAISE EXCEPTION 'Carga não pegou a autorizada mais recente de produção do contrato'; END IF;
  IF (SELECT tomador_documento || '|' || tomador_cep || '|' || item_lc116 || '|' || tipo_ente_governamental FROM public."NFSE_DADOS_CONTRATO"
      WHERE contrato_id = 'c1000000-0000-4000-8000-000000000001') <> '15126437003088|95840000|17.05|1' THEN RAISE EXCEPTION 'Normalização C1'; END IF;
  IF (SELECT item_lc116 || '|' || tipo_ente_governamental FROM public."NFSE_DADOS_CONTRATO"
      WHERE contrato_id = 'c2000000-0000-4000-8000-000000000002') <> '07.10|' THEN RAISE EXCEPTION 'Legado "0" ou item do código nacional'; END IF;
  IF EXISTS (SELECT 1 FROM public."NFSE_DADOS_CONTRATO" WHERE contrato_id IN ('c3000000-0000-4000-8000-000000000003','c4000000-0000-4000-8000-000000000004')) THEN
    RAISE EXCEPTION 'Carregou CNPJ inválido ou nota com cadastro desmarcado'; END IF;
END $$;

-- Gatilho: autorização nova atualiza; homologação, desmarcado e inválido não; resultado sempre gravado.
INSERT INTO public."NFSE_SOLICITACAO" (id,nf_emissao_id,empresa_id,ambiente,serie,numero_dps,estado,dados,criado_em,solicitado_por) VALUES
  ('51000000-0000-4000-8000-000000000010','a1000000-0000-4000-8000-000000000003','44444444-4444-4444-8444-444444444444','producao',1041,10,'aguardando',public.teste_p('15.126.437/0030-88','TOMADOR NOVO'),'2026-11-15 10:00Z','11111111-1111-4111-8111-111111111111'),
  ('51000000-0000-4000-8000-000000000011','a1000000-0000-4000-8000-000000000004','44444444-4444-4444-8444-444444444444','producao',1041,11,'aguardando',public.teste_p('123','QUEBRADO'),'2026-11-16 10:00Z',NULL),
  ('51000000-0000-4000-8000-000000000012','a1000000-0000-4000-8000-000000000005','44444444-4444-4444-8444-444444444444','producao',1041,12,'aguardando',public.teste_p('15.126.437/0030-88','NAO GRAVAR','{"atualizar_cadastro_contrato":false}'),'2026-11-17 10:00Z',NULL),
  ('51000000-0000-4000-8000-000000000013','a1000000-0000-4000-8000-000000000002','44444444-4444-4444-8444-444444444444','homologacao',1041,13,'aguardando',public.teste_p('15.126.437/0030-88','HOMOLOGACAO'),'2026-11-17 11:00Z',NULL);
UPDATE public."NFSE_SOLICITACAO" SET estado = 'autorizada' WHERE id = '51000000-0000-4000-8000-000000000010';
DO $$ BEGIN
  IF (SELECT tomador_nome || '|' || atualizado_por::text FROM public."NFSE_DADOS_CONTRATO" WHERE contrato_id = 'c1000000-0000-4000-8000-000000000001')
     <> 'TOMADOR NOVO|11111111-1111-4111-8111-111111111111' THEN RAISE EXCEPTION 'Autorização não atualizou o contrato'; END IF;
END $$;
UPDATE public."NFSE_SOLICITACAO" SET estado = 'autorizada' WHERE id IN ('51000000-0000-4000-8000-000000000011','51000000-0000-4000-8000-000000000012','51000000-0000-4000-8000-000000000013');
DO $$ BEGIN
  IF (SELECT count(*) FROM public."NFSE_SOLICITACAO" WHERE id IN ('51000000-0000-4000-8000-000000000011','51000000-0000-4000-8000-000000000012','51000000-0000-4000-8000-000000000013') AND estado = 'autorizada') <> 3 THEN
    RAISE EXCEPTION 'Gatilho impediu gravar o resultado fiscal'; END IF;
  IF (SELECT tomador_nome FROM public."NFSE_DADOS_CONTRATO" WHERE contrato_id = 'c1000000-0000-4000-8000-000000000001') <> 'TOMADOR NOVO' THEN
    RAISE EXCEPTION 'Inválida, desmarcada ou homologação mexeu no cadastro'; END IF;
END $$;

-- Leitura por permissão (RLS).
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000000',false);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public."NFSE_PARAMETRO_SERVICO") OR EXISTS (SELECT 1 FROM public."NFSE_DADOS_CONTRATO") THEN RAISE EXCEPTION 'Sem acesso leu o cadastro'; END IF;
  BEGIN PERFORM public.nfse_gravar_dados_contrato('c3000000-0000-4000-8000-000000000003', public.teste_p('15126437003088','X')->'parametros', NULL, NULL, now());
    RAISE EXCEPTION 'Navegador chamou a gravação interna'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public."NFSE_PARAMETRO_SERVICO") <> 3 THEN RAISE EXCEPTION 'Quem emite não leu os parâmetros'; END IF;
  IF (SELECT count(*) FROM public."NFSE_DADOS_CONTRATO") <> 2 THEN RAISE EXCEPTION 'Quem emite não leu os contratos'; END IF;
  BEGIN UPDATE public."NFSE_PARAMETRO_SERVICO" SET codigo_nbs = '999999999' WHERE item_lc116 = '07.10';
    IF FOUND THEN RAISE EXCEPTION 'Quem só emite alterou a parametrização'; END IF; END;
  BEGIN INSERT INTO public."NFSE_PARAMETRO_SERVICO" (municipio_emissor,item_lc116,codigo_tributacao,codigo_nbs,ibs_cst,ibs_classificacao,ibs_indicador_operacao)
    VALUES ('4322004','07.02','070201','118031000','000','000001','100301');
    RAISE EXCEPTION 'Quem só emite incluiu parâmetro'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.nfse_salvar_dados_contrato('c3000000-0000-4000-8000-000000000003', public.teste_p('15126437003088','X')->'parametros');
    RAISE EXCEPTION 'Quem só emite alterou o contrato'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Sem permissão%' THEN RAISE; END IF; END;
END $$;

-- Quem mantém a parametrização: inclui, altera, recebe CHECK legível e edita o contrato.
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
DO $$ BEGIN
  INSERT INTO public."NFSE_PARAMETRO_SERVICO" (municipio_emissor,item_lc116,descricao,codigo_tributacao,codigo_nbs,ibs_cst,ibs_classificacao,ibs_indicador_operacao)
    VALUES ('4322004','07.02','Teste','070201','118031000','000','000001','100301');
  UPDATE public."NFSE_PARAMETRO_SERVICO" SET ativo = false WHERE item_lc116 = '07.02';
  IF (SELECT atualizado_por FROM public."NFSE_PARAMETRO_SERVICO" WHERE item_lc116 = '07.02') <> '22222222-2222-4222-8222-222222222222' THEN RAISE EXCEPTION 'Carimbo de quem alterou'; END IF;
  BEGIN UPDATE public."NFSE_PARAMETRO_SERVICO" SET codigo_nbs = '11803100' WHERE item_lc116 = '07.10';
    RAISE EXCEPTION 'NBS de 8 dígitos aceita'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public."NFSE_PARAMETRO_SERVICO" SET codigo_tributacao = '170501' WHERE item_lc116 = '07.10';
    RAISE EXCEPTION 'Código nacional de outro item aceito'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN DELETE FROM public."NFSE_PARAMETRO_SERVICO" WHERE item_lc116 = '07.02';
    RAISE EXCEPTION 'Exclusão permitida'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.nfse_salvar_dados_contrato('c3000000-0000-4000-8000-000000000003', public.teste_p('123','X')->'parametros');
    RAISE EXCEPTION 'CNPJ inválido aceito'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Confira CPF/CNPJ%' THEN RAISE; END IF; END;
  PERFORM public.nfse_salvar_dados_contrato('c1000000-0000-4000-8000-000000000001',
    public.teste_p('15126437003088','EDITADO NA TELA','{"iss_retido":"1","item_lc116":"07.11"}')->'parametros');
  IF (SELECT tomador_nome || '|' || iss_retido || '|' || item_lc116 || '|' || coalesce(origem_solicitacao_id::text,'manual') FROM public."NFSE_DADOS_CONTRATO"
      WHERE contrato_id = 'c1000000-0000-4000-8000-000000000001') <> 'EDITADO NA TELA|1|07.11|manual' THEN RAISE EXCEPTION 'Edição manual'; END IF;
END $$;
RESET ROLE;

-- Pedido feito ANTES da edição manual e autorizado depois não a desfaz.
INSERT INTO public."NFSE_SOLICITACAO" (id,nf_emissao_id,empresa_id,ambiente,serie,numero_dps,estado,dados,criado_em) VALUES
  ('51000000-0000-4000-8000-000000000020','a1000000-0000-4000-8000-000000000006','44444444-4444-4444-8444-444444444444','producao',1041,20,'aguardando',public.teste_p('15.126.437/0030-88','PEDIDO ANTIGO'),now() - interval '1 hour');
UPDATE public."NFSE_SOLICITACAO" SET estado = 'autorizada' WHERE id = '51000000-0000-4000-8000-000000000020';
DO $$ BEGIN
  IF (SELECT tomador_nome FROM public."NFSE_DADOS_CONTRATO" WHERE contrato_id = 'c1000000-0000-4000-8000-000000000001') <> 'EDITADO NA TELA' THEN
    RAISE EXCEPTION 'Pedido mais antigo desfez a edição manual'; END IF;
END $$;
\echo 'OK SIS-2026-0941: carga do mesmo contrato, gatilho só na autorização de produção, edição manual prevalece, resultado fiscal nunca bloqueado, RLS, RPC e reexecução.'
