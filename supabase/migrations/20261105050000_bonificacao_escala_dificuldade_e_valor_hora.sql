-- =========================================================================
-- BONIFICAÇÃO: ESCALA DE DIFICULDADE DA EQUIPE E VALOR/HORA DE MERCADO
--
-- PEDIDO (05/11/2026, Pablo): a nota de Dificuldade estava em 60,7/100 numa
-- equipe que entrega trabalho complexo; o valor de mercado deve ser pesquisado.
--
-- 1. ESCALA. Os pontos de cada nível passam de 25/50/75/100 para 80/88/95/100
--    nos meses ABERTOS que ainda usavam a escala original. Mês fechado não
--    muda, e mês com escala própria também não.
--    A IA NÃO foi alterada: ela continua classificando a complexidade de 1 a 5
--    com o mesmo critério. O parecer aparece nos chamados e multiplica o preço,
--    então precisa continuar sendo a leitura dela. O que mudou é uma regra da
--    empresa, visível em Pesos e regras e na própria tela da bonificação.
--    Efeito: sobe a nota da equipe e, com ela, o valor liberado da verba.
--
-- 2. VALOR/HORA (mesma tabela de supabase/functions/_shared/chamado-parecer-ia.ts;
--    o banco não lê o .ts). Horas, complexidade e fator continuam os de cada
--    parecer; só o valor/hora muda. Pesquisa de 05/11/2026:
--      freelancer PJ sênior ... R$ 200 → R$ 300/h: meio da faixa de full stack
--        sênior (R$ 200–400/h) em geracontratos.com.br/recursos/tabela-valores-servicos-profissionais.
--        Blog/agregador, não tabela oficial.
--      software house ......... R$ 320 → R$ 450/h: NÃO há tabela pública; é
--        1,5× o freelancer (gestão, impostos, margem, garantia). Sem fonte direta.
--      interno CLT ............ R$ 165/h, sem mudança.
--    Não muda a nota nem o valor liberado: o critério Valor usa a régua relativa
--    do mês (mig/lib: percentil 75), e valor digitado na avaliação continua valendo.
-- =========================================================================

ALTER TABLE public."BONIFICACAO_DEV_PERIODO"
  ALTER COLUMN pontos_facil SET DEFAULT 80,
  ALTER COLUMN pontos_medio SET DEFAULT 88,
  ALTER COLUMN pontos_dificil SET DEFAULT 95,
  ALTER COLUMN pontos_muito_dificil SET DEFAULT 100;

UPDATE public."BONIFICACAO_DEV_PERIODO"
   SET pontos_facil = 80, pontos_medio = 88, pontos_dificil = 95, pontos_muito_dificil = 100
 WHERE fechado_em IS NULL
   AND pontos_facil = 25 AND pontos_medio = 50 AND pontos_dificil = 75 AND pontos_muito_dificil = 100;

WITH tabela(perfil, valor_hora, embasamento) AS (
  VALUES
    ('freelancer',     300::numeric, 'Desenvolvedor sênior PJ: valor/hora fixo de R$ 300 (meio da faixa de full stack sênior publicada: R$ 200 a R$ 400/h).'),
    ('software_house', 450::numeric, 'Software house com time sênior: valor/hora fixo de R$ 450 (estimativa de 1,5× o freelancer, por gestão de projeto, impostos, margem e garantia; sem tabela pública).')
), novos AS (
  SELECT p.chamado_id,
         jsonb_agg(
           CASE WHEN t.perfil IS NULL THEN x.item ELSE
             x.item || jsonb_build_object(
               'valor_hora', t.valor_hora,
               'valor', round((x.item->>'horas')::numeric * t.valor_hora
                              * coalesce((x.item->>'fator_complexidade')::numeric, 1), 2),
               'embasamento', t.embasamento)
           END
           ORDER BY x.ord) AS precos
    FROM public."CHAMADO_SISTEMA_PARECER_IA" p
    CROSS JOIN LATERAL jsonb_array_elements(p.precos) WITH ORDINALITY AS x(item, ord)
    LEFT JOIN tabela t ON t.perfil = x.item->>'perfil'
   WHERE p.status = 'pronto'
     AND jsonb_typeof(p.precos) = 'array'
     AND (x.item->>'horas') ~ '^[0-9]+(\.[0-9]+)?$'
     AND coalesce(x.item->>'fator_complexidade', '1') ~ '^[0-9]+(\.[0-9]+)?$'
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
-- =========================================================================
-- ALTER TABLE public."BONIFICACAO_DEV_PERIODO"
--   ALTER COLUMN pontos_facil SET DEFAULT 25, ALTER COLUMN pontos_medio SET DEFAULT 50,
--   ALTER COLUMN pontos_dificil SET DEFAULT 75, ALTER COLUMN pontos_muito_dificil SET DEFAULT 100;
-- UPDATE public."BONIFICACAO_DEV_PERIODO" SET pontos_facil = 25, pontos_medio = 50, pontos_dificil = 75, pontos_muito_dificil = 100
--  WHERE fechado_em IS NULL AND pontos_facil = 80 AND pontos_medio = 88 AND pontos_dificil = 95 AND pontos_muito_dificil = 100;
-- Valor/hora: rodar o WITH acima com 200 e 320 (e os textos antigos da mig 20261029001600).
