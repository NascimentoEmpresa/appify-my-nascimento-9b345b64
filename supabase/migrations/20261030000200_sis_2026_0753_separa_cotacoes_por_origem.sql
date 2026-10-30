-- SIS-2026-0753 — separa cotações por pessoa e por origem
--
-- O dashboard somava no mesmo gráfico dois fatos diferentes:
--   1. solicitações com cotação enviada em Cotações do Malote;
--   2. respostas enviadas em Cotações para Licitação.
-- Isso fazia o número parecer a quantidade de propostas (até três) de cada
-- processo do Malote. As novas séries mantêm as fontes independentes e deixam
-- explícito que uma solicitação do Malote conta uma vez, ainda que carregue
-- três propostas de fornecedores.
--
-- O nome também passa a ser agrupado sem diferenciar caixa e espaços repetidos.
-- Assim, "CLEIDIR PEIXOTO GOULART" e "Cleidir Peixoto Goulart" ocupam a mesma
-- barra. A série combinada antiga permanece no JSON por compatibilidade.
--
-- ROLLBACK:
--   Restaurar public.sup_dashboard_compras_estoque a partir da definição-base
--   de 20261007000001 e reaplicar, em ordem, os hotfixes anteriores desta RPC.
-- ============================================================================

DO $bloco$
DECLARE
  v_definicao text;
  v_origem text;
  v_destino text;
BEGIN
  SELECT pg_get_functiondef(
    'public.sup_dashboard_compras_estoque(uuid,date,date,uuid,text,text)'::regprocedure
  ) INTO v_definicao;

  IF v_definicao IS NULL THEN
    RAISE EXCEPTION 'Função sup_dashboard_compras_estoque não encontrada.';
  END IF;

  v_origem := $trecho$
      'cotacoes_por_comprador', COALESCE((
$trecho$;

  v_destino := $trecho$
      'cotacoes_malote_por_comprador', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.quantidade DESC, x.nome)
          FROM (
            SELECT
              CASE
                WHEN n.nome_normalizado = '__nao_informado__' THEN 'Não informado'
                ELSE initcap(n.nome_normalizado)
              END AS nome,
              n.quantidade
            FROM (
              SELECT
                COALESCE(
                  NULLIF(
                    regexp_replace(lower(btrim(cotacao_enviada_por_nome)), '\s+', ' ', 'g'),
                    ''
                  ),
                  '__nao_informado__'
                ) AS nome_normalizado,
                count(*)::int AS quantidade
              FROM cotacoes_malote
              GROUP BY 1
            ) n
            ORDER BY n.quantidade DESC, n.nome_normalizado
            LIMIT 10
          ) x
      ), '[]'::jsonb),
      'cotacoes_licitacao_por_comprador', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.quantidade DESC, x.nome)
          FROM (
            SELECT
              CASE
                WHEN n.nome_normalizado = '__nao_informado__' THEN 'Não informado'
                ELSE initcap(n.nome_normalizado)
              END AS nome,
              n.quantidade
            FROM (
              SELECT
                COALESCE(
                  NULLIF(
                    regexp_replace(lower(btrim(respondente_nome)), '\s+', ' ', 'g'),
                    ''
                  ),
                  '__nao_informado__'
                ) AS nome_normalizado,
                count(*)::int AS quantidade
              FROM cotacoes_licitacao
              GROUP BY 1
            ) n
            ORDER BY n.quantidade DESC, n.nome_normalizado
            LIMIT 10
          ) x
      ), '[]'::jsonb),
      'cotacoes_por_comprador', COALESCE((
$trecho$;

  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Ancora do grafico combinado de cotacoes por comprador nao encontrada.';
  END IF;

  v_definicao := replace(v_definicao, v_origem, v_destino);
  EXECUTE v_definicao;
END;
$bloco$;

NOTIFY pgrst, 'reload schema';
