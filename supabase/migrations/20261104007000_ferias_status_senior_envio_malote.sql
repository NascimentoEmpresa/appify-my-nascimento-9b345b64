-- =========================================================================
-- FÉRIAS — Status Senior, recibo, valor e envio ao Malote pela Gestão de
-- Férias; "Enviado em" da documentação (04/11/2026)
--
-- PEDIDO (Pablo, 04/11/2026)
--   "preciso migrar esse STATUS também, é o Status da Senior. [...] é um
--   status se foi gerado as férias dentro da senior. é Pendente ou Gerado."
--   "o RH gera as férias na senior e envia no malote do sistema, mas agora o
--   RH vai enviar as férias direto do gestão de férias, primeiro vai anexar o
--   arquivo gerado da senior de férias, ai vai puxar o valor automaticamente
--   e aí sim vai ser preenchido automatico e enviado pro malote, precisa de
--   confirmação pra tudo [...] (não pode puxar errado de forma alguma.)"
--   "a data do envio do malote só vai aparecer depois de clicar no novo botão
--   que SÓ APARECE PRO RH"
--   "o ENVIADO EM e o RETORNO DA DOCUMENTAÇÃO são os históricos. o Enviado em
--   precisa ser importado pro sistema de férias também."
--
-- OS TRÊS STATUS DE UMA SOLICITAÇÃO
--   status            Pendente/Aprovada/Reprovada/Cancelada (a solicitação)
--   status_senior     Pendente/Gerado — as férias já foram geradas na Senior
--                     (coluna STATUS das planilhas: GERADA). Vira "Gerado"
--                     sozinho ao anexar o recibo; o RH também marca à mão.
--   documentação      documentacao_enviada_em ("ENVIADO EM": "ENVIADO
--                     ZAPSIGN - 04/11/2026") e retorno_documentacao — texto
--                     livre, como na planilha.
--
-- O FLUXO DO BOTÃO (src/pages/rh/EnviarFeriasMalote.tsx), três passos, cada
-- um com confirmação, cada um numa RPC:
--   1. ferias_recibo_anexar   o PDF/imagem do recibo da Senior (bucket
--                             ferias-recibos/<id>/...). Status Senior → Gerado.
--                             Anexar de novo troca o arquivo e APAGA o valor
--                             confirmado (o valor é do arquivo).
--   2. ferias_valor_confirmar o líquido. A tela lê o recibo (texto do PDF ou
--                             OCR — src/lib/rh/reciboFerias.ts) e só preenche
--                             sozinha quando o "Líquido" bate com pelo menos
--                             duas das outras formas do recibo (importância,
--                             extenso, totais). Fica gravado de onde veio
--                             (valor_origem 'leitura'/'digitado') e o que foi
--                             lido (valor_leitura).
--   3. ferias_enviar_malote   cria a despesa no Malote — mesmo molde do
--                             RH › Rateio (rh_rateio_enviar_malote, mig
--                             20261016000020): mesmo PainelDespesaMalote, a
--                             despesa nasce pendente de aprovação nível 1 e os
--                             gatilhos do Malote rodam todos. O valor tem de
--                             ser o confirmado. Grava data_malote (hoje).
--   Os campos do fluxo (recibo, valor, malote, data_malote) só mudam por essas
--   RPCs: o gatilho recusa UPDATE direto — senão a "data do malote" voltava a
--   ser digitável e o valor podia mudar depois de confirmado.
--   Se o Malote excluir, reprovar ou cancelar a despesa, dá para reenviar.
--
-- PERMISSÃO
--   Anexar/confirmar: Gestão de Férias › alterar (o RH — o mesmo de
--   20261104002300). Enviar ao Malote: ação nova 'enviar_malote' no menu
--   rh_ferias, FORA do toggle (como no Rateio: ligar a tela não dá o poder de
--   lançar despesa). Para o botão já nascer com quem faz isso hoje, a ação é
--   concedida a quem tem rh_ferias › alterar em 04/11/2026 (9 pessoas); daqui
--   em diante, só por Administração › Acesso por Usuário.
--   malote_fornecedores_para_rateio ganha rh_ferias › enviar_malote (o
--   Fornecedor é obrigatório no rateio do painel). ⚠ A função no banco1 estava
--   SEM a linha do RH › Rateio que a mig 20261016000020 tinha posto (ela
--   consta como aplicada; algo depois reescreveu a função na versão de
--   30/09). Aqui ela volta com as duas.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Colunas ───────────────────────────────────────────────────────────
ALTER TABLE public."SISTEMA_SOLICITACOES_FERIAS"
  ADD COLUMN IF NOT EXISTS status_senior          text NOT NULL DEFAULT 'Pendente',
  ADD COLUMN IF NOT EXISTS status_senior_por      text,
  ADD COLUMN IF NOT EXISTS status_senior_em       timestamptz,
  ADD COLUMN IF NOT EXISTS documentacao_enviada_em text,
  ADD COLUMN IF NOT EXISTS recibo_path            text,
  ADD COLUMN IF NOT EXISTS recibo_nome            text,
  ADD COLUMN IF NOT EXISTS recibo_anexado_por     text,
  ADD COLUMN IF NOT EXISTS recibo_anexado_em      timestamptz,
  ADD COLUMN IF NOT EXISTS valor_liquido          numeric(12,2),
  ADD COLUMN IF NOT EXISTS valor_origem           text,
  ADD COLUMN IF NOT EXISTS valor_leitura          jsonb,
  ADD COLUMN IF NOT EXISTS valor_confirmado_por   text,
  ADD COLUMN IF NOT EXISTS valor_confirmado_em    timestamptz,
  ADD COLUMN IF NOT EXISTS malote_despesa_id      uuid REFERENCES public.malote_despesa(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS malote_enviado_por     text,
  ADD COLUMN IF NOT EXISTS malote_enviado_em      timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sol_ferias_status_senior_chk') THEN
    ALTER TABLE public."SISTEMA_SOLICITACOES_FERIAS"
      ADD CONSTRAINT sol_ferias_status_senior_chk CHECK (status_senior IN ('Pendente', 'Gerado'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sol_ferias_valor_origem_chk') THEN
    ALTER TABLE public."SISTEMA_SOLICITACOES_FERIAS"
      ADD CONSTRAINT sol_ferias_valor_origem_chk CHECK (valor_origem IS NULL OR valor_origem IN ('leitura', 'digitado'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sol_ferias_malote_despesa ON public."SISTEMA_SOLICITACOES_FERIAS"(malote_despesa_id);

COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_FERIAS".status_senior IS
  'Pendente/Gerado: as férias já foram geradas na Senior (coluna STATUS das planilhas). Gerado sozinho ao anexar o recibo.';
COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_FERIAS".documentacao_enviada_em IS
  'Como/quando a documentação foi enviada ao colaborador (coluna ENVIADO EM das planilhas: "ENVIADO ZAPSIGN - 04/11/2026"). Texto livre.';
COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_FERIAS".valor_liquido IS
  'Líquido do recibo de férias, confirmado pelo RH (ferias_valor_confirmar). É o valor da despesa no Malote.';
COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_FERIAS".malote_despesa_id IS
  'Despesa criada no Malote pela Gestão de Férias (ferias_enviar_malote).';

-- ── 2) Ação enviar_malote + quem já faz isso ─────────────────────────────
INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('rh_ferias', 'enviar_malote'::public.app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id, motivo)
SELECT s.user_id, 'rh_ferias', 'enviar_malote'::public.app_acao, true, NULL,
       'Mig 20261104007000: quem tinha Gestão de Férias › alterar em 04/11/2026 (RH) — envio das férias ao Malote'
  FROM public.screen_permission_user s
 WHERE s.menu_codigo = 'rh_ferias' AND s.acao = 'alterar'::public.app_acao AND s.allow AND s.empresa_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id AND x.menu_codigo = 'rh_ferias'
                      AND x.acao = 'enviar_malote'::public.app_acao AND x.empresa_id IS NULL);

-- ── 3) Storage do recibo ─────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('ferias-recibos', 'ferias-recibos', false, 20971520) -- 20 MB
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "ferias recibo select" ON storage.objects;
CREATE POLICY "ferias recibo select" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'ferias-recibos' AND (select public.has_screen_access(auth.uid(), 'rh_ferias', 'visualizar'::public.app_acao)));
DROP POLICY IF EXISTS "ferias recibo insert" ON storage.objects;
CREATE POLICY "ferias recibo insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'ferias-recibos' AND (select public.has_screen_access(auth.uid(), 'rh_ferias', 'alterar'::public.app_acao)));
DROP POLICY IF EXISTS "ferias recibo delete" ON storage.objects;
CREATE POLICY "ferias recibo delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'ferias-recibos' AND (select public.has_screen_access(auth.uid(), 'rh_ferias', 'alterar'::public.app_acao)));

-- ── 4) Gatilho: quem muda o quê ──────────────────────────────────────────
-- Substitui o de 20261104002300 (mesmo nome), agora com as colunas novas:
--   · sem usuário (carga/manutenção direto no banco): passa;
--   · campos do fluxo do Malote (recibo, valor, malote, data_malote): só
--     pelas RPCs deste arquivo, que ligam app.ferias_fluxo_malote;
--   · status Senior e documentação: o RH (rh_ferias › alterar) muda direto;
--     status_senior ganha carimbo de quem/quando;
--   · quem não é RH: no INSERT os campos nascem vazios; no UPDATE, recusa.
CREATE OR REPLACE FUNCTION public.ferias_documentacao_so_rh()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_rpc  boolean := coalesce(current_setting('app.ferias_fluxo_malote', true), '') = '1';
  v_rh   boolean;
  v_nome text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  v_rh := public.has_screen_access(auth.uid(), 'rh_ferias', 'alterar'::app_acao);

  IF TG_OP = 'INSERT' THEN
    IF NOT v_rpc THEN
      NEW.data_malote := NULL;
      NEW.recibo_path := NULL; NEW.recibo_nome := NULL; NEW.recibo_anexado_por := NULL; NEW.recibo_anexado_em := NULL;
      NEW.valor_liquido := NULL; NEW.valor_origem := NULL; NEW.valor_leitura := NULL;
      NEW.valor_confirmado_por := NULL; NEW.valor_confirmado_em := NULL;
      NEW.malote_despesa_id := NULL; NEW.malote_enviado_por := NULL; NEW.malote_enviado_em := NULL;
    END IF;
    IF NOT v_rh THEN
      NEW.retorno_documentacao := NULL;
      NEW.documentacao_enviada_em := NULL;
      NEW.status_senior := 'Pendente'; NEW.status_senior_por := NULL; NEW.status_senior_em := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF NOT v_rpc AND (
       NEW.data_malote IS DISTINCT FROM OLD.data_malote
    OR NEW.recibo_path IS DISTINCT FROM OLD.recibo_path
    OR NEW.recibo_nome IS DISTINCT FROM OLD.recibo_nome
    OR NEW.recibo_anexado_por IS DISTINCT FROM OLD.recibo_anexado_por
    OR NEW.recibo_anexado_em IS DISTINCT FROM OLD.recibo_anexado_em
    OR NEW.valor_liquido IS DISTINCT FROM OLD.valor_liquido
    OR NEW.valor_origem IS DISTINCT FROM OLD.valor_origem
    OR NEW.valor_leitura IS DISTINCT FROM OLD.valor_leitura
    OR NEW.valor_confirmado_por IS DISTINCT FROM OLD.valor_confirmado_por
    OR NEW.valor_confirmado_em IS DISTINCT FROM OLD.valor_confirmado_em
    OR NEW.malote_despesa_id IS DISTINCT FROM OLD.malote_despesa_id
    OR NEW.malote_enviado_por IS DISTINCT FROM OLD.malote_enviado_por
    OR NEW.malote_enviado_em IS DISTINCT FROM OLD.malote_enviado_em) THEN
    RAISE EXCEPTION 'Recibo, valor e envio ao Malote só mudam pelo botão "Enviar ao Malote" da Gestão de Férias.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT v_rh AND (
       NEW.retorno_documentacao IS DISTINCT FROM OLD.retorno_documentacao
    OR NEW.documentacao_enviada_em IS DISTINCT FROM OLD.documentacao_enviada_em
    OR NEW.status_senior IS DISTINCT FROM OLD.status_senior
    OR NEW.status_senior_por IS DISTINCT FROM OLD.status_senior_por
    OR NEW.status_senior_em IS DISTINCT FROM OLD.status_senior_em) THEN
    RAISE EXCEPTION 'Só o RH (Gestão de Férias › alterar) define o status Senior e a documentação.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status_senior IS DISTINCT FROM OLD.status_senior THEN
    SELECT coalesce(NULLIF(btrim(p.display_name), ''), p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
    NEW.status_senior_por := v_nome;
    NEW.status_senior_em := now();
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.ferias_documentacao_so_rh() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ferias_documentacao_so_rh ON public."SISTEMA_SOLICITACOES_FERIAS";
CREATE TRIGGER trg_ferias_documentacao_so_rh
  BEFORE INSERT OR UPDATE OF data_malote, retorno_documentacao, documentacao_enviada_em,
    status_senior, status_senior_por, status_senior_em,
    recibo_path, recibo_nome, recibo_anexado_por, recibo_anexado_em,
    valor_liquido, valor_origem, valor_leitura, valor_confirmado_por, valor_confirmado_em,
    malote_despesa_id, malote_enviado_por, malote_enviado_em
  ON public."SISTEMA_SOLICITACOES_FERIAS"
  FOR EACH ROW EXECUTE FUNCTION public.ferias_documentacao_so_rh();

-- ── 5) Auxiliares ────────────────────────────────────────────────────────
-- A despesa do Malote ainda "segura" as férias? (mesma regra do Rateio)
CREATE OR REPLACE FUNCTION public.ferias_malote_ativo(p_malote_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_malote_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.malote_despesa m
     WHERE m.id = p_malote_id AND m.deleted_at IS NULL
       AND m.status NOT IN ('despesa_reprovada', 'solicitacao_reprovada', 'cancelada'))
$$;
REVOKE ALL ON FUNCTION public.ferias_malote_ativo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ferias_malote_ativo(uuid) TO authenticated;

-- 1234.5 → '1.234,50' (o to_char do cluster sai em formato americano).
CREATE OR REPLACE FUNCTION public.ferias_fmt_reais(p numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT translate(to_char(round(p, 2), 'FM999,999,990.00'), ',.', '.,')
$$;

CREATE OR REPLACE FUNCTION public.ferias_nome_usuario()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(NULLIF(btrim(p.display_name), ''), p.email) FROM public.profiles p WHERE p.id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.ferias_nome_usuario() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ferias_nome_usuario() TO authenticated;

-- Número e status da despesa, para a tela do RH (quem só tem o RH não lê
-- malote_despesa pela RLS).
CREATE OR REPLACE FUNCTION public.ferias_malote_info(p_ids bigint[])
RETURNS TABLE(solicitacao_id bigint, malote_despesa_id uuid, numero text, status text, ativo boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'rh_ferias', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Sem acesso à Gestão de Férias' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT f.id, m.id, m.numero, CASE WHEN m.deleted_at IS NOT NULL THEN 'excluida' ELSE m.status END,
         public.ferias_malote_ativo(m.id)
    FROM public."SISTEMA_SOLICITACOES_FERIAS" f
    JOIN public.malote_despesa m ON m.id = f.malote_despesa_id
   WHERE f.id = ANY (p_ids[1:2000]);
END $$;
REVOKE ALL ON FUNCTION public.ferias_malote_info(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ferias_malote_info(bigint[]) TO authenticated;

-- O que a tela precisa para conferir o recibo e montar a despesa: CPF e
-- matrícula do cadastro, a empresa empregadora (código da Senior → empresas:
-- 1 HAGG, 2 SN, 3 CANAA, 4 LF, 5 NH) e o contrato pela filial — mesmo
-- casamento do Suprimentos (sup_ext_colaboradores, mig 20260830000001), só
-- que tirando o código da frente ("1050 - UFRGS - ..." → "UFRGS - ...").
CREATE OR REPLACE FUNCTION public.ferias_contexto_malote(p_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  f  public."SISTEMA_SOLICITACOES_FERIAS"%ROWTYPE;
  e  record;
  v_contrato uuid;
  v_empresa  uuid;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'rh_ferias', 'alterar'::app_acao) THEN
    RAISE EXCEPTION 'Sem permissão (Gestão de Férias › alterar)' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO f FROM public."SISTEMA_SOLICITACOES_FERIAS" WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;

  SELECT emp."Cadastro"::text AS cadastro, emp."CPF"::text AS cpf, emp."Nome" AS nome,
         emp."Empresa"::text AS empresa, emp."Nome Filial" AS filial
    INTO e FROM public."EMPREGADOS" emp WHERE emp."ID" = f.colaborador_id;

  IF e.filial IS NOT NULL THEN
    v_contrato := coalesce(
      (SELECT dp.contrato_id FROM public.sup_empregado_contrato_depara dp WHERE dp.filial_nome = e.filial LIMIT 1),
      (SELECT c.id FROM public.contratos c
        WHERE public.sup_norm_nome(c.nome) = public.sup_norm_nome(regexp_replace(e.filial, '^\s*\d+\s*-\s*', ''))
        ORDER BY (c.status = 'ativo') DESC LIMIT 1),
      (SELECT c.id FROM public.contratos c WHERE public.sup_norm_nome(c.nome) = public.sup_norm_nome(e.filial) LIMIT 1));
  END IF;
  SELECT em.id INTO v_empresa FROM public.empresas em
   WHERE em.codigo = CASE e.empresa WHEN '1' THEN 'HAGG' WHEN '2' THEN 'SN' WHEN '3' THEN 'CANAA' WHEN '4' THEN 'LF' WHEN '5' THEN 'NH' END;

  RETURN jsonb_build_object(
    'matricula', e.cadastro, 'cpf', coalesce(e.cpf, f.colaborador_cpf), 'nome', coalesce(e.nome, f.colaborador_nome),
    'empresa_senior', e.empresa, 'empresa_id', v_empresa,
    'filial', coalesce(e.filial, f.colaborador_filial),
    'contrato_id', v_contrato,
    'contrato_nome', (SELECT c.nome FROM public.contratos c WHERE c.id = v_contrato),
    'contrato_empresa_id', (SELECT c.empresa_id FROM public.contratos c WHERE c.id = v_contrato));
END $$;
REVOKE ALL ON FUNCTION public.ferias_contexto_malote(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ferias_contexto_malote(bigint) TO authenticated;

-- ── 6) Passo 1: anexar o recibo ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ferias_recibo_anexar(p_id bigint, p_path text, p_nome text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  f public."SISTEMA_SOLICITACOES_FERIAS"%ROWTYPE;
  v_nome text := public.ferias_nome_usuario();
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'rh_ferias', 'alterar'::app_acao) THEN
    RAISE EXCEPTION 'Sem permissão (Gestão de Férias › alterar)' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO f FROM public."SISTEMA_SOLICITACOES_FERIAS" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF f.status <> 'Aprovada' THEN RAISE EXCEPTION 'Só férias aprovadas recebem o recibo da Senior.'; END IF;
  IF public.ferias_malote_ativo(f.malote_despesa_id) THEN
    RAISE EXCEPTION 'Estas férias já estão no Malote — para trocar o recibo, a despesa precisa ser excluída ou reprovada lá.';
  END IF;
  IF coalesce(p_path, '') NOT LIKE p_id::text || '/%' THEN RAISE EXCEPTION 'Arquivo fora da pasta da solicitação.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'ferias-recibos' AND o.name = p_path) THEN
    RAISE EXCEPTION 'O arquivo não chegou ao servidor — anexe de novo.';
  END IF;

  PERFORM set_config('app.ferias_fluxo_malote', '1', true);
  UPDATE public."SISTEMA_SOLICITACOES_FERIAS" SET
    recibo_path = p_path, recibo_nome = NULLIF(btrim(p_nome), ''),
    recibo_anexado_por = v_nome, recibo_anexado_em = now(),
    -- o valor é do arquivo: arquivo novo, valor a confirmar de novo
    valor_liquido = NULL, valor_origem = NULL, valor_leitura = NULL,
    valor_confirmado_por = NULL, valor_confirmado_em = NULL,
    status_senior = 'Gerado',
    atualizado_em = now()
   WHERE id = p_id;
  PERFORM set_config('app.ferias_fluxo_malote', '', true);

  INSERT INTO public."SISTEMA_SOLICITACOES_FERIAS_HISTORICO" (solicitacao_id, evento, de_status, para_status, por_nome, por_user_id, motivo)
  VALUES (p_id, CASE WHEN f.recibo_path IS NULL THEN 'Recibo da Senior anexado' ELSE 'Recibo da Senior trocado' END,
          f.status, f.status, v_nome, auth.uid(), NULLIF(btrim(p_nome), ''));
END $$;
REVOKE ALL ON FUNCTION public.ferias_recibo_anexar(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ferias_recibo_anexar(bigint, text, text) TO authenticated;

-- ── 7) Passo 2: confirmar o valor ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ferias_valor_confirmar(p_id bigint, p_valor numeric, p_origem text, p_leitura jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  f public."SISTEMA_SOLICITACOES_FERIAS"%ROWTYPE;
  v_nome  text := public.ferias_nome_usuario();
  v_valor numeric := round(p_valor, 2);
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'rh_ferias', 'alterar'::app_acao) THEN
    RAISE EXCEPTION 'Sem permissão (Gestão de Férias › alterar)' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO f FROM public."SISTEMA_SOLICITACOES_FERIAS" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF f.recibo_path IS NULL THEN RAISE EXCEPTION 'Anexe o recibo da Senior antes de confirmar o valor.'; END IF;
  IF public.ferias_malote_ativo(f.malote_despesa_id) THEN RAISE EXCEPTION 'Estas férias já estão no Malote.'; END IF;
  IF v_valor IS NULL OR v_valor <= 0 OR v_valor >= 1000000 THEN RAISE EXCEPTION 'Valor inválido.'; END IF;
  IF p_origem NOT IN ('leitura', 'digitado') THEN RAISE EXCEPTION 'Origem do valor inválida.'; END IF;

  PERFORM set_config('app.ferias_fluxo_malote', '1', true);
  UPDATE public."SISTEMA_SOLICITACOES_FERIAS" SET
    valor_liquido = v_valor, valor_origem = p_origem,
    valor_leitura = CASE WHEN jsonb_typeof(p_leitura) = 'object' THEN p_leitura END,
    valor_confirmado_por = v_nome, valor_confirmado_em = now(), atualizado_em = now()
   WHERE id = p_id;
  PERFORM set_config('app.ferias_fluxo_malote', '', true);

  INSERT INTO public."SISTEMA_SOLICITACOES_FERIAS_HISTORICO" (solicitacao_id, evento, de_status, para_status, por_nome, por_user_id, motivo)
  VALUES (p_id, 'Valor confirmado', f.status, f.status, v_nome, auth.uid(),
          'R$ ' || public.ferias_fmt_reais(v_valor) || CASE p_origem WHEN 'leitura' THEN ' (lido do recibo)' ELSE ' (digitado)' END);
END $$;
REVOKE ALL ON FUNCTION public.ferias_valor_confirmar(bigint, numeric, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ferias_valor_confirmar(bigint, numeric, text, jsonb) TO authenticated;

-- ── 8) Passo 3: enviar ao Malote ─────────────────────────────────────────
-- p_despesa = o payload do PainelDespesaMalote (o mesmo do Rateio): {
--   empresa_id, classificacao_id, nome, valor_total, data_pagamento,
--   competencia, forma_pagamento, informacoes_pagamento,
--   excecao_solicitacao_id, justificativa_excecao, parcelado,
--   numero_parcelas, dia_desconto, rateio: [...], parcelas: [...],
--   arquivos: ["<p_despesa_id>/..."] }
CREATE OR REPLACE FUNCTION public.ferias_enviar_malote(p_id bigint, p_despesa_id uuid, p_despesa jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  f            public."SISTEMA_SOLICITACOES_FERIAS"%ROWTYPE;
  v_class      public.planejamento_orcamentario_classificacao%ROWTYPE;
  v_valor      numeric;
  v_soma       numeric;
  v_parcelado  boolean := COALESCE((p_despesa->>'parcelado')::boolean, false);
  v_nparc      integer := NULLIF(p_despesa->>'numero_parcelas', '')::integer;
  v_arquivos   text[];
  v_nome       text := public.ferias_nome_usuario();
  v_numero     text;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'rh_ferias', 'enviar_malote'::app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para enviar férias ao Malote (Gestão de Férias › Enviar ao Malote).' USING ERRCODE = '42501';
  END IF;
  IF p_despesa_id IS NULL THEN RAISE EXCEPTION 'Id da despesa não informado.'; END IF;

  SELECT * INTO f FROM public."SISTEMA_SOLICITACOES_FERIAS" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF f.status <> 'Aprovada' THEN RAISE EXCEPTION 'Só férias aprovadas vão para o Malote.'; END IF;
  IF public.ferias_malote_ativo(f.malote_despesa_id) THEN RAISE EXCEPTION 'Estas férias já estão no Malote.'; END IF;
  IF f.recibo_path IS NULL THEN RAISE EXCEPTION 'Anexe o recibo da Senior antes.'; END IF;
  IF f.valor_liquido IS NULL OR f.valor_confirmado_em IS NULL THEN RAISE EXCEPTION 'Confirme o valor do recibo antes.'; END IF;

  SELECT * INTO v_class FROM public.planejamento_orcamentario_classificacao
   WHERE id = NULLIF(p_despesa->>'classificacao_id', '')::uuid AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escolha uma classificação ativa do Malote.'; END IF;
  IF NULLIF(p_despesa->>'empresa_id', '') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.empresas e WHERE e.id = (p_despesa->>'empresa_id')::uuid) THEN
    RAISE EXCEPTION 'Escolha a empresa pagadora.';
  END IF;
  IF btrim(coalesce(p_despesa->>'nome', '')) = '' THEN RAISE EXCEPTION 'Informe o nome da despesa.'; END IF;

  v_valor := round(NULLIF(p_despesa->>'valor_total', '')::numeric, 2);
  IF v_valor IS NULL OR v_valor <> round(f.valor_liquido, 2) THEN
    RAISE EXCEPTION 'O valor da despesa deve ser o valor confirmado do recibo (R$ %).', public.ferias_fmt_reais(f.valor_liquido);
  END IF;
  IF NULLIF(p_despesa->>'data_pagamento', '') IS NULL OR NULLIF(p_despesa->>'competencia', '') IS NULL
     OR btrim(coalesce(p_despesa->>'forma_pagamento', '')) = '' THEN
    RAISE EXCEPTION 'Data de pagamento, competência e forma de pagamento são obrigatórias.';
  END IF;
  IF jsonb_typeof(p_despesa->'rateio') IS DISTINCT FROM 'array' OR jsonb_array_length(p_despesa->'rateio') = 0 THEN
    RAISE EXCEPTION 'Adicione ao menos uma linha de rateio.';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_despesa->'rateio') l WHERE NULLIF(l->>'empresa_id', '') IS NULL) THEN
    RAISE EXCEPTION 'Toda linha do rateio precisa da empresa.';
  END IF;
  SELECT round(COALESCE(sum((l->>'valor')::numeric), 0), 2) INTO v_soma FROM jsonb_array_elements(p_despesa->'rateio') l;
  IF abs(v_soma - v_valor) > 0.01 THEN
    RAISE EXCEPTION 'O total do rateio (R$ %) deve ser igual ao valor da despesa (R$ %).', v_soma, v_valor;
  END IF;
  IF v_parcelado AND (v_nparc IS NULL OR v_nparc < 2 OR v_nparc > 420
                      OR jsonb_array_length(COALESCE(p_despesa->'parcelas', '[]'::jsonb)) <> v_nparc) THEN
    RAISE EXCEPTION 'Parcelas inválidas (entre 2 e 420, e a lista tem de bater com a quantidade).';
  END IF;

  SELECT COALESCE(array_agg(a), '{}') INTO v_arquivos
    FROM jsonb_array_elements_text(COALESCE(p_despesa->'arquivos', '[]'::jsonb)) a;
  IF EXISTS (SELECT 1 FROM unnest(v_arquivos) a WHERE a NOT LIKE p_despesa_id::text || '/%') THEN
    RAISE EXCEPTION 'Anexo fora da pasta da despesa.';
  END IF;
  IF cardinality(v_arquivos) = 0 THEN RAISE EXCEPTION 'O recibo da Senior tem de ir anexado na despesa.'; END IF;

  INSERT INTO public.malote_despesa (
    id, empresa_id, classificacao_id, origem, status, nivel_aprovacao_atual,
    nome, valor_total, motivo, descricao, tipo_movimento, tipo, contrato_id,
    data_pagamento, competencia, forma_pagamento, informacoes_pagamento,
    excecao_solicitacao_id, justificativa_excecao, parcelado, numero_parcelas, dia_desconto,
    arquivos, solicitacao_dispensada_manualmente, created_by
  ) VALUES (
    p_despesa_id, (p_despesa->>'empresa_id')::uuid, v_class.id, 'despesa_unica', 'pendente_aprovacao', 1,
    btrim(p_despesa->>'nome'), v_valor,
    'Férias ' || coalesce(f.colaborador_nome, ''),
    'Gerado pelo RH › Gestão de Férias (solicitação #' || f.id ||
      CASE WHEN f.data_saida IS NOT NULL THEN ', saída ' || to_char(f.data_saida, 'DD/MM/YYYY') ELSE '' END ||
      ', recibo da Senior anexo, valor confirmado por ' || coalesce(f.valor_confirmado_por, '—') || ').',
    'saida', CASE WHEN v_class.tipo IN ('administrativo', 'contrato') THEN v_class.tipo ELSE 'contrato' END, NULL,
    (p_despesa->>'data_pagamento')::date, (p_despesa->>'competencia')::date,
    btrim(p_despesa->>'forma_pagamento'),
    NULLIF(btrim(coalesce(p_despesa->>'informacoes_pagamento', '')), ''),
    NULLIF(p_despesa->>'excecao_solicitacao_id', '')::uuid,
    NULLIF(btrim(coalesce(p_despesa->>'justificativa_excecao', '')), ''),
    v_parcelado, CASE WHEN v_parcelado THEN v_nparc END,
    CASE WHEN v_parcelado THEN NULLIF(p_despesa->>'dia_desconto', '')::integer END,
    v_arquivos,
    COALESCE(v_class.requer_solicitacao, false),
    auth.uid()
  );

  INSERT INTO public.malote_despesa_rateio_linha (
    despesa_id, classificacao_id, empresa_id, contrato_id, fornecedor_id,
    integrante_empregado_id, percentual, valor, ordem, justificativa_texto
  )
  SELECT p_despesa_id,
         NULLIF(l->>'classificacao_id', '')::uuid,
         NULLIF(l->>'empresa_id', '')::uuid,
         NULLIF(l->>'contrato_id', '')::uuid,
         NULLIF(l->>'fornecedor_id', '')::uuid,
         NULLIF(l->>'integrante_empregado_id', '')::bigint,
         NULLIF(l->>'percentual', '')::numeric,
         (l->>'valor')::numeric,
         (o - 1)::integer,
         NULLIF(btrim(coalesce(l->>'justificativa_texto', '')), '')
    FROM jsonb_array_elements(p_despesa->'rateio') WITH ORDINALITY AS t(l, o);

  IF v_parcelado THEN
    INSERT INTO public.malote_despesa_parcela (despesa_id, numero_parcela, valor, data_vencimento)
    SELECT p_despesa_id, (x->>'numero_parcela')::integer, (x->>'valor')::numeric, (x->>'data_vencimento')::date
      FROM jsonb_array_elements(p_despesa->'parcelas') x;
  END IF;

  PERFORM set_config('app.ferias_fluxo_malote', '1', true);
  UPDATE public."SISTEMA_SOLICITACOES_FERIAS" SET
    malote_despesa_id = p_despesa_id, malote_enviado_por = v_nome, malote_enviado_em = now(),
    data_malote = (now() AT TIME ZONE 'America/Sao_Paulo')::date,
    status_senior = 'Gerado', atualizado_em = now()
   WHERE id = p_id;
  PERFORM set_config('app.ferias_fluxo_malote', '', true);

  SELECT m.numero INTO v_numero FROM public.malote_despesa m WHERE m.id = p_despesa_id;
  INSERT INTO public."SISTEMA_SOLICITACOES_FERIAS_HISTORICO" (solicitacao_id, evento, de_status, para_status, por_nome, por_user_id, motivo)
  VALUES (p_id, 'Enviada ao Malote', f.status, f.status, v_nome, auth.uid(),
          coalesce(v_numero || ' · ', '') || 'R$ ' || public.ferias_fmt_reais(v_valor));

  RETURN p_despesa_id;
END $$;
REVOKE ALL ON FUNCTION public.ferias_enviar_malote(bigint, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ferias_enviar_malote(bigint, uuid, jsonb) TO authenticated;

-- ── 9) Fornecedores do rateio para quem envia pela Gestão de Férias ──────
-- Versão da mig 20261016000020 (com o RH › Rateio, que tinha sumido do banco)
-- + rh_ferias › enviar_malote.
CREATE OR REPLACE FUNCTION public.malote_fornecedores_para_rateio()
 RETURNS TABLE(id uuid, razao_social text, nome_fantasia text, cnpj_cpf text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT f.id, f.razao_social, f.nome_fantasia, f.cnpj_cpf
    FROM public.fornecedor f
   WHERE EXISTS (
           -- Qualquer tela que renderiza o RateioGrid. Lista explícita e não
           -- um LIKE 'malote_%' de propósito: menu novo do Malote não deve
           -- ganhar acesso à lista de fornecedores sem alguém decidir isso.
           SELECT 1
             FROM unnest(ARRAY[
               'fornecedores',                 -- quem já vê o cadastro
               'malote_criar_despesa',
               'malote_ratear_classificacao',
               'malote_despesa_visualizar',
               'malote_solicitacao_visualizar',
               'malote_aprovacoes',
               'malote_meus_itens',
               'malote_pagamento',
               'diretoria_malote_aprovacoes',
               'diretoria_malote_despesa',
               'diretoria_malote_solicitacao',
               'operacional_diarias',          -- SIS-2026-0480
               'financeiro_diarias',
               'encarregados_diarias'
             ]) AS m(codigo)
            WHERE public.can_access(auth.uid(), m.codigo, 'visualizar'::public.app_acao)
         )
      -- SIS-2026-0673 (16/10/2026): o RH envia rateio ao Malote pelo mesmo
      -- painel. Só quem tem a AÇÃO de enviar, não quem só confere.
      OR public.can_access(auth.uid(), 'rh_rateio_despesas', 'enviar_malote'::public.app_acao)
      -- 04/11/2026: Gestão de Férias › Enviar ao Malote, mesmo painel.
      OR public.can_access(auth.uid(), 'rh_ferias', 'enviar_malote'::public.app_acao)
   ORDER BY f.razao_social;
$function$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Reaplicar 20261104002300 (gatilho só com data_malote/retorno_documentacao) e:
-- DROP FUNCTION IF EXISTS public.ferias_enviar_malote(bigint, uuid, jsonb),
--   public.ferias_valor_confirmar(bigint, numeric, text, jsonb), public.ferias_recibo_anexar(bigint, text, text),
--   public.ferias_contexto_malote(bigint), public.ferias_malote_info(bigint[]),
--   public.ferias_nome_usuario(), public.ferias_fmt_reais(numeric), public.ferias_malote_ativo(uuid);
-- DROP POLICY IF EXISTS "ferias recibo select" ON storage.objects;
-- DROP POLICY IF EXISTS "ferias recibo insert" ON storage.objects;
-- DROP POLICY IF EXISTS "ferias recibo delete" ON storage.objects;
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'rh_ferias' AND acao = 'enviar_malote';
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'rh_ferias' AND acao = 'enviar_malote';
-- ALTER TABLE public."SISTEMA_SOLICITACOES_FERIAS" DROP CONSTRAINT IF EXISTS sol_ferias_status_senior_chk,
--   DROP CONSTRAINT IF EXISTS sol_ferias_valor_origem_chk,
--   DROP COLUMN IF EXISTS status_senior, DROP COLUMN IF EXISTS status_senior_por, DROP COLUMN IF EXISTS status_senior_em,
--   DROP COLUMN IF EXISTS documentacao_enviada_em, DROP COLUMN IF EXISTS recibo_path, DROP COLUMN IF EXISTS recibo_nome,
--   DROP COLUMN IF EXISTS recibo_anexado_por, DROP COLUMN IF EXISTS recibo_anexado_em, DROP COLUMN IF EXISTS valor_liquido,
--   DROP COLUMN IF EXISTS valor_origem, DROP COLUMN IF EXISTS valor_leitura, DROP COLUMN IF EXISTS valor_confirmado_por,
--   DROP COLUMN IF EXISTS valor_confirmado_em, DROP COLUMN IF EXISTS malote_despesa_id, DROP COLUMN IF EXISTS malote_enviado_por,
--   DROP COLUMN IF EXISTS malote_enviado_em;
-- NOTIFY pgrst, 'reload schema';
