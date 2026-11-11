-- SIS-2026-0859 — Fluxo de Caixa: integrante também nos lançamentos importados da planilha (IMP-…)
-- ============================================================================
-- Pedido: "permitir que altere o integrante nos que já têm e adicione nos lançamentos que não têm". No lápis do Fluxo,
-- o lançamento importado (ex.: IMP-00017, 7314 - 2026) mostrava "Só despesa do Malote tem integrante." e não deixava escolher.
-- A SIS-2026-0823 (mig 20261110000200) só previu integrante no Malote (linha de rateio).
--
--   1. fluxo_caixa_importado.integrante_empregado_id : a planilha não traz integrante; ele nasce nulo e é preenchido pelo Fluxo.
--                                                       Como no rateio do Malote, sem FK (EMPREGADOS é do RH; nome via fluxo_integrante_nome).
--   2. v_fluxo_caixa_importado_fluxo_caixa            : mesma definição de 20261015000010, com integrante_empregado_id e integrante_nome
--                                                       NO FINAL (a leitura compacta pega as colunas da view sozinha).
--   3. financeiro_fluxo_caixa_evento.tipo             : ganha 'integrante_alterado' (histórico da linha importada, que não tem tabela de evento própria).
--   4. fluxo_caixa_trocar_integrante                  : passa a aceitar 'importacao_historica'. Grava em TODAS as cotas do lançamento
--                                                       (_despesa_id = id da linha ou do grupo de rateio, como excluir/ratear): o integrante
--                                                       é do lançamento, não da cota. O ramo do Malote não muda.
--
-- Idempotente. NOTIFY ao final.
--
-- ROLLBACK:
--   Reaplicar fluxo_caixa_trocar_integrante de 20261110000200_sis_2026_0823_fluxo_caixa_integrante.sql;
--   a view só ganhou colunas no final (o front ignora o excesso). Para tirar: DROP VIEW v_fluxo_caixa_importado_fluxo_caixa e
--   recriar pela 20261015000010 (+ ALTER VIEW ... security_invoker e GRANT), depois
--   ALTER TABLE public.fluxo_caixa_importado DROP COLUMN IF EXISTS integrante_empregado_id;
--   (a CHECK do evento pode ficar: só aceita um tipo a mais.)

SET lock_timeout = '5s';

-- 1. coluna
ALTER TABLE public.fluxo_caixa_importado
  ADD COLUMN IF NOT EXISTS integrante_empregado_id bigint;

-- 2. view (igual a 20261015000010 + duas colunas no fim)
CREATE OR REPLACE VIEW public.v_fluxo_caixa_importado_fluxo_caixa AS
SELECT
  COALESCE(fi.rateio_grupo_id, fi.id) AS despesa_id,
  COALESCE(fi.rateio_codigo, fi.planilha_id_original, 'IMP-' || lpad(fi.planilha_linha::text, 5, '0')) AS id_malote,
  COALESCE(aj.data_pagamento, fi.data_pagamento) AS data_pagamento,
  COALESCE(aj.competencia, fi.competencia) AS competencia,
  COALESCE(aj.empresa_id, fi.empresa_id) AS empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  fi.contrato_id,
  COALESCE(c.nome, CASE WHEN fi.rateio_grupo_id IS NOT NULL THEN NULLIF(fi.contrato_texto, '') END) AS contrato_nome,
  COALESCE(aj.classificacao_id, fi.classificacao_id) AS classificacao_id,
  cl.nome AS classificacao_nome,
  COALESCE(aj.descricao, fi.descricao) AS descricao,
  COALESCE(aj.forma_pagamento, fi.forma_pagamento) AS forma_pagamento,
  COALESCE(aj.banco_id, fi.banco_id) AS banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  NULL::int AS numero_parcela,
  NULL::int AS numero_parcelas,
  CASE WHEN fi.rateio_grupo_id IS NOT NULL THEN fi.valor ELSE COALESCE(aj.valor, fi.valor) END AS valor,
  COALESCE(aj.tipo, fi.tipo) AS tipo,
  'importacao_historica'::text AS origem,
  (aj.id IS NOT NULL) AS ajustado,
  NULLIF(concat_ws(' · ',
    CASE WHEN fi.contrato_id IS NULL AND fi.rateio_grupo_id IS NULL AND NOT fi.sem_contrato_confirmado
      THEN 'Contrato não mapeado (planilha: ' || COALESCE(NULLIF(fi.contrato_texto, ''), '—') || ')' END,
    CASE WHEN COALESCE(aj.classificacao_id, fi.classificacao_id) IS NULL
      THEN 'Classificação não mapeada (planilha: ' || COALESCE(NULLIF(fi.classificacao_texto, ''), '—') || ')' END,
    CASE WHEN fi.conferencia = 'possivel_duplicidade' OR fi.observacao_importacao LIKE 'Rateio % sem cotas%'
      THEN fi.observacao_importacao END
  ), '') AS inconsistencia,
  fi.id AS linha_id,
  fi.rateio_erp AS rateio_erp,
  fi.integrante_empregado_id,
  CASE WHEN fi.integrante_empregado_id IS NULL THEN NULL ELSE public.fluxo_integrante_nome(fi.integrante_empregado_id) END AS integrante_nome
FROM public.fluxo_caixa_importado fi
LEFT JOIN public.financeiro_fluxo_caixa_ajuste aj
  ON aj.origem = 'importacao_historica' AND aj.despesa_id = COALESCE(fi.rateio_grupo_id, fi.id) AND aj.numero_parcela IS NULL
LEFT JOIN public.empresas e ON e.id = COALESCE(aj.empresa_id, fi.empresa_id)
LEFT JOIN public.contratos c ON c.id = fi.contrato_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = COALESCE(aj.classificacao_id, fi.classificacao_id)
LEFT JOIN public.malote_cartao_banco cb ON cb.id = COALESCE(aj.banco_id, fi.banco_id)
WHERE fi.deleted_at IS NULL AND fi.conferencia <> 'ja_existe_no_erp';

ALTER VIEW public.v_fluxo_caixa_importado_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_fluxo_caixa_importado_fluxo_caixa TO authenticated;

-- 3. tipo de evento novo no histórico do Fluxo
ALTER TABLE public.financeiro_fluxo_caixa_evento DROP CONSTRAINT IF EXISTS financeiro_fluxo_caixa_evento_tipo_check;
ALTER TABLE public.financeiro_fluxo_caixa_evento ADD CONSTRAINT financeiro_fluxo_caixa_evento_tipo_check
  CHECK (tipo IN ('rateio_criado', 'rateio_alterado', 'rateio_desfeito', 'excluido', 'restaurado', 'integrante_alterado'));

-- 4. troca do integrante: Malote (como na 0823) + importação da planilha
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
  IF _origem IS DISTINCT FROM 'malote' AND _origem IS DISTINCT FROM 'importacao_historica' THEN
    RAISE EXCEPTION 'Esta origem não permite trocar o integrante pelo Fluxo de Caixa (só Malote e importação da planilha).';
  END IF;

  SELECT e."Nome" INTO v_novo_nome FROM public."EMPREGADOS" e WHERE e."ID" = _empregado_id;
  IF v_novo_nome IS NULL THEN
    RAISE EXCEPTION 'Integrante não encontrado.';
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
      SELECT e."Nome" INTO v_antigo_nome FROM public."EMPREGADOS" e WHERE e."ID" = v_antigo;
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
    SELECT e."Nome" INTO v_antigo_nome FROM public."EMPREGADOS" e WHERE e."ID" = v_antigo;
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
