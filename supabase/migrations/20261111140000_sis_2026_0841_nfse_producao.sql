-- SIS-2026-0841: ambientes fiscais separados e produção liberada por empresa.
-- Não habilita produção nem escolhe série/nota reais automaticamente.
ALTER TABLE public."NFSE_NUMERACAO" ADD COLUMN IF NOT EXISTS ambiente text NOT NULL DEFAULT 'homologacao';
ALTER TABLE public."NFSE_NUMERACAO" DROP CONSTRAINT IF EXISTS "NFSE_NUMERACAO_ambiente_check";
ALTER TABLE public."NFSE_NUMERACAO" ADD CONSTRAINT "NFSE_NUMERACAO_ambiente_check" CHECK (ambiente IN ('homologacao','producao'));
ALTER TABLE public."NFSE_NUMERACAO" DROP CONSTRAINT IF EXISTS "NFSE_NUMERACAO_pkey";
ALTER TABLE public."NFSE_NUMERACAO" ADD PRIMARY KEY (empresa_id, ambiente, serie);
ALTER TABLE public."NFSE_SOLICITACAO" DROP CONSTRAINT IF EXISTS "NFSE_SOLICITACAO_ambiente_check";
ALTER TABLE public."NFSE_SOLICITACAO" ADD CONSTRAINT "NFSE_SOLICITACAO_ambiente_check" CHECK (ambiente IN ('homologacao','producao'));
DROP INDEX IF EXISTS public.idx_nfse_solicitacao_ativa;
CREATE UNIQUE INDEX idx_nfse_solicitacao_ativa ON public."NFSE_SOLICITACAO" (nf_emissao_id,ambiente) WHERE estado <> 'rejeitada';
DROP INDEX IF EXISTS public.idx_nfse_solicitacao_dps;
CREATE UNIQUE INDEX idx_nfse_solicitacao_dps ON public."NFSE_SOLICITACAO" (empresa_id,ambiente,serie,numero_dps);

CREATE TABLE IF NOT EXISTS public."NFSE_CONFIGURACAO" (
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  ambiente text NOT NULL CHECK (ambiente IN ('homologacao','producao')),
  serie integer CHECK (serie BETWEEN 1 AND 49999),
  municipio_emissor text NOT NULL CHECK (municipio_emissor ~ '^[0-9]{7}$'),
  inscricao_municipal text NOT NULL,
  habilitado boolean NOT NULL DEFAULT false,
  nf_piloto_id uuid REFERENCES public.nf_emissao(id),
  PRIMARY KEY (empresa_id,ambiente),
  CHECK (NOT habilitado OR serie IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_nfse_configuracao_piloto ON public."NFSE_CONFIGURACAO" (nf_piloto_id) WHERE nf_piloto_id IS NOT NULL;
ALTER TABLE public."NFSE_CONFIGURACAO" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nfse_configuracao_select ON public."NFSE_CONFIGURACAO";
CREATE POLICY nfse_configuracao_select ON public."NFSE_CONFIGURACAO" FOR SELECT TO authenticated
 USING ((SELECT public.has_screen_access(auth.uid(),'financeiro-nfse','visualizar'))
 AND (SELECT public.has_screen_access(auth.uid(),'nf_emissao_controle','visualizar')));
REVOKE ALL ON public."NFSE_CONFIGURACAO" FROM anon,authenticated;
GRANT SELECT ON public."NFSE_CONFIGURACAO" TO authenticated;
GRANT ALL ON public."NFSE_CONFIGURACAO" TO service_role;
INSERT INTO public."NFSE_CONFIGURACAO" (empresa_id,ambiente,serie,municipio_emissor,inscricao_municipal,habilitado)
 SELECT e.id,v.ambiente,v.serie,v.municipio,'3761',v.habilitado FROM public.empresas e
 CROSS JOIN (VALUES ('homologacao',1041,'3542404',true),('producao',NULL::integer,'4322004',false)) v(ambiente,serie,municipio,habilitado)
 WHERE regexp_replace(e.cnpj,'[^0-9]','','g')='03644009000123'
 ON CONFLICT (empresa_id,ambiente) DO NOTHING;
UPDATE public.app_menu SET nome='NFS-e — integração com a prefeitura' WHERE codigo='financeiro-nfse';

CREATE OR REPLACE FUNCTION public.nfse_solicitar_emissao(_nf_id uuid, _parametros jsonb, _ambiente text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_nf public.nf_emissao%ROWTYPE;
  v_empresa public.empresas%ROWTYPE;
  v_id uuid;
  v_numero bigint;
  v_serie integer;
  v_config public."NFSE_CONFIGURACAO"%ROWTYPE;
BEGIN
  IF _ambiente NOT IN ('homologacao','producao') OR _ambiente IS NULL THEN RAISE EXCEPTION 'Ambiente fiscal inválido'; END IF;
  IF auth.uid() IS NULL OR NOT public.has_screen_access(auth.uid(), 'financeiro-nfse', 'incluir')
    OR NOT public.has_screen_access(auth.uid(), 'nf_emissao_controle', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para solicitar emissão de NFS-e';
  END IF;
  IF jsonb_typeof(_parametros) IS DISTINCT FROM 'object' OR octet_length(_parametros::text) > 20000 THEN
    RAISE EXCEPTION 'Parâmetros fiscais inválidos';
  END IF;
  IF _parametros->'confirmacao_fiscal' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'Confirme a revisão dos dados fiscais';
  END IF;
  IF coalesce(_parametros->>'serie', '') !~ '^[0-9]{1,5}$' THEN
    RAISE EXCEPTION 'Informe a série de DPS liberada para o ERP em homologação';
  END IF;
  v_serie := (_parametros->>'serie')::integer;
  IF v_serie NOT BETWEEN 1 AND 49999 THEN RAISE EXCEPTION 'Série de DPS inválida'; END IF;
  SELECT * INTO v_nf FROM public.nf_emissao WHERE id = _nf_id FOR UPDATE;
  IF NOT FOUND OR v_nf.status::text <> 'enviada' OR v_nf.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Escolha uma preparação enviada ao Financeiro e fora da lixeira';
  END IF;
  SELECT id INTO v_id FROM public."NFSE_SOLICITACAO" WHERE nf_emissao_id = _nf_id AND ambiente = _ambiente AND estado <> 'rejeitada';
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  IF _ambiente = 'producao' THEN
    SELECT * INTO v_config FROM public."NFSE_CONFIGURACAO" WHERE empresa_id = v_nf.empresa_id AND ambiente = _ambiente FOR SHARE;
    IF NOT FOUND OR NOT v_config.habilitado THEN RAISE EXCEPTION 'Emissão em produção ainda não liberada para esta empresa'; END IF;
    IF v_config.nf_piloto_id IS NOT NULL AND v_config.nf_piloto_id <> _nf_id THEN RAISE EXCEPTION 'Produção limitada à preparação da validação inicial'; END IF;
    IF _parametros->'confirmacao_producao' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Confirme a emissão de uma nota fiscal real'; END IF;
    IF v_serie IS DISTINCT FROM v_config.serie OR _parametros->>'municipio_emissor' IS DISTINCT FROM v_config.municipio_emissor
      OR _parametros->>'inscricao_municipal' IS DISTINCT FROM v_config.inscricao_municipal THEN RAISE EXCEPTION 'Série, município ou inscrição municipal divergem da configuração de produção'; END IF;
    IF nullif(btrim(v_nf.numero_nf::text),'') IS NOT NULL THEN RAISE EXCEPTION 'A preparação já possui número de NF; confira se já foi emitida antes de transmitir'; END IF;
  END IF;
  SELECT * INTO STRICT v_empresa FROM public.empresas WHERE id = v_nf.empresa_id;
  IF NOT v_empresa.ativa OR regexp_replace(v_empresa.cnpj, '[^0-9]', '', 'g') !~ '^[0-9]{14}$' THEN
    RAISE EXCEPTION 'Empresa inativa ou sem CNPJ válido';
  END IF;
  IF v_nf.vlr_bruto_total <= 0 OR v_nf.vlr_liquido_total < 0 THEN
    RAISE EXCEPTION 'Confira os valores salvos da preparação antes da emissão';
  END IF;
  INSERT INTO public."NFSE_NUMERACAO" (empresa_id, ambiente, serie, proximo_numero)
    VALUES (v_nf.empresa_id, _ambiente, v_serie, 2)
    ON CONFLICT (empresa_id, ambiente, serie) DO UPDATE SET proximo_numero = "NFSE_NUMERACAO".proximo_numero + 1
    RETURNING proximo_numero - 1 INTO v_numero;
  INSERT INTO public."NFSE_SOLICITACAO" (nf_emissao_id, empresa_id, ambiente, serie, numero_dps, solicitado_por, dados)
    VALUES (_nf_id, v_nf.empresa_id, _ambiente, v_serie, v_numero, auth.uid(), jsonb_build_object(
      'nota', jsonb_build_object('competencia', v_nf.competencia, 'descricao', v_nf.descricao,
        'vlr_bruto_total', v_nf.vlr_bruto_total, 'vlr_liquido_total', v_nf.vlr_liquido_total,
        'issqn_total', v_nf.issqn_total, 'inss_total', v_nf.inss_total, 'ir_total', v_nf.ir_total,
        'pis_total', v_nf.pis_total, 'cofins_total', v_nf.cofins_total, 'csll_total', v_nf.csll_total),
      'empresa', jsonb_build_object('cnpj', regexp_replace(v_empresa.cnpj, '[^0-9]', '', 'g'),
        'razao_social', v_empresa.razao_social), 'parametros', _parametros)) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.nfse_solicitar_emissao(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nfse_solicitar_emissao(uuid, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.nfse_solicitar_homologacao(_nf_id uuid,_parametros jsonb)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.nfse_solicitar_emissao(_nf_id,_parametros,'homologacao');
$$;
REVOKE ALL ON FUNCTION public.nfse_solicitar_homologacao(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.nfse_solicitar_homologacao(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.nfse_reservar_trabalho_ambiente(_ambiente text)
RETURNS SETOF public."NFSE_SOLICITACAO" LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH proximo AS (
 SELECT s.id FROM public."NFSE_SOLICITACAO" s WHERE s.ambiente=_ambiente
 AND s.tentativas<30 AND s.proxima_tentativa<=now() AND (s.reservado_ate IS NULL OR s.reservado_ate<now())
 AND (s.estado IN ('pendente','aguardando','incerta','processando') OR (s.estado='autorizada' AND s.pdf_path IS NULL))
 AND (_ambiente='homologacao' OR EXISTS (SELECT 1 FROM public."NFSE_CONFIGURACAO" c
 WHERE c.empresa_id=s.empresa_id AND c.ambiente='producao' AND c.habilitado AND c.serie=s.serie
 AND (c.nf_piloto_id IS NULL OR c.nf_piloto_id=s.nf_emissao_id)))
 ORDER BY s.proxima_tentativa,s.criado_em FOR UPDATE OF s SKIP LOCKED LIMIT 1
 ) UPDATE public."NFSE_SOLICITACAO" s SET reserva=gen_random_uuid(),reservado_ate=now()+interval '3 minutes',
 estado=CASE WHEN s.estado='autorizada' THEN s.estado ELSE 'processando' END,
 tentativas=s.tentativas+1,atualizado_em=now() FROM proximo p WHERE s.id=p.id RETURNING s.*;
$$;
CREATE OR REPLACE FUNCTION public.nfse_reservar_trabalho()
RETURNS SETOF public."NFSE_SOLICITACAO" LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT * FROM public.nfse_reservar_trabalho_ambiente('homologacao');
$$;
REVOKE ALL ON FUNCTION public.nfse_reservar_trabalho_ambiente(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nfse_reservar_trabalho_ambiente(text) TO service_role;
REVOKE ALL ON FUNCTION public.nfse_reservar_trabalho() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nfse_reservar_trabalho() TO service_role;

-- ROLLBACK operacional: desabilitar produção na configuração e no processador.
-- Preservar solicitações, numeração e documentos autorizados para auditoria.
NOTIFY pgrst,'reload schema';
