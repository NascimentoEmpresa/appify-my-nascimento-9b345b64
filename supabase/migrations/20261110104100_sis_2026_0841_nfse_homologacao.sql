-- SIS-2026-0841: piloto da NFS-e nacional/GOVBR no Financeiro.
-- O piloto aceita SOMENTE homologação. Não atualiza número/status de nf_emissao.
-- Certificados, chaves privadas, senhas e endereços de API ficam no worker.

-- 1. Permissão específica, sob o módulo Financeiro já existente.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT id, 'financeiro-nfse', 'NFS-e — integração e homologação', NULL, 95
FROM public.app_modulo WHERE codigo = 'financeiro'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT p.id, 'financeiro-nfse', a.acao::public.app_acao, true
FROM public.perfil_acesso p
JOIN public.app_modulo m ON m.nome = p.nome AND m.codigo = 'financeiro'
CROSS JOIN (VALUES ('visualizar'), ('incluir'), ('alterar'), ('exportar')) a(acao)
WHERE p.ativo AND NOT p.concede_tudo
ON CONFLICT DO NOTHING;

-- 2. Numeração transacional, independente da numeração do portal.
CREATE TABLE IF NOT EXISTS public."NFSE_NUMERACAO" (
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  serie integer NOT NULL CHECK (serie BETWEEN 1 AND 49999),
  proximo_numero bigint NOT NULL DEFAULT 1 CHECK (proximo_numero BETWEEN 1 AND 999999999999999),
  PRIMARY KEY (empresa_id, serie)
);
ALTER TABLE public."NFSE_NUMERACAO" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."NFSE_NUMERACAO" FROM anon, authenticated;
GRANT ALL ON public."NFSE_NUMERACAO" TO service_role;

CREATE TABLE IF NOT EXISTS public."NFSE_SOLICITACAO" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nf_emissao_id uuid NOT NULL REFERENCES public.nf_emissao(id),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  ambiente text NOT NULL DEFAULT 'homologacao' CHECK (ambiente = 'homologacao'),
  serie integer NOT NULL CHECK (serie BETWEEN 1 AND 49999),
  numero_dps bigint NOT NULL CHECK (numero_dps BETWEEN 1 AND 999999999999999),
  estado text NOT NULL DEFAULT 'pendente' CHECK (estado IN
    ('pendente', 'processando', 'aguardando', 'autorizada', 'rejeitada', 'erro', 'incerta')),
  dados jsonb NOT NULL CHECK (jsonb_typeof(dados) = 'object'),
  solicitado_por uuid REFERENCES auth.users(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  proxima_tentativa timestamptz NOT NULL DEFAULT now(),
  tentativas integer NOT NULL DEFAULT 0,
  reserva uuid,
  reservado_ate timestamptz,
  envio_iniciado_em timestamptz,
  protocolo uuid,
  chave text CHECK (chave IS NULL OR chave ~ '^[0-9]{50}$'),
  numero_nf text,
  xml_envio_path text,
  xml_retorno_path text,
  pdf_path text,
  mensagem text
);
CREATE INDEX IF NOT EXISTS idx_nfse_solicitacao_empresa ON public."NFSE_SOLICITACAO" (empresa_id);
CREATE INDEX IF NOT EXISTS idx_nfse_solicitacao_usuario ON public."NFSE_SOLICITACAO" (solicitado_por);
CREATE INDEX IF NOT EXISTS idx_nfse_solicitacao_nota ON public."NFSE_SOLICITACAO" (nf_emissao_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_nfse_solicitacao_fila ON public."NFSE_SOLICITACAO" (proxima_tentativa)
  WHERE estado IN ('pendente', 'processando', 'aguardando', 'incerta', 'autorizada');
CREATE UNIQUE INDEX IF NOT EXISTS idx_nfse_solicitacao_ativa ON public."NFSE_SOLICITACAO" (nf_emissao_id)
  WHERE estado <> 'rejeitada';
CREATE UNIQUE INDEX IF NOT EXISTS idx_nfse_solicitacao_dps ON public."NFSE_SOLICITACAO" (empresa_id, serie, numero_dps);
CREATE INDEX IF NOT EXISTS idx_nfse_solicitacao_xml_envio ON public."NFSE_SOLICITACAO" (xml_envio_path) WHERE xml_envio_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nfse_solicitacao_xml_retorno ON public."NFSE_SOLICITACAO" (xml_retorno_path) WHERE xml_retorno_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nfse_solicitacao_pdf ON public."NFSE_SOLICITACAO" (pdf_path) WHERE pdf_path IS NOT NULL;

ALTER TABLE public."NFSE_SOLICITACAO" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nfse_solicitacao_select ON public."NFSE_SOLICITACAO";
CREATE POLICY nfse_solicitacao_select ON public."NFSE_SOLICITACAO" FOR SELECT TO authenticated
  USING ((SELECT public.has_screen_access(auth.uid(), 'financeiro-nfse', 'visualizar'))
    AND (SELECT public.has_screen_access(auth.uid(), 'nf_emissao_controle', 'visualizar')));
REVOKE ALL ON public."NFSE_SOLICITACAO" FROM anon, authenticated;
GRANT SELECT ON public."NFSE_SOLICITACAO" TO authenticated;
GRANT ALL ON public."NFSE_SOLICITACAO" TO service_role;

-- 3. Pedido pelo usuário: snapshot e valores vêm do banco, não do navegador.
CREATE OR REPLACE FUNCTION public.nfse_solicitar_homologacao(_nf_id uuid, _parametros jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_nf public.nf_emissao%ROWTYPE;
  v_empresa public.empresas%ROWTYPE;
  v_id uuid;
  v_numero bigint;
  v_serie integer;
BEGIN
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
  SELECT id INTO v_id FROM public."NFSE_SOLICITACAO" WHERE nf_emissao_id = _nf_id AND estado <> 'rejeitada';
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT * INTO STRICT v_empresa FROM public.empresas WHERE id = v_nf.empresa_id;
  IF NOT v_empresa.ativa OR regexp_replace(v_empresa.cnpj, '[^0-9]', '', 'g') !~ '^[0-9]{14}$' THEN
    RAISE EXCEPTION 'Empresa inativa ou sem CNPJ válido';
  END IF;
  IF v_nf.vlr_bruto_total <= 0 OR v_nf.vlr_liquido_total < 0 THEN
    RAISE EXCEPTION 'Confira os valores salvos da preparação antes da emissão';
  END IF;
  INSERT INTO public."NFSE_NUMERACAO" (empresa_id, serie, proximo_numero)
    VALUES (v_nf.empresa_id, v_serie, 2)
    ON CONFLICT (empresa_id, serie) DO UPDATE SET proximo_numero = "NFSE_NUMERACAO".proximo_numero + 1
    RETURNING proximo_numero - 1 INTO v_numero;
  INSERT INTO public."NFSE_SOLICITACAO" (nf_emissao_id, empresa_id, serie, numero_dps, solicitado_por, dados)
    VALUES (_nf_id, v_nf.empresa_id, v_serie, v_numero, auth.uid(), jsonb_build_object(
      'nota', jsonb_build_object('competencia', v_nf.competencia, 'descricao', v_nf.descricao,
        'vlr_bruto_total', v_nf.vlr_bruto_total, 'vlr_liquido_total', v_nf.vlr_liquido_total,
        'issqn_total', v_nf.issqn_total, 'inss_total', v_nf.inss_total, 'ir_total', v_nf.ir_total,
        'pis_total', v_nf.pis_total, 'cofins_total', v_nf.cofins_total, 'csll_total', v_nf.csll_total),
      'empresa', jsonb_build_object('cnpj', regexp_replace(v_empresa.cnpj, '[^0-9]', '', 'g'),
        'razao_social', v_empresa.razao_social), 'parametros', _parametros)) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.nfse_solicitar_homologacao(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nfse_solicitar_homologacao(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.nfse_reprocessar(_id uuid, _descartar boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_s public."NFSE_SOLICITACAO"%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_screen_access(auth.uid(), 'financeiro-nfse', 'alterar')
    OR NOT public.has_screen_access(auth.uid(), 'nf_emissao_controle', 'visualizar') THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  SELECT * INTO STRICT v_s FROM public."NFSE_SOLICITACAO" WHERE id = _id FOR UPDATE;
  IF v_s.reservado_ate > now() THEN RAISE EXCEPTION 'Aguarde o processamento atual'; END IF;
  IF _descartar THEN
    IF v_s.envio_iniciado_em IS NOT NULL OR v_s.estado NOT IN ('pendente','erro') THEN
      RAISE EXCEPTION 'Só é possível descartar uma solicitação antes de iniciar o envio';
    END IF;
    UPDATE public."NFSE_SOLICITACAO" SET estado = 'rejeitada', mensagem = 'Solicitação descartada antes do envio', atualizado_em = now() WHERE id = _id;
  ELSE
    IF v_s.estado NOT IN ('erro','incerta','aguardando','processando') AND NOT (v_s.estado = 'autorizada' AND v_s.pdf_path IS NULL) THEN
      RAISE EXCEPTION 'Esta solicitação não precisa de reprocessamento';
    END IF;
    -- Depois de iniciar o envio, reprocessar significa CONSULTAR, nunca retransmitir.
    UPDATE public."NFSE_SOLICITACAO" SET estado = CASE WHEN v_s.estado = 'autorizada' THEN 'autorizada'
      WHEN envio_iniciado_em IS NULL THEN 'pendente' ELSE 'aguardando' END,
      tentativas = 0, proxima_tentativa = now(), reserva = NULL, reservado_ate = NULL, atualizado_em = now()
    WHERE id = _id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.nfse_reprocessar(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nfse_reprocessar(uuid, boolean) TO authenticated;

-- 4. Reserva com lease: duas instâncias do worker não enviam a mesma DPS.
CREATE OR REPLACE FUNCTION public.nfse_reservar_trabalho()
RETURNS SETOF public."NFSE_SOLICITACAO" LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH proximo AS (
    SELECT id FROM public."NFSE_SOLICITACAO"
    WHERE tentativas < 30 AND proxima_tentativa <= now() AND (reservado_ate IS NULL OR reservado_ate < now())
      AND (estado IN ('pendente','aguardando','incerta','processando') OR (estado = 'autorizada' AND pdf_path IS NULL))
    ORDER BY proxima_tentativa, criado_em FOR UPDATE SKIP LOCKED LIMIT 1
  )
  UPDATE public."NFSE_SOLICITACAO" s SET reserva = gen_random_uuid(), reservado_ate = now() + interval '3 minutes',
    estado = CASE WHEN s.estado = 'autorizada' THEN s.estado ELSE 'processando' END,
    tentativas = s.tentativas + 1, atualizado_em = now()
  FROM proximo p WHERE s.id = p.id RETURNING s.*;
$$;
CREATE OR REPLACE FUNCTION public.nfse_marcar_envio(_id uuid, _reserva uuid, _xml_path text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public."NFSE_SOLICITACAO" SET envio_iniciado_em = now(), xml_envio_path = _xml_path, atualizado_em = now()
    WHERE id = _id AND reserva = _reserva AND reservado_ate > now() AND envio_iniciado_em IS NULL AND estado = 'processando';
  RETURN FOUND;
END $$;
CREATE OR REPLACE FUNCTION public.nfse_registrar_resultado(_id uuid, _reserva uuid, _resultado jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_s public."NFSE_SOLICITACAO"%ROWTYPE; v_estado text := _resultado->>'estado';
BEGIN
  SELECT * INTO v_s FROM public."NFSE_SOLICITACAO" WHERE id = _id AND reserva = _reserva AND reservado_ate > now() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_estado NOT IN ('aguardando','autorizada','rejeitada','erro','incerta') THEN RAISE EXCEPTION 'Resultado inválido'; END IF;
  IF v_s.estado = 'autorizada' AND v_estado <> 'autorizada' THEN RAISE EXCEPTION 'Documento autorizado não pode regredir'; END IF;
  IF v_estado = 'autorizada' AND (coalesce(_resultado->>'chave', v_s.chave, '') !~ '^[0-9]{50}$'
    OR coalesce(_resultado->>'numero_nf', v_s.numero_nf, '') !~ '^[0-9]+$'
    OR coalesce(_resultado->>'xml_retorno_path', v_s.xml_retorno_path) IS NULL) THEN
    RAISE EXCEPTION 'Documento autorizado sem identificação ou XML oficial';
  END IF;
  IF v_estado = 'rejeitada' AND v_s.envio_iniciado_em IS NULL THEN RAISE EXCEPTION 'Rejeição fiscal sem envio'; END IF;
  UPDATE public."NFSE_SOLICITACAO" SET estado = v_estado,
    protocolo = coalesce((_resultado->>'protocolo')::uuid, protocolo),
    chave = coalesce(_resultado->>'chave', chave), numero_nf = coalesce(_resultado->>'numero_nf', numero_nf),
    xml_retorno_path = coalesce(_resultado->>'xml_retorno_path', xml_retorno_path), pdf_path = coalesce(_resultado->>'pdf_path', pdf_path),
    mensagem = left(_resultado->>'mensagem', 2000), proxima_tentativa = now() + interval '1 minute',
    reserva = NULL, reservado_ate = NULL, atualizado_em = now() WHERE id = _id;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.nfse_reservar_trabalho() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nfse_marcar_envio(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nfse_registrar_resultado(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nfse_reservar_trabalho() TO service_role;
GRANT EXECUTE ON FUNCTION public.nfse_marcar_envio(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nfse_registrar_resultado(uuid, uuid, jsonb) TO service_role;

-- 5. Artefatos privados, somente o worker escreve; leitura segue as permissões da tela.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('nfse-integracao', 'nfse-integracao', false, 15728640) ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "nfse integracao leitura" ON storage.objects;
CREATE POLICY "nfse integracao leitura" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'nfse-integracao'
  AND (SELECT public.has_screen_access(auth.uid(), 'financeiro-nfse', 'visualizar'))
  AND (SELECT public.has_screen_access(auth.uid(), 'nf_emissao_controle', 'visualizar'))
  AND (SELECT public.has_screen_access(auth.uid(), 'financeiro-nfse', 'exportar'))
  AND EXISTS (SELECT 1 FROM public."NFSE_SOLICITACAO" s
    WHERE storage.objects.name IN (s.xml_envio_path, s.xml_retorno_path, s.pdf_path))
);

-- ROLLBACK operacional: desabilitar NFSE_HABILITADO no worker e o menu financeiro-nfse.
-- Preservar solicitações/numeração/arquivos para auditoria; não apagar documentos fiscais.
NOTIFY pgrst, 'reload schema';
