-- =========================================================================
-- Site institucional: números ao vivo (anon)
--
-- PEDIDO (18/09/2026, Pablo): o site mostrava "2.227 colaboradores" fixo no
-- código; tem que puxar os ATIVOS NO MÊS do dashboard de Colaboradores
-- (hoje 2.478). Aqui entra uma RPC pública, só com agregados — nada de nome,
-- CPF ou salário — pra página (que é pública, sem login) ler pelo anon.
--
--   colaboradores = presença no mês corrente, a MESMA régua de
--                   rh_colaboradores_dashboard ("ativos_mes"): admitido até o
--                   fim do mês e, se saiu, saiu dentro do mês ou depois.
--   contratos     = CONTRATOS."ATIVO" = 'SIM'
--   empresas      = empresas distintas entre os ativos do mês
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.site_numeros()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  WITH lim AS (
    SELECT date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date AS ini,
           (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')) + interval '1 month' - interval '1 day')::date AS fim
  ),
  v AS (
    SELECT public.rh_data(e."Admissão"::text) AS admissao,
           public.rh_data(e."Data Afastamento"::text) AS afastamento,
           (btrim(coalesce(e."Situação", '')) ~* '(DEMIT|DESLIG|RESCIS|APOSENT)') AS eh_saida,
           coalesce(public.rh_empresa(e."Empresa"::text, e."Nome da Empresa"), '—') AS empresa
      FROM public."EMPREGADOS" e
  ),
  ativos AS (
    SELECT * FROM v, lim
     WHERE (admissao IS NULL OR admissao <= lim.fim)
       AND (NOT eh_saida OR (afastamento IS NOT NULL AND afastamento >= lim.ini))
  )
  SELECT jsonb_build_object(
    'colaboradores', (SELECT count(*) FROM ativos),
    'contratos',     (SELECT count(*) FROM public."CONTRATOS" WHERE "ATIVO" = 'SIM'),
    'empresas',      (SELECT count(DISTINCT empresa) FROM ativos WHERE empresa <> '—'),
    'mes',           to_char((SELECT ini FROM lim), 'YYYY-MM'),
    'atualizado_em', now()
  );
$fn$;
REVOKE ALL ON FUNCTION public.site_numeros() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.site_numeros() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.site_numeros();
-- NOTIFY pgrst, 'reload schema';
