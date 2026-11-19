-- SIS-2026-0945: prova do dashboard de pedidos cancelados.
-- Executar SOMENTE em PostgreSQL 18 descartável chamado sup_0945_teste:
--   psql -d sup_0945_teste -v ON_ERROR_STOP=1 -f supabase/tests/sis_2026_0945_dashboard_cancelados.sql
-- Cobre: aprovado e registro antigo no total, solicitado/recusado fora do total,
-- período e fuso de São Paulo, preço pelo filho do tamanho, item sem preço,
-- provável novo pedido para a vaga (mesmo posto, até 45 dias), filtro de
-- categoria, as duas RPCs batendo, portão de menu e de empresa, reexecução.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() <> 'sup_0945_teste' THEN RAISE EXCEPTION 'Use um banco descartável chamado sup_0945_teste'; END IF; END $$;
SET client_min_messages = error;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth;
CREATE TYPE public.app_acao AS ENUM ('visualizar','incluir','alterar','exportar','aprovar','excluir');
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE public.teste_permissao (user_id uuid, menu text, acao text);
CREATE FUNCTION public.has_screen_access(_uid uuid, _menu text, _acao public.app_acao) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.teste_permissao WHERE user_id = _uid AND menu = _menu AND acao = _acao::text)
$$;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, empresa_id uuid, acessa_todas_empresas boolean NOT NULL DEFAULT false);
CREATE TABLE public.user_empresa (user_id uuid, empresa_id uuid);
CREATE TABLE public.sup_item (id uuid PRIMARY KEY, nome text, tipo text, item_pai_id uuid, tamanho text);
CREATE TABLE public.sup_estoque_item (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid, sup_item_id uuid,
  valor_unitario numeric, arquivado_em timestamptz, updated_at timestamptz DEFAULT now());
CREATE TABLE public.sup_pedido (id uuid PRIMARY KEY, empresa_id uuid, pedido_id text, contrato_id uuid, contrato_nome text,
  posto_id uuid, funcao_id uuid, posto_nome text, funcao_nome text, nome_colaborador text, status text,
  created_at timestamptz, updated_at timestamptz,
  cancelamento_estado text NOT NULL DEFAULT 'NENHUM', cancelamento_categoria text, cancelamento_detalhe text,
  cancelamento_origem text, cancelamento_solicitado_por_nome text, cancelamento_solicitado_em timestamptz,
  cancelamento_decidido_por_nome text, cancelamento_decidido_em timestamptz);
CREATE TABLE public.sup_pedido_item (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pedido_id uuid, item_id uuid,
  tipo_item text, tamanho text, quantidade integer);
CREATE TABLE public.sup_pedido_historico (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pedido_id uuid, acao text,
  status_anterior text, observacao text, alterado_por_nome text, data_alteracao timestamptz);

-- E1 e E2; usuário 0 sem menu; 1 com menu só na E1; 2 com menu e todas as empresas.
\set e1 '''e1000000-0000-4000-8000-000000000001'''
\set e2 '''e2000000-0000-4000-8000-000000000002'''
INSERT INTO auth.users VALUES ('00000000-0000-4000-8000-000000000000'),('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
INSERT INTO public.profiles VALUES
  ('00000000-0000-4000-8000-000000000000', :e1, false),
  ('11111111-1111-4111-8111-111111111111', :e1, false),
  ('22222222-2222-4222-8222-222222222222', :e1, true);
INSERT INTO public.teste_permissao VALUES
  ('11111111-1111-4111-8111-111111111111','sup_dashboard_compras_estoque','visualizar'),
  ('22222222-2222-4222-8222-222222222222','sup_dashboard_compras_estoque','visualizar');

-- Jaqueta base + filhos M (R$ 50) e G (R$ 70); a M da E2 custa 999 e não pode
-- ganhar da E1. Luva sem preço nenhum.
INSERT INTO public.sup_item VALUES
  ('a1000000-0000-4000-8000-000000000000','JAQUETA','uniforme',NULL,NULL),
  ('a1000000-0000-4000-8000-00000000000a','JAQUETA M','uniforme','a1000000-0000-4000-8000-000000000000','M'),
  ('a1000000-0000-4000-8000-00000000000b','JAQUETA G','uniforme','a1000000-0000-4000-8000-000000000000','G'),
  ('a2000000-0000-4000-8000-000000000000','LUVA','epi',NULL,NULL);
INSERT INTO public.sup_estoque_item (empresa_id, sup_item_id, valor_unitario, updated_at) VALUES
  (:e1,'a1000000-0000-4000-8000-00000000000a',50,'2026-11-01'),
  (:e2,'a1000000-0000-4000-8000-00000000000a',999,'2026-11-18'),
  (:e1,'a1000000-0000-4000-8000-00000000000b',70,'2026-11-01');

\set c1 '''c1000000-0000-4000-8000-000000000001'''
\set p1 '''f1000000-0000-4000-8000-000000000001'''
\set p2 '''f2000000-0000-4000-8000-000000000002'''
\set p3 '''f3000000-0000-4000-8000-000000000003'''
\set p4 '''f4000000-0000-4000-8000-000000000004'''
\set fn '''fa000000-0000-4000-8000-000000000001'''
INSERT INTO public.sup_pedido (id,empresa_id,pedido_id,contrato_id,contrato_nome,posto_id,funcao_id,status,created_at,updated_at,
  cancelamento_estado,cancelamento_categoria,cancelamento_detalhe,cancelamento_origem,cancelamento_solicitado_por_nome,cancelamento_decidido_por_nome,cancelamento_decidido_em) VALUES
  -- A: aprovado, desistência, em novembro
  ('b0000000-0000-4000-8000-00000000000a',:e1,'PED-A',:c1,'C1',:p1,:fn,'CANCELADO','2026-11-01 10:00-03','2026-11-10 12:00-03',
   'APROVADO','DESISTENCIA_ADMISSAO','Candidato desistiu antes de assinar','RECRUTAMENTO','RH ANA','SUP JOAO','2026-11-10 12:00-03'),
  -- R: o novo pedido para a vaga de A
  ('b0000000-0000-4000-8000-00000000000b',:e1,'PED-R',:c1,'C1',:p1,:fn,'EM PREPARACAO','2026-11-15 09:00-03','2026-11-15 09:00-03',
   'NENHUM',NULL,NULL,NULL,NULL,NULL,NULL),
  -- L: registro antigo, motivo só no histórico, cancelado depois de despachado
  ('b0000000-0000-4000-8000-00000000000c',:e1,'PED-L',:c1,'C1',:p2,:fn,'CANCELADO','2026-10-01 10:00-03','2026-11-19 08:00-03',
   'NENHUM',NULL,NULL,NULL,NULL,NULL,NULL),
  -- F: aprovado em agosto — fora do período
  ('b0000000-0000-4000-8000-00000000000d',:e1,'PED-F',:c1,'C1',:p1,:fn,'CANCELADO','2026-08-01 10:00-03','2026-08-05 10:00-03',
   'APROVADO','DUPLICIDADE','Pedido feito duas vezes','ENCARREGADO','ENC','SUP','2026-08-05 10:00-03'),
  -- S: solicitado, ainda sem decisão
  ('b0000000-0000-4000-8000-00000000000e',:e1,'PED-S',:c1,'C1',NULL,:fn,'EM PREPARACAO','2026-11-05 10:00-03','2026-11-05 10:00-03',
   'SOLICITADO','PEDIDO_INCORRETO','Tamanho pedido errado','ENCARREGADO',NULL,NULL,NULL),
  -- K: recusado em novembro
  ('b0000000-0000-4000-8000-00000000000f',:e1,'PED-K',:c1,'C1',NULL,:fn,'AGUARDANDO ENVIO','2026-11-02 10:00-03','2026-11-12 10:00-03',
   'RECUSADO','NAO_NECESSARIO','Acho que não precisa','ENCARREGADO','ENC','SUP','2026-11-12 10:00-03'),
  -- X: desligado em setembro; o pedido seguinte do posto P3 vem 61 dias depois
  ('b0000000-0000-4000-8000-000000000010',:e1,'PED-X',:c1,'C1',:p3,:fn,'CANCELADO','2026-08-20 10:00-03','2026-09-01 10:00-03',
   'APROVADO','COLABORADOR_DESLIGADO','Colaborador desligado na experiência','ENCARREGADO','ENC','SUP','2026-09-01 10:00-03'),
  ('b0000000-0000-4000-8000-000000000011',:e1,'PED-X2',:c1,'C1',:p3,:fn,'DESPACHADO','2026-11-01 10:00-03','2026-11-01 10:00-03',
   'NENHUM',NULL,NULL,NULL,NULL,NULL,NULL),
  -- Y: desistência no posto P4; o pedido seguinte é de OUTRO posto (P1)
  ('b0000000-0000-4000-8000-000000000012',:e1,'PED-Y',:c1,'C1',:p4,NULL,'CANCELADO','2026-11-02 10:00-03','2026-11-03 10:00-03',
   'APROVADO','DESISTENCIA_ADMISSAO','Desistiu da vaga no segundo dia','ENCARREGADO','ENC','SUP','2026-11-03 10:00-03'),
  ('b0000000-0000-4000-8000-000000000013',:e1,'PED-Y2',:c1,'C1',:p1,NULL,'EM PREPARACAO','2026-11-04 10:00-03','2026-11-04 10:00-03',
   'NENHUM',NULL,NULL,NULL,NULL,NULL,NULL),
  -- T: aprovado 30/11 22:00 em São Paulo = 01/12 01:00 UTC → conta em novembro
  ('b0000000-0000-4000-8000-000000000014',:e1,'PED-T',:c1,'C1',:p1,:fn,'CANCELADO','2026-11-20 10:00-03','2026-12-01 01:00+00',
   'APROVADO','OUTRO','Motivo diferente dos listados','ENCARREGADO','ENC','SUP','2026-12-01 01:00+00'),
  -- L2: pedido seguinte da vaga do registro antigo L — aparece na linha, não no cartão
  ('b0000000-0000-4000-8000-000000000016',:e1,'PED-L2',:c1,'C1',:p2,:fn,'EM PREPARACAO','2026-10-25 10:00-03','2026-10-25 10:00-03',
   'NENHUM',NULL,NULL,NULL,NULL,NULL,NULL),
  -- A2: outra desistência da MESMA vaga de A; o novo pedido R é o mesmo
  ('b0000000-0000-4000-8000-000000000017',:e1,'PED-A2',:c1,'C1',:p1,:fn,'CANCELADO','2026-11-03 10:00-03','2026-11-12 10:00-03',
   'APROVADO','DESISTENCIA_ADMISSAO','Segunda candidata também desistiu','RECRUTAMENTO','RH ANA','SUP JOAO','2026-11-12 10:00-03'),
  -- E2: um cancelado no período, de outra empresa
  ('b0000000-0000-4000-8000-000000000015',:e2,'PED-E2',NULL,'C9',NULL,NULL,'CANCELADO','2026-11-01 10:00-03','2026-11-02 10:00-03',
   'APROVADO','DUPLICIDADE','Duplicado na outra empresa','ENCARREGADO','ENC','SUP','2026-11-02 10:00-03');
INSERT INTO public.sup_pedido_item (pedido_id,item_id,tipo_item,tamanho,quantidade) VALUES
  ('b0000000-0000-4000-8000-00000000000a','a1000000-0000-4000-8000-000000000000','uniforme','M',2),
  ('b0000000-0000-4000-8000-00000000000a','a2000000-0000-4000-8000-000000000000','epi',NULL,1),
  ('b0000000-0000-4000-8000-00000000000b','a1000000-0000-4000-8000-000000000000','uniforme','G',1),
  ('b0000000-0000-4000-8000-00000000000c','a1000000-0000-4000-8000-000000000000','uniforme','m ',1);
INSERT INTO public.sup_pedido_historico (pedido_id,acao,status_anterior,observacao,alterado_por_nome,data_alteracao) VALUES
  ('b0000000-0000-4000-8000-00000000000a','CANCELAMENTO_APROVADO','AGUARDANDO ENVIO',NULL,'SUP JOAO','2026-11-10 12:00-03'),
  ('b0000000-0000-4000-8000-00000000000c','CANCELADO','EM PREPARACAO','primeira tentativa','BERNARDO','2026-10-15 10:00-03'),
  ('b0000000-0000-4000-8000-00000000000c','CANCELADO','DESPACHADO','  Colaborador desistiu da vaga ','BERNARDO','2026-10-20 10:00-03');

\ir ../migrations/20261120030000_sis_2026_0945_dashboard_pedidos_cancelados.sql
-- Reexecução: o arquivo tem que poder rodar de novo sem erro.
\ir ../migrations/20261120030000_sis_2026_0945_dashboard_pedidos_cancelados.sql

-- ── Usuário 1 (menu + E1) ────────────────────────────────────────────────
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
DO $$
DECLARE
  d jsonb := public.sup_dashboard_cancelamentos_painel(ARRAY['e1000000-0000-4000-8000-000000000001']::uuid[], '2026-09-01', '2026-11-30');
  a jsonb; l jsonb; v jsonb;
BEGIN
  -- A, A2, L, X, Y, T. F fora do período; S e K não são cancelamento efetivado.
  IF (d->'resumo'->>'total')::int <> 6 THEN RAISE EXCEPTION 'total = %, esperado 6', d->'resumo'->>'total'; END IF;
  IF (d->'resumo'->>'legados')::int <> 1 OR (d->'resumo'->>'estruturados')::int <> 5 THEN RAISE EXCEPTION 'legado/estruturado: %', d->'resumo'; END IF;
  -- A = 2 × 50 (filho M da E1, não o 999 da E2); L = 1 × 50 ('m ' casa com M); luva sem preço.
  IF (d->'resumo'->>'valor')::numeric <> 150 THEN RAISE EXCEPTION 'valor = %, esperado 150', d->'resumo'->>'valor'; END IF;
  IF (d->'resumo'->>'unidades_sem_preco')::numeric <> 1 THEN RAISE EXCEPTION 'sem preço: %', d->'resumo'; END IF;
  IF (d->'resumo'->>'aguardando_decisao')::int <> 1 OR (d->'resumo'->>'recusados')::int <> 1 THEN RAISE EXCEPTION 'pendente/recusado: %', d->'resumo'; END IF;
  -- A e A2 tiveram o MESMO novo pedido (R, jaqueta G = 70): conta 2 vagas e 70 uma vez só.
  -- X passou de 45 dias; Y2 é de outro posto; L (antigo) tem L2, mas antigo não entra no cartão.
  IF (d->'resumo'->>'vagas_com_reposicao')::int <> 2 OR (d->'resumo'->>'valor_reposicao')::numeric <> 70 THEN RAISE EXCEPTION 'reposição: %', d->'resumo'; END IF;
  IF d->'por_mes' <> '[{"mes":"2026-09","valor":0,"cancelados":1,"pedidos_criados":0},{"mes":"2026-10","valor":50,"cancelados":1,"pedidos_criados":2},{"mes":"2026-11","valor":100,"cancelados":4,"pedidos_criados":9}]'::jsonb THEN
    RAISE EXCEPTION 'por_mes: %', d->'por_mes'; END IF;
  SELECT x INTO a FROM jsonb_array_elements(d->'linhas') x WHERE x->>'pedido_id' = 'PED-A';
  IF a->>'reposicao_pedido_id' IS DISTINCT FROM 'PED-R' OR a->>'situacao' <> 'ANTES_DESPACHO' OR a->>'motivo_nome' <> 'Desistência da admissão'
     OR a->>'origem_nome' <> 'Recrutamento' OR a->>'decidido_por_nome' <> 'SUP JOAO' THEN RAISE EXCEPTION 'linha A: %', a; END IF;
  SELECT x INTO l FROM jsonb_array_elements(d->'linhas') x WHERE x->>'pedido_id' = 'PED-L';
  IF l->>'detalhe' <> 'Colaborador desistiu da vaga' OR l->>'situacao' <> 'APOS_DESPACHO' OR l->>'decidido_por_nome' <> 'BERNARDO'
     OR (l->>'legado')::boolean IS NOT TRUE OR l->>'categoria' IS NOT NULL OR l->>'origem_nome' <> 'Registro antigo'
     OR l->>'reposicao_pedido_id' IS DISTINCT FROM 'PED-L2' THEN RAISE EXCEPTION 'linha L: %', l; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d->'por_motivo') x WHERE x->>'categoria' = 'LEGADO' AND x->>'nome' = 'Registro antigo (sem motivo padronizado)' AND (x->>'quantidade')::int = 1) THEN
    RAISE EXCEPTION 'motivo legado: %', d->'por_motivo'; END IF;
  IF jsonb_array_length(d->'pendentes') <> 1 OR d->'pendentes'->0->>'pedido_id' <> 'PED-S' THEN RAISE EXCEPTION 'pendentes: %', d->'pendentes'; END IF;
  IF (d->>'linhas_truncadas')::boolean THEN RAISE EXCEPTION 'truncou 6 linhas'; END IF;
  -- Fuso: T (01/12 01:00 UTC) é novembro; com fim em 30/11 ele entra.
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d->'linhas') x WHERE x->>'pedido_id' = 'PED-T') THEN RAISE EXCEPTION 'fuso: T ficou fora'; END IF;

  -- Filtro de categoria de item: só A tem EPI.
  v := public.sup_dashboard_cancelamentos_painel(ARRAY['e1000000-0000-4000-8000-000000000001']::uuid[], '2026-09-01', '2026-11-30', NULL, 'epi');
  IF (v->'resumo'->>'total')::int <> 1 THEN RAISE EXCEPTION 'filtro epi: %', v->'resumo'; END IF;

  -- A RPC do 0948 dá o mesmo total e já conta o registro antigo.
  v := public.sup_dashboard_cancelamentos('e1000000-0000-4000-8000-000000000001', '2026-09-01', '2026-11-30');
  IF (v->>'total')::int <> (d->'resumo'->>'total')::int THEN RAISE EXCEPTION 'RPCs divergem: % x %', v->>'total', d->'resumo'->>'total'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'por_origem') x WHERE x->>'nome' = 'Registro antigo') THEN RAISE EXCEPTION 'origem legado na RPC antiga: %', v; END IF;

  -- E2 no array sem acesso à E2.
  BEGIN
    PERFORM public.sup_dashboard_cancelamentos_painel(ARRAY['e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000002']::uuid[], '2026-09-01', '2026-11-30');
    RAISE EXCEPTION 'Leu empresa sem acesso';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- Funções internas não são chamáveis pelo navegador.
  BEGIN
    PERFORM * FROM public.sup_cancelamentos_base(ARRAY['e2000000-0000-4000-8000-000000000002']::uuid[], '2026-01-01', '2026-12-31');
    RAISE EXCEPTION 'Navegador chamou a base sem portão';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- ── Usuário 2 (todas as empresas) ────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
DO $$ BEGIN
  IF (public.sup_dashboard_cancelamentos_painel(ARRAY['e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000002']::uuid[], '2026-09-01', '2026-11-30')->'resumo'->>'total')::int <> 7 THEN
    RAISE EXCEPTION 'Todas as empresas deveria somar 7'; END IF;
END $$;

-- ── Usuário 0 (sem o menu) ───────────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000000',false);
DO $$ BEGIN
  BEGIN
    PERFORM public.sup_dashboard_cancelamentos_painel(ARRAY['e1000000-0000-4000-8000-000000000001']::uuid[], '2026-09-01', '2026-11-30');
    RAISE EXCEPTION 'Sem menu leu o painel';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.sup_dashboard_cancelamentos('e1000000-0000-4000-8000-000000000001', '2026-09-01', '2026-11-30');
    RAISE EXCEPTION 'Sem menu leu a RPC antiga';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
\echo 'OK SIS-2026-0945: aprovado + registro antigo no total, solicitado/recusado à parte, período e fuso, preço pelo tamanho, sem preço, novo pedido para a vaga (posto e 45 dias), filtro de categoria, RPCs batendo, portão de menu e empresa, reexecução.'
