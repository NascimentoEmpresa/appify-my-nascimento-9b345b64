-- =========================================================================
-- PARECER DA I.A: VALOR/HORA FIXO DE SÊNIOR E NÚMEROS QUE NÃO MUDAM
--
-- PEDIDO (29/10/2026, Pablo): "Toda vez que clica em gerar de novo altera os
-- valores, perdendo a credibilidade, e os valores estão baixos, aumenta, somos
-- desenvolvedores seniors. Mantém os valores fixos gerados, só explica os
-- valores e já era." O print era de um chamado a R$ 130/h (freelancer),
-- R$ 200/h (software house) e R$ 90/h (interno): a I.A escolhia o valor/hora
-- dentro de uma faixa larga, e cada geração caía num ponto diferente.
--
-- O que mudou no código (Edge chamado-parecer-ia + _shared):
--   * valor/hora deixou de vir da I.A: é a tabela fixa VALOR_HORA_SENIOR em
--     supabase/functions/_shared/chamado-parecer-ia.ts. A I.A estima só as
--     horas e a complexidade, com temperatura 0;
--   * parecer pronto não é refeito; o botão "Gerar de novo" saiu da tela.
--
-- Esta migration faz o recálculo ÚNICO dos pareceres já gravados, SEM chamar
-- a I.A: mantém as horas e a complexidade de cada perfil e aplica o valor/hora
-- novo. Os números abaixo REPETEM a tabela do _shared (o banco não lê o .ts) —
-- mudou lá, rode de novo este UPDATE com os números novos.
--   freelancer PJ sênior .................... R$ 200/h (faixa R$ 180–220)
--   software house, time sênior ............. R$ 320/h (faixa R$ 280–350)
--   interno sênior CLT, custo empresa ....... R$ 165/h (faixa R$ 150–180)
-- A explicação que citava o valor/hora antigo (R$ .../h) é trocada por uma
-- frase neutra, para o texto não contradizer o número novo.
-- =========================================================================

WITH tabela(perfil, valor_hora, embasamento) AS (
  VALUES
    ('freelancer',     200::numeric, 'Desenvolvedor sênior PJ: valor/hora fixo de R$ 200 (faixa de mercado de sênior: R$ 180 a R$ 220/h).'),
    ('software_house', 320::numeric, 'Software house com time sênior: valor/hora fixo de R$ 320 (faixa de mercado: R$ 280 a R$ 350/h; inclui gestão de projeto, impostos, margem e garantia).'),
    ('interno',        165::numeric, 'Desenvolvedor sênior CLT, custo empresa com encargos e benefícios: valor/hora fixo de R$ 165 (faixa: R$ 150 a R$ 180/h).')
), novos AS (
  SELECT p.chamado_id,
         jsonb_agg(
           x.item || jsonb_build_object(
             'valor_hora', t.valor_hora,
             'valor', round((x.item->>'horas')::numeric * t.valor_hora, 2),
             'embasamento', t.embasamento,
             'explicacao', CASE
               WHEN coalesce(x.item->>'explicacao', '') ~ '(R\$|/h|por hora)'
                 THEN 'Horas estimadas para um desenvolvedor sênior neste perfil.'
               ELSE coalesce(x.item->>'explicacao', '') END)
           ORDER BY x.ord) AS precos
    FROM public."CHAMADO_SISTEMA_PARECER_IA" p
    CROSS JOIN LATERAL jsonb_array_elements(p.precos) WITH ORDINALITY AS x(item, ord)
    JOIN tabela t ON t.perfil = x.item->>'perfil'
   WHERE p.status = 'pronto'
     AND jsonb_typeof(p.precos) = 'array'
     AND (x.item->>'horas') ~ '^[0-9]+(\.[0-9]+)?$'
   GROUP BY p.chamado_id
  HAVING count(*) = 3
)
UPDATE public."CHAMADO_SISTEMA_PARECER_IA" p
   SET precos = n.precos,
       valor_medio = (SELECT round(avg((e->>'valor')::numeric), 2) FROM jsonb_array_elements(n.precos) e),
       updated_at = now()
  FROM novos n
 WHERE n.chamado_id = p.chamado_id;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   Não há volta automática dos valores antigos (o valor/hora anterior não
--   fica guardado). Para conferir o recálculo de um chamado:
--     SELECT chamado_id, valor_medio, horas_estimadas, precos
--       FROM public."CHAMADO_SISTEMA_PARECER_IA" WHERE chamado_id = '<uuid>';
-- =========================================================================
