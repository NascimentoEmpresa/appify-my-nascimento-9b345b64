-- =====================================================================
-- SIS-2026-0287 (hotfix) — a competência da diária vai para o Malote como
-- data, não como texto.
--
-- A 20260930000033 gravou a despesa a partir do jsonb e converteu cada
-- campo para o tipo da coluna — menos este. Como tudo que sai de um jsonb
-- com ->> é text e malote_despesa.competencia é date, o INSERT era
-- recusado já no parse, antes de olhar o valor:
--
--   column "competencia" is of type date but expression is of type text
--
-- Ou seja: NENHUMA diária conseguia ser aprovada em /app/operacional/diarias,
-- com qualquer competência. O formulário nunca esteve errado — o
-- PainelDespesaMalote já monta 'AAAA-MM-01' (o mesmo valor que o caminho
-- normal do Malote manda para malote_aprovar_despesa(_competencia date)).
--
-- Muda uma linha só: (p_despesa->>'competencia')::date. Sem date_trunc
-- deliberadamente — a competência continua chegando exatamente como o
-- Malote a grava hoje, e um formato diferente deve estourar aqui em vez de
-- ser silenciosamente corrigido.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.diaria_aprovar_com_despesa(
  p_solicitacao_id uuid,
  p_despesa jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_solicitacao      public."DIARIA_SOLICITACAO"%ROWTYPE;
  v_empresa_id       uuid;
  v_classificacao_id uuid;
  v_malote_id        uuid;
  v_valor_total      numeric;
  v_total_rateio     numeric;
  v_numero_parcelas  integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão expirada.';
  END IF;
  IF NOT public.can_access(auth.uid(), 'operacional_diarias', 'aprovar') THEN
    RAISE EXCEPTION 'Você não tem permissão para decidir esta solicitação.';
  END IF;

  SELECT * INTO v_solicitacao
    FROM public."DIARIA_SOLICITACAO" s
   WHERE s.id = p_solicitacao_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação de diária não encontrada.';
  END IF;
  IF v_solicitacao.status <> 'solicitada' THEN
    RAISE EXCEPTION 'A solicitação já foi % e não pode ser decidida novamente.', v_solicitacao.status;
  END IF;
  IF v_solicitacao.solicitante_id = auth.uid() THEN
    RAISE EXCEPTION 'Quem solicitou a diária não pode aprovar a própria solicitação.';
  END IF;

  SELECT c.empresa_id INTO v_empresa_id
    FROM public.contratos c
   WHERE c.id = v_solicitacao.contrato_id;
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'O contrato da diária não possui empresa para gerar a despesa do Malote.';
  END IF;

  SELECT c.id INTO v_classificacao_id
    FROM public.planejamento_orcamentario_classificacao c
   WHERE c.ativo = true
     AND lower(public.unaccent_safe(btrim(c.nome))) = 'diaria'
   ORDER BY c.created_at
   LIMIT 1;
  IF v_classificacao_id IS NULL THEN
    RAISE EXCEPTION 'A classificação ativa "Diária" não foi encontrada no Malote.';
  END IF;

  IF btrim(coalesce(p_despesa->>'nome', '')) = '' THEN
    RAISE EXCEPTION 'Informe o nome da despesa.';
  END IF;
  v_valor_total := NULLIF(p_despesa->>'valor_total', '')::numeric;
  IF v_valor_total IS NULL OR v_valor_total <= 0 THEN
    RAISE EXCEPTION 'Informe um valor total válido para a despesa.';
  END IF;
  IF round(v_valor_total, 2) <> round(v_solicitacao.valor_total_centavos / 100.0, 2) THEN
    RAISE EXCEPTION 'O valor da despesa deve ser igual ao total da solicitação de diária.';
  END IF;
  IF NULLIF(p_despesa->>'data_pagamento', '') IS NULL
     OR NULLIF(p_despesa->>'competencia', '') IS NULL
     OR btrim(coalesce(p_despesa->>'forma_pagamento', '')) = '' THEN
    RAISE EXCEPTION 'Data de pagamento, competência e forma de pagamento são obrigatórias.';
  END IF;
  IF jsonb_array_length(COALESCE(p_despesa->'rateio', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Adicione ao menos uma linha de rateio.';
  END IF;
  SELECT round(COALESCE(sum((r->>'valor')::numeric), 0), 2)
    INTO v_total_rateio
    FROM jsonb_array_elements(COALESCE(p_despesa->'rateio', '[]'::jsonb)) r;
  IF abs(v_total_rateio - round(v_valor_total, 2)) > 0.01 THEN
    RAISE EXCEPTION 'O total do rateio deve ser igual ao valor da despesa.';
  END IF;

  v_numero_parcelas := NULLIF(p_despesa->>'numero_parcelas', '')::integer;
  IF COALESCE((p_despesa->>'parcelado')::boolean, false)
     AND (v_numero_parcelas IS NULL OR v_numero_parcelas < 2 OR v_numero_parcelas > 420) THEN
    RAISE EXCEPTION 'Quantidade de parcelas deve ser entre 2 e 420.';
  END IF;
  IF COALESCE((p_despesa->>'parcelado')::boolean, false)
     AND jsonb_array_length(COALESCE(p_despesa->'parcelas', '[]'::jsonb)) <> v_numero_parcelas THEN
    RAISE EXCEPTION 'As parcelas informadas não correspondem à quantidade da despesa.';
  END IF;

  INSERT INTO public.malote_despesa (
    empresa_id, classificacao_id, origem, status, nivel_aprovacao_atual,
    nome, valor_total, motivo, descricao, tipo_movimento, tipo, contrato_id,
    data_pagamento, competencia, forma_pagamento, informacoes_pagamento,
    excecao, justificativa_excecao, parcelado, numero_parcelas, dia_desconto,
    created_by
  ) VALUES (
    v_empresa_id, v_classificacao_id, 'despesa_unica', 'pendente_aprovacao', 1,
    btrim(p_despesa->>'nome'), v_valor_total,
    'Pagamento de diária ' || coalesce(v_solicitacao.numero, v_solicitacao.id::text),
    'Gerado automaticamente pelo Controle de Diárias. Faltante: ' ||
      v_solicitacao.faltante_nome || '; diarista: ' || v_solicitacao.diarista_nome ||
      '; posto: ' || v_solicitacao.posto_nome || '.',
    'saida', 'contrato', v_solicitacao.contrato_id,
    (p_despesa->>'data_pagamento')::date,
    (p_despesa->>'competencia')::date,
    btrim(p_despesa->>'forma_pagamento'),
    NULLIF(btrim(coalesce(p_despesa->>'informacoes_pagamento', '')), ''),
    COALESCE((p_despesa->>'excecao')::boolean, false),
    NULLIF(btrim(coalesce(p_despesa->>'justificativa_excecao', '')), ''),
    COALESCE((p_despesa->>'parcelado')::boolean, false),
    CASE WHEN COALESCE((p_despesa->>'parcelado')::boolean, false) THEN v_numero_parcelas ELSE NULL END,
    CASE WHEN COALESCE((p_despesa->>'parcelado')::boolean, false) THEN NULLIF(p_despesa->>'dia_desconto', '')::integer ELSE NULL END,
    auth.uid()
  ) RETURNING id INTO v_malote_id;

  INSERT INTO public.malote_despesa_rateio_linha (
    despesa_id, classificacao_id, empresa_id, contrato_id, fornecedor_id,
    integrante_empregado_id, percentual, valor, ordem, justificativa_texto
  )
  SELECT
    v_malote_id,
    NULLIF(r.linha->>'classificacao_id', '')::uuid,
    NULLIF(r.linha->>'empresa_id', '')::uuid,
    NULLIF(r.linha->>'contrato_id', '')::uuid,
    NULLIF(r.linha->>'fornecedor_id', '')::uuid,
    NULLIF(r.linha->>'integrante_empregado_id', '')::bigint,
    NULLIF(r.linha->>'percentual', '')::numeric,
    (r.linha->>'valor')::numeric,
    (r.ordem - 1)::integer,
    NULLIF(btrim(coalesce(r.linha->>'justificativa_texto', '')), '')
  FROM jsonb_array_elements(COALESCE(p_despesa->'rateio', '[]'::jsonb))
       WITH ORDINALITY AS r(linha, ordem);

  IF COALESCE((p_despesa->>'parcelado')::boolean, false) THEN
    INSERT INTO public.malote_despesa_parcela (
      despesa_id, numero_parcela, valor, data_vencimento
    )
    SELECT
      v_malote_id,
      (p.parcela->>'numero_parcela')::integer,
      (p.parcela->>'valor')::numeric,
      (p.parcela->>'data_vencimento')::date
    FROM jsonb_array_elements(COALESCE(p_despesa->'parcelas', '[]'::jsonb)) p(parcela);
  END IF;

  UPDATE public."DIARIA_SOLICITACAO"
     SET status = 'aprovada',
         malote_motivo = btrim(p_despesa->>'nome'),
         malote_data_pagamento = (p_despesa->>'data_pagamento')::date,
         malote_despesa_id = v_malote_id,
         enviado_malote_em = now()
   WHERE id = v_solicitacao.id;

  RETURN v_malote_id;
END $$;

REVOKE ALL ON FUNCTION public.diaria_aprovar_com_despesa(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.diaria_aprovar_com_despesa(uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK (executar manualmente)
--
-- Reexecutar a 20260930000033_diaria_despesa_pendente_aprovacao.sql
-- inteira: ela recria diaria_aprovar_com_despesa com a linha sem o ::date,
-- que é o único ponto em que as duas versões diferem. Só faz sentido se a
-- coluna malote_despesa.competencia deixar de ser date.
-- =====================================================================
