-- =========================================================================
-- LEITURA COMPACTA: as mesmas linhas, em formato colunar com dicionário
-- (04/11/2026 — pedido do Eduardo: otimizar as telas que baixam tudo)
--
-- O PROBLEMA, MEDIDO (log do Kong de 03/11 e teste de carga, docs/infra/)
--   v_fluxo_caixa_importado_fluxo_caixa ... 21.650 linhas, 17,5 MB por leitura
--   planilha_custo ........................ 1.909 linhas, ~4,5 MB, a rota mais
--                                           pesada do ERP (3,1 GB/dia, 11 telas)
--   v_malote_utilizado_orcamento .......... 5.038 linhas, 2,5 MB (15 telas)
--   O grosso não é dado: é o NOME das colunas repetido em cada linha (a
--   planilha tem ~120 colunas) e valores de pouquíssima variedade repetidos
--   milhares de vezes (6 empresas, 93 contratos, 100 classificações).
--
-- O QUE ISTO FAZ
--   Devolve EXATAMENTE as mesmas linhas, só que:
--     - colunar: os nomes das colunas uma vez só ("cols");
--     - dicionário: texto/uuid/data repetidos vêm uma vez em "dic" e a linha
--       carrega a posição (inteiro curto); número e booleano vão crus.
--   O navegador remonta objeto a objeto (src/lib/leituraCompacta.ts) e as
--   telas recebem o mesmo array de antes, campo a campo. Nenhuma regra de
--   negócio, total ou filtro muda — é só o jeito de transportar.
--
-- POR QUE FUNÇÕES NOVAS, E NÃO TROCAR AS ANTIGAS
--   Quem está com a tela aberta roda o bundle antigo, que espera o formato
--   antigo. O front novo tenta a compacta e, se ela ainda não existir, cai na
--   leitura de sempre (front e migration podem subir em qualquer ordem).
--
-- PROVA (antes de aplicar, na produção, só leitura, transação desfeita):
--   o corpo de leitura_compacta_sql (bloco GERADOR) é extraído DESTE arquivo
--   e executado como authenticated para usuários comuns reais; a saída
--   remontada é comparada com a leitura antiga linha a linha
--   (infra/qa/conferir-leitura-compacta.mjs). Resultado em
--   docs/infra/telas-pesadas.md.
--
-- CUSTO NO BANCO: o dicionário é montado sobre os valores DISTINTOS e ligado
-- por hash join. Uma 1a versão com dense_rank() OVER (ORDER BY coluna)
-- ordenava a tabela inteira por coluna: 287 -> 2.070 ms. Esta: 278 -> 392 ms
-- para mandar 76 % menos — e os 13 MB a menos deixam de passar por PostgREST,
-- Kong e o gzip do Caddy, que rodam na mesma máquina do banco.
--
-- Cercas: lista fechada de fontes em cada função pública, SECURITY INVOKER
-- (a RLS de quem lê continua decidindo), mesmo código de erro para view
-- ausente que o PostgREST daria (os .catch do front continuam valendo).
-- =========================================================================

-- O gerador: devolve o TEXTO da consulta compacta para uma fonte. Não executa
-- nada, então não abre dado nenhum — mas só é chamado pelas duas funções
-- abaixo, que conferem a lista fechada. p_ordem (opcional) é uma constante
-- dessas funções, nunca entrada do usuário.
CREATE OR REPLACE FUNCTION public.leitura_compacta_sql(p_fonte text, p_ordem text DEFAULT NULL)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
-- GERADOR-INICIO (o teste de equivalência extrai este bloco; $1 = fonte, $2 = ordem)
    WITH col AS (
      SELECT a.attnum, a.attname AS nome,
             -- Dicionário só onde o valor se repete: texto, uuid e data, MENOS as
             -- colunas quase únicas (uma por linha), em que ele não economiza nada
             -- e só custaria CPU. Número, booleano e json vão crus (json nem tem
             -- igualdade para o DISTINCT).
             a.atttypid NOT IN ('int2'::regtype, 'int4'::regtype, 'int8'::regtype,
                                'numeric'::regtype, 'float4'::regtype, 'float8'::regtype,
                                'bool'::regtype, 'json'::regtype, 'jsonb'::regtype,
                                'timestamptz'::regtype, 'timestamp'::regtype)
             AND a.attname NOT IN ('id', 'despesa_id', 'linha_id', 'id_malote',
                                   'despesa_id_origem', 'id_malote_origem') AS dic
        FROM pg_attribute a
       WHERE a.attrelid = to_regclass('public.' || quote_ident($1))
         AND a.attnum > 0 AND NOT a.attisdropped
    ),
    -- Cada valor da linha, e em qual pedaço de até 100 ele vai: função do
    -- Postgres aceita no máximo 100 argumentos, e a planilha_custo tem ~120
    -- colunas. Fonte com mais de 100 colunas manda a linha em pedaços
    -- ("partes": true) e o navegador emenda.
    el AS (
      SELECT attnum, (row_number() OVER (ORDER BY attnum) - 1) / 100 AS pedaco,
             CASE WHEN dic THEN format('d%s.i', attnum) ELSE format('b.%I', nome) END AS expr
        FROM col
    ),
    pedacos AS (
      SELECT pedaco, string_agg(expr, ', ' ORDER BY attnum) AS lista FROM el GROUP BY pedaco
    )
    SELECT format(
      $q$WITH b AS MATERIALIZED (SELECT * FROM public.%1$I)%2$s
      SELECT json_build_object(
        'v', 1,
        'partes', %8$s,
        'cols', %3$L::json,
        'dic', json_build_object(%4$s),
        'linhas', (SELECT coalesce(json_agg(json_build_array(%5$s)%7$s), '[]'::json) FROM b%6$s))$q$,
      $1,
      coalesce(string_agg(CASE WHEN dic THEN format(
        ', d%1$s AS (SELECT v, (row_number() OVER (ORDER BY v)) - 1 AS i FROM (SELECT DISTINCT %2$I AS v FROM b WHERE %2$I IS NOT NULL) x)',
        attnum, nome) END, '' ORDER BY attnum), ''),
      json_agg(nome ORDER BY attnum)::text,
      coalesce(string_agg(CASE WHEN dic THEN format(
        '%1$L, (SELECT coalesce(json_agg(v ORDER BY i), ''[]''::json) FROM d%2$s)', nome, attnum) END, ', ' ORDER BY attnum), ''),
      (SELECT CASE WHEN count(*) = 1 THEN min(lista)
                   ELSE string_agg('json_build_array(' || lista || ')', ', ' ORDER BY pedaco) END
         FROM pedacos),
      coalesce(string_agg(CASE WHEN dic THEN format(' LEFT JOIN d%1$s ON d%1$s.v = b.%2$I', attnum, nome) END, '' ORDER BY attnum), ''),
      CASE WHEN $2 IS NULL THEN '' ELSE ' ORDER BY ' || $2 END,
      (SELECT CASE WHEN count(*) > 1 THEN 'true' ELSE 'false' END FROM pedacos)
    )
    FROM col
-- GERADOR-FIM
$fn$;

REVOKE ALL ON FUNCTION public.leitura_compacta_sql(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leitura_compacta_sql(text, text) TO authenticated;

-- Fluxo de Caixa: as mesmas 8 fontes de fluxo_caixa_ler_fonte, sem ordem
-- (como lá: o hook reordena por data).
CREATE OR REPLACE FUNCTION public.fluxo_caixa_ler_fonte_compacta(p_fonte text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  resultado json;
BEGIN
  IF p_fonte IS NULL OR p_fonte NOT IN (
    'v_malote_pagamento_fluxo_caixa', 'v_malote_pagamento_fluxo_caixa_consolidado',
    'v_debito_automatico_fluxo_caixa', 'v_cartao_fatura_fluxo_caixa',
    'v_aplicacao_financeira_fluxo_caixa', 'v_aplicacao_financeira_resgate_fluxo_caixa',
    'v_fluxo_caixa_importado_fluxo_caixa', 'v_fluxo_caixa_previsto'
  ) THEN
    RAISE EXCEPTION 'fonte % não é do Fluxo de Caixa', p_fonte USING ERRCODE = '22023';
  END IF;
  IF to_regclass('public.' || quote_ident(p_fonte)) IS NULL THEN
    RAISE EXCEPTION 'relation "public.%" does not exist', p_fonte USING ERRCODE = '42P01';
  END IF;
  EXECUTE public.leitura_compacta_sql(p_fonte) INTO resultado;
  RETURN resultado;
END;
$$;

REVOKE ALL ON FUNCTION public.fluxo_caixa_ler_fonte_compacta(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fluxo_caixa_ler_fonte_compacta(text) TO authenticated;

-- Planilha de Custo e Orçamento utilizado do Malote: na MESMA ordem que as
-- telas pediam (created_at desc / data_pagamento desc, o padrão do PostgREST
-- para .order(..., { ascending: false }), que é NULLS FIRST).
CREATE OR REPLACE FUNCTION public.ler_compacto(p_fonte text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  ordem text;
  resultado json;
BEGIN
  ordem := CASE p_fonte
             WHEN 'planilha_custo'               THEN 'b.created_at DESC'
             WHEN 'v_malote_utilizado_orcamento' THEN 'b.data_pagamento DESC'
           END;
  IF ordem IS NULL THEN
    RAISE EXCEPTION 'fonte % não tem leitura compacta', p_fonte USING ERRCODE = '22023';
  END IF;
  IF to_regclass('public.' || quote_ident(p_fonte)) IS NULL THEN
    RAISE EXCEPTION 'relation "public.%" does not exist', p_fonte USING ERRCODE = '42P01';
  END IF;
  EXECUTE public.leitura_compacta_sql(p_fonte, ordem) INTO resultado;
  RETURN resultado;
END;
$$;

REVOKE ALL ON FUNCTION public.ler_compacto(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ler_compacto(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.ler_compacto(text);
-- DROP FUNCTION IF EXISTS public.fluxo_caixa_ler_fonte_compacta(text);
-- DROP FUNCTION IF EXISTS public.leitura_compacta_sql(text, text);
