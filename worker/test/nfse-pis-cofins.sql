-- Somente PostgreSQL 18 descartável nfse_0841_teste. Nenhuma transmissão fiscal.
\ir nfse-producao.sql
DELETE FROM public."NFSE_SOLICITACAO";
ALTER TABLE public.nf_emissao ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN updated_by uuid, ADD COLUMN pis_pct numeric(6,4) DEFAULT 0, ADD COLUMN cofins_pct numeric(6,4) DEFAULT 0;
CREATE FUNCTION public.can_access(_uid uuid, _menu text, _acao public.app_acao) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.has_screen_access(_uid, _menu, _acao)
$$;
CREATE TABLE public.nf_emissao_item(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nf_emissao_id uuid,
  vlr_bruto numeric(14,2), pis numeric(14,2), cofins numeric(14,2), vlr_liquido numeric(14,2),
  pis_pct numeric(6,4), cofins_pct numeric(6,4), issqn numeric(14,2), inss numeric(14,2));
CREATE TABLE public.nf_emissao_historico(nf_emissao_id uuid, acao text, detalhe text, dados jsonb);
CREATE FUNCTION public.teste_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := clock_timestamp(); RETURN NEW; END $$;
CREATE TRIGGER teste_updated_at BEFORE UPDATE ON public.nf_emissao FOR EACH ROW EXECUTE FUNCTION public.teste_updated_at();
GRANT SELECT ON public.nf_emissao,public.nf_emissao_item,public.nf_emissao_historico TO authenticated;
UPDATE public.nf_emissao SET vlr_bruto_total=29848.96,vlr_liquido_total=22795.93,pis_total=194.02,cofins_total=895.47,
  issqn_total=1492.45,inss_total=2739.86,ir_total=1432.75,csll_total=298.49 WHERE id='55555555-5555-4555-8555-555555555555';
INSERT INTO public.nf_emissao_item(nf_emissao_id,vlr_bruto,pis,cofins,vlr_liquido,pis_pct,cofins_pct,issqn,inss)
  VALUES ('55555555-5555-4555-8555-555555555555',29848.96,194.02,895.47,22795.93,.0065,.03,1492.45,2739.86);
\ir ../../supabase/migrations/20261116210000_sis_2026_0841_percentuais_pis_cofins.sql
\ir ../../supabase/migrations/20261116210000_sis_2026_0841_percentuais_pis_cofins.sql
CREATE FUNCTION public.teste_ajustar(_pis numeric, _cofins numeric) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_versao timestamptz; v_base jsonb;
BEGIN
 SELECT updated_at INTO v_versao FROM public.nf_emissao WHERE id='55555555-5555-4555-8555-555555555555';
 SELECT jsonb_agg(jsonb_build_object('id',id,'bruto',vlr_bruto,'pis',pis,'cofins',cofins,'liquido',vlr_liquido) ORDER BY id)
 INTO v_base FROM public.nf_emissao_item WHERE nf_emissao_id='55555555-5555-4555-8555-555555555555';
 PERFORM public.nfse_atualizar_pis_cofins('55555555-5555-4555-8555-555555555555',_pis,_cofins,v_versao,v_base);
END $$;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.teste_ajustar(.655,3); RAISE EXCEPTION 'Aceitou precisão inválida'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Informe percentuais%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.teste_ajustar('NaN',3); RAISE EXCEPTION 'Aceitou NaN'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Informe percentuais%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.teste_ajustar(-1,3); RAISE EXCEPTION 'Aceitou negativo'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Informe percentuais%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.teste_ajustar(NULL,3); RAISE EXCEPTION 'Aceitou NULL'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Informe percentuais%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.nfse_atualizar_pis_cofins('55555555-5555-4555-8555-555555555555',.65,3,'2020-01-01','[]');
 RAISE EXCEPTION 'Aceitou versão antiga'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'A preparação foi alterada%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.teste_ajustar(100,100); RAISE EXCEPTION 'Aceitou líquido negativo'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%líquido%negativo' THEN RAISE; END IF; END;
END $$;
SELECT set_config('teste.sem_incluir','1',false);
DO $$ BEGIN
 BEGIN PERFORM public.teste_ajustar(.65,3); RAISE EXCEPTION 'Alterou sem permissão'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Sem permissão%' THEN RAISE; END IF; END;
END $$;
SELECT set_config('teste.sem_incluir','0',false);
SELECT public.teste_ajustar(1,2);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.nf_emissao WHERE pis_total=298.49 AND cofins_total=596.98 AND vlr_liquido_total=22989.95 AND pis_pct=.01 AND cofins_pct=.02 AND issqn_total=1492.45 AND inss_total=2739.86 AND ir_total=1432.75 AND csll_total=298.49) THEN RAISE EXCEPTION 'Cálculo ou preservação das retenções incorretos'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.nf_emissao_item WHERE pis=298.49 AND cofins=596.98 AND vlr_liquido=22989.95 AND issqn=1492.45 AND inss=2739.86) THEN RAISE EXCEPTION 'Itens não atualizados'; END IF;
 IF (SELECT count(*) FROM public.nf_emissao_historico)<>1 THEN RAISE EXCEPTION 'Auditoria ausente'; END IF;
END $$;
SELECT public.nfse_solicitar_emissao('55555555-5555-4555-8555-555555555555','{"serie":"123","confirmacao_fiscal":true}','homologacao');
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public."NFSE_SOLICITACAO" WHERE dados#>>'{nota,pis_total}'='298.49' AND dados#>>'{nota,cofins_total}'='596.98' AND dados#>>'{nota,vlr_liquido_total}'='22989.95') THEN RAISE EXCEPTION 'Snapshot não usa os valores recalculados'; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE v_estado text; BEGIN
 FOREACH v_estado IN ARRAY ARRAY['pendente','processando','aguardando','incerta','autorizada','erro'] LOOP
 UPDATE public."NFSE_SOLICITACAO" SET estado=v_estado;
 BEGIN PERFORM public.teste_ajustar(.65,3); RAISE EXCEPTION 'Alterou com solicitação ativa'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Há solicitação fiscal ativa%' THEN RAISE; END IF; END;
 END LOOP;
 UPDATE public."NFSE_SOLICITACAO" SET estado='rejeitada';
END $$;
SELECT public.teste_ajustar(0,0);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.nf_emissao WHERE pis_total=0 AND cofins_total=0 AND vlr_liquido_total=23885.42) THEN RAISE EXCEPTION 'Zero não retirou somente PIS/COFINS'; END IF;
 UPDATE public.nf_emissao SET numero_nf='123';
 BEGIN PERFORM public.teste_ajustar(.65,3); RAISE EXCEPTION 'Alterou NF emitida'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Ajuste permitido somente%' THEN RAISE; END IF; END;
 UPDATE public.nf_emissao SET numero_nf=NULL,deleted_at=now();
 BEGIN PERFORM public.teste_ajustar(.65,3); RAISE EXCEPTION 'Alterou NF excluída'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Ajuste permitido somente%' THEN RAISE; END IF; END;
 UPDATE public.nf_emissao SET deleted_at=NULL,status='concluida';
 BEGIN PERFORM public.teste_ajustar(.65,3); RAISE EXCEPTION 'Alterou NF concluída'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Ajuste permitido somente%' THEN RAISE; END IF; END;
 UPDATE public.nf_emissao SET status='enviada';
END $$;
-- Falha no histórico reverte itens e cabeçalho juntos.
CREATE FUNCTION public.teste_falha_historico() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falha simulada'; END $$;
CREATE TRIGGER teste_falha BEFORE INSERT ON public.nf_emissao_historico FOR EACH ROW EXECUTE FUNCTION public.teste_falha_historico();
DO $$ BEGIN
 BEGIN PERFORM public.teste_ajustar(.65,3); EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'falha simulada' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.nf_emissao WHERE pis_total<>0 OR cofins_total<>0) OR EXISTS(SELECT 1 FROM public.nf_emissao_item WHERE pis<>0 OR cofins<>0) THEN RAISE EXCEPTION 'Atualização parcial após falha'; END IF;
END $$;
DROP TRIGGER teste_falha ON public.nf_emissao_historico;
-- Duas bases de R$ 1,00: 0,5% arredonda para R$ 0,01 em cada item.
DELETE FROM public.nf_emissao_item;
INSERT INTO public.nf_emissao_item(nf_emissao_id,vlr_bruto,pis,cofins,vlr_liquido,pis_pct,cofins_pct,issqn,inss)
  VALUES ('55555555-5555-4555-8555-555555555555',1,0,0,.8,0,0,.1,.1),
         ('55555555-5555-4555-8555-555555555555',1,0,0,.8,0,0,.1,.1);
UPDATE public.nf_emissao SET vlr_bruto_total=2,pis_total=0,cofins_total=0,vlr_liquido_total=1.6 WHERE id='55555555-5555-4555-8555-555555555555';
SELECT public.teste_ajustar(.5,.5);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.nf_emissao WHERE pis_total=.02 AND cofins_total=.02 AND vlr_liquido_total=1.56) THEN RAISE EXCEPTION 'Arredondamento por item divergente'; END IF;
END $$;
\echo 'OK: recálculo atômico, permissões, versão, arredondamento, snapshot fiscal, proteção de emissão e auditoria.'
