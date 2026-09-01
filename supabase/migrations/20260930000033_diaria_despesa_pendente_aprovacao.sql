-- =====================================================================
-- SIS-2026-0287 — diária entra no fluxo normal de aprovação do Malote.
--
-- A despesa deixou de ser um rascunho incompleto criado pela trigger. O
-- formulário é o mesmo do Malote, e esta RPC grava despesa, rateio, parcelas
-- e a decisão da diária numa única transação SECURITY DEFINER. O upload dos
-- anexos continua depois: o Storage precisa do id que esta função devolve.
-- =====================================================================

-- O aprovador pode enxergar Diárias sem ter SELECT direto no contrato. Esta
-- função entrega somente o id de empresa necessário ao painel de rateio; a
-- RPC de aprovação não confia nele e resolve o contrato outra vez.
CREATE OR REPLACE FUNCTION public.diaria_empresa_contrato(p_contrato_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT c.empresa_id
    FROM public.contratos c
   WHERE c.id = p_contrato_id
     AND public.can_access(auth.uid(), 'operacional_diarias', 'visualizar');
$$;
REVOKE ALL ON FUNCTION public.diaria_empresa_contrato(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.diaria_empresa_contrato(uuid) TO authenticated;

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
    p_despesa->>'competencia',
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

-- O guard não cria mais a despesa. Ele exige o vínculo já criado pela RPC,
-- de modo que UPDATE direto nunca produza diária aprovada sem Malote.
CREATE OR REPLACE FUNCTION public.diaria_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.valor_total_centavos IS DISTINCT FROM OLD.valor_total_centavos
     AND NOT public.diaria_recalculando() THEN
    RAISE EXCEPTION 'O total é calculado pelas diárias, não pode ser digitado.';
  END IF;
  IF NEW.valor_total_centavos IS DISTINCT FROM OLD.valor_total_centavos
     AND public.diaria_recalculando() THEN
    RETURN NEW;
  END IF;
  IF NEW.solicitante_id IS DISTINCT FROM OLD.solicitante_id THEN
    RAISE EXCEPTION 'O solicitante não muda.';
  END IF;
  IF NEW.numero IS DISTINCT FROM OLD.numero THEN
    RAISE EXCEPTION 'O número da solicitação não muda.';
  END IF;

  IF public.can_access(auth.uid(), 'operacional_diarias', 'aprovar') THEN
    IF (to_jsonb(NEW) - ARRAY[
          'status', 'malote_motivo', 'malote_data_pagamento',
          'malote_despesa_id', 'enviado_malote_em',
          'decidido_por', 'decidido_por_nome', 'decidido_em', 'updated_at'
        ]::text[])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY[
          'status', 'malote_motivo', 'malote_data_pagamento',
          'malote_despesa_id', 'enviado_malote_em',
          'decidido_por', 'decidido_por_nome', 'decidido_em', 'updated_at'
        ]::text[]) THEN
      RAISE EXCEPTION 'A aprovação não pode alterar os dados da solicitação.';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status <> 'solicitada' THEN
        RAISE EXCEPTION 'A solicitação já foi % e não pode ser decidida novamente.', OLD.status;
      END IF;
      IF NEW.status NOT IN ('aprovada', 'reprovada') THEN
        RAISE EXCEPTION 'Decisão inválida para a solicitação.';
      END IF;
      IF OLD.solicitante_id = auth.uid() THEN
        RAISE EXCEPTION 'Quem solicitou a diária não pode aprovar ou reprovar a própria solicitação.';
      END IF;
      IF NEW.status = 'aprovada'
         AND (btrim(coalesce(NEW.malote_motivo, '')) = ''
              OR NEW.malote_data_pagamento IS NULL) THEN
        RAISE EXCEPTION 'Nome/motivo e data de pagamento são obrigatórios para aprovar.';
      END IF;
      IF NEW.status = 'aprovada' AND NEW.malote_despesa_id IS NULL THEN
        RAISE EXCEPTION 'A diária só pode ser aprovada pela RPC que cria a despesa do Malote.';
      END IF;
      IF NEW.status = 'reprovada' THEN
        NEW.malote_motivo := NULL;
        NEW.malote_data_pagamento := NULL;
      END IF;
      NEW.decidido_por := auth.uid();
      NEW.decidido_em := now();
      SELECT COALESCE(p.display_name, p.email) INTO NEW.decidido_por_nome
        FROM public.profiles p WHERE p.id = auth.uid();
    ELSIF NEW.malote_motivo IS DISTINCT FROM OLD.malote_motivo
       OR NEW.malote_data_pagamento IS DISTINCT FROM OLD.malote_data_pagamento
       OR NEW.malote_despesa_id IS DISTINCT FROM OLD.malote_despesa_id
       OR NEW.enviado_malote_em IS DISTINCT FROM OLD.enviado_malote_em
       OR NEW.decidido_por IS DISTINCT FROM OLD.decidido_por
       OR NEW.decidido_por_nome IS DISTINCT FROM OLD.decidido_por_nome
       OR NEW.decidido_em IS DISTINCT FROM OLD.decidido_em THEN
      RAISE EXCEPTION 'Os dados da decisão só mudam junto com o status.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Você não tem permissão para decidir esta solicitação.';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['observacoes', 'updated_at']::text[])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['observacoes', 'updated_at']::text[]) THEN
    RAISE EXCEPTION 'Depois de criada, somente a observação da solicitação pode ser corrigida.';
  END IF;
  IF NEW.decidido_por IS DISTINCT FROM OLD.decidido_por
     OR NEW.decidido_por_nome IS DISTINCT FROM OLD.decidido_por_nome
     OR NEW.decidido_em IS DISTINCT FROM OLD.decidido_em
     OR NEW.malote_motivo IS DISTINCT FROM OLD.malote_motivo
     OR NEW.malote_data_pagamento IS DISTINCT FROM OLD.malote_data_pagamento
     OR NEW.malote_despesa_id IS DISTINCT FROM OLD.malote_despesa_id
     OR NEW.enviado_malote_em IS DISTINCT FROM OLD.enviado_malote_em THEN
    RAISE EXCEPTION 'Só quem aprova preenche os dados do Malote.';
  END IF;

  RETURN NEW;
END $$;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK (executar manualmente)
--
-- DROP FUNCTION IF EXISTS public.diaria_aprovar_com_despesa(uuid, jsonb);
-- DROP FUNCTION IF EXISTS public.diaria_empresa_contrato(uuid);
--
-- CREATE OR REPLACE FUNCTION public.diaria_guard() RETURNS trigger
-- LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
-- AS $rollback$
-- DECLARE
--   v_empresa_id       uuid;
--   v_classificacao_id uuid;
--   v_competencia      text;
--   v_malote_id        uuid;
-- BEGIN
--   IF NEW.valor_total_centavos IS DISTINCT FROM OLD.valor_total_centavos
--      AND NOT public.diaria_recalculando() THEN
--     RAISE EXCEPTION 'O total é calculado pelas diárias, não pode ser digitado.';
--   END IF;
--   IF NEW.valor_total_centavos IS DISTINCT FROM OLD.valor_total_centavos
--      AND public.diaria_recalculando() THEN
--     RETURN NEW;
--   END IF;
--   IF NEW.solicitante_id IS DISTINCT FROM OLD.solicitante_id THEN
--     RAISE EXCEPTION 'O solicitante não muda.';
--   END IF;
--   IF NEW.numero IS DISTINCT FROM OLD.numero THEN
--     RAISE EXCEPTION 'O número da solicitação não muda.';
--   END IF;
--
--   IF public.can_access(auth.uid(), 'operacional_diarias', 'aprovar') THEN
--     IF (to_jsonb(NEW) - ARRAY[
--           'status', 'malote_motivo', 'malote_data_pagamento',
--           'decidido_por', 'decidido_por_nome', 'decidido_em', 'updated_at'
--         ]::text[])
--        IS DISTINCT FROM
--        (to_jsonb(OLD) - ARRAY[
--           'status', 'malote_motivo', 'malote_data_pagamento',
--           'decidido_por', 'decidido_por_nome', 'decidido_em', 'updated_at'
--         ]::text[]) THEN
--       RAISE EXCEPTION 'A aprovação não pode alterar os dados da solicitação.';
--     END IF;
--
--     IF NEW.status IS DISTINCT FROM OLD.status THEN
--       IF OLD.status <> 'solicitada' THEN
--         RAISE EXCEPTION 'A solicitação já foi % e não pode ser decidida novamente.', OLD.status;
--       END IF;
--       IF NEW.status NOT IN ('aprovada', 'reprovada') THEN
--         RAISE EXCEPTION 'Decisão inválida para a solicitação.';
--       END IF;
--       IF OLD.solicitante_id = auth.uid() THEN
--         RAISE EXCEPTION 'Quem solicitou a diária não pode aprovar ou reprovar a própria solicitação.';
--       END IF;
--       IF NEW.status = 'aprovada'
--          AND (btrim(coalesce(NEW.malote_motivo, '')) = ''
--               OR NEW.malote_data_pagamento IS NULL) THEN
--         RAISE EXCEPTION 'Nome/motivo e data de pagamento são obrigatórios para aprovar.';
--       END IF;
--       IF NEW.status = 'aprovada' THEN
--         SELECT c.empresa_id INTO v_empresa_id
--           FROM public.contratos c WHERE c.id = OLD.contrato_id;
--         IF v_empresa_id IS NULL THEN
--           RAISE EXCEPTION 'O contrato da diária não possui empresa para gerar a despesa do Malote.';
--         END IF;
--         SELECT c.id INTO v_classificacao_id
--           FROM public.planejamento_orcamentario_classificacao c
--          WHERE c.ativo = true
--            AND lower(public.unaccent_safe(btrim(c.nome))) = 'diaria'
--          ORDER BY c.created_at
--          LIMIT 1;
--         SELECT to_char(min(l.data), 'YYYY-MM') INTO v_competencia
--           FROM public."DIARIA_LINHA" l WHERE l.solicitacao_id = OLD.id;
--         INSERT INTO public.malote_despesa (
--           empresa_id, classificacao_id, origem, status, nome, valor_total,
--           motivo, descricao, tipo_movimento, tipo, contrato_id,
--           data_pagamento, competencia, informacoes_pagamento, created_by
--         ) VALUES (
--           v_empresa_id, v_classificacao_id, 'despesa_unica', 'rascunho',
--           btrim(NEW.malote_motivo), OLD.valor_total_centavos / 100.0,
--           'Pagamento de diária ' || coalesce(OLD.numero, OLD.id::text),
--           'Gerado automaticamente pelo Controle de Diárias. Faltante: ' ||
--             OLD.faltante_nome || '; diarista: ' || OLD.diarista_nome ||
--             '; posto: ' || OLD.posto_nome || '.',
--           'saida', 'contrato', OLD.contrato_id,
--           NEW.malote_data_pagamento, v_competencia,
--           'PIX: ' || OLD.pix, auth.uid()
--         ) RETURNING id INTO v_malote_id;
--         NEW.malote_despesa_id := v_malote_id;
--         NEW.enviado_malote_em := now();
--       END IF;
--       IF NEW.status = 'reprovada' THEN
--         NEW.malote_motivo := NULL;
--         NEW.malote_data_pagamento := NULL;
--       END IF;
--       NEW.decidido_por := auth.uid();
--       NEW.decidido_em := now();
--       SELECT COALESCE(p.display_name, p.email) INTO NEW.decidido_por_nome
--         FROM public.profiles p WHERE p.id = auth.uid();
--     ELSIF NEW.malote_motivo IS DISTINCT FROM OLD.malote_motivo
--        OR NEW.malote_data_pagamento IS DISTINCT FROM OLD.malote_data_pagamento
--        OR NEW.decidido_por IS DISTINCT FROM OLD.decidido_por
--        OR NEW.decidido_por_nome IS DISTINCT FROM OLD.decidido_por_nome
--        OR NEW.decidido_em IS DISTINCT FROM OLD.decidido_em THEN
--       RAISE EXCEPTION 'Os dados da decisão só mudam junto com o status.';
--     END IF;
--     RETURN NEW;
--   END IF;
--
--   IF NEW.status IS DISTINCT FROM OLD.status THEN
--     RAISE EXCEPTION 'Você não tem permissão para decidir esta solicitação.';
--   END IF;
--   IF (to_jsonb(NEW) - ARRAY['observacoes', 'updated_at']::text[])
--      IS DISTINCT FROM
--      (to_jsonb(OLD) - ARRAY['observacoes', 'updated_at']::text[]) THEN
--     RAISE EXCEPTION 'Depois de criada, somente a observação da solicitação pode ser corrigida.';
--   END IF;
--   IF NEW.decidido_por IS DISTINCT FROM OLD.decidido_por
--      OR NEW.decidido_por_nome IS DISTINCT FROM OLD.decidido_por_nome
--      OR NEW.decidido_em IS DISTINCT FROM OLD.decidido_em
--      OR NEW.malote_motivo IS DISTINCT FROM OLD.malote_motivo
--      OR NEW.malote_data_pagamento IS DISTINCT FROM OLD.malote_data_pagamento
--      OR NEW.malote_despesa_id IS DISTINCT FROM OLD.malote_despesa_id
--      OR NEW.enviado_malote_em IS DISTINCT FROM OLD.enviado_malote_em THEN
--     RAISE EXCEPTION 'Só quem aprova preenche os dados do Malote.';
--   END IF;
--   RETURN NEW;
-- END
-- $rollback$;
--
-- NOTIFY pgrst, 'reload schema';
-- =====================================================================
