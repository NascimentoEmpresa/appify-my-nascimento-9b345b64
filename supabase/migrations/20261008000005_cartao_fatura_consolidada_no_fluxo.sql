-- ============================================================================
-- SIS-2026-0632 — Cartão Sicredi 2719: 1 linha por fatura no Fluxo de Caixa
-- ============================================================================
-- Hoje cada despesa de Malote paga no cartão vira uma linha própria no Fluxo, no
-- dia da compra (ou, nas parcelas, no dia do vencimento). O pedido: a despesa
-- NÃO aparece no dia da compra; no dia do VENCIMENTO da fatura sai UMA linha com
-- o total da fatura, e as despesas aparecem rateadas dentro dela (o Fluxo já
-- agrupa por despesa_id e mostra "Rateio" expansível por contrato). A despesa
-- continua `despesa_paga` no Malote (decisão: só a visão do Fluxo muda). Exclusivo
-- do cartão 2719 — por flag no cadastro do cartão, não por código fixo.
--
-- 1. malote_cartao_credito.fatura_consolidada_fluxo (liga no 2719 aqui).
-- 2. malote_cartao_fatura ganha o VALOR REAL DA FATURA (digitado, a partir do
--    boleto) e o anexo do boleto — para comparar com a soma das despesas.
-- 3. fn_cartoes_fatura_consolidada(): lista (só os cartões com a flag) para quem
--    não tem acesso ao cadastro de cartões — a RLS de malote_cartao_credito exige
--    'financeiro-cartao-credito'; sem isto o Fluxo consolidaria só para quem tem.
-- 4. v_malote_pagamento_fluxo_caixa_consolidado: o Fluxo lê daqui. A view original
--    (v_malote_pagamento_fluxo_caixa) NÃO muda — a tela de Cartão de Crédito e os
--    demais consumidores continuam vendo 1 linha por despesa.
--
-- Qual fatura recebe a despesa (mesma regra de calcularFatura, front): compra até
-- o dia do fechamento entra na fatura do próprio mês, depois dele no mês seguinte.
-- PARCELA do Malote cuja data cai no dia do VENCIMENTO do cartão (parcelas 2, 3...,
-- dia do desconto) já traz a data do vencimento: a fatura é o mês dessa data. A
-- parcela 1 tem a data da compra (ex.: 28/09) e segue a regra da compra à vista. Vencimento = dia_vencimento do cartão no mês da fatura (mês
-- seguinte se dia_vencimento <= dia_fechamento).
--
-- EXECUTAR EM BLOCOS, UM DE CADA VEZ (marcados "BLOCO n"): o ALTER TABLE compete com
-- sessões do painel do Supabase (deadlock 40P01). Cada bloco é idempotente.
--
-- ROLLBACK:
--   DROP VIEW IF EXISTS public.v_malote_pagamento_fluxo_caixa_consolidado;
--   DROP FUNCTION IF EXISTS public.fn_cartoes_fatura_consolidada();
--   ALTER TABLE public.malote_cartao_fatura DROP COLUMN valor_fatura_informado, DROP COLUMN boleto_path,
--     DROP COLUMN boleto_nome, DROP COLUMN boleto_anexado_em, DROP COLUMN boleto_anexado_por;
--   ALTER TABLE public.malote_cartao_credito DROP COLUMN fatura_consolidada_fluxo;

-- ── BLOCO 1 ──
SET lock_timeout = '8s';
ALTER TABLE public.malote_cartao_credito
  ADD COLUMN IF NOT EXISTS fatura_consolidada_fluxo boolean NOT NULL DEFAULT false;

-- ── BLOCO 2 ──
SET lock_timeout = '8s';
ALTER TABLE public.malote_cartao_fatura
  ADD COLUMN IF NOT EXISTS valor_fatura_informado numeric,
  ADD COLUMN IF NOT EXISTS boleto_path text,
  ADD COLUMN IF NOT EXISTS boleto_nome text,
  ADD COLUMN IF NOT EXISTS boleto_anexado_em timestamptz,
  ADD COLUMN IF NOT EXISTS boleto_anexado_por uuid;

-- ── BLOCO 3 ──
-- Liga o cartão Sicredi final 2719.
UPDATE public.malote_cartao_credito
   SET fatura_consolidada_fluxo = true
 WHERE final_cartao = '2719' AND tipo_forma_pagamento ILIKE '%2719%';

-- O retorno ganhou final_cartao: recria a função (e a view que depende dela, no BLOCO 4).
DROP VIEW IF EXISTS public.v_malote_pagamento_fluxo_caixa_consolidado;
DROP FUNCTION IF EXISTS public.fn_cartoes_fatura_consolidada();
CREATE FUNCTION public.fn_cartoes_fatura_consolidada()
RETURNS TABLE (cartao_id uuid, nome_cartao text, tipo_forma_pagamento text, dia_fechamento int, dia_vencimento int, final_cartao text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id, c.nome_cartao, c.tipo_forma_pagamento, c.dia_fechamento, c.dia_vencimento, c.final_cartao
    FROM public.malote_cartao_credito c
   WHERE c.fatura_consolidada_fluxo AND c.ativo;
$$;
REVOKE ALL ON FUNCTION public.fn_cartoes_fatura_consolidada() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_cartoes_fatura_consolidada() TO authenticated;

-- Remover o boleto da fatura apaga o arquivo do bucket (só havia select/insert).
DROP POLICY IF EXISTS cartao_faturas_delete ON storage.objects;
CREATE POLICY cartao_faturas_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'cartao-faturas' AND public.can_access(auth.uid(), 'financeiro-cartao-credito', 'alterar'::public.app_acao));

-- ── BLOCO 4 ──
SET lock_timeout = '8s';
CREATE OR REPLACE VIEW public.v_malote_pagamento_fluxo_caixa_consolidado AS
WITH x AS (
  SELECT
    v.*,
    cc.cartao_id AS cc_cartao_id,
    cc.nome_cartao AS cc_nome,
    cc.dia_vencimento AS cc_venc,
    CASE
      WHEN cc.cartao_id IS NULL OR v.data_pagamento IS NULL THEN NULL
      -- parcela datada no dia do vencimento -> fatura = mês dessa data (menos 1 se o vencimento cai no mês seguinte ao fechamento)
      WHEN v.numero_parcela IS NOT NULL AND extract(day FROM v.data_pagamento)::int = cc.dia_vencimento THEN
        (date_trunc('month', v.data_pagamento)::date
          - CASE WHEN cc.dia_vencimento <= cc.dia_fechamento THEN interval '1 month' ELSE interval '0' END)::date
      -- compra à vista: depois do fechamento entra na fatura do mês seguinte
      ELSE
        (date_trunc('month', v.data_pagamento)::date
          + CASE WHEN extract(day FROM v.data_pagamento) > cc.dia_fechamento THEN interval '1 month' ELSE interval '0' END)::date
    END AS fat_mes,
    cc.dia_fechamento AS cc_fech
  FROM public.v_malote_pagamento_fluxo_caixa v
  -- O mesmo cartão existe no catálogo de formas de pagamento com dois nomes ("Sicredi Final
  -- 2719 - (Usado no Malote)" e "Cartão de Crédito Sicredi HAGG 119 - Final 2719 - (Usado no
  -- Malote)"): casa pelo nome do cadastro OU pelo final do cartão no nome da forma.
  LEFT JOIN public.fn_cartoes_fatura_consolidada() cc
    ON cc.tipo_forma_pagamento = v.forma_pagamento
    OR (cc.final_cartao IS NOT NULL AND v.forma_pagamento ILIKE '%final ' || cc.final_cartao || '%')
), y AS (
  SELECT
    x.*,
    CASE WHEN x.fat_mes IS NULL THEN NULL
         ELSE (x.fat_mes + CASE WHEN x.cc_venc <= x.cc_fech THEN interval '1 month' ELSE interval '0' END)::date
    END AS venc_mes
  FROM x
)
SELECT
  CASE WHEN y.fat_mes IS NULL THEN y.despesa_id
       ELSE md5('fatura-cartao:' || y.cc_cartao_id::text || ':' || y.fat_mes::text)::uuid END AS despesa_id,
  CASE WHEN y.fat_mes IS NULL THEN y.id_malote
       ELSE y.cc_nome || ' — fatura ' || to_char(y.venc_mes, 'MM/YYYY') END AS id_malote,
  CASE WHEN y.fat_mes IS NULL THEN y.data_pagamento
       ELSE y.venc_mes + (LEAST(y.cc_venc,
              extract(day FROM (y.venc_mes + interval '1 month' - interval '1 day'))::int) - 1) END AS data_pagamento,
  CASE WHEN y.fat_mes IS NULL THEN y.competencia ELSE y.venc_mes END AS competencia,
  y.empresa_id,
  y.empresa_nome,
  y.contrato_id,
  y.contrato_nome,
  y.classificacao_id,
  y.classificacao_nome,
  CASE WHEN y.fat_mes IS NULL THEN y.descricao
       ELSE 'Fatura ' || y.cc_nome || ' ' || to_char(y.venc_mes, 'MM/YYYY') END AS descricao,
  y.forma_pagamento,
  y.banco_id,
  y.banco_nome,
  y.banco_logo_path,
  CASE WHEN y.fat_mes IS NULL THEN y.numero_parcela ELSE NULL END AS numero_parcela,
  CASE WHEN y.fat_mes IS NULL THEN y.numero_parcelas ELSE NULL END AS numero_parcelas,
  y.valor,
  y.tipo,
  y.origem,
  y.ajustado,
  -- marcadores novos (só no fim): quem consome decide a UI da linha consolidada
  y.cc_cartao_id AS fatura_cartao_id,
  y.fat_mes AS fatura_mes,
  y.despesa_id AS despesa_id_origem,
  y.numero_parcela AS numero_parcela_origem,
  -- identificação da despesa de origem (a linha consolidada troca id/descrição pelos da
  -- fatura): o Fluxo abre a fatura mostrando cada despesa (DM-xxx, descrição, valor)
  y.id_malote AS id_malote_origem,
  y.descricao AS descricao_origem,
  y.numero_parcelas AS numero_parcelas_origem,
  -- data da COMPRA da despesa (Ruan): à vista = a própria data; parcelada = a data da 1ª parcela
  MIN(y.data_pagamento) OVER (PARTITION BY y.despesa_id) AS data_compra_origem
FROM y;

ALTER VIEW public.v_malote_pagamento_fluxo_caixa_consolidado SET (security_invoker = true);
GRANT SELECT ON public.v_malote_pagamento_fluxo_caixa_consolidado TO authenticated;

NOTIFY pgrst, 'reload schema';
