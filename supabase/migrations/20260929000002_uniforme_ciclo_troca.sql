-- =========================================================================
-- Ciclo de troca de uniforme — dois sinais, não um
--
-- A regra veio do Eduardo em 26/08/2026, e ela tem dois lados que costumam ser
-- confundidos num alerta só:
--
--   1. INFORMATIVO — passaram 12 meses desde a última entrega de uniforme
--      daquele colaborador, então a troca é devida. Quem foi admitido em
--      novembro fica com uma muda só naquele ano e entra no ciclo no ano
--      seguinte; isso sai de graça ao contar a partir da ÚLTIMA ENTREGA em vez
--      do ano-calendário.
--
--   2. ANOMALIA — mais de 2 entregas numa janela de 12 meses. Aqui o alerta é
--      de excesso, não de atraso. Receber MENOS que o previsto nunca alerta:
--      nas palavras dele, "aqui para a empresa é até economia e mais lucro
--      nesse caso".
--
-- POR QUE JANELA CORRIDA E NÃO ANO-CALENDÁRIO
-- Três entregas em dezembro e janeiro cairiam em anos diferentes e passariam
-- despercebidas num corte por ano-calendário. A janela de 12 meses corridos a
-- partir de hoje pega esse caso, que é justamente o padrão de quem está
-- abusando.
--
-- O QUE CONTA COMO "UMA MUDA"
-- Um evento de entrega — um `sup_pedido` distinto que tenha pelo menos um item
-- de tipo 'uniforme' com etiqueta marcada como usada. Contar etiqueta a
-- etiqueta superestimaria (uma muda são camisa + calça + botina, três
-- etiquetas de um mesmo evento). O limite é parâmetro, não constante, porque
-- essa definição é a que tem mais chance de o Cassio querer refinar depois —
-- separar reposição avulsa de muda completa, por exemplo.
--
-- Idempotente.
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sup_uniforme_ciclo_colaborador(text, integer, integer);
--   DROP FUNCTION IF EXISTS public.sup_uniforme_ciclo(integer, integer);
-- =========================================================================

-- ── 1) Panorama de todos os colaboradores ────────────────────────────────
-- Uma linha por matrícula, com os dois sinais já resolvidos. É o que alimenta
-- a tela e, mais adiante, a notificação do worker.

CREATE OR REPLACE FUNCTION public.sup_uniforme_ciclo(
  p_meses_ciclo   integer DEFAULT 12,
  p_limite_janela integer DEFAULT 2
)
RETURNS TABLE (
  matricula           text,
  colaborador         text,
  contrato_id         uuid,
  entregas_janela     integer,
  ultima_entrega      date,
  meses_desde_ultima  integer,
  troca_devida        boolean,
  excesso             boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  WITH entregas AS (
    -- Uma linha POR PEDIDO, não por etiqueta: um pedido é um evento de
    -- entrega, mesmo que tenha trazido cinco peças. O GROUP BY aqui é o que
    -- garante isso — agrupar depois, no nível da matrícula, contaria a mesma
    -- entrega várias vezes quando as etiquetas foram baixadas em datas
    -- diferentes.
    SELECT
      p.id                            AS pedido_id,
      btrim(p.matricula_colaborador)  AS matricula,
      p.nome_colaborador              AS colaborador,
      p.contrato_id                   AS contrato_id,
      max(t.usado_em::date)           AS entregue_em
    FROM public.sup_estoque_tag t
    JOIN public.sup_pedido      p  ON p.id  = t.pedido_id
    JOIN public.sup_pedido_item pi ON pi.id = t.pedido_item_id
    JOIN public.sup_item        i  ON i.id  = pi.item_id
    WHERE t.usado
      AND t.usado_em IS NOT NULL
      AND i.tipo = 'uniforme'
      AND btrim(COALESCE(p.matricula_colaborador, '')) <> ''
    GROUP BY p.id, btrim(p.matricula_colaborador), p.nome_colaborador, p.contrato_id
  ),
  por_matricula AS (
    SELECT
      e.matricula,
      max(e.colaborador) AS colaborador,
      (array_agg(e.contrato_id ORDER BY e.entregue_em DESC))[1] AS contrato_id,
      count(*) FILTER (
        WHERE e.entregue_em > CURRENT_DATE - (p_meses_ciclo || ' months')::interval
      )::integer AS entregas_janela,
      max(e.entregue_em) AS ultima_entrega
    FROM entregas e
    GROUP BY e.matricula
  )
  SELECT
    m.matricula,
    m.colaborador,
    m.contrato_id,
    m.entregas_janela,
    m.ultima_entrega,
    (EXTRACT(YEAR FROM age(CURRENT_DATE, m.ultima_entrega)) * 12
     + EXTRACT(MONTH FROM age(CURRENT_DATE, m.ultima_entrega)))::integer,
    m.ultima_entrega <= CURRENT_DATE - (p_meses_ciclo || ' months')::interval,
    m.entregas_janela > p_limite_janela
  FROM por_matricula m;
$fn$;

-- ── 2) Detalhe de um colaborador ─────────────────────────────────────────
-- Para a tela abrir o "por quê" de um alerta: quais foram as entregas que
-- entraram na conta. Sem isso o encarregado vê "excesso" e não tem como
-- contestar nem confirmar.

CREATE OR REPLACE FUNCTION public.sup_uniforme_ciclo_colaborador(
  p_matricula     text,
  p_meses_ciclo   integer DEFAULT 12,
  p_limite_janela integer DEFAULT 2
)
RETURNS TABLE (
  id              uuid,
  protocolo       text,
  entregue_em     date,
  pecas           integer,
  na_janela       boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  -- `p.pedido_id` é o protocolo em texto (PD-AAAA-NNNN), não a FK: em
  -- sup_pedido a coluna `pedido_id` é o número visível, enquanto em
  -- sup_pedido_item o `pedido_id` é o uuid. Nomes iguais, papéis opostos.
  SELECT
    p.id,
    p.pedido_id,
    max(t.usado_em::date),
    count(*)::integer,
    max(t.usado_em::date) > CURRENT_DATE - (p_meses_ciclo || ' months')::interval
  FROM public.sup_estoque_tag t
  JOIN public.sup_pedido      p  ON p.id  = t.pedido_id
  JOIN public.sup_pedido_item pi ON pi.id = t.pedido_item_id
  JOIN public.sup_item        i  ON i.id  = pi.item_id
  WHERE t.usado
    AND t.usado_em IS NOT NULL
    AND i.tipo = 'uniforme'
    AND btrim(COALESCE(p.matricula_colaborador, '')) = btrim(COALESCE(p_matricula, ''))
    AND btrim(COALESCE(p_matricula, '')) <> ''
  GROUP BY p.id, p.pedido_id
  ORDER BY 3 DESC;
$fn$;

-- ── 3) Privilégios ───────────────────────────────────────────────────────
-- Reaproveita o menu do histórico do colaborador (0208), que já é a tela onde
-- essa informação faz sentido aparecer — não cria menu novo.

REVOKE ALL ON FUNCTION public.sup_uniforme_ciclo(integer, integer)                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_uniforme_ciclo_colaborador(text, integer, integer)     FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_uniforme_ciclo(integer, integer)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_uniforme_ciclo_colaborador(text, integer, integer)  TO authenticated;

NOTIFY pgrst, 'reload schema';
