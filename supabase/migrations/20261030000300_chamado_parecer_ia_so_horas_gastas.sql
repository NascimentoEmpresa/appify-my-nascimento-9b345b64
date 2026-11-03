-- =========================================================================
-- PARECER DA I.A: SÓ AS HORAS GASTAS (30/10/2026)
--
-- Pablo, SIS-2026-0787: 8 h gastas informadas e o parecer cotando
-- Freelancer em 14 h (R$ 5.600) e Software house em 20 h (R$ 12.800) — só a
-- Equipe interna usava as 8 h. Regra nova: havendo horas gastas, os TRÊS
-- perfis e o valor médio usam essas horas; muda só o valor/hora fixo de cada
-- perfil. O validarParecer (supabase/functions/_shared/chamado-parecer-ia.ts)
-- já grava assim os pareceres novos; esta migration recalcula os gravados,
-- sem chamar a I.A: valor/hora e fator de complexidade continuam os de cada
-- preço; horas = horas gastas (1 casa, mínimo 0,5 h, como no .ts).
--
-- Sem horas gastas, o parecer fica como está (estimativa da I.A).
-- =========================================================================

WITH base AS (
  SELECT p.chamado_id,
         round(least(6000, greatest(0.5, c.horas_gastas)), 1) AS horas
    FROM public."CHAMADO_SISTEMA_PARECER_IA" p
    JOIN public."CHAMADO_SISTEMA" c ON c.id = p.chamado_id
   WHERE p.status = 'pronto'
     AND jsonb_typeof(p.precos) = 'array'
     AND c.horas_gastas > 0
), novos AS (
  SELECT b.chamado_id, b.horas,
         jsonb_agg(
           x.item || jsonb_build_object(
             'horas', b.horas,
             'valor', round(b.horas * (x.item->>'valor_hora')::numeric
                            * coalesce((x.item->>'fator_complexidade')::numeric, 1), 2))
           ORDER BY x.ord) AS precos
    FROM base b
    JOIN public."CHAMADO_SISTEMA_PARECER_IA" p ON p.chamado_id = b.chamado_id
    CROSS JOIN LATERAL jsonb_array_elements(p.precos) WITH ORDINALITY AS x(item, ord)
   WHERE (x.item->>'valor_hora') ~ '^[0-9]+(\.[0-9]+)?$'
     AND coalesce(x.item->>'fator_complexidade', '1') ~ '^[0-9]+(\.[0-9]+)?$'
   GROUP BY b.chamado_id, b.horas
  HAVING count(*) = 3
)
UPDATE public."CHAMADO_SISTEMA_PARECER_IA" p
   SET precos = n.precos,
       valor_medio = (SELECT round(avg((e->>'valor')::numeric), 2) FROM jsonb_array_elements(n.precos) e),
       horas_estimadas = n.horas,
       updated_at = now()
  FROM novos n
 WHERE n.chamado_id = p.chamado_id;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   Sem volta automática: as horas que a I.A estimou para freelancer e
--   software house foram sobrescritas pelas horas gastas. Para refazer um
--   parecer, apagar a linha em "CHAMADO_SISTEMA_PARECER_IA" e gerar de novo
--   pela tela do chamado (botão "Gerar parecer").
-- =========================================================================
