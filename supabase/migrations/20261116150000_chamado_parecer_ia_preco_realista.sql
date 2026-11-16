-- =========================================================================
-- CHAMADOS: PREÇO DO PARECER DA I.A REALISTA (16/11/2026)
--
-- PEDIDO (Pablo, sobre o SIS-2026-0756 — pesquisa de permanência, 3/5 —
-- cotado a R$ 16.200 freelancer e R$ 35.100 software house): "no máximo uns
-- mil e poucos/dois mil", "18 mil e 35 mil é passamento", "tá puxando alto
-- de mais assim pra vários chamados, DEIXA REALISTA".
--
-- A conta inflava por três lados ao mesmo tempo: valor/hora de topo de faixa
-- (R$ 300 e R$ 450/h), horas "do zero, sem conhecer o ERP" (36 h e 52 h num
-- formulário) e a complexidade contada duas vezes (já sobe as horas e ainda
-- multiplicava o total: ×1,5 no nível 3, ×2,5 no 5).
--
-- O ERRO PRINCIPAL ERA DE HORAS (Pablo, mesmo dia): "nenhum freelancer ia
-- cobrar só 1280 por 16h, o problema real é: quem leva 16h pra fazer um
-- formulário? no máximo 8h seria". O valor/hora fica num preço real de
-- freelancer e o que cai são as horas.
--
-- REGRA NOVA (a mesma de supabase/functions/_shared/chamado-parecer-ia.ts;
-- o banco não lê o .ts, por isso os números se repetem aqui):
--   valor/hora ....... freelancer R$ 150 · software house R$ 225 · interno R$ 30
--   complexidade ..... NÃO multiplica mais (fator 1); limita as horas:
--   teto de horas .... nível 1 = 2 h · 2 = 4 h · 3 = 8 h · 4 = 16 h · 5 = 40 h
--   valor ............ horas (até o teto) × valor/hora
--   valor médio ...... média de freelancer e software house (sem o interno,
--                      que na tela é o card verde de custo real)
--
-- PARECERES JÁ GRAVADOS ("valores fixos depois de gerados"): refeitos aqui
-- com as horas e a complexidade que a I.A já tinha dado — sem chamar a I.A
-- de novo, então o texto (explicação, premissas) fica igual e só os números
-- mudam. SIS-2026-0756: 36 h e 52 h passam a 8 h (teto do nível 3) →
-- freelancer R$ 1.200, software house R$ 1.800, média R$ 1.500.
--
-- Bonificação: o critério Valor usa a régua relativa do mês (percentil 75),
-- então a nota quase não muda; o que cai é o valor/lucro exibido. Valor
-- digitado pelo gestor na avaliação não é tocado (fica em outra tabela).
-- =========================================================================
SET lock_timeout = '5s';

WITH tabela(perfil, valor_hora, embasamento) AS (
  VALUES
    ('freelancer',     150::numeric, 'Desenvolvedor PJ: valor/hora fixo de R$ 150 (valor comum de freelancer experiente no Brasil).'),
    ('software_house', 225::numeric, 'Software house: valor/hora fixo de R$ 225 (1,5× o freelancer, por gestão, impostos e margem).'),
    ('interno',        30::numeric,  'Desenvolvedor CLT, custo empresa com encargos: valor/hora fixo de R$ 30.')
), teto(nivel, horas) AS (
  VALUES (1, 2::numeric), (2, 4), (3, 8), (4, 16), (5, 40)
), novos AS (
  SELECT p.chamado_id,
         jsonb_agg(
           x.item || jsonb_build_object(
             'horas', h.horas,
             'valor_hora', t.valor_hora,
             'fator_complexidade', 1,
             'valor', round(h.horas * t.valor_hora, 2),
             'embasamento', t.embasamento)
           ORDER BY x.ord) AS precos
    FROM public."CHAMADO_SISTEMA_PARECER_IA" p
    CROSS JOIN LATERAL jsonb_array_elements(p.precos) WITH ORDINALITY AS x(item, ord)
    JOIN tabela t ON t.perfil = x.item->>'perfil'
    LEFT JOIN teto tt ON tt.nivel = p.complexidade_nivel
    CROSS JOIN LATERAL (
      SELECT round(least((x.item->>'horas')::numeric, coalesce(tt.horas, 40)), 1) AS horas
    ) h
   WHERE p.status = 'pronto'
     AND jsonb_typeof(p.precos) = 'array'
     AND (x.item->>'horas') ~ '^[0-9]+(\.[0-9]+)?$'
   GROUP BY p.chamado_id
  HAVING count(*) = 3
)
UPDATE public."CHAMADO_SISTEMA_PARECER_IA" p
   SET precos = n.precos,
       valor_medio = (SELECT round(avg((e->>'valor')::numeric), 2)
                        FROM jsonb_array_elements(n.precos) e WHERE e->>'perfil' <> 'interno'),
       horas_estimadas = (SELECT round(avg((e->>'horas')::numeric), 1)
                            FROM jsonb_array_elements(n.precos) e WHERE e->>'perfil' <> 'interno'),
       updated_at = now()
  FROM novos n
 WHERE n.chamado_id = p.chamado_id;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Não há volta exata: as horas acima do teto foram cortadas no próprio
-- parecer. Para voltar à regra anterior, devolver os chamados concluídos à
-- fila de reavaliação (como na mig 20261112230000, passo 3) com a Edge na
-- versão antiga (R$ 300/450/165 e FATOR_COMPLEXIDADE 1/1,2/1,5/2/2,5).
