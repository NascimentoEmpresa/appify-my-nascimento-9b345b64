-- Saídas por Contrato em R$, e a Lucratividade somando também a saída
-- reconstruída (SIS-2026-0769).
--
-- DECISÃO DA CEO, 10/11/2026, com layout aprovado. O quadro "Por contrato" da
-- tela de Saídas deixa de contar unidades por origem e passa a mostrar
-- quantidade E valor por categoria de item (uniforme, EPI, material de
-- limpeza, insumo, equipamento), com total por contrato. E o "Valor total" de
-- cada contrato ali TEM que ser o mesmo número que a coluna "Consumo de
-- Estoque" mostra para aquele contrato na Lucratividade, no mesmo período.
--
-- O QUE MUDA NA LUCRATIVIDADE, E POR QUE
--   sup_rel_consumo_custo_por_contrato nasceu em 20261109004000 contando só a
--   saída com pedido no ERP, de propósito: o contrato reconstruído dos exports
--   em Excel do sistema antigo não é registro do ERP. A ressalva era mais fraca
--   do que pareceu — o PREÇO sempre veio do cadastro do item aqui dentro; da
--   planilha vem só o DESTINO. Com a exigência de um número único, as duas
--   consultas passam a usar o mesmo contrato efetivo:
--     COALESCE(pedido.contrato_id, consumo.contrato_id_reconstruido)
--
-- POR QUE A IGUALDADE É ESTRUTURAL, E NÃO COINCIDÊNCIA
--   As duas somam a MESMA expressão sobre as MESMAS três tabelas:
--   quantidade × COALESCE(valor_unitario, 0), vindo de sup_estoque_consumo,
--   sup_pedido e sup_estoque_item. Item que entrou no estoque sem preço vale
--   zero NAS DUAS: os totais continuam batendo e os dois ficam subestimados
--   juntos. É por isso que a Lucratividade avisa quantas unidades saíram sem
--   preço, em vez de esconder o furo — e esse aviso não pode sair de lá sem
--   quebrar a leitura do número.
--
-- A saída sem contrato nenhum (nem pedido nem export) continua fora da
-- Lucratividade: não existe linha de contrato a que atribuí-la. Ela aparece na
-- tela de Suprimentos como "(sem contrato identificado)" e no aviso de
-- cobertura do mês, que é onde ela tem sentido.
--
-- Maio/2026 segue em ~54% de cobertura e isso não melhora: o mês cai no vão
-- entre o export de 27/04 e o de 23/06, confirmado pelo setor em 30/10/2026.
-- O valor de maio é o que dá para saber, não o que aconteceu.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sup_rel_saidas_por_contrato(date, date, uuid, uuid);
--   -- e recriar a versão de 20261105012000 (sem a coluna `valor`), e
--   -- sup_rel_consumo_custo_por_contrato como estava em 20261109004000
--   -- (JOIN interno em sup_pedido, sem o COALESCE do reconstruído).
--   NOTIFY pgrst, 'reload schema';

SET lock_timeout = '5s';

-- A assinatura de RETURNS TABLE muda (ganha `valor`), e Postgres não aceita
-- CREATE OR REPLACE trocando as colunas de saída: tem que ser DROP + CREATE.
-- Dentro da mesma transação, então não existe janela sem a função.
DROP FUNCTION IF EXISTS public.sup_rel_saidas_por_contrato(date, date, uuid, uuid);

CREATE FUNCTION public.sup_rel_saidas_por_contrato(
  p_inicio      date,
  p_fim         date,
  p_contrato_id uuid DEFAULT NULL,
  p_empresa_id  uuid DEFAULT NULL
)
RETURNS TABLE (
  competencia    text,
  contrato_id    uuid,
  contrato_nome  text,
  sup_item_id    uuid,
  item_nome      text,
  item_codigo    text,
  item_tipo      text,
  quantidade     bigint,
  valor          numeric,
  origem         text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT to_char(c.consumido_em, 'YYYY-MM')                      AS competencia,
         COALESCE(p.contrato_id, c.contrato_id_reconstruido)      AS contrato_id,
         COALESCE(p.contrato_nome, ct.nome, '(sem contrato identificado)') AS contrato_nome,
         i.id                                                     AS sup_item_id,
         COALESCE(i.nome, '(material removido)')                  AS item_nome,
         i.codigo                                                 AS item_codigo,
         i.tipo                                                   AS item_tipo,
         sum(c.quantidade)::bigint                                AS quantidade,
         -- Mesma expressão de sup_rel_consumo_custo_por_contrato, abaixo. As
         -- duas têm que somar igual: é o que a CEO pediu.
         sum(c.quantidade * COALESCE(ei.valor_unitario, 0))::numeric AS valor,
         CASE
           WHEN p.id IS NOT NULL                       THEN 'sistema'
           WHEN c.contrato_id_reconstruido IS NOT NULL THEN 'planilha:' || COALESCE(c.contrato_origem, '?')
           ELSE 'sem_destino'
         END                                                      AS origem
    FROM public.sup_estoque_consumo c
    LEFT JOIN public.sup_pedido        p  ON p.id  = c.pedido_id
    LEFT JOIN public.contratos         ct ON ct.id = c.contrato_id_reconstruido
    -- Contrato EFETIVO da linha (do pedido ou reconstruído): é dele que sai a
    -- empresa. `ct` acima só serve para o nome do contrato reconstruído.
    LEFT JOIN public.contratos         ce ON ce.id = COALESCE(p.contrato_id, c.contrato_id_reconstruido)
    LEFT JOIN public.sup_estoque_item  ei ON ei.id = c.item_estoque_id
    LEFT JOIN public.sup_item          i  ON i.id  = ei.sup_item_id
   WHERE (public.has_screen_access(auth.uid(), 'sup_rel_saidas_contrato', 'visualizar')
          OR public.has_screen_access(auth.uid(), 'sup_dashboard_compras_estoque', 'visualizar'))
     AND c.consumido_em >= p_inicio::timestamptz
     AND c.consumido_em <  (p_fim + 1)::timestamptz
     AND (p_contrato_id IS NULL
          OR COALESCE(p.contrato_id, c.contrato_id_reconstruido) = p_contrato_id)
     AND (p_empresa_id IS NULL OR ce.empresa_id = p_empresa_id)
   GROUP BY 1, 2, 3, 4, 5, 6, 7, 10
   ORDER BY 1, 3, 5;
$$;

REVOKE ALL ON FUNCTION public.sup_rel_saidas_por_contrato(date, date, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_rel_saidas_por_contrato(date, date, uuid, uuid) TO authenticated;

-- Lucratividade: mesmo contrato efetivo da consulta acima. As colunas de saída
-- não mudam, então CREATE OR REPLACE basta.
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
         COALESCE(p.contrato_id, c.contrato_id_reconstruido)                AS contrato_id,
         sum(c.quantidade * COALESCE(ei.valor_unitario, 0))::numeric        AS valor,
         sum(c.quantidade)::bigint                                          AS unidades,
         sum(CASE WHEN COALESCE(ei.valor_unitario, 0) = 0
                  THEN c.quantidade ELSE 0 END)::bigint                     AS unidades_sem_valor
    FROM public.sup_estoque_consumo c
    -- LEFT, e não JOIN: desde 10/11/2026 a saída reconstruída do export conta
    -- aqui também, e ela não tem pedido.
    LEFT JOIN public.sup_pedido        p  ON p.id  = c.pedido_id
    LEFT JOIN public.sup_estoque_item  ei ON ei.id = c.item_estoque_id
   WHERE public.has_screen_access(auth.uid(), 'lucratividade-contratos', 'visualizar')
     AND COALESCE(p.contrato_id, c.contrato_id_reconstruido) IS NOT NULL
     AND c.consumido_em >= p_inicio::timestamptz
     AND c.consumido_em <  (p_fim + 1)::timestamptz
   GROUP BY 1, 2
   ORDER BY 1, 2;
$$;

REVOKE ALL ON FUNCTION public.sup_rel_consumo_custo_por_contrato(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_rel_consumo_custo_por_contrato(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
