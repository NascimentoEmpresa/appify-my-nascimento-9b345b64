-- =========================================================================
-- Catálogo oficial de CA (CAEPI/MTE) — validação automática do certificado
--
-- POR QUE ESTA TABELA EXISTE
-- O 0222 passou a exigir número e validade do CA na entrada de EPI, mas quem
-- digita é uma pessoa: se ela errar o número ou copiar a validade errada da
-- embalagem, o sistema aceita e o problema das 400 máscaras se repete com uma
-- camada de burocracia a mais. O catálogo é a fonte independente que permite
-- conferir o que foi digitado contra o que o Ministério publica.
--
-- POR QUE UM ARQUIVO INTEIRO, E NÃO CONSULTA CA A CA
-- O MTE publica a base completa do CAEPI num arquivo atualizado diariamente
-- às 20h. Baixar o arquivo é melhor que consultar o formulário por CA em três
-- aspectos que importam aqui: não depende do HTML do site continuar igual, não
-- esbarra em limite de requisição, e — o principal — permite reconferir o
-- estoque INTEIRO de uma vez, inclusive retroativamente. É isso que responde
-- de imediato quais etiquetas já existentes estão com CA vencido.
--
-- O arquivo tem 96 mil linhas e 98 MB, mas o que interessa aqui são 7 colunas.
-- Descrição do equipamento e observação de laudo são texto longo que nenhuma
-- tela nossa consome; ficam de fora de propósito.
--
-- ATENÇÃO A DUAS ARMADILHAS DO ARQUIVO, ambas verificadas no arquivo real:
--   1. `NRRegistroCA` NÃO é chave única. O mesmo CA aparece numa linha por
--      norma técnica atendida (o CA 27182, por exemplo, repete). A carga
--      deduplica; sem isso a tabela inflaria e o casamento ficaria ambíguo.
--   2. A coluna `Situacao` do arquivo ("VENCIDO"/"VÁLIDO") está congelada na
--      data em que o governo gerou o arquivo. Guardamos o valor por
--      rastreabilidade, mas quem decide é sempre `validade` comparada com
--      a data de hoje — senão um CA que vence amanhã apareceria válido pela
--      semana inteira, até a próxima carga.
--
-- Idempotente.
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sst_ca_auditar_estoque(integer);
--   DROP FUNCTION IF EXISTS public.sst_ca_consultar(text);
--   DROP TABLE IF EXISTS public.sst_ca_sincronizacao;
--   DROP TABLE IF EXISTS public.sst_ca_catalogo;
-- =========================================================================

-- ── 1) O catálogo ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sst_ca_catalogo (
  ca_numero       text PRIMARY KEY,
  validade        date,
  situacao        text,
  equipamento     text,
  natureza        text,
  fabricante_cnpj text,
  fabricante      text,
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sst_ca_catalogo IS
  'Espelho do CAEPI/MTE, carregado pelo worker. Somente leitura pelo app.';

COMMENT ON COLUMN public.sst_ca_catalogo.situacao IS
  'Situacao como veio no arquivo, congelada na geracao dele. Nao usar para decidir vencimento: use validade contra a data corrente.';

CREATE INDEX IF NOT EXISTS idx_sst_ca_catalogo_validade
  ON public.sst_ca_catalogo(validade);

-- ── 2) Histórico das cargas ──────────────────────────────────────────────
-- Serve para o worker saber quando rodou a última vez (o ciclo dele é de
-- minutos, e esta carga é semanal) e para alguém conseguir explicar depois
-- por que o catálogo estava desatualizado num dia específico.

CREATE TABLE IF NOT EXISTS public.sst_ca_sincronizacao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  iniciado_em   timestamptz NOT NULL DEFAULT now(),
  concluido_em  timestamptz,
  linhas_lidas  integer,
  cas_gravados  integer,
  erro          text
);

CREATE INDEX IF NOT EXISTS idx_sst_ca_sincronizacao_inicio
  ON public.sst_ca_sincronizacao(iniciado_em DESC);

-- ── 3) Consulta de um CA ─────────────────────────────────────────────────
-- `encontrado = false` é resposta legítima e diferente de "vencido": CA que
-- não existe no catálogo pode ser erro de digitação OU um CA novo emitido
-- depois da última carga. A tela precisa distinguir os dois casos, por isso
-- devolve também a data do catálogo.

CREATE OR REPLACE FUNCTION public.sst_ca_consultar(p_ca text)
RETURNS TABLE (
  encontrado        boolean,
  ca_numero         text,
  validade          date,
  vencido           boolean,
  dias_para_vencer  integer,
  equipamento       text,
  fabricante        text,
  catalogo_de       timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT
    c.ca_numero IS NOT NULL,
    c.ca_numero,
    c.validade,
    CASE WHEN c.validade IS NULL THEN NULL ELSE c.validade < CURRENT_DATE END,
    CASE WHEN c.validade IS NULL THEN NULL ELSE (c.validade - CURRENT_DATE)::integer END,
    c.equipamento,
    c.fabricante,
    (SELECT max(s.concluido_em) FROM public.sst_ca_sincronizacao s WHERE s.erro IS NULL)
  FROM (SELECT regexp_replace(coalesce(p_ca, ''), '\D', '', 'g') AS chave) k
  LEFT JOIN public.sst_ca_catalogo c ON c.ca_numero = k.chave;
$fn$;

-- ── 4) Auditoria retroativa do estoque ───────────────────────────────────
-- A pergunta que originou o chamado: "quais das minhas etiquetas estão com CA
-- vencido?". Compara o que foi digitado na etiqueta com o catálogo oficial e
-- separa problemas diferentes, porque a ação para cada um é outra:
--   vencido_oficial → o CA venceu de fato; o EPI sai de uso
--   divergente      → a validade digitada não bate com a oficial; corrigir o
--                     cadastro (e desconfiar do lote)
--   nao_encontrado  → CA não existe no catálogo; erro de digitação ou CA mais
--                     novo que a última carga

CREATE OR REPLACE FUNCTION public.sst_ca_auditar_estoque(p_dias_alerta integer DEFAULT 60)
RETURNS TABLE (
  tag_id            uuid,
  codigo            text,
  sup_item_id       uuid,
  item              text,
  ca_numero         text,
  ca_validade_tag   date,
  ca_validade_ofic  date,
  problema          text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT
    t.id,
    t.codigo,
    ei.sup_item_id,
    i.nome,
    t.ca_numero,
    t.ca_validade,
    c.validade,
    CASE
      WHEN t.ca_numero IS NULL OR btrim(t.ca_numero) = ''  THEN 'sem_ca'
      WHEN c.ca_numero IS NULL                             THEN 'nao_encontrado'
      WHEN c.validade < CURRENT_DATE                       THEN 'vencido_oficial'
      WHEN t.ca_validade IS DISTINCT FROM c.validade       THEN 'divergente'
      WHEN c.validade <= CURRENT_DATE + p_dias_alerta      THEN 'vencendo'
      ELSE 'ok'
    END
  FROM public.sup_estoque_tag t
  JOIN public.sup_estoque_item ei ON ei.id = t.item_estoque_id
  JOIN public.sup_item i          ON i.id = ei.sup_item_id
  LEFT JOIN public.sst_ca_catalogo c
    ON c.ca_numero = regexp_replace(coalesce(t.ca_numero, ''), '\D', '', 'g')
  WHERE i.tipo = 'epi';
$fn$;

-- ── 5) RLS ───────────────────────────────────────────────────────────────
-- Leitura para quem tem o menu de CA, o de laudos ou o de estoque. Escrita
-- não tem policy nenhuma: quem grava é o worker, com service role, que passa
-- por fora da RLS.

ALTER TABLE public.sst_ca_catalogo      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sst_ca_sincronizacao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sst_ca_catalogo_select ON public.sst_ca_catalogo;
CREATE POLICY sst_ca_catalogo_select ON public.sst_ca_catalogo
  FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'sst_ca', 'visualizar')
    OR public.can_access(auth.uid(), 'sst_laudo', 'visualizar')
    OR public.can_access(auth.uid(), 'sup_estoque', 'visualizar')
  );

DROP POLICY IF EXISTS sst_ca_sincronizacao_select ON public.sst_ca_sincronizacao;
CREATE POLICY sst_ca_sincronizacao_select ON public.sst_ca_sincronizacao
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'sst_ca', 'visualizar'));

-- ── 6) Privilégios ───────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.sst_ca_consultar(text)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sst_ca_auditar_estoque(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_ca_consultar(text)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.sst_ca_auditar_estoque(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
