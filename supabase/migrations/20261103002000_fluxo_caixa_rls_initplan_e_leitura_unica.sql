-- ============================================================================
-- Fluxo de Caixa derrubando o ERP (03/11/2026) — RLS por linha + leitura única
--
-- O INCIDENTE
--
-- Manhã de 03/11: a API passou a responder 503 PGRST002 ("Could not query the
-- database for the schema cache") em ondas, e o app mostrava a tela "Aguarde"
-- para todo mundo. O banco1 estava com carga 19 (1,4 às 8h36), sem nenhuma
-- consulta presa: ~12 consultas do app ativas o tempo todo, de 1 a 3 s cada.
-- Amostrando pg_stat_activity a cada segundo, ~25% do tempo era o Fluxo de
-- Caixa (useFluxoCaixaMalote.ts), que baixa 6 views inteiras de 1000 em 1000.
--
-- POR QUE CADA PÁGINA CUSTAVA TANTO
--
-- As policies das tabelas por trás das views chamavam can_access /
-- has_screen_access LINHA POR LINHA. A chamada não depende da linha (só de
-- auth.uid() e de constantes), mas sem o `(SELECT ...)` em volta o Postgres
-- não sabe disso e a reavalia para cada linha, ~1,5-5 ms cada (ela passa por
-- perfil_acesso, erp_login_bloqueado...). Medido com a RLS da Erica
-- (Controladoria), EXPLAIN ANALYZE:
--
--   financeiro_fluxo_caixa_ajuste   925 linhas   1,35 s só no Seq Scan
--   "DEBITO_AUTOMATICO"            1094 linhas   5,1 s só no Index Scan
--   malote_despesa (consolidada)   4069 linhas   ~2,5 s no filtro
--
-- E como a tela paginava com ORDER BY + OFFSET, cada página montava e
-- ordenava a view INTEIRA de novo: ~19 s de banco por abertura do Fluxo,
-- repetidos a cada edição (invalidateQueries de Conciliação/Cartão/Aplicação).
--
-- O QUE MUDA
--
-- 1) Nas tabelas que as views do Fluxo leem, toda chamada de permissão sem
--    argumento de linha vira `(SELECT chamada)` — InitPlan, avaliado UMA vez
--    por consulta. É o mesmo padrão que fluxo_caixa_importado_select já usava
--    (e por isso a importação era a única view rápida no filtro). O resultado
--    é idêntico: a função é STABLE e os argumentos são constantes dentro da
--    consulta. ALTER POLICY mantém nome, comando, papéis e PERMISSIVE.
--    Só entram chamadas cujos argumentos são auth.uid() e literais — qualquer
--    coisa com coluna da linha (user_pode_ver_empresa(auth.uid(), empresa_id))
--    fica como está.
--
-- 2) fluxo_caixa_ler_fonte(p_fonte): devolve a view inteira em UMA consulta
--    (json_agg), sem ORDER BY — o cliente já reordena por data_pagamento, e
--    uma consulta só não tem o problema de página repetir/pular linha que
--    obrigou o ORDER BY (SIS-2026-0038/0569). SECURITY INVOKER: a RLS do
--    usuário continua valendo, igual ao select da view. Lista fechada de
--    views — não é um "select em qualquer coisa".
--
-- Não toca dado nenhum. Só as 531 policies do mesmo formato no resto do banco
-- ficam para outra migration (outros módulos, fora do Fluxo).
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.fluxo_caixa_ler_fonte(text);
--   -- as policies: o `(SELECT ...)` é semanticamente igual; para desfazer,
--   -- ALTER POLICY <nome> ON <tabela> USING (<expressão sem o SELECT>).
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================

SET lock_timeout = '5s';

-- 1) Policies: chamada de permissão sem coluna da linha -> InitPlan ----------

DO $$
DECLARE
  -- Chamada de permissão cujos argumentos são só auth.uid() e literais.
  chamada constant text :=
    '\m(can_access|has_screen_access|has_role|malote_gerente_financeiro)\(auth\.uid\(\)(, ''[^'']*''::[a-z_]+)*\)|\mmalote_pode_pagar\(\)';
  p record;
  novo_qual text;
  novo_check text;
  n int := 0;
BEGIN
  FOR p IN
    SELECT pol.polname, c.relname, pg_get_expr(pol.polqual, pol.polrelid) AS qual,
           pg_get_expr(pol.polwithcheck, pol.polrelid) AS wcheck
      FROM pg_policy pol
      JOIN pg_class c ON c.oid = pol.polrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public'
       AND c.relname IN (
         'APLICACAO_FINANCEIRA', 'APLICACAO_FINANCEIRA_RESGATE_CAIXA', 'DEBITO_AUTOMATICO',
         'financeiro_fluxo_caixa_ajuste', 'fluxo_caixa_importado',
         'malote_cartao_banco', 'malote_cartao_credito', 'malote_cartao_fatura',
         'malote_cartao_fatura_item', 'malote_cartao_fatura_item_rateio',
         'malote_despesa', 'malote_despesa_parcela', 'malote_despesa_rateio_linha')
  LOOP
    -- Tira o embrulho que já existir e embrulha tudo de novo: assim rodar a
    -- migration duas vezes não vira `(SELECT (SELECT ...))`.
    novo_qual := regexp_replace(
      regexp_replace(p.qual, '\( SELECT (' || chamada || ') AS [a-z_]+\)', '\1', 'g'),
      '(' || chamada || ')', '(SELECT \1)', 'g');
    novo_check := regexp_replace(
      regexp_replace(p.wcheck, '\( SELECT (' || chamada || ') AS [a-z_]+\)', '\1', 'g'),
      '(' || chamada || ')', '(SELECT \1)', 'g');

    -- Só mexe se havia alguma chamada fora de SELECT.
    IF coalesce(regexp_count(p.qual, chamada), 0) > coalesce(regexp_count(p.qual, '\( SELECT (' || chamada || ') AS '), 0)
       OR coalesce(regexp_count(p.wcheck, chamada), 0) > coalesce(regexp_count(p.wcheck, '\( SELECT (' || chamada || ') AS '), 0)
    THEN
      IF novo_qual IS NOT NULL THEN
        EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)', p.polname, p.relname, novo_qual);
      END IF;
      IF novo_check IS NOT NULL THEN
        EXECUTE format('ALTER POLICY %I ON public.%I WITH CHECK (%s)', p.polname, p.relname, novo_check);
      END IF;
      n := n + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'policies do Fluxo de Caixa com permissao em InitPlan: %', n;
END $$;

-- 2) Leitura única das views do Fluxo ----------------------------------------

CREATE OR REPLACE FUNCTION public.fluxo_caixa_ler_fonte(p_fonte text)
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
  -- Mesmo código que o PostgREST devolve para view ausente: os .catch do
  -- hook que tratam migration não aplicada continuam funcionando.
  IF to_regclass('public.' || quote_ident(p_fonte)) IS NULL THEN
    RAISE EXCEPTION 'relation "public.%" does not exist', p_fonte USING ERRCODE = '42P01';
  END IF;
  EXECUTE format('SELECT coalesce(json_agg(t), ''[]''::json) FROM public.%I t', p_fonte) INTO resultado;
  RETURN resultado;
END;
$$;

REVOKE ALL ON FUNCTION public.fluxo_caixa_ler_fonte(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fluxo_caixa_ler_fonte(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fluxo_caixa_ler_fonte(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
