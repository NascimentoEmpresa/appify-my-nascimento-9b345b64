-- =========================================================================
-- SIS-2026-0941: PARAMETRIZAÇÃO FISCAL DA NFS-e (19/11/2026)
--
-- CHAMADO (Jeferson, Financeiro), continuação do SIS-2026-0841: a cada
-- emissão o Faturamento redigita os mesmos códigos fiscais e o tomador.
-- Pedido: (1) escolher o código de serviço e o sistema preencher código
-- nacional, NBS, código do serviço na prefeitura, CST/classificação de
-- IBS/CBS e indicador da operação; (2) CST de PIS/COFINS como lista (só
-- frontend); (3) tomador guardado por contrato e reaproveitado nas próximas
-- competências; tela própria para o Faturamento consultar e alterar.
--
-- MUDANÇA DE REGRA EM RELAÇÃO AO 0841 (deliberada): no 0841 o sistema não
-- escolhia código fiscal sozinho — a nota 1442 mostrou o cIntContrib 8111700
-- em OUTRO contrato, e cada emissão exigia a confirmação do Financeiro. Aqui
-- a confirmação passa a ser o CADASTRO feito e mantido pelo próprio
-- Financeiro: o painel só preenche quando o usuário escolhe o item de
-- serviço, tudo continua editável na nota e "Revisei os dados fiscais"
-- continua obrigatório. O CST de PIS/COFINS NÃO entra no cadastro (continua
-- escolha por nota). O worker e nfse_solicitar_emissao NÃO mudam: só muda
-- de onde vêm os valores, não o formato da DPS.
--
-- TABELAS
--   NFSE_PARAMETRO_SERVICO  1 linha por município emissor × item da LC 116.
--                           Os formatos espelham validarParametrosNfse.ts e
--                           worker/src/nfse/documento.js — o cadastro nunca
--                           guarda o que a emissão recusaria. Sem DELETE:
--                           inativa-se.
--   NFSE_DADOS_CONTRATO     1 linha por contrato: tomador + local da
--                           prestação, consumidor final, ente governamental,
--                           retenções e o último item de serviço.
--
-- COMO O CADASTRO DO CONTRATO SE ATUALIZA (decidido com o Eduardo, 19/11):
--   • Só quando a prefeitura AUTORIZA uma nota de produção (gatilho em
--     NFSE_SOLICITACAO). Tentativa rejeitada nunca estraga o cadastro.
--   • O painel manda parametros.atualizar_cadastro_contrato = false quando o
--     usuário desmarca a caixa (nota avulsa para outro tomador).
--   • Nota pedida ANTES da última atualização não sobrescreve: a edição manual
--     feita na tela depois do pedido prevalece.
--   • O gatilho nunca derruba nfse_registrar_resultado: falha vira WARNING e o
--     resultado fiscal é gravado do mesmo jeito.
--   • Carga inicial: a nota autorizada mais recente DE CADA CONTRATO (nunca de
--     outro contrato — o problema da nota 1442).
--
-- ACESSO — menu novo `financeiro-nfse-parametros`
-- (/app/financeiro/emissao-nf/parametrizacao-fiscal), módulo Financeiro.
-- Nasce PENDENTE (SIS-0931): liberar em Novos Módulos. Ações: visualizar,
-- incluir, alterar. Leitura também para quem emite (financeiro-nfse
-- visualizar), senão o painel não preenche nada. Acesso preparado: Jeferson e
-- Ana Luiza (usuários indicados no chamado). Linhas já existentes em
-- screen_permission_user não são tocadas (o código de menu é novo).
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Menu e acesso preparado ──────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'financeiro-nfse-parametros', 'Parametrização Fiscal (NFS-e)',
       '/app/financeiro/emissao-nf/parametrizacao-fiscal', 93, true
FROM public.app_modulo m WHERE m.codigo = 'financeiro'
AND NOT EXISTS (SELECT 1 FROM public.app_menu WHERE codigo = 'financeiro-nfse-parametros');

INSERT INTO public.app_menu_acao (menu_codigo, acao)
SELECT 'financeiro-nfse-parametros', a::public.app_acao
  FROM unnest(ARRAY['visualizar','incluir','alterar']) a
ON CONFLICT (menu_codigo, acao) DO NOTHING;

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT u.id, 'financeiro-nfse-parametros', a::public.app_acao, true,
       'SIS-2026-0941: Faturamento mantém a parametrização fiscal da NFS-e'
  FROM (VALUES ('8f426a53-fdbb-49f2-ad43-d39532539f2d'::uuid),   -- Jeferson Ruan Pimentel Lopes
               ('03323fbd-a05d-47c4-8ea9-0547acd5874d'::uuid))   -- Ana Luiza Faleiro Teixeira
       u(id)
 CROSS JOIN unnest(ARRAY['visualizar','incluir','alterar']) a
 WHERE EXISTS (SELECT 1 FROM auth.users x WHERE x.id = u.id)
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user s
                    WHERE s.user_id = u.id AND s.menu_codigo = 'financeiro-nfse-parametros' AND s.acao::text = a);

-- Quem emite lê; quem tem a tela lê. Uma função só para as duas tabelas.
CREATE OR REPLACE FUNCTION public.nfse_parametrizacao_pode_ler()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT auth.uid() IS NOT NULL
     AND (public.has_screen_access(auth.uid(), 'financeiro-nfse', 'visualizar')
          OR public.has_screen_access(auth.uid(), 'financeiro-nfse-parametros', 'visualizar'))
$fn$;
REVOKE ALL ON FUNCTION public.nfse_parametrizacao_pode_ler() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nfse_parametrizacao_pode_ler() TO authenticated;

-- ── 2) Parâmetros por código de serviço ────────────────────────────────
CREATE TABLE IF NOT EXISTS public."NFSE_PARAMETRO_SERVICO" (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_emissor           text NOT NULL CHECK (municipio_emissor ~ '^[0-9]{7}$'),
  item_lc116                  text NOT NULL CHECK (item_lc116 ~ '^[0-9]{2}\.[0-9]{2}$'),
  descricao                   text NOT NULL DEFAULT '' CHECK (length(descricao) <= 200),
  codigo_tributacao           text NOT NULL CHECK (codigo_tributacao ~ '^[0-9]{6}$'),
  codigo_nbs                  text NOT NULL CHECK (codigo_nbs ~ '^[0-9]{9}$'),
  codigo_integracao_municipal text NOT NULL DEFAULT '' CHECK (codigo_integracao_municipal ~ '^[a-zA-Z0-9]{0,20}$'),
  ibs_cst                     text NOT NULL CHECK (ibs_cst ~ '^[0-9]{3}$'),
  ibs_classificacao           text NOT NULL CHECK (ibs_classificacao ~ '^[0-9]{6}$'),
  ibs_indicador_operacao      text NOT NULL CHECK (ibs_indicador_operacao ~ '^[0-9]{6}$'),
  ativo                       boolean NOT NULL DEFAULT true,
  criado_em                   timestamptz NOT NULL DEFAULT now(),
  atualizado_em               timestamptz NOT NULL DEFAULT now(),
  atualizado_por              uuid REFERENCES auth.users(id),
  UNIQUE (municipio_emissor, item_lc116),
  -- 07.10 só pode apontar para 0710xx: evita trocar o item por engano.
  CONSTRAINT nfse_parametro_servico_item_confere CHECK (left(codigo_tributacao, 4) = replace(item_lc116, '.', ''))
);
CREATE INDEX IF NOT EXISTS idx_nfse_parametro_servico_atualizado_por
  ON public."NFSE_PARAMETRO_SERVICO" (atualizado_por) WHERE atualizado_por IS NOT NULL;

CREATE OR REPLACE FUNCTION public.nfse_parametro_servico_carimbo()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  NEW.atualizado_em := now();
  NEW.atualizado_por := coalesce(auth.uid(), NEW.atualizado_por);
  IF TG_OP = 'UPDATE' THEN NEW.criado_em := OLD.criado_em; END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_nfse_parametro_servico_carimbo ON public."NFSE_PARAMETRO_SERVICO";
CREATE TRIGGER trg_nfse_parametro_servico_carimbo BEFORE INSERT OR UPDATE ON public."NFSE_PARAMETRO_SERVICO"
  FOR EACH ROW EXECUTE FUNCTION public.nfse_parametro_servico_carimbo();

ALTER TABLE public."NFSE_PARAMETRO_SERVICO" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nfse_parametro_servico_select ON public."NFSE_PARAMETRO_SERVICO";
CREATE POLICY nfse_parametro_servico_select ON public."NFSE_PARAMETRO_SERVICO" FOR SELECT TO authenticated
  USING ((SELECT public.nfse_parametrizacao_pode_ler()));
DROP POLICY IF EXISTS nfse_parametro_servico_insert ON public."NFSE_PARAMETRO_SERVICO";
CREATE POLICY nfse_parametro_servico_insert ON public."NFSE_PARAMETRO_SERVICO" FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_screen_access(auth.uid(), 'financeiro-nfse-parametros', 'incluir')));
DROP POLICY IF EXISTS nfse_parametro_servico_update ON public."NFSE_PARAMETRO_SERVICO";
CREATE POLICY nfse_parametro_servico_update ON public."NFSE_PARAMETRO_SERVICO" FOR UPDATE TO authenticated
  USING ((SELECT public.has_screen_access(auth.uid(), 'financeiro-nfse-parametros', 'alterar')))
  WITH CHECK ((SELECT public.has_screen_access(auth.uid(), 'financeiro-nfse-parametros', 'alterar')));
REVOKE ALL ON public."NFSE_PARAMETRO_SERVICO" FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public."NFSE_PARAMETRO_SERVICO" TO authenticated;
GRANT ALL ON public."NFSE_PARAMETRO_SERVICO" TO service_role;

-- Valores do chamado = os mesmos das notas já autorizadas em Triunfo (4322004).
-- ON CONFLICT DO NOTHING: reexecutar não desfaz edição feita pela tela.
INSERT INTO public."NFSE_PARAMETRO_SERVICO"
  (municipio_emissor, item_lc116, descricao, codigo_tributacao, codigo_nbs, codigo_integracao_municipal,
   ibs_cst, ibs_classificacao, ibs_indicador_operacao)
VALUES
  ('4322004', '07.10', 'Limpeza, manutenção e conservação de imóveis', '071002', '118031000', '8121400', '000', '000001', '020201'),
  ('4322004', '17.05', 'Fornecimento de mão de obra',                  '170501', '118012100', '8111700', '000', '000001', '100301'),
  ('4322004', '07.11', 'Jardinagem, inclusive corte e poda de árvores', '071102', '118067000', '8111700', '000', '000001', '100301')
ON CONFLICT (municipio_emissor, item_lc116) DO NOTHING;

-- ── 3) Dados da NFS-e por contrato ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."NFSE_DADOS_CONTRATO" (
  contrato_id                 uuid PRIMARY KEY REFERENCES public.contratos(id) ON DELETE CASCADE,
  tomador_documento           text NOT NULL CHECK (tomador_documento ~ '^([0-9]{11}|[0-9]{14})$'),
  tomador_nome                text NOT NULL CHECK (btrim(tomador_nome) <> '' AND length(tomador_nome) <= 150),
  tomador_inscricao_municipal text NOT NULL DEFAULT '' CHECK (length(tomador_inscricao_municipal) <= 15),
  tomador_municipio           text NOT NULL CHECK (tomador_municipio ~ '^[0-9]{7}$'),
  tomador_cep                 text NOT NULL CHECK (tomador_cep ~ '^[0-9]{8}$'),
  tomador_logradouro          text NOT NULL CHECK (btrim(tomador_logradouro) <> '' AND length(tomador_logradouro) <= 255),
  tomador_numero              text NOT NULL CHECK (btrim(tomador_numero) <> '' AND length(tomador_numero) <= 60),
  tomador_complemento         text NOT NULL DEFAULT '' CHECK (length(tomador_complemento) <= 156),
  tomador_bairro              text NOT NULL CHECK (btrim(tomador_bairro) <> '' AND length(tomador_bairro) <= 60),
  tomador_email               text NOT NULL DEFAULT '' CHECK (length(tomador_email) <= 80),
  local_prestacao             text NOT NULL DEFAULT '' CHECK (local_prestacao ~ '^([0-9]{7})?$'),
  consumidor_final            text NOT NULL DEFAULT '' CHECK (consumidor_final IN ('', '0', '1')),
  tipo_ente_governamental     text NOT NULL DEFAULT '' CHECK (tipo_ente_governamental ~ '^[1-4]?$'),
  iss_retido                  text NOT NULL DEFAULT '' CHECK (iss_retido IN ('', '1', '2')),
  retencao_pis_cofins         text NOT NULL DEFAULT '' CHECK (retencao_pis_cofins IN ('', '1', '3', '4')),
  item_lc116                  text NOT NULL DEFAULT '' CHECK (item_lc116 ~ '^([0-9]{2}\.[0-9]{2})?$'),
  origem_solicitacao_id       uuid REFERENCES public."NFSE_SOLICITACAO"(id) ON DELETE SET NULL,
  atualizado_em               timestamptz NOT NULL DEFAULT now(),
  atualizado_por              uuid REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS idx_nfse_dados_contrato_origem
  ON public."NFSE_DADOS_CONTRATO" (origem_solicitacao_id) WHERE origem_solicitacao_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nfse_dados_contrato_atualizado_por
  ON public."NFSE_DADOS_CONTRATO" (atualizado_por) WHERE atualizado_por IS NOT NULL;

-- Escrita só pelas funções abaixo; o navegador apenas lê.
ALTER TABLE public."NFSE_DADOS_CONTRATO" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nfse_dados_contrato_select ON public."NFSE_DADOS_CONTRATO";
CREATE POLICY nfse_dados_contrato_select ON public."NFSE_DADOS_CONTRATO" FOR SELECT TO authenticated
  USING ((SELECT public.nfse_parametrizacao_pode_ler()));
REVOKE ALL ON public."NFSE_DADOS_CONTRATO" FROM anon, authenticated;
GRANT SELECT ON public."NFSE_DADOS_CONTRATO" TO authenticated;
GRANT ALL ON public."NFSE_DADOS_CONTRATO" TO service_role;

-- Recebe o mesmo formato de ParametrosNfse (tomador + campos da prestação)
-- e grava normalizado. Campos opcionais fora do domínio (ex. o "0" legado do
-- ente governamental) viram vazio em vez de recusar a linha inteira; os do
-- tomador são obrigatórios e recusam. Nota pedida antes da última
-- atualização (_quando <= atualizado_em) não sobrescreve.
CREATE OR REPLACE FUNCTION public.nfse_gravar_dados_contrato(
  _contrato_id uuid, _p jsonb, _origem uuid, _usuario uuid, _quando timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  t jsonb := coalesce(_p->'tomador', '{}'::jsonb);
  v_item text := coalesce(_p->>'item_lc116', '');
  v_trib text := regexp_replace(coalesce(_p->>'codigo_tributacao', ''), '[^0-9]', '', 'g');
  v_opc text;
BEGIN
  IF v_item !~ '^[0-9]{2}\.[0-9]{2}$' THEN
    v_item := CASE WHEN length(v_trib) >= 4 THEN substr(v_trib, 1, 2) || '.' || substr(v_trib, 3, 2) ELSE '' END;
  END IF;
  INSERT INTO public."NFSE_DADOS_CONTRATO" AS d (
    contrato_id, tomador_documento, tomador_nome, tomador_inscricao_municipal, tomador_municipio, tomador_cep,
    tomador_logradouro, tomador_numero, tomador_complemento, tomador_bairro, tomador_email,
    local_prestacao, consumidor_final, tipo_ente_governamental, iss_retido, retencao_pis_cofins, item_lc116,
    origem_solicitacao_id, atualizado_em, atualizado_por)
  VALUES (
    _contrato_id,
    regexp_replace(coalesce(t->>'documento', ''), '[^0-9]', '', 'g'),
    btrim(coalesce(t->>'nome', '')),
    btrim(coalesce(t->>'inscricao_municipal', '')),
    regexp_replace(coalesce(t->>'municipio', ''), '[^0-9]', '', 'g'),
    regexp_replace(coalesce(t->>'cep', ''), '[^0-9]', '', 'g'),
    btrim(coalesce(t->>'logradouro', '')),
    btrim(coalesce(t->>'numero', '')),
    btrim(coalesce(t->>'complemento', '')),
    btrim(coalesce(t->>'bairro', '')),
    btrim(coalesce(t->>'email', '')),
    CASE WHEN regexp_replace(coalesce(_p->>'local_prestacao', ''), '[^0-9]', '', 'g') ~ '^[0-9]{7}$'
         THEN regexp_replace(_p->>'local_prestacao', '[^0-9]', '', 'g') ELSE '' END,
    CASE WHEN _p->>'consumidor_final' IN ('0', '1') THEN _p->>'consumidor_final' ELSE '' END,
    CASE WHEN coalesce(_p->>'tipo_ente_governamental', '') ~ '^[1-4]$' THEN _p->>'tipo_ente_governamental' ELSE '' END,
    CASE WHEN _p->>'iss_retido' IN ('1', '2') THEN _p->>'iss_retido' ELSE '' END,
    CASE WHEN _p->>'retencao_pis_cofins' IN ('1', '3', '4') THEN _p->>'retencao_pis_cofins' ELSE '' END,
    v_item, _origem, _quando, _usuario)
  ON CONFLICT (contrato_id) DO UPDATE SET
    tomador_documento = EXCLUDED.tomador_documento, tomador_nome = EXCLUDED.tomador_nome,
    tomador_inscricao_municipal = EXCLUDED.tomador_inscricao_municipal, tomador_municipio = EXCLUDED.tomador_municipio,
    tomador_cep = EXCLUDED.tomador_cep, tomador_logradouro = EXCLUDED.tomador_logradouro,
    tomador_numero = EXCLUDED.tomador_numero, tomador_complemento = EXCLUDED.tomador_complemento,
    tomador_bairro = EXCLUDED.tomador_bairro, tomador_email = EXCLUDED.tomador_email,
    local_prestacao = EXCLUDED.local_prestacao, consumidor_final = EXCLUDED.consumidor_final,
    tipo_ente_governamental = EXCLUDED.tipo_ente_governamental, iss_retido = EXCLUDED.iss_retido,
    retencao_pis_cofins = EXCLUDED.retencao_pis_cofins, item_lc116 = EXCLUDED.item_lc116,
    origem_solicitacao_id = EXCLUDED.origem_solicitacao_id,
    atualizado_em = EXCLUDED.atualizado_em, atualizado_por = EXCLUDED.atualizado_por
  WHERE d.atualizado_em < EXCLUDED.atualizado_em;
  RETURN FOUND;
END $fn$;
REVOKE ALL ON FUNCTION public.nfse_gravar_dados_contrato(uuid, jsonb, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nfse_gravar_dados_contrato(uuid, jsonb, uuid, uuid, timestamptz) TO service_role;

-- Versão que nunca falha: usada pelo gatilho e pela carga inicial. Uma
-- linha inválida não pode impedir o registro do resultado fiscal nem parar
-- a fila de migrations.
CREATE OR REPLACE FUNCTION public.nfse_gravar_dados_contrato_seguro(
  _contrato_id uuid, _p jsonb, _origem uuid, _usuario uuid, _quando timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  RETURN public.nfse_gravar_dados_contrato(_contrato_id, _p, _origem, _usuario, _quando);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'SIS-2026-0941: dados do contrato % não atualizados pela solicitação % (%)', _contrato_id, _origem, SQLERRM;
  RETURN false;
END $fn$;
REVOKE ALL ON FUNCTION public.nfse_gravar_dados_contrato_seguro(uuid, jsonb, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nfse_gravar_dados_contrato_seguro(uuid, jsonb, uuid, uuid, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.nfse_solicitacao_autorizada_atualiza_contrato()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_contrato uuid;
BEGIN
  IF NEW.dados->'parametros'->'atualizar_cadastro_contrato' = 'false'::jsonb THEN RETURN NULL; END IF;
  SELECT contrato_id INTO v_contrato FROM public.nf_emissao WHERE id = NEW.nf_emissao_id;
  IF v_contrato IS NOT NULL THEN
    PERFORM public.nfse_gravar_dados_contrato_seguro(v_contrato, NEW.dados->'parametros', NEW.id, NEW.solicitado_por, NEW.criado_em);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'SIS-2026-0941: cadastro do contrato não atualizado (%)', SQLERRM;
  RETURN NULL;
END $fn$;
DROP TRIGGER IF EXISTS trg_nfse_solicitacao_autorizada_atualiza_contrato ON public."NFSE_SOLICITACAO";
CREATE TRIGGER trg_nfse_solicitacao_autorizada_atualiza_contrato
  AFTER UPDATE OF estado ON public."NFSE_SOLICITACAO"
  FOR EACH ROW
  WHEN (NEW.estado = 'autorizada' AND OLD.estado IS DISTINCT FROM 'autorizada' AND NEW.ambiente = 'producao')
  EXECUTE FUNCTION public.nfse_solicitacao_autorizada_atualiza_contrato();

-- Edição pela tela de Parametrização. Erros de formato voltam com mensagem
-- legível (o diálogo já valida antes; isto é a última barreira).
CREATE OR REPLACE FUNCTION public.nfse_salvar_dados_contrato(_contrato_id uuid, _dados jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_screen_access(auth.uid(), 'financeiro-nfse-parametros', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar os dados fiscais do contrato';
  END IF;
  IF jsonb_typeof(_dados) IS DISTINCT FROM 'object' OR octet_length(_dados::text) > 10000 THEN
    RAISE EXCEPTION 'Dados do contrato inválidos';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contratos WHERE id = _contrato_id) THEN
    RAISE EXCEPTION 'Contrato não encontrado';
  END IF;
  PERFORM public.nfse_gravar_dados_contrato(_contrato_id, _dados, NULL, auth.uid(), clock_timestamp());
EXCEPTION WHEN check_violation OR not_null_violation THEN
  RAISE EXCEPTION 'Confira CPF/CNPJ (11 ou 14 números), nome, município (código IBGE), CEP (8 números), logradouro, número e bairro do tomador';
END $fn$;
REVOKE ALL ON FUNCTION public.nfse_salvar_dados_contrato(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nfse_salvar_dados_contrato(uuid, jsonb) TO authenticated;

-- ── 4) Carga inicial: última nota de produção autorizada de cada contrato ─
SELECT count(*) FILTER (WHERE gravado) AS contratos_carregados
  FROM (
    SELECT public.nfse_gravar_dados_contrato_seguro(u.contrato_id, u.parametros, u.id, u.solicitado_por, u.criado_em) AS gravado
      FROM (
        SELECT DISTINCT ON (n.contrato_id) n.contrato_id, s.dados->'parametros' AS parametros, s.id, s.solicitado_por, s.criado_em
          FROM public."NFSE_SOLICITACAO" s
          JOIN public.nf_emissao n ON n.id = s.nf_emissao_id
         WHERE s.ambiente = 'producao' AND s.estado = 'autorizada' AND n.contrato_id IS NOT NULL
           AND s.dados->'parametros'->'atualizar_cadastro_contrato' IS DISTINCT FROM 'false'::jsonb
         ORDER BY n.contrato_id, s.criado_em DESC
      ) u
  ) c;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (o cadastro some; as notas emitidas e o histórico em
-- NFSE_SOLICITACAO não são tocados):
-- DROP TRIGGER IF EXISTS trg_nfse_solicitacao_autorizada_atualiza_contrato ON public."NFSE_SOLICITACAO";
-- DROP FUNCTION IF EXISTS public.nfse_solicitacao_autorizada_atualiza_contrato();
-- DROP FUNCTION IF EXISTS public.nfse_salvar_dados_contrato(uuid, jsonb);
-- DROP FUNCTION IF EXISTS public.nfse_gravar_dados_contrato_seguro(uuid, jsonb, uuid, uuid, timestamptz);
-- DROP FUNCTION IF EXISTS public.nfse_gravar_dados_contrato(uuid, jsonb, uuid, uuid, timestamptz);
-- DROP TABLE IF EXISTS public."NFSE_DADOS_CONTRATO";
-- DROP TABLE IF EXISTS public."NFSE_PARAMETRO_SERVICO";
-- DROP FUNCTION IF EXISTS public.nfse_parametro_servico_carimbo();
-- DROP FUNCTION IF EXISTS public.nfse_parametrizacao_pode_ler();
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'financeiro-nfse-parametros';
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'financeiro-nfse-parametros';
-- DELETE FROM public.app_menu WHERE codigo = 'financeiro-nfse-parametros';
