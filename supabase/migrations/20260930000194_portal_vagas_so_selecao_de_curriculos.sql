-- =========================================================================
-- Portal público /vagas: só a vaga em "Vaga aberta - Seleção de Currículos"
--
-- PEDIDO (18/09/2026, Pablo): o site mostrava "33 oportunidades" porque a
-- lista excluía só alguns status (pendentes, reprovada, concluída, contratado)
-- e deixava passar vaga em análise jurídica, entrevista, documentação,
-- SST + Compras — vagas que já têm candidato e não aceitam inscrição.
-- A candidatura (portal_candidatar_v2) já recusava fora de "Seleção de
-- Currículos"; agora a LISTA e as CIDADES seguem a mesma régua.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.portal_cidades_com_vagas()
RETURNS TABLE(cidade text, vagas bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT btrim(s."cidade") AS cidade, count(*) AS vagas
    FROM public."SISTEMA_RECRUTAMENTO" s
   WHERE s."status" = 'Vaga aberta - Seleção de Currículos'
     AND btrim(coalesce(s."cidade",'')) <> ''
   GROUP BY 1
   ORDER BY 1;
$function$;

CREATE OR REPLACE FUNCTION public.portal_vagas_por_cidade(p_cidade text)
RETURNS TABLE(id integer, cargo text, contrato text, cidade text, escala text, salario text, beneficios text, quantidade_vagas integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT s."id", s."cargo", s."contrato", s."cidade", s."escala",
         s."salario", s."beneficios", s."quantidade_vagas"
    FROM public."SISTEMA_RECRUTAMENTO" s
   WHERE s."status" = 'Vaga aberta - Seleção de Currículos'
     AND btrim(lower(s."cidade")) = btrim(lower(coalesce(p_cidade, '')))
   ORDER BY s."cargo";
$function$;

NOTIFY pgrst, 'reload schema';

-- Conferência:
-- SELECT sum(vagas) FROM public.portal_cidades_com_vagas();

-- =========================================================================
-- ROLLBACK: reaplicar as duas funções da 20260906000016 (NOT IN dos status).
-- =========================================================================
