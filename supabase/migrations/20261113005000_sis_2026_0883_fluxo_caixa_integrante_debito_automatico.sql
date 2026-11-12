-- SIS-2026-0883 — Fluxo de Caixa: integrante também nos lançamentos do Débito Automático (DA-…)  (Parte 2 da SIS-2026-0859)
-- ============================================================================
-- Pedido (Controladoria): "Não está liberado para reclassificar o integrante da classificação consórcio, por exemplo no ID DA-2026-1074
-- aparece a informação 'Integrante só em despesa do Malote ou lançamento importado da planilha'." Algumas classificações (ex.: consórcio)
-- passaram a exigir integrante, e elas também são pagas por Débito Automático. A SIS-2026-0823 (mig 20261110000200) previu integrante só
-- no Malote; a SIS-2026-0859 (mig 20261111150000) acrescentou a importação da planilha. Faltava o Débito Automático.
--
--   1. "DEBITO_AUTOMATICO".integrante_empregado_id : nasce nulo e é preenchido pelo Fluxo. Como no rateio do Malote e na importação,
--                                                    sem FK (EMPREGADOS é do RH; -1 = "Empresa", SIS-2026-0873; nome via fluxo_integrante_nome).
--   2. v_debito_automatico_fluxo_caixa             : mesma definição de 20261030004000, com integrante_empregado_id e integrante_nome
--                                                    NO FINAL (a leitura compacta pega as colunas da view sozinha).
--   3. fluxo_caixa_trocar_integrante               : mesma definição de 20261112200000 (SIS-2026-0873), com o ramo 'debito_automatico':
--                                                    grava no próprio débito (não tem rateio nem parcela no Fluxo) e registra
--                                                    'edicao' no histórico do débito ("DEBITO_AUTOMATICO_EVENTO"). Malote e importação não mudam.
--
-- Cartão, aplicação financeira e conta garantida continuam sem integrante.
-- Idempotente. NOTIFY ao final.
--
-- ROLLBACK:
--   Reaplicar fluxo_caixa_trocar_integrante de 20261112200000_sis_2026_0873_integrante_empresa.sql;
--   DROP VIEW public.v_debito_automatico_fluxo_caixa e recriar pela 20261030004000 (+ security_invoker e GRANT; atenção: a
--   leitura do Fluxo e as TVs usam a view), depois
--   ALTER TABLE public."DEBITO_AUTOMATICO" DROP COLUMN IF EXISTS integrante_empregado_id;

SET lock_timeout = '5s';

-- 1. coluna
ALTER TABLE public."DEBITO_AUTOMATICO"
  ADD COLUMN IF NOT EXISTS integrante_empregado_id bigint;

-- 2. view (igual a 20261030004000 + duas colunas no fim)
CREATE OR REPLACE VIEW public.v_debito_automatico_fluxo_caixa AS
SELECT
  d.id AS despesa_id,
  d.numero AS id_malote,
  COALESCE(aj.data_pagamento, d.data_pagamento) AS data_pagamento,
  COALESCE(aj.competencia, d.competencia) AS competencia,
  COALESCE(aj.empresa_id, d.empresa_id) AS empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  d.contrato_id,
  c.nome AS contrato_nome,
  COALESCE(aj.classificacao_id, d.classificacao_id) AS classificacao_id,
  cl.nome AS classificacao_nome,
  COALESCE(aj.descricao, d.descricao) AS descricao,
  COALESCE(aj.forma_pagamento, d.forma_pagamento) AS forma_pagamento,
  COALESCE(aj.banco_id, d.banco_id) AS banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  NULL::int AS numero_parcela,
  NULL::int AS numero_parcelas,
  COALESCE(aj.valor, d.valor) AS valor,
  COALESCE(aj.tipo, d.tipo) AS tipo,
  'debito_automatico'::text AS origem,
  (aj.id IS NOT NULL) AS ajustado,
  d.integrante_empregado_id,
  CASE WHEN d.integrante_empregado_id IS NULL THEN NULL ELSE public.fluxo_integrante_nome(d.integrante_empregado_id) END AS integrante_nome
FROM public."DEBITO_AUTOMATICO" d
LEFT JOIN public.financeiro_fluxo_caixa_ajuste aj
  ON aj.origem = 'debito_automatico' AND aj.despesa_id = d.id AND aj.numero_parcela IS NULL
LEFT JOIN public.empresas e ON e.id = COALESCE(aj.empresa_id, d.empresa_id)
LEFT JOIN public.contratos c ON c.id = d.contrato_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = COALESCE(aj.classificacao_id, d.classificacao_id)
LEFT JOIN public.malote_cartao_banco cb ON cb.id = COALESCE(aj.banco_id, d.banco_id)
WHERE d.status = 'pago' AND d.deleted_at IS NULL
  AND NOT (
    COALESCE(aj.tipo, d.tipo) = 'saida'
    AND public.fn_debito_coberto_por_fatura_importada(
      COALESCE(aj.forma_pagamento, d.forma_pagamento),
      COALESCE(aj.competencia, d.competencia)::date,
      COALESCE(aj.data_pagamento, d.data_pagamento)::date
    )
  );

ALTER VIEW public.v_debito_automatico_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_debito_automatico_fluxo_caixa TO authenticated;

-- 3. troca do integrante: Malote + importação da planilha (como na 0873) + Débito Automático
CREATE OR REPLACE FUNCTION public.fluxo_caixa_trocar_integrante(_origem text, _despesa_id uuid, _empregado_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n_rateio int;
  v_rateio_id uuid;
  v_antigo bigint;
  v_antigo_nome text;
  v_novo_nome text;
  v_n_cotas int;
  v_n_diferentes int;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar o Fluxo de Caixa.';
  END IF;
  IF _empregado_id IS NULL THEN
    RAISE EXCEPTION 'Informe o integrante.';
  END IF;
  IF _origem IS NULL OR _origem NOT IN ('malote', 'importacao_historica', 'debito_automatico') THEN
    RAISE EXCEPTION 'Esta origem não permite trocar o integrante pelo Fluxo de Caixa (só Malote, Débito Automático e importação da planilha).';
  END IF;

  v_novo_nome := public.fluxo_integrante_nome(_empregado_id);  -- SIS-2026-0873: -1 = "Empresa"
  IF v_novo_nome IS NULL THEN
    RAISE EXCEPTION 'Integrante não encontrado.';
  END IF;

  -- SIS-2026-0883: Débito Automático. Uma linha por débito no Fluxo (sem rateio nem parcela): o integrante fica no próprio débito.
  IF _origem = 'debito_automatico' THEN
    SELECT d.integrante_empregado_id INTO v_antigo
      FROM public."DEBITO_AUTOMATICO" d
     WHERE d.id = _despesa_id AND d.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Débito Automático não encontrado.';
    END IF;
    IF v_antigo IS NOT DISTINCT FROM _empregado_id THEN
      RAISE EXCEPTION 'O lançamento já está com este integrante.';
    END IF;
    IF v_antigo IS NOT NULL THEN
      v_antigo_nome := public.fluxo_integrante_nome(v_antigo);
    END IF;

    UPDATE public."DEBITO_AUTOMATICO" SET integrante_empregado_id = _empregado_id WHERE id = _despesa_id;

    INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
    VALUES (_despesa_id, 'edicao', auth.uid(),
            format('Integrante alterado pelo Fluxo de Caixa: "%s" → "%s".', COALESCE(v_antigo_nome, '(sem integrante)'), v_novo_nome));
    RETURN;
  END IF;

  -- SIS-2026-0859: lançamento importado da planilha. _despesa_id é o id da linha ou do grupo de rateio (o despesa_id da view);
  -- o integrante vale para o lançamento inteiro, então todas as cotas recebem o mesmo.
  IF _origem = 'importacao_historica' THEN
    SELECT count(*), count(*) FILTER (WHERE fi.integrante_empregado_id IS DISTINCT FROM _empregado_id), min(fi.integrante_empregado_id)
      INTO v_n_cotas, v_n_diferentes, v_antigo
      FROM public.fluxo_caixa_importado fi
     WHERE COALESCE(fi.rateio_grupo_id, fi.id) = _despesa_id
       AND fi.deleted_at IS NULL
       AND fi.conferencia <> 'ja_existe_no_erp';
    IF v_n_cotas = 0 THEN
      RAISE EXCEPTION 'Lançamento importado não encontrado.';
    END IF;
    IF v_n_diferentes = 0 THEN
      RAISE EXCEPTION 'O lançamento já está com este integrante.';
    END IF;
    IF v_antigo IS NOT NULL THEN
      v_antigo_nome := public.fluxo_integrante_nome(v_antigo);  -- SIS-2026-0873: -1 = "Empresa"
    END IF;

    UPDATE public.fluxo_caixa_importado fi
       SET integrante_empregado_id = _empregado_id
     WHERE COALESCE(fi.rateio_grupo_id, fi.id) = _despesa_id
       AND fi.deleted_at IS NULL
       AND fi.conferencia <> 'ja_existe_no_erp';

    PERFORM public.fluxo_caixa_registrar_evento(
      'importacao_historica', _despesa_id, 'integrante_alterado',
      format('Integrante alterado pelo Fluxo de Caixa: "%s" → "%s".', COALESCE(v_antigo_nome, '(sem integrante)'), v_novo_nome),
      jsonb_build_object('antes', v_antigo, 'depois', _empregado_id)
    );
    RETURN;
  END IF;

  -- Malote (SIS-2026-0823, sem mudança): grava na linha de rateio de origem; uma só linha de rateio.
  IF NOT EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = _despesa_id AND d.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Despesa do Malote não encontrada.';
  END IF;

  SELECT count(*) INTO v_n_rateio FROM public.malote_despesa_rateio_linha WHERE despesa_id = _despesa_id;
  IF v_n_rateio > 1 THEN
    RAISE EXCEPTION 'Esta despesa é rateada em várias linhas: ajuste o integrante de cada linha direto na grade de rateio do Malote.';
  END IF;
  IF v_n_rateio = 0 THEN
    RAISE EXCEPTION 'Esta despesa não tem linha de rateio para receber o integrante: ajuste direto no Malote.';
  END IF;

  SELECT rl.id, rl.integrante_empregado_id INTO v_rateio_id, v_antigo
    FROM public.malote_despesa_rateio_linha rl WHERE rl.despesa_id = _despesa_id;
  IF v_antigo IS NOT DISTINCT FROM _empregado_id THEN
    RAISE EXCEPTION 'O lançamento já está com este integrante.';
  END IF;

  IF v_antigo IS NOT NULL THEN
    v_antigo_nome := public.fluxo_integrante_nome(v_antigo);  -- SIS-2026-0873: -1 = "Empresa"
  END IF;

  UPDATE public.malote_despesa_rateio_linha SET integrante_empregado_id = _empregado_id WHERE id = v_rateio_id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, nivel, ator_user_id)
  VALUES (_despesa_id, 'edicao',
          format('Integrante alterado pelo Fluxo de Caixa: "%s" → "%s".', COALESCE(v_antigo_nome, '(sem integrante)'), v_novo_nome),
          NULL, auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.fluxo_caixa_trocar_integrante(text, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fluxo_caixa_trocar_integrante(text, uuid, bigint) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
