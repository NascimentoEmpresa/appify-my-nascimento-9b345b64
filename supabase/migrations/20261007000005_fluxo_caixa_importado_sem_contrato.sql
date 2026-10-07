-- ============================================================================
-- Fluxo de Caixa — "Sem contrato (administrativo)" confirmado na revisão
-- ============================================================================
-- Linhas importadas da planilha com contrato "INVESTIMENTOS" / "DESPESAS
-- CONTRATOS" não casam com nenhum contrato, e o selo "Contrato não mapeado"
-- nunca saía: a RPC de troca só aceita contrato de verdade. Agora o Financeiro
-- pode CONFIRMAR, na revisão, que o lançamento não pertence a contrato
-- (administrativo). É uma decisão registrada — o contrato_id continua nulo —,
-- e o selo de contrato some. Escolher um contrato real depois desfaz a marca.
--
-- Depende de 20261007000004 (view sem selo de anotação de carga).
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS fci_limpa_sem_contrato ON public.fluxo_caixa_importado;
--   DROP FUNCTION IF EXISTS public.fci_limpa_sem_contrato();
--   DROP FUNCTION IF EXISTS public.fluxo_caixa_importado_sem_contrato(uuid, boolean);
--   (recriar a view com a definição de 20261007000004_fluxo_caixa_importado_selo_so_pendencia.sql)
--   ALTER TABLE public.fluxo_caixa_importado DROP COLUMN IF EXISTS sem_contrato_confirmado;
--   NOTIFY pgrst, 'reload schema';

SET lock_timeout = '5s';

ALTER TABLE public.fluxo_caixa_importado
  ADD COLUMN IF NOT EXISTS sem_contrato_confirmado boolean NOT NULL DEFAULT false;

-- Escolher um contrato real desfaz a confirmação de "sem contrato".
CREATE OR REPLACE FUNCTION public.fci_limpa_sem_contrato()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.contrato_id IS NOT NULL THEN
    NEW.sem_contrato_confirmado := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fci_limpa_sem_contrato ON public.fluxo_caixa_importado;
CREATE TRIGGER fci_limpa_sem_contrato
  BEFORE UPDATE OF contrato_id ON public.fluxo_caixa_importado
  FOR EACH ROW EXECUTE FUNCTION public.fci_limpa_sem_contrato();

CREATE OR REPLACE FUNCTION public.fluxo_caixa_importado_sem_contrato(_linha_id uuid, _confirmado boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_contrato uuid;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar o Fluxo de Caixa.';
  END IF;

  SELECT fi.contrato_id INTO v_contrato
    FROM public.fluxo_caixa_importado fi
   WHERE fi.id = _linha_id AND fi.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento importado não encontrado.';
  END IF;
  IF _confirmado AND v_contrato IS NOT NULL THEN
    RAISE EXCEPTION 'O lançamento já tem contrato.';
  END IF;

  UPDATE public.fluxo_caixa_importado SET sem_contrato_confirmado = _confirmado WHERE id = _linha_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fluxo_caixa_importado_sem_contrato(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fluxo_caixa_importado_sem_contrato(uuid, boolean) TO authenticated;

-- View: mesma definição de 20261007000004; só o selo de contrato respeita a confirmação.
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
  fi.id AS linha_id
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

NOTIFY pgrst, 'reload schema';
