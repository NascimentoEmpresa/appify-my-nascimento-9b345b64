-- Saídas por Contrato também como aba do Dashboard de Compras (SIS-2026-0769).
--
-- Duas mudanças nas RPCs criadas em 20261103001000, as duas por causa da aba
-- nova dentro de /app/suprimentos/dashboard:
--
-- 1) O PORTÃO passa a aceitar DOIS códigos de menu. As RPCs são SECURITY
--    DEFINER e gateavam só por 'sup_rel_saidas_contrato'. O Dashboard de
--    Compras tem menu próprio ('sup_dashboard_compras_estoque') e hoje chega a
--    12 pessoas, contra 7 do relatório. Sem o OR, quem enxerga o Dashboard mas
--    não tem o menu do relatório abriria a aba e veria uma TABELA VAZIA — não
--    um erro, porque permissão negada aqui devolve zero linha, igual a "não
--    houve saída no período". Mentir em silêncio numa tela de rentabilidade é
--    pior do que esconder a aba. Mesmo padrão já usado na Implantação, que
--    responde a dois códigos de menu.
--
-- 2) FILTRO POR EMPRESA em sup_rel_saidas_por_contrato. O Dashboard tem
--    seletor de empresa ("Todas" ou uma das 6) e as outras abas respeitam. Sem
--    o parâmetro, a aba de saídas ignoraria o seletor e mostraria o grupo
--    inteiro com o nome de uma empresa em cima. Todos os 103 contratos têm
--    empresa_id, então o recorte é confiável.
--
--    Saída SEM contrato identificado fica FORA quando se filtra por empresa:
--    não há como atribuí-la a uma empresa sem inventar. Por isso a tela avisa,
--    quando há empresa selecionada, que o "sem destino" não entra na conta.
--
-- `sup_rel_saidas_cobertura` NÃO recebe o filtro de empresa, de propósito: ela
-- é justamente o aviso de que parte do mês não tem destino conhecido. Filtrada
-- por empresa, as linhas sem destino desapareceriam e a cobertura passaria a
-- dizer 100% sempre — o oposto do que ela existe para contar.
--
-- DROP antes de CREATE porque a assinatura muda: deixar as duas versões
-- conviverem faria a chamada de 3 argumentos virar ambígua, e o PostgREST
-- chama por nome de parâmetro.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sup_rel_saidas_por_contrato(date, date, uuid, uuid);
--   -- e recriar as duas funções a partir de 20261103001000
--   -- (a versão de lá, com portão de um menu só e sem p_empresa_id).
--   NOTIFY pgrst, 'reload schema';

SET lock_timeout = '5s';

-- ---------------------------------------------------------------- relatório

DROP FUNCTION IF EXISTS public.sup_rel_saidas_por_contrato(date, date, uuid);

CREATE OR REPLACE FUNCTION public.sup_rel_saidas_por_contrato(
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
   GROUP BY 1, 2, 3, 4, 5, 6, 7, 9
   ORDER BY 1, 3, 5;
$$;

REVOKE ALL ON FUNCTION public.sup_rel_saidas_por_contrato(date, date, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_rel_saidas_por_contrato(date, date, uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------- cobertura
-- Mesmo corpo de 20261103001000; só o portão muda, para a aba do Dashboard
-- não mostrar o aviso vazio para quem chega por lá.

CREATE OR REPLACE FUNCTION public.sup_rel_saidas_cobertura(
  p_inicio date,
  p_fim    date
)
RETURNS TABLE (
  competencia      text,
  unidades_total   bigint,
  unidades_sistema bigint,
  unidades_planilha bigint,
  unidades_sem_destino bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT to_char(c.consumido_em, 'YYYY-MM') AS competencia,
         sum(c.quantidade)::bigint,
         sum(c.quantidade) FILTER (WHERE c.pedido_id IS NOT NULL)::bigint,
         sum(c.quantidade) FILTER (WHERE c.pedido_id IS NULL
                                     AND c.contrato_id_reconstruido IS NOT NULL)::bigint,
         sum(c.quantidade) FILTER (WHERE c.pedido_id IS NULL
                                     AND c.contrato_id_reconstruido IS NULL)::bigint
    FROM public.sup_estoque_consumo c
   WHERE (public.has_screen_access(auth.uid(), 'sup_rel_saidas_contrato', 'visualizar')
          OR public.has_screen_access(auth.uid(), 'sup_dashboard_compras_estoque', 'visualizar'))
     AND c.consumido_em >= p_inicio::timestamptz
     AND c.consumido_em <  (p_fim + 1)::timestamptz
   GROUP BY 1
   ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION public.sup_rel_saidas_cobertura(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_rel_saidas_cobertura(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
