-- =========================================================================
-- MALOTE — "primeira linha do rateio" numa chamada só (03/11/2026, ~19h UTC)
--
-- POR QUE ESTA MIGRATION EXISTE
--   Quarta queda do dia (503 PGRST002). Vigia do cluster às 19:00 UTC:
--   banco1 com carga 21,56 para 2 vCPU, 64/120 conexões. Amostrando
--   pg_stat_activity 20 vezes (1 s), 53 de 144 consultas ativas eram a MESMA
--   leitura de "malote_despesa_rateio_linha":
--     select despesa_id, contrato_id|empresa_id, ordem ... in(despesa_id)
--     order by despesa_id, ordem
--   A 20261103004200 (Eduardo, 15:24) já tinha baixado o custo de CADA
--   leitura; o problema que sobrou é a QUANTIDADE. A tabela seguia somando
--   varreduras de índice (71,24 M → 72,26 M em poucas horas).
--
-- DE ONDE VEM O LEQUE
--   src/hooks/useMaloteDespesa.ts · buscarTodasLinhasRateio: quebra os ids da
--   lista em lotes de 40 (limite de URL do gateway, 19/10/2026) e dispara
--   TODOS os lotes em paralelo. Pagamento Malote e Aprovações chamam isso três
--   vezes (empresa, classificação e contrato da primeira linha). Com ~1.900
--   despesas visíveis são ~48 lotes × 3 = ~140 requisições simultâneas, cada
--   uma pagando a RLS (EXISTS em malote_despesa, que tem RLS própria) —
--   150–300 ms cada, medido com usuário comum. Em 2 vCPU, isso é a fila.
--
-- O QUE MUDA
--   malote_rateio_primeira_linha(uuid[]): as três respostas de uma vez, por
--   POST (sem limite de URL), numa consulta. Medido na produção com o mesmo
--   usuário comum, ROLLBACK: 1.880 despesas → 230 ms, UMA vez.
--   SECURITY INVOKER de propósito: a RLS da tabela continua decidindo o que
--   cada um vê — a função não abre nada que o select direto não abriria.
--   Semântica igual à de antes: para cada coluna, o valor da linha de menor
--   `ordem` que o tenha preenchido (cada coluna independente da outra, como
--   eram as três consultas).
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.malote_rateio_primeira_linha(p_despesa_ids uuid[])
RETURNS TABLE (despesa_id uuid, empresa_id uuid, classificacao_id uuid, contrato_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
  SELECT l.despesa_id,
         (array_agg(l.empresa_id       ORDER BY l.ordem, l.id) FILTER (WHERE l.empresa_id       IS NOT NULL))[1],
         (array_agg(l.classificacao_id ORDER BY l.ordem, l.id) FILTER (WHERE l.classificacao_id IS NOT NULL))[1],
         (array_agg(l.contrato_id      ORDER BY l.ordem, l.id) FILTER (WHERE l.contrato_id      IS NOT NULL))[1]
    FROM public.malote_despesa_rateio_linha l
   WHERE l.despesa_id = ANY (p_despesa_ids)
   GROUP BY l.despesa_id
$$;
REVOKE ALL ON FUNCTION public.malote_rateio_primeira_linha(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.malote_rateio_primeira_linha(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.malote_rateio_primeira_linha(uuid[]);
-- NOTIFY pgrst, 'reload schema';
