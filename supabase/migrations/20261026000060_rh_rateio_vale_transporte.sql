-- =========================================================================
-- RH › RATEIO DE DESPESAS — tipo novo VALE TRANSPORTE (26/10/2026)
--
-- PEDIDO (Pablo, com o PDF "VT 11.2026 POLICIA-SMS-SAMU-TJ-UFRGS- TEU.pdf"):
-- "preciso conseguir importar esse arquivo de rateio também no sistema de
-- rateio do RH, adapta e adiciona esse novo tipo de VT".
--
-- O PDF é o boleto da TEU (R$ 22.508,30) + os relatórios "Período Vale
-- Transporte" da Senior (BSVT001), uma linha por colaborador com MATRÍCULA
-- e valor, sem CPF e sem contrato. A leitura é no navegador
-- (extrairLinhasValeTransporte em src/lib/rh/rateioDespesas.ts) e o contrato
-- vem da matrícula pela rh_rateio_casar_cadastros, que já existe (mig
-- 20261021000070). Aqui só o que o banco precisa:
--   1. o CHECK de "RH_RATEIO_DESPESA".tipo aceita 'vale_transporte';
--   2. rh_rateio_enviar_malote dá o nome "Vale Transporte" à despesa do
--      Malote (antes cairia no ELSE e sairia "vale_transporte"). O resto da
--      função é IGUAL à mig 20261016000020 (copiado dela).
-- =========================================================================

-- ── 1. O tipo novo ───────────────────────────────────────────────────────
DO $chk$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
     WHERE con.conrelid = 'public."RH_RATEIO_DESPESA"'::regclass AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%tipo%mensalidade_seeac%'
  LOOP
    EXECUTE format('ALTER TABLE public."RH_RATEIO_DESPESA" DROP CONSTRAINT %I', c);
  END LOOP;
END $chk$;
ALTER TABLE public."RH_RATEIO_DESPESA" ADD CONSTRAINT "RH_RATEIO_DESPESA_tipo_check"
  CHECK (tipo IN ('jusbrasil', 'senior', 'fgts', 'bullla', 'seguro', 'bsf', 'gratificacao_pcd', 'mensalidade_seeac', 'vale_transporte'));

-- ── 2. Nome da despesa no Malote ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rh_rateio_enviar_malote(p_rateio_id uuid, p_despesa_id uuid, p_despesa jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r            public."RH_RATEIO_DESPESA"%ROWTYPE;
  v_class      public.planejamento_orcamentario_classificacao%ROWTYPE;
  v_valor      numeric;
  v_soma       numeric;
  v_parcelado  boolean := COALESCE((p_despesa->>'parcelado')::boolean, false);
  v_nparc      integer := NULLIF(p_despesa->>'numero_parcelas', '')::integer;
  v_arquivos   text[];
  v_nome       text;
  v_rotulo     text;
BEGIN
  IF NOT public.rh_rateio_pode('enviar_malote') THEN
    RAISE EXCEPTION 'Sem permissão para enviar rateio ao Malote' USING ERRCODE = '42501';
  END IF;
  IF p_despesa_id IS NULL THEN RAISE EXCEPTION 'Id da despesa não informado.'; END IF;

  SELECT * INTO r FROM public."RH_RATEIO_DESPESA" WHERE id = p_rateio_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rateio não encontrado.'; END IF;
  IF r.status <> 'conferido' THEN
    RAISE EXCEPTION 'Só rateio conferido vai para o Malote — salve como conferido antes.';
  END IF;
  IF public.rh_rateio_malote_ativo(r.malote_despesa_id) THEN
    RAISE EXCEPTION 'Este rateio já está no Malote.';
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
  IF v_valor IS NULL OR v_valor <> round(r.valor, 2) THEN
    RAISE EXCEPTION 'O valor da despesa deve ser o valor do rateio (R$ %).', to_char(r.valor, 'FM999G999G990D00');
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

  -- Só arquivos que o navegador subiu na pasta desta despesa.
  SELECT COALESCE(array_agg(a), '{}') INTO v_arquivos
    FROM jsonb_array_elements_text(COALESCE(p_despesa->'arquivos', '[]'::jsonb)) a;
  IF EXISTS (SELECT 1 FROM unnest(v_arquivos) a WHERE a NOT LIKE p_despesa_id::text || '/%') THEN
    RAISE EXCEPTION 'Anexo fora da pasta da despesa.';
  END IF;

  SELECT COALESCE(NULLIF(btrim(pr.display_name), ''), pr.email) INTO v_nome
    FROM public.profiles pr WHERE pr.id = auth.uid();
  v_rotulo := CASE r.tipo
    WHEN 'jusbrasil' THEN 'Jus Brasil' WHEN 'senior' THEN 'Senior' WHEN 'fgts' THEN 'FGTS'
    WHEN 'bullla' THEN 'Bullla' WHEN 'seguro' THEN 'Seguro' WHEN 'bsf' THEN 'BSF'
    WHEN 'gratificacao_pcd' THEN 'Gratificação PCD' WHEN 'mensalidade_seeac' THEN 'Mensalidade SEEAC'
    WHEN 'vale_transporte' THEN 'Vale Transporte'
    ELSE r.tipo END;

  INSERT INTO public.malote_despesa (
    id, empresa_id, classificacao_id, origem, status, nivel_aprovacao_atual,
    nome, valor_total, motivo, descricao, tipo_movimento, tipo, contrato_id,
    data_pagamento, competencia, forma_pagamento, informacoes_pagamento,
    excecao_solicitacao_id, justificativa_excecao, parcelado, numero_parcelas, dia_desconto,
    arquivos, solicitacao_dispensada_manualmente, created_by
  ) VALUES (
    p_despesa_id, (p_despesa->>'empresa_id')::uuid, v_class.id, 'despesa_unica', 'pendente_aprovacao', 1,
    btrim(p_despesa->>'nome'), v_valor,
    'Rateio ' || v_rotulo || ' ' || to_char(r.competencia, 'MM/YYYY'),
    'Gerado pelo RH › Rateio de Despesas (' || v_rotulo || ', competência ' || to_char(r.competencia, 'MM/YYYY') ||
      ', critério ' || r.criterio || ').' || COALESCE(' ' || r.descricao, ''),
    'saida', CASE WHEN v_class.tipo IN ('administrativo', 'contrato') THEN v_class.tipo ELSE 'contrato' END, NULL,
    (p_despesa->>'data_pagamento')::date, (p_despesa->>'competencia')::date,
    btrim(p_despesa->>'forma_pagamento'),
    NULLIF(btrim(coalesce(p_despesa->>'informacoes_pagamento', '')), ''),
    NULLIF(p_despesa->>'excecao_solicitacao_id', '')::uuid,
    NULLIF(btrim(coalesce(p_despesa->>'justificativa_excecao', '')), ''),
    v_parcelado, CASE WHEN v_parcelado THEN v_nparc END,
    CASE WHEN v_parcelado THEN NULLIF(p_despesa->>'dia_desconto', '')::integer END,
    v_arquivos,
    -- Vem do RH sem solicitação: se a classificação pedia uma, fica o rastro.
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

  UPDATE public."RH_RATEIO_DESPESA"
     SET malote_despesa_id = p_despesa_id, enviado_malote_em = now(),
         enviado_malote_por = auth.uid(), enviado_malote_por_nome = v_nome
   WHERE id = r.id;

  RETURN p_despesa_id;
END $$;
REVOKE ALL ON FUNCTION public.rh_rateio_enviar_malote(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_rateio_enviar_malote(uuid, uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- (só se não houver rateio de VT gravado: DELETE FROM public."RH_RATEIO_DESPESA" WHERE tipo = 'vale_transporte';)
-- ALTER TABLE public."RH_RATEIO_DESPESA" DROP CONSTRAINT IF EXISTS "RH_RATEIO_DESPESA_tipo_check";
-- ALTER TABLE public."RH_RATEIO_DESPESA" ADD CONSTRAINT "RH_RATEIO_DESPESA_tipo_check"
--   CHECK (tipo IN ('jusbrasil', 'senior', 'fgts', 'bullla', 'seguro', 'bsf', 'gratificacao_pcd', 'mensalidade_seeac'));
-- Função: reaplicar rh_rateio_enviar_malote da mig 20261016000020.
