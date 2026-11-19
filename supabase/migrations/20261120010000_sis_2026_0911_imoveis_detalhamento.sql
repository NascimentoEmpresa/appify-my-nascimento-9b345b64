-- SIS-2026-0911 — Jurídico › Patrimônios › Imóveis Detalhamento
-- ============================================================================
-- Reúne, por imóvel, o que foi aplicado (aquisição + Investimentos/Obras) e o que foi gasto de manutenção, a partir dos lançamentos que JÁ existem no Fluxo de
-- Caixa (Malote, Débito Automático, unificados e importados). Nada é digitado de novo: o vínculo guarda só "este lançamento é deste imóvel"; valor, data e contrato
-- continuam sendo lidos das views do Fluxo, então corrigir na origem reflete na tela.
--
--   1. JUR_PATRIMONIOS.integrante_empregado_id : integrante do imóvel (mesma convenção do Fluxo: id do colaborador, -1 = Empresa).
--      O "valor médio estimado para venda" já existe no cadastro (JUR_PATRIMONIOS.valor_estimado) e o valor de aquisição é o valor_contrato: sem coluna nova.
--   2. financeiro_fluxo_caixa_patrimonio       : vínculo lançamento do Fluxo → imóvel (mesma chave de financeiro_fluxo_caixa_conta: origem + despesa + parcela).
--   3. juridico_imoveis_lancamentos(ini, fim)  : lançamentos de SAÍDA vinculados a imóveis no período, com o tratamento do contrato (investimento / obra / normal).
--      SECURITY DEFINER com porta própria (quem vê Patrimônios vê o detalhamento, sem precisar de acesso ao Fluxo de Caixa).
--
-- Idempotente. NOTIFY ao final.
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.juridico_imoveis_lancamentos(date, date);
--   DROP TABLE IF EXISTS public.financeiro_fluxo_caixa_patrimonio;
--   ALTER TABLE public."JUR_PATRIMONIOS" DROP COLUMN IF EXISTS integrante_empregado_id;

SET lock_timeout = '5s';

-- 1) integrante do imóvel
ALTER TABLE public."JUR_PATRIMONIOS" ADD COLUMN IF NOT EXISTS integrante_empregado_id integer;

-- 2) vínculo lançamento → imóvel
CREATE TABLE IF NOT EXISTS public.financeiro_fluxo_caixa_patrimonio (
  origem text NOT NULL CHECK (origem IN ('malote', 'debito_automatico', 'importacao_historica', 'unificado')),
  despesa_id uuid NOT NULL,
  parcela int NOT NULL DEFAULT 0, -- numero_parcela do lançamento; 0 = sem parcela
  patrimonio_id bigint NOT NULL REFERENCES public."JUR_PATRIMONIOS"(id) ON DELETE CASCADE,
  updated_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (origem, despesa_id, parcela)
);
CREATE INDEX IF NOT EXISTS financeiro_fluxo_caixa_patrimonio_patrimonio ON public.financeiro_fluxo_caixa_patrimonio (patrimonio_id);

ALTER TABLE public.financeiro_fluxo_caixa_patrimonio ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS financeiro_fluxo_caixa_patrimonio_select ON public.financeiro_fluxo_caixa_patrimonio;
CREATE POLICY financeiro_fluxo_caixa_patrimonio_select ON public.financeiro_fluxo_caixa_patrimonio
  FOR SELECT TO authenticated
  USING ((SELECT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'visualizar')) OR (SELECT public.can_access(auth.uid(), 'patrimonios', 'visualizar')));

DROP POLICY IF EXISTS financeiro_fluxo_caixa_patrimonio_insert ON public.financeiro_fluxo_caixa_patrimonio;
CREATE POLICY financeiro_fluxo_caixa_patrimonio_insert ON public.financeiro_fluxo_caixa_patrimonio
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'alterar')) OR (SELECT public.can_access(auth.uid(), 'patrimonios', 'alterar')));

DROP POLICY IF EXISTS financeiro_fluxo_caixa_patrimonio_update ON public.financeiro_fluxo_caixa_patrimonio;
CREATE POLICY financeiro_fluxo_caixa_patrimonio_update ON public.financeiro_fluxo_caixa_patrimonio
  FOR UPDATE TO authenticated
  USING ((SELECT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'alterar')) OR (SELECT public.can_access(auth.uid(), 'patrimonios', 'alterar')))
  WITH CHECK ((SELECT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'alterar')) OR (SELECT public.can_access(auth.uid(), 'patrimonios', 'alterar')));

DROP POLICY IF EXISTS financeiro_fluxo_caixa_patrimonio_delete ON public.financeiro_fluxo_caixa_patrimonio;
CREATE POLICY financeiro_fluxo_caixa_patrimonio_delete ON public.financeiro_fluxo_caixa_patrimonio
  FOR DELETE TO authenticated
  USING ((SELECT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'alterar')) OR (SELECT public.can_access(auth.uid(), 'patrimonios', 'alterar')));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.financeiro_fluxo_caixa_patrimonio TO authenticated;

-- 3) lançamentos de saída vinculados a imóveis
CREATE OR REPLACE FUNCTION public.juridico_imoveis_lancamentos(p_ini date DEFAULT NULL, p_fim date DEFAULT NULL)
RETURNS TABLE (
  patrimonio_id bigint,
  origem text,
  despesa_id uuid,
  numero_parcela int,
  id_malote text,
  data_pagamento date,
  competencia date,
  contrato_id uuid,
  contrato_nome text,
  tratamento_excecao text,
  classificacao_nome text,
  descricao text,
  valor numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'patrimonios', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Sem acesso a Patrimônios' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH l AS (
    SELECT m.origem, m.despesa_id, m.numero_parcela, m.id_malote, m.data_pagamento, m.competencia, m.contrato_id, m.contrato_nome, m.classificacao_nome, m.descricao, m.valor, m.tipo
      FROM public.v_malote_pagamento_fluxo_caixa m
    UNION ALL
    SELECT d.origem, d.despesa_id, d.numero_parcela, d.id_malote, d.data_pagamento, d.competencia, d.contrato_id, d.contrato_nome, d.classificacao_nome, d.descricao, d.valor, d.tipo
      FROM public.v_debito_automatico_fluxo_caixa d
    UNION ALL
    SELECT i.origem, i.despesa_id, i.numero_parcela, i.id_malote, i.data_pagamento, i.competencia, i.contrato_id, i.contrato_nome, i.classificacao_nome, i.descricao, i.valor, i.tipo
      FROM public.v_fluxo_caixa_importado_fluxo_caixa i
  )
  SELECT v.patrimonio_id, l.origem::text, l.despesa_id, l.numero_parcela, l.id_malote::text, l.data_pagamento::date, l.competencia::date, l.contrato_id,
         l.contrato_nome::text, t.tratamento::text, l.classificacao_nome::text, l.descricao::text, l.valor
    FROM public.financeiro_fluxo_caixa_patrimonio v
    JOIN l ON l.origem = v.origem AND l.despesa_id = v.despesa_id AND COALESCE(l.numero_parcela, 0) = v.parcela
    LEFT JOIN public.controladoria_contrato_tratamento t ON t.contrato_id = l.contrato_id
   WHERE l.tipo = 'saida'
     AND (p_ini IS NULL OR l.data_pagamento >= p_ini)
     AND (p_fim IS NULL OR l.data_pagamento <= p_fim)
   ORDER BY l.data_pagamento DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.juridico_imoveis_lancamentos(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.juridico_imoveis_lancamentos(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
