-- ============================================================================
-- [SEM-CHAMADO] Débito Automático no cartão alimenta a fatura consolidada do Fluxo de Caixa
-- ============================================================================
-- O Malote paga no cartão com "fatura consolidada no Fluxo" (Sicredi 2719) e a despesa vira item da
-- fatura (migration 20261008000005). O Débito Automático com a forma de pagamento desse mesmo cartão
-- ("Sicredi Final 2719 - (Usado no Malote)") continuava como linha avulsa no dia do débito. Agora
-- segue a mesma regra das parcelas do Malote:
--   * débito datado no DIA DO VENCIMENTO do cartão (ex.: 15/10) = pagamento daquela fatura (juros, IOF,
--     anuidade, parcela do mês...): entra na fatura que vence nessa data. A data só existe por causa do
--     cartão; a data de criação do registro NÃO serve (lançam tudo de uma vez e as parcelas nascem juntas).
--   * débito em qualquer outro dia = data da compra: até o dia do fechamento entra na fatura do mês,
--     depois dele na do mês seguinte.
--
-- Só muda a view v_malote_pagamento_fluxo_caixa_consolidado (a fonte passa a ser Malote + Débito
-- Automático pagos). Débito de outra forma de pagamento, e débito de ENTRADA, não são tocados: seguem
-- como linhas próprias, pela view v_debito_automatico_fluxo_caixa. Quem consome (useFluxoCaixaCombinado)
-- tira dessa lista os débitos que já vieram dentro da fatura, para não somar duas vezes.
--
-- Migration leve (só recria uma view): pode rodar inteira de uma vez no SQL Editor.
--
-- ROLLBACK: reaplicar a view de 20261008000005 (BLOCO 4).

CREATE OR REPLACE VIEW public.v_malote_pagamento_fluxo_caixa_consolidado AS
WITH fonte AS (
  SELECT despesa_id, id_malote, data_pagamento, competencia, empresa_id, empresa_nome, contrato_id, contrato_nome,
         classificacao_id, classificacao_nome, descricao, forma_pagamento, banco_id, banco_nome, banco_logo_path,
         numero_parcela, numero_parcelas, valor, tipo, origem, ajustado
    FROM public.v_malote_pagamento_fluxo_caixa
  UNION ALL
  SELECT despesa_id, id_malote, data_pagamento, competencia, empresa_id, empresa_nome, contrato_id, contrato_nome,
         classificacao_id, classificacao_nome, descricao, forma_pagamento, banco_id, banco_nome, banco_logo_path,
         numero_parcela, numero_parcelas, valor, tipo, origem, ajustado
    FROM public.v_debito_automatico_fluxo_caixa
), x AS (
  SELECT
    v.*,
    cc.cartao_id AS cc_cartao_id,
    cc.nome_cartao AS cc_nome,
    cc.dia_vencimento AS cc_venc,
    CASE
      WHEN cc.cartao_id IS NULL OR v.data_pagamento IS NULL THEN NULL
      -- parcela datada no dia do vencimento -> fatura = mês dessa data (menos 1 se o vencimento cai no mês seguinte ao fechamento)
      WHEN (v.numero_parcela IS NOT NULL OR v.origem = 'debito_automatico')
           AND extract(day FROM v.data_pagamento)::int = cc.dia_vencimento THEN
        (date_trunc('month', v.data_pagamento)::date
          - CASE WHEN cc.dia_vencimento <= cc.dia_fechamento THEN interval '1 month' ELSE interval '0' END)::date
      -- compra à vista (e débito automático): depois do fechamento entra na fatura do mês seguinte
      ELSE
        (date_trunc('month', v.data_pagamento)::date
          + CASE WHEN extract(day FROM v.data_pagamento) > cc.dia_fechamento THEN interval '1 month' ELSE interval '0' END)::date
    END AS fat_mes,
    cc.dia_fechamento AS cc_fech
  FROM fonte v
  -- Casa pelo nome do cadastro OU pelo final do cartão no nome da forma (o mesmo cartão tem dois nomes no catálogo).
  -- Débito automático: só SAÍDA vai para a fatura.
  LEFT JOIN public.fn_cartoes_fatura_consolidada() cc
    ON (v.origem <> 'debito_automatico' OR v.tipo = 'saida')
   AND (cc.tipo_forma_pagamento = v.forma_pagamento
        OR (cc.final_cartao IS NOT NULL AND v.forma_pagamento ILIKE '%final ' || cc.final_cartao || '%'))
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
  -- a linha da fatura é sempre "malote" (a fatura mistura despesas e débitos; as ações da tela não valem para ela)
  CASE WHEN y.fat_mes IS NULL THEN y.origem ELSE 'malote' END AS origem,
  y.ajustado,
  y.cc_cartao_id AS fatura_cartao_id,
  y.fat_mes AS fatura_mes,
  y.despesa_id AS despesa_id_origem,
  y.numero_parcela AS numero_parcela_origem,
  y.id_malote AS id_malote_origem,
  y.descricao AS descricao_origem,
  y.numero_parcelas AS numero_parcelas_origem,
  MIN(y.data_pagamento) OVER (PARTITION BY y.despesa_id) AS data_compra_origem
FROM y
-- Débito automático que não é da fatura (outra forma de pagamento, ou entrada) NÃO sai por aqui: vem da própria view dele.
WHERE y.origem <> 'debito_automatico' OR y.fat_mes IS NOT NULL;

ALTER VIEW public.v_malote_pagamento_fluxo_caixa_consolidado SET (security_invoker = true);
GRANT SELECT ON public.v_malote_pagamento_fluxo_caixa_consolidado TO authenticated;

NOTIFY pgrst, 'reload schema';
