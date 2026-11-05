-- =========================================================================
-- FÉRIAS — "Malote em massa" na Gestão de Férias (05/11/2026)
--
-- PEDIDO (Pablo, 05/11/2026)
--   "preciso que tenha um botão no gestão de férias de inserir malote em
--   massa, onde seja possível adicionar esse arquivo que é as férias de vários
--   ao mesmo tempo sendo pagas, o sistema tem que ler o nome completo ali,
--   bater com o sistema e vincular esse mesmo documento na solicitação de
--   férias. [...] e o doc vai ser enviado ao malote preenchido já
--   automaticamente com os valores."
--
-- O ARQUIVO é o lote que a Senior gera por filial (ex.: "FERIAS UFRGS
-- MOTORISTAS 034.2022.pdf"): página 1 = Relação Bancária (cadastro, nome, CPF,
-- valor de cada um + Total Geral), depois um Recibo de Férias por pessoa. A
-- leitura e as conferências são do navegador (src/lib/rh/loteFerias.ts, com
-- teste): valor só sai sozinho quando o líquido do recibo bate com pelo menos
-- duas provas independentes (relação bancária, importância, extenso, totais).
--
-- O MESMO FLUXO DO ENVIO INDIVIDUAL (mig 20261104007000), de uma vez:
--   ferias_lote_localizar     as solicitações de férias das pessoas do
--                             arquivo (CPF ou nome completo), com o contexto
--                             de cada uma (contrato, empresa) — a tela casa.
--   ferias_lote_enviar_malote numa transação só: o MESMO arquivo vira o recibo
--                             de cada solicitação (bucket ferias-recibos,
--                             pasta lote/<uuid>/), o valor de cada uma fica
--                             confirmado, e UMA despesa no Malote com o total
--                             e uma linha de rateio por colaborador. Todas as
--                             solicitações apontam para essa despesa; data do
--                             malote = hoje. Se o Malote excluir ou reprovar a
--                             despesa, todas voltam a poder ser enviadas.
--   Nada é gravado antes do último "Enviar ao Malote": a tela pede as
--   confirmações (anexo, valores, envio) e só então chama a RPC — sem lote
--   pela metade se o RH desistir no meio.
--
-- PERMISSÃO: as duas ações do envio individual juntas — Gestão de Férias ›
-- alterar (anexar/confirmar) e › Enviar ao Malote. Nenhuma ação nova.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_FERIAS".recibo_path IS
  'Recibo da Senior no bucket ferias-recibos: <id>/... (envio individual) ou lote/<uuid>/... (Malote em massa — o mesmo arquivo em todas as solicitações do lote).';

-- ── 1) Achar as solicitações das pessoas do arquivo ───────────────────────
-- p_pessoas: [{ "cpf": "359.120.900-78", "nome": "PAULO ..." }, ...]
-- Devolve as solicitações (de até 400 dias para trás) cujo colaborador tem
-- um dos CPFs ou um dos nomes completos — de QUALQUER status, para a tela
-- dizer por que alguém ficou de fora ("já no Malote", "não aprovada").
CREATE OR REPLACE FUNCTION public.ferias_lote_localizar(p_pessoas jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cpfs  text[];
  v_nomes text[];
  v_res   jsonb;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'rh_ferias', 'alterar'::app_acao) THEN
    RAISE EXCEPTION 'Sem permissão (Gestão de Férias › alterar)' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_pessoas) IS DISTINCT FROM 'array' OR jsonb_array_length(p_pessoas) > 200 THEN
    RAISE EXCEPTION 'Lista de pessoas inválida (até 200).';
  END IF;

  SELECT array_agg(DISTINCT regexp_replace(x->>'cpf', '\D', '', 'g'))
           FILTER (WHERE length(regexp_replace(coalesce(x->>'cpf', ''), '\D', '', 'g')) = 11),
         array_agg(DISTINCT public.sup_norm_nome(x->>'nome'))
           FILTER (WHERE btrim(coalesce(x->>'nome', '')) <> '')
    INTO v_cpfs, v_nomes
    FROM jsonb_array_elements(p_pessoas) x;

  SELECT coalesce(jsonb_agg(
           public.ferias_contexto_malote(f.id) || jsonb_build_object(
             'id', f.id, 'colaborador_id', f.colaborador_id, 'data_saida', f.data_saida,
             'dias_ferias', f.dias_ferias, 'status', f.status,
             'no_malote', public.ferias_malote_ativo(f.malote_despesa_id))
           ORDER BY f.data_saida DESC, f.id DESC), '[]'::jsonb)
    INTO v_res
    FROM public."SISTEMA_SOLICITACOES_FERIAS" f
    LEFT JOIN public."EMPREGADOS" e ON e."ID" = f.colaborador_id
   WHERE f.data_saida >= current_date - 400
     AND (regexp_replace(coalesce(e."CPF"::text, f.colaborador_cpf, ''), '\D', '', 'g') = ANY (coalesce(v_cpfs, '{}'))
          OR public.sup_norm_nome(coalesce(e."Nome", f.colaborador_nome)) = ANY (coalesce(v_nomes, '{}'))
          OR public.sup_norm_nome(f.colaborador_nome) = ANY (coalesce(v_nomes, '{}')));
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION public.ferias_lote_localizar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ferias_lote_localizar(jsonb) TO authenticated;

-- ── 2) Anexar + confirmar + enviar, de uma vez ────────────────────────────
-- p_itens:   [{ "id": 1369, "valor": 3346.58, "origem": "leitura"|"digitado", "leitura": {...} }, ...]
-- p_recibo_path: "lote/<uuid>/<arquivo>" já enviado ao bucket ferias-recibos
-- p_despesa: o payload do PainelDespesaMalote (o mesmo do envio individual),
--            valor_total = soma dos itens; arquivos em "<p_despesa_id>/...".
CREATE OR REPLACE FUNCTION public.ferias_lote_enviar_malote(
  p_itens jsonb, p_recibo_path text, p_recibo_nome text, p_despesa_id uuid, p_despesa jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  f            public."SISTEMA_SOLICITACOES_FERIAS"%ROWTYPE;
  it           record;
  v_class      public.planejamento_orcamentario_classificacao%ROWTYPE;
  v_n          integer;
  v_distintos  integer;
  v_total      numeric;
  v_valor      numeric;
  v_soma       numeric;
  v_parcelado  boolean := COALESCE((p_despesa->>'parcelado')::boolean, false);
  v_nparc      integer := NULLIF(p_despesa->>'numero_parcelas', '')::integer;
  v_arquivos   text[];
  v_nome       text := public.ferias_nome_usuario();
  v_numero     text;
  v_ids        text;
  v_arq_nome   text := NULLIF(btrim(p_recibo_nome), '');
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'rh_ferias', 'enviar_malote'::app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para enviar férias ao Malote (Gestão de Férias › Enviar ao Malote).' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_screen_access(auth.uid(), 'rh_ferias', 'alterar'::app_acao) THEN
    RAISE EXCEPTION 'Sem permissão (Gestão de Férias › alterar)' USING ERRCODE = '42501';
  END IF;
  IF p_despesa_id IS NULL THEN RAISE EXCEPTION 'Id da despesa não informado.'; END IF;

  -- O arquivo do lote
  IF coalesce(p_recibo_path, '') NOT LIKE 'lote/%' THEN RAISE EXCEPTION 'Arquivo fora da pasta de lotes.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'ferias-recibos' AND o.name = p_recibo_path) THEN
    RAISE EXCEPTION 'O arquivo do lote não chegou ao servidor — envie de novo.';
  END IF;

  -- Os itens
  IF jsonb_typeof(p_itens) IS DISTINCT FROM 'array' OR jsonb_array_length(p_itens) = 0 OR jsonb_array_length(p_itens) > 200 THEN
    RAISE EXCEPTION 'Nenhuma férias no lote (ou mais de 200).';
  END IF;
  SELECT count(*), count(DISTINCT (x->>'id')::bigint), round(sum(round((x->>'valor')::numeric, 2)), 2),
         string_agg('#' || (x->>'id'), ', ' ORDER BY (x->>'id')::bigint)
    INTO v_n, v_distintos, v_total, v_ids
    FROM jsonb_array_elements(p_itens) x;
  IF v_distintos <> v_n THEN RAISE EXCEPTION 'A mesma solicitação aparece duas vezes no lote.'; END IF;

  -- Trava e confere cada solicitação (em ordem de id: dois lotes ao mesmo tempo não se travam)
  FOR it IN SELECT (x->>'id')::bigint AS id, round((x->>'valor')::numeric, 2) AS valor, x->>'origem' AS origem
              FROM jsonb_array_elements(p_itens) x ORDER BY 1 LOOP
    SELECT * INTO f FROM public."SISTEMA_SOLICITACOES_FERIAS" WHERE id = it.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação #% não encontrada.', it.id; END IF;
    IF f.status <> 'Aprovada' THEN RAISE EXCEPTION 'As férias de % (#%) não estão aprovadas.', f.colaborador_nome, it.id; END IF;
    IF public.ferias_malote_ativo(f.malote_despesa_id) THEN
      RAISE EXCEPTION 'As férias de % (#%) já estão no Malote.', f.colaborador_nome, it.id;
    END IF;
    IF it.valor IS NULL OR it.valor <= 0 OR it.valor >= 1000000 THEN
      RAISE EXCEPTION 'Valor inválido para % (#%).', f.colaborador_nome, it.id;
    END IF;
    IF coalesce(it.origem, '') NOT IN ('leitura', 'digitado') THEN RAISE EXCEPTION 'Origem do valor inválida (#%).', it.id; END IF;
  END LOOP;

  -- A despesa (mesmas regras do envio individual)
  SELECT * INTO v_class FROM public.planejamento_orcamentario_classificacao
   WHERE id = NULLIF(p_despesa->>'classificacao_id', '')::uuid AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escolha uma classificação ativa do Malote.'; END IF;
  IF NULLIF(p_despesa->>'empresa_id', '') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.empresas e WHERE e.id = (p_despesa->>'empresa_id')::uuid) THEN
    RAISE EXCEPTION 'Escolha a empresa pagadora.';
  END IF;
  IF btrim(coalesce(p_despesa->>'nome', '')) = '' THEN RAISE EXCEPTION 'Informe o nome da despesa.'; END IF;

  v_valor := round(NULLIF(p_despesa->>'valor_total', '')::numeric, 2);
  IF v_valor IS NULL OR v_valor <> v_total THEN
    RAISE EXCEPTION 'O valor da despesa deve ser a soma das férias confirmadas (R$ %).', public.ferias_fmt_reais(v_total);
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
  IF cardinality(v_arquivos) = 0 THEN RAISE EXCEPTION 'O arquivo das férias tem de ir anexado na despesa.'; END IF;

  INSERT INTO public.malote_despesa (
    id, empresa_id, classificacao_id, origem, status, nivel_aprovacao_atual,
    nome, valor_total, motivo, descricao, tipo_movimento, tipo, contrato_id,
    data_pagamento, competencia, forma_pagamento, informacoes_pagamento,
    excecao_solicitacao_id, justificativa_excecao, parcelado, numero_parcelas, dia_desconto,
    arquivos, solicitacao_dispensada_manualmente, created_by
  ) VALUES (
    p_despesa_id, (p_despesa->>'empresa_id')::uuid, v_class.id, 'despesa_unica', 'pendente_aprovacao', 1,
    btrim(p_despesa->>'nome'), v_valor,
    'Férias em lote — ' || v_n || CASE WHEN v_n = 1 THEN ' colaborador' ELSE ' colaboradores' END,
    'Gerado pelo RH › Gestão de Férias › Malote em massa (solicitações ' || v_ids ||
      coalesce('; arquivo ' || v_arq_nome, '') || '; valores confirmados por ' || coalesce(v_nome, '—') || ').',
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

  -- As solicitações: recibo (o arquivo do lote), valor confirmado, Malote
  PERFORM set_config('app.ferias_fluxo_malote', '1', true);
  UPDATE public."SISTEMA_SOLICITACOES_FERIAS" s SET
    recibo_path = p_recibo_path, recibo_nome = v_arq_nome,
    recibo_anexado_por = v_nome, recibo_anexado_em = now(),
    valor_liquido = round((x->>'valor')::numeric, 2), valor_origem = x->>'origem',
    valor_leitura = CASE WHEN jsonb_typeof(x->'leitura') = 'object' THEN (x->'leitura') || jsonb_build_object('lote', true) END,
    valor_confirmado_por = v_nome, valor_confirmado_em = now(),
    malote_despesa_id = p_despesa_id, malote_enviado_por = v_nome, malote_enviado_em = now(),
    data_malote = (now() AT TIME ZONE 'America/Sao_Paulo')::date,
    status_senior = 'Gerado', atualizado_em = now()
    FROM jsonb_array_elements(p_itens) x
   WHERE s.id = (x->>'id')::bigint;
  PERFORM set_config('app.ferias_fluxo_malote', '', true);

  -- Histórico: os mesmos três eventos do envio individual, em cada solicitação
  SELECT m.numero INTO v_numero FROM public.malote_despesa m WHERE m.id = p_despesa_id;
  INSERT INTO public."SISTEMA_SOLICITACOES_FERIAS_HISTORICO" (solicitacao_id, evento, de_status, para_status, por_nome, por_user_id, motivo)
  SELECT s.id, ev.evento, s.status, s.status, v_nome, auth.uid(), ev.motivo
    FROM jsonb_array_elements(p_itens) x
    JOIN public."SISTEMA_SOLICITACOES_FERIAS" s ON s.id = (x->>'id')::bigint
   CROSS JOIN LATERAL (VALUES
     (1, 'Recibo da Senior anexado', coalesce(v_arq_nome, 'arquivo do lote') || ' (Malote em massa)'),
     (2, 'Valor confirmado', 'R$ ' || public.ferias_fmt_reais(round((x->>'valor')::numeric, 2))
           || CASE x->>'origem' WHEN 'leitura' THEN ' (lido do arquivo do lote)' ELSE ' (digitado)' END),
     (3, 'Enviada ao Malote', coalesce(v_numero || ' · ', '') || 'R$ ' || public.ferias_fmt_reais(round((x->>'valor')::numeric, 2))
           || ' · lote de ' || v_n || ', total R$ ' || public.ferias_fmt_reais(v_total))
   ) AS ev(ordem, evento, motivo)
   ORDER BY s.id, ev.ordem;

  RETURN p_despesa_id;
END $$;
REVOKE ALL ON FUNCTION public.ferias_lote_enviar_malote(jsonb, text, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ferias_lote_enviar_malote(jsonb, text, text, uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.ferias_lote_enviar_malote(jsonb, text, text, uuid, jsonb),
--   public.ferias_lote_localizar(jsonb);
-- COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_FERIAS".recibo_path IS NULL;
-- NOTIFY pgrst, 'reload schema';
