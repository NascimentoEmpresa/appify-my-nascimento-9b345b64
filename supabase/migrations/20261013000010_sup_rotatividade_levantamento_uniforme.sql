-- [SEM-CHAMADO] Rotatividade do Estoque — estrutura do levantamento de tamanhos
--
-- 1) Tabela do levantamento de tamanhos de uniforme (grade declarada)
-- 2) RLS da tabela
-- 3) sup_tamanho_ordem() — ordena tamanho para leitura humana
--
-- Pedido da diretoria: ver qual tamanho de uniforme mais sai, mais entra e
-- mais roda dentro do estoque. A movimentação real vem de sup_pedido_item e
-- sup_estoque_movimento, que já existem. O que faltava era a GRADE DECLARADA:
-- o tamanho que cada colaborador diz vestir, levantado pelos encarregados num
-- formulário por contrato. Sem ela não é possível responder a pergunta que
-- interessa de verdade — "a gente compra o tamanho que a equipe veste?".
--
-- A tabela entra como `sup_*` minúsculo, não `"NOME_MAIUSCULO"`: todo o
-- módulo de Suprimentos (sup_pedido, sup_item, sup_estoque_*) usa esse prefixo
-- e consistência dentro do módulo vale mais que a regra geral de case aqui.
--
-- Os dados (as ~1000 respostas) vêm na migration seguinte,
-- 20261013000011_sup_levantamento_uniforme_dados.sql, gerada por
-- scripts/gerar-seed-levantamento-uniforme.mjs a partir do CSV do formulário.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sup_tamanho_ordem(text);
--   DROP TABLE IF EXISTS public.sup_levantamento_uniforme;
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Tabela do levantamento
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sup_levantamento_uniforme (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Resolvidos a partir do texto livre do formulário na migration de dados.
  -- Ficam nulos quando o texto do contrato não identifica um contrato único
  -- (ex.: "ADMINISTRATIVO", que existe em quatro empresas) — nulo aqui é
  -- resposta não classificada, não erro.
  empresa_id     uuid REFERENCES public.empresas(id),
  contrato_id    uuid REFERENCES public.contratos(id),
  contrato_texto text,

  nome_completo  text NOT NULL,
  enviado_em     timestamptz NOT NULL,

  -- Uma coluna por peça perguntada no formulário. Tamanho é texto porque a
  -- grade mistura letra (PP..EGG) e numeração (33..50) na mesma pergunta.
  camisa         text,
  calca          text,
  jaleco         text,
  jaqueta        text,
  moletom        text,
  calcado        text,
  luva           text,

  origem_arquivo text,
  importado_em   timestamptz NOT NULL DEFAULT now(),
  importado_por  uuid,

  -- Chave de reimportação. Muita gente respondeu o formulário mais de uma vez
  -- (109 pessoas, numa das 1000 respostas): guardamos todas e o dashboard
  -- considera só a última de cada pessoa, em vez de contar a mesma pessoa
  -- três vezes na grade.
  CONSTRAINT sup_levantamento_uniforme_resposta_unica
    UNIQUE (nome_completo, enviado_em)
);

CREATE INDEX IF NOT EXISTS idx_sup_levantamento_uniforme_empresa
  ON public.sup_levantamento_uniforme (empresa_id);
CREATE INDEX IF NOT EXISTS idx_sup_levantamento_uniforme_contrato
  ON public.sup_levantamento_uniforme (contrato_id);
CREATE INDEX IF NOT EXISTS idx_sup_levantamento_uniforme_pessoa
  ON public.sup_levantamento_uniforme (nome_completo, enviado_em DESC);

COMMENT ON TABLE public.sup_levantamento_uniforme IS
  'Grade declarada de tamanhos de uniforme por colaborador, levantada pelos encarregados em formulário por contrato. Não é movimentação de estoque: serve de referência para comparar com o que de fato sai do almoxarifado.';

-- ----------------------------------------------------------------------------
-- 2) RLS
--
-- Quem enxerga o Dashboard de Compras, Estoque e Saving enxerga o
-- levantamento, porque é lá que ele é consumido. A tabela não tem dono por
-- linha (é censo de contrato, não documento pessoal), então o gate de tela
-- basta — não há vazamento entre usuários a evitar aqui.
--
-- `can_access` vai ENVELOPADA em `(SELECT ...)` nas duas policies, inclusive
-- na de escrita. Escrita crua, a função é avaliada uma vez POR LINHA (~0,29 ms
-- medido em produção); envelopada vira InitPlan avaliado uma vez por consulta.
-- E policy `FOR ALL` roda no SELECT também — `ALL` inclui SELECT, e as duas
-- permissivas se somam no mesmo scan. Foi exatamente o que levou
-- `sup_pedido_item` de 1.494 ms para 33 ms no lote
-- 20261013000001_rls_can_access_subquery_lote4; esta tabela nasce já no padrão
-- certo em vez de entrar na fila do próximo lote.
-- ----------------------------------------------------------------------------

ALTER TABLE public.sup_levantamento_uniforme ENABLE ROW LEVEL SECURITY;

-- `CREATE POLICY <nome> ON <tabela>` fica na MESMA linha de propósito: a
-- portaria do CI (.github/scripts/portaria-pr.mjs, regra R3) confere o saldo
-- entre DROP e CREATE de policy com um regex linha a linha. Quebrando o `ON`
-- para a linha seguinte, o CREATE não é reconhecido e a R3 reprova a PR
-- achando que a policy foi removida e nunca recriada.
DROP POLICY IF EXISTS sup_levantamento_uniforme_select ON public.sup_levantamento_uniforme;
CREATE POLICY sup_levantamento_uniforme_select ON public.sup_levantamento_uniforme
  FOR SELECT
  USING ((SELECT public.can_access(auth.uid(), 'sup_dashboard_compras_estoque', 'visualizar'::public.app_acao)));

DROP POLICY IF EXISTS sup_levantamento_uniforme_write ON public.sup_levantamento_uniforme;
CREATE POLICY sup_levantamento_uniforme_write ON public.sup_levantamento_uniforme
  FOR ALL
  USING ((SELECT public.can_access(auth.uid(), 'sup_dashboard_compras_estoque', 'alterar'::public.app_acao)))
  WITH CHECK ((SELECT public.can_access(auth.uid(), 'sup_dashboard_compras_estoque', 'alterar'::public.app_acao)));

-- ----------------------------------------------------------------------------
-- 3) Ordem de leitura do tamanho
--
-- Ordenar tamanho por texto coloca "EGG" antes de "G" e "10" antes de "9".
-- Esta função dá a ordem que um humano espera: letra na escala PP→EXGG, depois
-- numeração crescente, depois o resto.
--
-- Propositalmente NÃO fundimos rótulos parecidos (EGG / XGG / EXG / EXGG). O
-- formulário oferece 7 opções (PP, P, M, G, GG, EGG, EXG) e o catálogo de
-- estoque usa 9 rótulos, incluindo XGG e EXGG. Fundir "XGG" em "EGG" seria
-- adivinhar equivalência de grade e falsear a comparação; o dashboard mostra
-- cada rótulo como ele é e sinaliza os que só existem de um lado.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sup_tamanho_ordem(p_tamanho text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  SELECT CASE
           WHEN t IS NULL THEN 9999
           WHEN t = 'PP'   THEN 10
           WHEN t = 'P'    THEN 20
           WHEN t = 'M'    THEN 30
           WHEN t = 'G'    THEN 40
           WHEN t = 'GG'   THEN 50
           WHEN t = 'EGG'  THEN 60
           WHEN t = 'XGG'  THEN 61
           WHEN t = 'EXG'  THEN 70
           WHEN t = 'EXGG' THEN 71
           -- Numeração de calçado, inclusive faixa "36/37": ordena pelo
           -- primeiro número.
           WHEN t ~ '^[0-9]{1,2}' THEN 1000 + (regexp_match(t, '^([0-9]{1,2})'))[1]::int
           ELSE 9000
         END
    FROM (SELECT public.sup_tamanho_da_variante(p_tamanho) AS t) v;
$function$;

COMMENT ON FUNCTION public.sup_tamanho_ordem(text) IS
  'Ordem de leitura humana para tamanho: letra PP→EXGG, depois numeração crescente, depois o resto.';

NOTIFY pgrst, 'reload schema';
