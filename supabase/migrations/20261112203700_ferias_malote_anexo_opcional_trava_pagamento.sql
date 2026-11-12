-- =========================================================================
-- RH › GESTÃO DE FÉRIAS — anexo OPCIONAL ao enviar ao Malote; o PAGAMENTO
-- é que exige o documento (12/11/2026)
--
-- PEDIDO
--   "O sistema de Férias pede anexo na hora de programar o envio para o
--   malote, e isso está errado. O anexo tem que ser OPCIONAL quando se
--   programa o envio. Já o pagamento não pode ser feito sem documento
--   anexado." As férias vão para o Malote normalmente (despesa de verdade,
--   fila de aprovação de sempre), ficam marcadas PENDENTE DE ANEXO DE
--   DOCUMENTO até alguém anexar o recibo, e enquanto isso o pagamento fica
--   bloqueado.
--
-- O QUE HAVIA
--   · ferias_enviar_malote (mig 20261104007000) recusava sem recibo_path,
--     sem valor confirmado (o valor sai do recibo) e sem arquivo na despesa;
--   · o "Programar no malote" do #0865 (mig 20261111235800) só marcava
--     malote_programado_em — NÃO criava a despesa: as férias não entravam
--     no Malote de fato.
--
-- DESENHO
--   · ferias_enviar_malote sem recibo: passa. O valor vem do painel
--     (digitado pelo RH, > 0) e fica gravado como valor_origem 'digitado';
--     a despesa nasce sem anexo e com "PENDENTE DE ANEXO DE DOCUMENTO" na
--     descrição (é o que o Financeiro vê no Malote). malote_programado_em/por
--     marcam o envio sem documento. COM recibo, as regras de antes valem
--     todas (valor confirmado, igual ao da despesa, recibo anexo).
--   · "Pendente de anexo" = despesa ativa de férias sem recibo_path
--     (ferias_despesa_pendente_anexo). Nenhuma coluna nova: a marca some
--     sozinha no anexo e não tem como ficar dessincronizada.
--   · TRAVA NO BANCO: gatilhos em malote_despesa (status → despesa_paga) e
--     malote_despesa_parcela (status → paga) recusam o pagamento enquanto
--     houver férias pendentes de anexo naquela despesa. Gatilho e não só a
--     RPC de pagar: pega malote_pagar_despesa, malote_pagar_parcela e
--     qualquer caminho futuro. Sem exceção para carga (auth.uid() NULL): o
--     pedido é "não pode", ponto.
--   · Anexar depois: ferias_malote_anexar_documento — o recibo vai para
--     ferias-recibos (recibo_path, status Senior Gerado) e para a despesa no
--     Malote (malote-anexos/<despesa>/…, em arquivos), a descrição troca a
--     marca por "recibo anexado depois" e a linha do tempo da despesa ganha
--     um evento. O valor NÃO muda (a despesa já está na aprovação com ele).
--   · ferias_enviado_mentore: o check final também exige o recibo.
--   Permissões: enviar = rh_ferias › enviar_malote (como antes); anexar
--   depois = rh_ferias › alterar (o mesmo de anexar o recibo).
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Despesa com férias pendentes de anexo? ────────────────────────────
CREATE OR REPLACE FUNCTION public.ferias_despesa_pendente_anexo(p_despesa_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_despesa_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public."SISTEMA_SOLICITACOES_FERIAS" f
     WHERE f.malote_despesa_id = p_despesa_id AND f.recibo_path IS NULL)
$$;
REVOKE ALL ON FUNCTION public.ferias_despesa_pendente_anexo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ferias_despesa_pendente_anexo(uuid) TO authenticated;

-- ── 2) Trava do pagamento ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ferias_malote_bloqueia_pagamento_sem_anexo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_despesa uuid;
  v_quem    text;
BEGIN
  IF TG_TABLE_NAME = 'malote_despesa' THEN
    IF NEW.status IS DISTINCT FROM 'despesa_paga' OR OLD.status IS NOT DISTINCT FROM 'despesa_paga' THEN RETURN NEW; END IF;
    v_despesa := NEW.id;
  ELSE
    IF NEW.status IS DISTINCT FROM 'paga' OR OLD.status IS NOT DISTINCT FROM 'paga' THEN RETURN NEW; END IF;
    v_despesa := NEW.despesa_id;
  END IF;
  IF NOT public.ferias_despesa_pendente_anexo(v_despesa) THEN RETURN NEW; END IF;

  SELECT string_agg(coalesce(f.colaborador_nome, '#' || f.id), ', ' ORDER BY f.colaborador_nome)
    INTO v_quem
    FROM public."SISTEMA_SOLICITACOES_FERIAS" f
   WHERE f.malote_despesa_id = v_despesa AND f.recibo_path IS NULL;
  RAISE EXCEPTION 'Pagamento bloqueado: férias PENDENTES DE ANEXO DE DOCUMENTO (%). O RH precisa anexar o recibo da Senior em RH › Gestão de Férias antes do pagamento.', v_quem
    USING ERRCODE = 'P0001';
END $fn$;
REVOKE ALL ON FUNCTION public.ferias_malote_bloqueia_pagamento_sem_anexo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ferias_bloqueia_pagamento_sem_anexo ON public.malote_despesa;
CREATE TRIGGER trg_ferias_bloqueia_pagamento_sem_anexo
  BEFORE UPDATE OF status ON public.malote_despesa
  FOR EACH ROW EXECUTE FUNCTION public.ferias_malote_bloqueia_pagamento_sem_anexo();

DROP TRIGGER IF EXISTS trg_ferias_bloqueia_pagamento_parcela_sem_anexo ON public.malote_despesa_parcela;
CREATE TRIGGER trg_ferias_bloqueia_pagamento_parcela_sem_anexo
  BEFORE UPDATE OF status ON public.malote_despesa_parcela
  FOR EACH ROW EXECUTE FUNCTION public.ferias_malote_bloqueia_pagamento_sem_anexo();

-- ── 3) Enviar ao Malote: recibo opcional ─────────────────────────────────
-- Mesma assinatura e mesmo payload de 20261104007000; muda só o que é
-- obrigatório quando não há recibo.
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
  v_sem_doc    boolean;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'rh_ferias', 'enviar_malote'::app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para enviar férias ao Malote (Gestão de Férias › Enviar ao Malote).' USING ERRCODE = '42501';
  END IF;
  IF p_despesa_id IS NULL THEN RAISE EXCEPTION 'Id da despesa não informado.'; END IF;

  SELECT * INTO f FROM public."SISTEMA_SOLICITACOES_FERIAS" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF f.status <> 'Aprovada' THEN RAISE EXCEPTION 'Só férias aprovadas vão para o Malote.'; END IF;
  IF public.ferias_malote_ativo(f.malote_despesa_id) THEN RAISE EXCEPTION 'Estas férias já estão no Malote.'; END IF;
  v_sem_doc := f.recibo_path IS NULL;
  IF NOT v_sem_doc AND (f.valor_liquido IS NULL OR f.valor_confirmado_em IS NULL) THEN
    RAISE EXCEPTION 'Confirme o valor do recibo antes.';
  END IF;

  SELECT * INTO v_class FROM public.planejamento_orcamentario_classificacao
   WHERE id = NULLIF(p_despesa->>'classificacao_id', '')::uuid AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escolha uma classificação ativa do Malote.'; END IF;
  IF NULLIF(p_despesa->>'empresa_id', '') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.empresas e WHERE e.id = (p_despesa->>'empresa_id')::uuid) THEN
    RAISE EXCEPTION 'Escolha a empresa pagadora.';
  END IF;
  IF btrim(coalesce(p_despesa->>'nome', '')) = '' THEN RAISE EXCEPTION 'Informe o nome da despesa.'; END IF;

  v_valor := round(NULLIF(p_despesa->>'valor_total', '')::numeric, 2);
  IF v_sem_doc THEN
    IF v_valor IS NULL OR v_valor <= 0 OR v_valor >= 1000000 THEN RAISE EXCEPTION 'Informe o valor líquido das férias.'; END IF;
  ELSIF v_valor IS NULL OR v_valor <> round(f.valor_liquido, 2) THEN
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
  IF NOT v_sem_doc AND cardinality(v_arquivos) = 0 THEN RAISE EXCEPTION 'O recibo da Senior tem de ir anexado na despesa.'; END IF;

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
    CASE WHEN v_sem_doc THEN
      'PENDENTE DE ANEXO DE DOCUMENTO — o recibo de férias da Senior ainda não foi anexado; o pagamento fica bloqueado até o RH anexar. '
    ELSE '' END ||
    'Gerado pelo RH › Gestão de Férias (solicitação #' || f.id ||
      CASE WHEN f.data_saida IS NOT NULL THEN ', saída ' || to_char(f.data_saida, 'DD/MM/YYYY') ELSE '' END ||
      CASE WHEN v_sem_doc THEN ', valor informado por ' || coalesce(v_nome, '—')
           ELSE ', recibo da Senior anexo, valor confirmado por ' || coalesce(f.valor_confirmado_por, '—') END || ').',
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
    status_senior = CASE WHEN v_sem_doc THEN status_senior ELSE 'Gerado' END,
    -- sem recibo: o valor é o que foi para a despesa, informado pelo RH
    valor_liquido        = CASE WHEN v_sem_doc THEN v_valor     ELSE valor_liquido END,
    valor_origem         = CASE WHEN v_sem_doc THEN 'digitado'  ELSE valor_origem END,
    valor_leitura        = CASE WHEN v_sem_doc THEN NULL        ELSE valor_leitura END,
    valor_confirmado_por = CASE WHEN v_sem_doc THEN v_nome      ELSE valor_confirmado_por END,
    valor_confirmado_em  = CASE WHEN v_sem_doc THEN now()       ELSE valor_confirmado_em END,
    malote_programado_em  = CASE WHEN v_sem_doc THEN coalesce(malote_programado_em, now())  ELSE malote_programado_em END,
    malote_programado_por = CASE WHEN v_sem_doc THEN coalesce(malote_programado_por, v_nome) ELSE malote_programado_por END,
    atualizado_em = now()
   WHERE id = p_id;
  PERFORM set_config('app.ferias_fluxo_malote', '', true);

  SELECT m.numero INTO v_numero FROM public.malote_despesa m WHERE m.id = p_despesa_id;
  INSERT INTO public."SISTEMA_SOLICITACOES_FERIAS_HISTORICO" (solicitacao_id, evento, de_status, para_status, por_nome, por_user_id, motivo)
  VALUES (p_id, CASE WHEN v_sem_doc THEN 'Enviada ao Malote sem documento (pendente de anexo)' ELSE 'Enviada ao Malote' END,
          f.status, f.status, v_nome, auth.uid(),
          coalesce(v_numero || ' · ', '') || 'R$ ' || public.ferias_fmt_reais(v_valor));

  RETURN p_despesa_id;
END $$;
REVOKE ALL ON FUNCTION public.ferias_enviar_malote(bigint, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ferias_enviar_malote(bigint, uuid, jsonb) TO authenticated;

-- ── 4) Anexar o documento depois ─────────────────────────────────────────
-- p_recibo_path: "<id>/..." no bucket ferias-recibos;
-- p_malote_path: "<despesa>/..." no bucket malote-anexos (o mesmo arquivo,
--   para quem aprova/paga no Malote ver o recibo na despesa).
CREATE OR REPLACE FUNCTION public.ferias_malote_anexar_documento(
  p_id bigint, p_recibo_path text, p_recibo_nome text, p_malote_path text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  f      public."SISTEMA_SOLICITACOES_FERIAS"%ROWTYPE;
  v_nome text := public.ferias_nome_usuario();
  v_hoje text := to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY');
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'rh_ferias', 'alterar'::app_acao) THEN
    RAISE EXCEPTION 'Sem permissão (Gestão de Férias › alterar)' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO f FROM public."SISTEMA_SOLICITACOES_FERIAS" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF NOT public.ferias_malote_ativo(f.malote_despesa_id) THEN
    RAISE EXCEPTION 'Estas férias não estão no Malote — anexe o recibo pelo envio normal.';
  END IF;
  IF f.recibo_path IS NOT NULL THEN RAISE EXCEPTION 'Estas férias já têm o recibo anexado.'; END IF;
  IF coalesce(p_recibo_path, '') NOT LIKE p_id::text || '/%' THEN RAISE EXCEPTION 'Arquivo fora da pasta da solicitação.'; END IF;
  IF coalesce(p_malote_path, '') NOT LIKE f.malote_despesa_id::text || '/%' THEN RAISE EXCEPTION 'Anexo fora da pasta da despesa.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'ferias-recibos' AND o.name = p_recibo_path)
     OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'malote-anexos' AND o.name = p_malote_path) THEN
    RAISE EXCEPTION 'O arquivo não chegou ao servidor — anexe de novo.';
  END IF;

  PERFORM set_config('app.ferias_fluxo_malote', '1', true);
  UPDATE public."SISTEMA_SOLICITACOES_FERIAS" SET
    recibo_path = p_recibo_path, recibo_nome = NULLIF(btrim(p_recibo_nome), ''),
    recibo_anexado_por = v_nome, recibo_anexado_em = now(),
    status_senior = 'Gerado', atualizado_em = now()
   WHERE id = p_id;
  PERFORM set_config('app.ferias_fluxo_malote', '', true);

  UPDATE public.malote_despesa SET
    arquivos  = array_append(coalesce(arquivos, '{}'::text[]), p_malote_path),
    descricao = replace(coalesce(descricao, ''),
      'PENDENTE DE ANEXO DE DOCUMENTO — o recibo de férias da Senior ainda não foi anexado; o pagamento fica bloqueado até o RH anexar. ',
      'Recibo de férias da Senior anexado depois por ' || coalesce(v_nome, '—') || ' em ' || v_hoje || '. ')
   WHERE id = f.malote_despesa_id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, ator_user_id, descricao)
  VALUES (f.malote_despesa_id, 'edicao', auth.uid(),
          'RH › Gestão de Férias: recibo da Senior de ' || coalesce(f.colaborador_nome, '#' || f.id) || ' anexado — pagamento liberado.');

  INSERT INTO public."SISTEMA_SOLICITACOES_FERIAS_HISTORICO" (solicitacao_id, evento, de_status, para_status, por_nome, por_user_id, motivo)
  VALUES (p_id, 'Recibo da Senior anexado (pendência do Malote resolvida)', f.status, f.status, v_nome, auth.uid(), NULLIF(btrim(p_recibo_nome), ''));
END $$;
REVOKE ALL ON FUNCTION public.ferias_malote_anexar_documento(bigint, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ferias_malote_anexar_documento(bigint, text, text, text) TO authenticated;

-- ── 5) Check final da Mentore também exige o recibo ──────────────────────
CREATE OR REPLACE FUNCTION public.ferias_enviado_mentore(p_id bigint, p_enviado boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  f public."SISTEMA_SOLICITACOES_FERIAS"%ROWTYPE;
  v_nome text := public.ferias_nome_usuario();
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'rh_ferias', 'enviar_malote'::app_acao) THEN
    RAISE EXCEPTION 'Sem permissão (Gestão de Férias › Enviar ao Malote).' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO f FROM public."SISTEMA_SOLICITACOES_FERIAS" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF p_enviado THEN
    IF f.mentore_enviado_em IS NOT NULL THEN RAISE EXCEPTION 'Estas férias já estão como Enviado pra Mentore.'; END IF;
    IF NOT public.ferias_malote_ativo(f.malote_despesa_id) THEN
      RAISE EXCEPTION 'Só depois de enviadas ao Malote (com o recibo) as férias podem ir pra Mentore.';
    END IF;
    IF f.recibo_path IS NULL THEN
      RAISE EXCEPTION 'Estas férias estão PENDENTES DE ANEXO DE DOCUMENTO — anexe o recibo da Senior antes.';
    END IF;
  ELSIF f.mentore_enviado_em IS NULL THEN
    RAISE EXCEPTION 'Estas férias não estão como Enviado pra Mentore.';
  END IF;

  PERFORM set_config('app.ferias_fluxo_malote', '1', true);
  UPDATE public."SISTEMA_SOLICITACOES_FERIAS" SET
    mentore_enviado_em  = CASE WHEN p_enviado THEN now() END,
    mentore_enviado_por = CASE WHEN p_enviado THEN v_nome END,
    atualizado_em = now()
   WHERE id = p_id;
  PERFORM set_config('app.ferias_fluxo_malote', '', true);

  INSERT INTO public."SISTEMA_SOLICITACOES_FERIAS_HISTORICO" (solicitacao_id, evento, de_status, para_status, por_nome, por_user_id, motivo)
  VALUES (p_id, CASE WHEN p_enviado THEN 'Enviado pra Mentore' ELSE 'Envio pra Mentore desfeito' END,
          f.status, f.status, v_nome, auth.uid(), NULL);
END $$;
REVOKE ALL ON FUNCTION public.ferias_enviado_mentore(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ferias_enviado_mentore(bigint, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_ferias_bloqueia_pagamento_sem_anexo ON public.malote_despesa;
--   DROP TRIGGER IF EXISTS trg_ferias_bloqueia_pagamento_parcela_sem_anexo ON public.malote_despesa_parcela;
--   DROP FUNCTION IF EXISTS public.ferias_malote_bloqueia_pagamento_sem_anexo();
--   DROP FUNCTION IF EXISTS public.ferias_malote_anexar_documento(bigint, text, text, text);
--   DROP FUNCTION IF EXISTS public.ferias_despesa_pendente_anexo(uuid);
--   -- ferias_enviar_malote: reaplicar o bloco 8 de 20261104007000;
--   -- ferias_enviado_mentore: reaplicar o bloco 3 de 20261111235800.
