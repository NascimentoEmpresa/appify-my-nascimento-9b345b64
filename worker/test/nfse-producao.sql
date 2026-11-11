-- Somente no PostgreSQL descartável nfse_0841_teste; nunca no cluster do ERP.
\ir nfse-fila.sql
\ir ../../supabase/migrations/20261111140000_sis_2026_0841_nfse_producao.sql
\ir ../../supabase/migrations/20261111140000_sis_2026_0841_nfse_producao.sql
INSERT INTO public."NFSE_CONFIGURACAO" (empresa_id,ambiente,serie,municipio_emissor,inscricao_municipal,habilitado,nf_piloto_id)
 VALUES ('44444444-4444-4444-8444-444444444444','producao',123,'4322004','100',false,'55555555-5555-4555-8555-555555555555');
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.nfse_solicitar_emissao('55555555-5555-4555-8555-555555555555','{"serie":"123","confirmacao_fiscal":true,"confirmacao_producao":true,"municipio_emissor":"4322004","inscricao_municipal":"100"}','producao');
 RAISE EXCEPTION 'Produção desabilitada foi aceita'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Emissão em produção ainda%' THEN RAISE; END IF; END;
 BEGIN UPDATE public."NFSE_CONFIGURACAO" SET habilitado=true; RAISE EXCEPTION 'Navegador habilitou produção'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.nfse_reservar_trabalho_ambiente('producao'); RAISE EXCEPTION 'Navegador acessou fila de produção'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public."NFSE_CONFIGURACAO" SET habilitado=true WHERE ambiente='producao';
INSERT INTO public.nf_emissao (id,empresa_id,status,competencia,descricao,vlr_bruto_total,vlr_liquido_total)
 VALUES ('66666666-6666-4666-8666-666666666666','44444444-4444-4444-8444-444444444444','enviada','2026-10-01','Preparação fora do piloto',100,82.2);
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.nfse_solicitar_emissao('66666666-6666-4666-8666-666666666666','{"serie":"123","confirmacao_fiscal":true,"confirmacao_producao":true,"municipio_emissor":"4322004","inscricao_municipal":"100"}','producao');
 RAISE EXCEPTION 'Preparação fora do piloto aceita'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Produção limitada%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.nfse_solicitar_emissao('55555555-5555-4555-8555-555555555555','{"serie":"123","confirmacao_fiscal":true,"municipio_emissor":"4322004","inscricao_municipal":"100"}','producao');
 RAISE EXCEPTION 'Emissão real sem confirmação'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Confirme a emissão%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.nfse_solicitar_emissao('55555555-5555-4555-8555-555555555555','{"serie":"123","confirmacao_fiscal":true,"confirmacao_producao":true,"municipio_emissor":"3542404","inscricao_municipal":"100"}','producao');
 RAISE EXCEPTION 'Município de teste aceito em produção'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Série, município%' THEN RAISE; END IF; END;
END $$;
SELECT public.nfse_solicitar_emissao('55555555-5555-4555-8555-555555555555','{"serie":"123","confirmacao_fiscal":true,"confirmacao_producao":true,"municipio_emissor":"4322004","inscricao_municipal":"100"}','producao');
SELECT public.nfse_solicitar_emissao('55555555-5555-4555-8555-555555555555','{"serie":"123","confirmacao_fiscal":true,"confirmacao_producao":true,"municipio_emissor":"4322004","inscricao_municipal":"100"}','producao');
DO $$ BEGIN
 IF (SELECT count(*) FROM public."NFSE_SOLICITACAO" WHERE ambiente='producao')<>1 THEN RAISE EXCEPTION 'Duplo clique duplicou produção'; END IF;
 IF (SELECT numero_dps FROM public."NFSE_SOLICITACAO" WHERE ambiente='producao')<>1 THEN RAISE EXCEPTION 'Numeração real misturada com homologação'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999999',false);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public."NFSE_CONFIGURACAO") THEN RAISE EXCEPTION 'Configuração exposta sem acesso'; END IF; END $$;
RESET ROLE;
SET ROLE service_role;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.nfse_reservar_trabalho() WHERE ambiente<>'homologacao') THEN RAISE EXCEPTION 'Worker antigo reservou produção'; END IF;
 IF (SELECT count(*) FROM public.nfse_reservar_trabalho_ambiente('producao'))<>1 THEN RAISE EXCEPTION 'Não reservou produção'; END IF;
 IF EXISTS(SELECT 1 FROM public.nfse_reservar_trabalho_ambiente('producao')) THEN RAISE EXCEPTION 'Reserva real duplicada'; END IF;
END $$;
RESET ROLE;
\echo 'OK: produção desabilitada por padrão, confirmação real, configuração fiscal, ambientes e numeração isolados, permissões e lease.'
