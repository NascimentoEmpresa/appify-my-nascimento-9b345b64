-- Consumo de estoque por contrato, para a Lucratividade (SIS-2026-0769).
--
-- Coluna INFORMATIVA ao lado das despesas: quanto de material saiu do estoque
-- para cada contrato no mês, em reais. NÃO entra no Total de Custos nem no
-- Lucro Bruto, e a tela diz isso.
--
-- Por que não entra na soma, embora seja custo de verdade:
--   Hoje a compra de material já é lançada no contrato. Medido em 09/11/2026,
--   de 01/09 em diante, a grande maioria das compras de MATERIAL DE LIMPEZA,
--   UNIFORMES e EPI'S do malote foi lançada direto num contrato real, e só uma
--   fração no contrato ADMINISTRATIVO de estoque, que fica fora das despesas
--   de contrato. Somar a saída de estoque por cima disso cobraria o mesmo
--   material duas vezes no mesmo contrato. Os números da medição estão no
--   chamado SIS-2026-0769, não aqui: este repositório é público.
--
--   O desenho certo (compra pousa no contrato ESTOQUE, a saída debita o
--   contrato real) está sendo adotado pelo setor. Quando a prática virar, esta
--   coluna passa a poder somar — e aí é trocar a regra na tela, não refazer a
--   consulta.
--
-- SÓ CONTA SAÍDA COM PEDIDO DE VERDADE. O contrato reconstruído a partir dos
-- exports em Excel do sistema antigo (contrato_id_reconstruido, criado em
-- 20261103001000) serve para medir VOLUME, não dinheiro: é dado de boa
-- procedência, mas não é registro do ERP, e numa conta de lucratividade essa
-- diferença importa. Por isso aqui o contrato vem só de sup_pedido.
--
-- `unidades_sem_valor` existe para a tela avisar: parte das saídas de setembro
-- para cá está sem preço (item com valor_unitario zerado). Sem o aviso, o
-- contrato apareceria recebendo material de graça.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sup_rel_consumo_custo_por_contrato(date, date);
--   NOTIFY pgrst, 'reload schema';

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.sup_rel_consumo_custo_por_contrato(
  p_inicio date,
  p_fim    date
)
RETURNS TABLE (
  competencia        text,
  contrato_id        uuid,
  valor              numeric,
  unidades           bigint,
  unidades_sem_valor bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT to_char(c.consumido_em, 'YYYY-MM')                                AS competencia,
         p.contrato_id                                                      AS contrato_id,
         sum(c.quantidade * COALESCE(ei.valor_unitario, 0))::numeric        AS valor,
         sum(c.quantidade)::bigint                                          AS unidades,
         sum(CASE WHEN COALESCE(ei.valor_unitario, 0) = 0
                  THEN c.quantidade ELSE 0 END)::bigint                     AS unidades_sem_valor
    FROM public.sup_estoque_consumo c
    JOIN public.sup_pedido         p  ON p.id  = c.pedido_id
    LEFT JOIN public.sup_estoque_item ei ON ei.id = c.item_estoque_id
   WHERE public.has_screen_access(auth.uid(), 'lucratividade-contratos', 'visualizar')
     AND p.contrato_id IS NOT NULL
     AND c.consumido_em >= p_inicio::timestamptz
     AND c.consumido_em <  (p_fim + 1)::timestamptz
   GROUP BY 1, 2
   ORDER BY 1, 2;
$$;

REVOKE ALL ON FUNCTION public.sup_rel_consumo_custo_por_contrato(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_rel_consumo_custo_por_contrato(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
