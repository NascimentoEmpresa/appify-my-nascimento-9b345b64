-- ============================================================================
-- SIS-2026-0751 — Fatura importada (BB, Banrisul, Bradesco...): 1 linha por fatura no Fluxo de Caixa
-- ============================================================================
-- Até aqui cada item da fatura importada virava uma linha própria no Fluxo, na data da compra (parcelas
-- antigas caíam em meses passados), mesmo sem classificação, e a linha de PAGAMENTO da fatura anterior
-- (valor negativo, ex.: "PGTO DEBITO CONTA") entrava como saída negativa. Agora, igual ao Sicredi 2719:
--   * a fatura só vai ao Fluxo quando TODOS os itens dela estão classificados (têm rateio por
--     Classificação/Contrato). Enquanto houver item pendente, não aparece no Fluxo;
--   * sai UMA linha por fatura, no dia do vencimento do cartão (mesma regra de vencimento da fatura
--     consolidada do Sicredi), com os itens abertos dentro dela e o rateio por contrato/classificação;
--   * item com valor <= 0 (pagamento da fatura anterior, estorno, crédito) não entra na soma nem
--     precisa de classificação — o rateio exige valor >= 0, então ele nunca poderia ser classificado.
-- Só muda a view v_cartao_fatura_fluxo_caixa: as 21 colunas de antes ficam na mesma ordem e ganham 8 no
-- fim (as mesmas que a view consolidada do Malote usa para a Fluxo abrir as despesas dentro da fatura).
-- Ajuste manual por item (financeiro_fluxo_caixa_ajuste, origem 'cartao_fatura') deixa de valer: a linha
-- é da fatura, não do item (a tela mostra "Ver no Cartão" nessas linhas, como no Sicredi).
-- Migration leve: pode rodar inteira de uma vez.
--
-- ROLLBACK: reaplicar a view de 20260930000276 (BLOCO 4, 1 linha por item).

CREATE OR REPLACE VIEW public.v_cartao_fatura_fluxo_caixa AS
WITH faturas_liberadas AS (
  -- Fatura importada, com ao menos 1 item que conta, e nenhum item que conta sem rateio.
  SELECT f.id AS fatura_id
    FROM public.malote_cartao_fatura f
   WHERE f.status = 'importada'
     AND EXISTS (
       SELECT 1 FROM public.malote_cartao_fatura_item fi
        WHERE fi.fatura_id = f.id AND fi.status = 'confirmado' AND fi.deleted_at IS NULL AND fi.valor > 0
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.malote_cartao_fatura_item fi
        WHERE fi.fatura_id = f.id AND fi.status = 'confirmado' AND fi.deleted_at IS NULL AND fi.valor > 0
          AND NOT EXISTS (SELECT 1 FROM public.malote_cartao_fatura_item_rateio r WHERE r.item_id = fi.id)
     )
), base AS (
  SELECT
    f.id AS fatura_id,
    f.competencia AS fatura_mes,
    cc.id AS cartao_id,
    cc.nome_cartao,
    cc.empresa_id,
    cc.tipo_forma_pagamento,
    cc.banco_id,
    -- mês do vencimento: se o vencimento é no mês seguinte ao fechamento, a fatura "09" vence em 10
    (f.competencia + CASE WHEN cc.dia_vencimento <= cc.dia_fechamento THEN interval '1 month' ELSE interval '0' END)::date AS venc_mes,
    cc.dia_vencimento
  FROM faturas_liberadas fl
  JOIN public.malote_cartao_fatura f ON f.id = fl.fatura_id
  JOIN public.malote_cartao_credito cc ON cc.id = f.cartao_id
)
SELECT
  md5('fatura-importada:' || b.fatura_id::text)::uuid AS despesa_id,
  b.nome_cartao || ' — fatura ' || to_char(b.venc_mes, 'MM/YYYY') AS id_malote,
  b.venc_mes + (LEAST(b.dia_vencimento, extract(day FROM (b.venc_mes + interval '1 month' - interval '1 day'))::int) - 1) AS data_pagamento,
  b.venc_mes AS competencia,
  b.empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  r.contrato_id,
  co.nome AS contrato_nome,
  r.classificacao_id,
  cl.nome AS classificacao_nome,
  'Fatura ' || b.nome_cartao || ' ' || to_char(b.venc_mes, 'MM/YYYY') AS descricao,
  b.tipo_forma_pagamento AS forma_pagamento,
  b.banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  NULL::int AS numero_parcela,
  NULL::int AS numero_parcelas,
  r.valor,
  'saida'::text AS tipo,
  'cartao_fatura'::text AS origem,
  false AS ajustado,
  -- a partir daqui: o mesmo contrato de colunas da fatura consolidada do Malote (a tela abre as despesas dentro da linha)
  b.cartao_id AS fatura_cartao_id,
  b.fatura_mes AS fatura_mes,
  fi.id AS despesa_id_origem,
  fi.parcela_atual AS numero_parcela_origem,
  b.nome_cartao || ' — ' || to_char(b.fatura_mes, 'MM/YYYY') AS id_malote_origem,
  fi.descricao AS descricao_origem,
  fi.parcela_total AS numero_parcelas_origem,
  fi.data_compra AS data_compra_origem
FROM base b
JOIN public.malote_cartao_fatura_item fi
  ON fi.fatura_id = b.fatura_id AND fi.status = 'confirmado' AND fi.deleted_at IS NULL AND fi.valor > 0
JOIN public.malote_cartao_fatura_item_rateio r ON r.item_id = fi.id
LEFT JOIN public.empresas e ON e.id = b.empresa_id
LEFT JOIN public.contratos co ON co.id = r.contrato_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = r.classificacao_id
LEFT JOIN public.malote_cartao_banco cb ON cb.id = b.banco_id;

ALTER VIEW public.v_cartao_fatura_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_cartao_fatura_fluxo_caixa TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   Reaplicar o CREATE OR REPLACE VIEW public.v_cartao_fatura_fluxo_caixa de
--   20260930000276_cartao_credito_classificacao_contrato_item.sql (BLOCO 4). As 8 colunas novas no fim saem
--   com um DROP VIEW + CREATE VIEW, pois CREATE OR REPLACE não remove coluna:
--     DROP VIEW IF EXISTS public.v_cartao_fatura_fluxo_caixa;
--     -- e então o CREATE VIEW do corpo de 20260930000276, com security_invoker e GRANT SELECT.
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
