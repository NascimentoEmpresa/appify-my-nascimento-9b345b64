-- =====================================================================
-- MIGRAÇÃO DO SISTEMA ANTIGO — passo 1: estrutura para os dados caberem
--
-- CONTEXTO
-- O sistema antigo de Compras (Postgres na Render) vai ser desligado. Os
-- dados das 17 tabelas dele entram nas tabelas `sup_*` que já existem — não
-- se clona o schema antigo, porque o novo é um redesenho deliberado.
--
-- Esta migration NÃO carrega dado nenhum. Ela só abre espaço para que a carga
-- seja (a) sem perda e (b) repetível. A carga vem depois, por script.
--
-- POR QUE CADA COISA ABAIXO EXISTE
--
-- 1. RASTRO DE ORIGEM (`legado_origem` + `legado_id`)
--    Sem ele, rodar a carga duas vezes duplica tudo, e não há como conferir
--    origem × destino depois. Com o índice único, a carga vira idempotente:
--    ON CONFLICT DO NOTHING e pronto. É também o que permite desfazer.
--
-- 2. A FICHA DE ESTOQUE ANTIGA TEM IDENTIDADE OCULTA
--    `estoque_items` não é (nome, tipo): é (nome, tipo, TAMANHO, estado,
--    valor, fornecedor, prateleira). O tamanho não existe como coluna — só
--    dá para saber pelas etiquetas da ficha. `JAQUETA/UNIFORME` tem 26 fichas,
--    uma por combinação, e a prateleira codifica o tamanho pela posição
--    (A1.01=P, A1.02=M, A1.03=G, A1.04=GG).
--    Como `sup_estoque_item` tem UNIQUE (almoxarifado_id, sup_item_id), as 890
--    fichas colapsam em ~346 materiais. Para não perder nada, `fornecedor` e a
--    prateleira descem para a ETIQUETA, que é onde tamanho/estado/valor já
--    moram. Daí `localizacao` e `fornecedor` em sup_estoque_tag.
--
-- 3. `localizacao` NÃO É ALMOXARIFADO
--    São 442 valores e todos são endereço de prateleira (`F-04-08`, `D4.10`),
--    não nome de depósito. O comentário da migration 20260820000001 dizia que
--    isso viraria FK de `almoxarifado`; seguir aquilo criaria 442 depósitos
--    falsos. Vira campo de endereço, no item e na etiqueta.
--
-- 4. VÍNCULOS QUEBRADOS NA ORIGEM
--    Uma limpeza em 23/06/2026 apagou pedidos e deixou referências penduradas:
--      • estoque_tags.pedido_id ....... 1.068 de 3.272 casam
--      • estoque_tags_consumo ......... 890 de 3.443 são totalmente ligáveis
--    Descartar essas linhas seria perder histórico de consumo real. Em vez
--    disso o texto do protocolo antigo fica em `pedido_id_legado`, e os dois
--    NOT NULL de sup_estoque_consumo são afrouxados. Quem tiver vínculo ganha
--    FK de verdade; quem não tiver, mantém o rastro.
--
-- NADA É REMOVIDO E NADA MUDA DE TIPO. Só entram colunas novas e caem dois
-- NOT NULL. Nenhuma tela existente quebra.
-- =====================================================================

-- ── 1. Rastro de origem, uniforme em todas as tabelas de destino ─────
--
-- `legado_origem` guarda o nome da tabela antiga porque duas tabelas de lá
-- caem na mesma daqui (veiculos + equipamentos → sup_patrimonio) e as duas
-- têm sequências próprias: o id 7 existe nas duas e significa coisas
-- diferentes. Sem a origem no par, o índice único casaria bens distintos.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sup_item', 'sup_posto', 'sup_funcao',
    'sup_pedido', 'sup_pedido_item',
    'sup_estoque_item', 'sup_estoque_tag', 'sup_estoque_consumo',
    'sup_patrimonio', 'sup_patrimonio_arquivo', 'sup_patrimonio_log',
    'sup_cat_lote', 'sup_cat_alteracao', 'cotacoes_licitacao'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS legado_origem text', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS legado_id integer', t);
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_%s_legado ON public.%I (legado_origem, legado_id)
         WHERE legado_id IS NOT NULL', t, t);
    EXECUTE format(
      'COMMENT ON COLUMN public.%I.legado_id IS
         ''Id na tabela do sistema antigo (Render). Nulo em registro nascido aqui. Par com legado_origem torna a carga idempotente.''', t);
  END LOOP;
END $$;

-- ── 2. Endereço de prateleira ────────────────────────────────────────
ALTER TABLE public.sup_estoque_item ADD COLUMN IF NOT EXISTS localizacao text;
COMMENT ON COLUMN public.sup_estoque_item.localizacao IS
  'Endereço físico na prateleira, vindo do legado (ex.: F-04-08, D4.10). Não é o almoxarifado — esse é o almoxarifado_id.';

ALTER TABLE public.sup_estoque_tag ADD COLUMN IF NOT EXISTS localizacao text;
ALTER TABLE public.sup_estoque_tag ADD COLUMN IF NOT EXISTS fornecedor  text;
COMMENT ON COLUMN public.sup_estoque_tag.localizacao IS
  'Prateleira da ficha antiga que deu origem a esta etiqueta. No legado a ficha era por (tamanho, estado, valor, fornecedor, prateleira) e o tamanho já mora aqui.';
COMMENT ON COLUMN public.sup_estoque_tag.fornecedor IS
  'Fornecedor da ficha antiga. Varia entre etiquetas do mesmo material (JAQUETA tem RUVERIM e IZOLINI), por isso não cabe só no item.';

-- ── 3. Vínculo de pedido que a origem perdeu ─────────────────────────
ALTER TABLE public.sup_estoque_tag     ADD COLUMN IF NOT EXISTS pedido_id_legado text;
ALTER TABLE public.sup_estoque_consumo ADD COLUMN IF NOT EXISTS pedido_id_legado text;
COMMENT ON COLUMN public.sup_estoque_tag.pedido_id_legado IS
  'Protocolo do pedido no sistema antigo. Preenchido sempre; pedido_id (FK) só quando o pedido sobreviveu à limpeza de 23/06/2026.';

-- Sem isto, 2.553 das 3.443 linhas de consumo não entrariam — e consumo é
-- justamente o histórico que não se recompõe depois.
ALTER TABLE public.sup_estoque_consumo ALTER COLUMN pedido_id      DROP NOT NULL;
ALTER TABLE public.sup_estoque_consumo ALTER COLUMN pedido_item_id DROP NOT NULL;

-- ── 4. Alteração de catálogo aponta para entidade do sistema antigo ──
--
-- `alvo_id` é uuid NOT NULL e aponta para uma entidade daqui. As 4.258
-- alterações do legado apontam para ids INTEIROS de lá, que em boa parte nem
-- existem mais. O alvo textual continua legível dentro de `dados`.
ALTER TABLE public.sup_cat_alteracao ALTER COLUMN alvo_id DROP NOT NULL;
ALTER TABLE public.sup_cat_alteracao ADD COLUMN IF NOT EXISTS alvo_legado_id integer;
COMMENT ON COLUMN public.sup_cat_alteracao.alvo_legado_id IS
  'Id da entidade no sistema antigo. Usado quando alvo_id é nulo porque o alvo nunca existiu neste banco.';

-- ── Conferência ──────────────────────────────────────────────────────
SELECT table_name, count(*) FILTER (WHERE column_name IN ('legado_origem','legado_id')) AS colunas_de_rastro
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('sup_item','sup_posto','sup_funcao','sup_pedido','sup_pedido_item',
                      'sup_estoque_item','sup_estoque_tag','sup_estoque_consumo',
                      'sup_patrimonio','sup_patrimonio_arquivo','sup_patrimonio_log',
                      'sup_cat_lote','sup_cat_alteracao','cotacoes_licitacao')
 GROUP BY 1 ORDER BY 1;

SELECT count(*) AS indices_de_rastro FROM pg_indexes
 WHERE schemaname = 'public' AND indexname LIKE 'uq_sup%legado' OR indexname LIKE 'uq_cotacoes%legado';

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   ALTER TABLE public.sup_estoque_consumo ALTER COLUMN pedido_id      SET NOT NULL;
--   ALTER TABLE public.sup_estoque_consumo ALTER COLUMN pedido_item_id SET NOT NULL;
--   ALTER TABLE public.sup_cat_alteracao   ALTER COLUMN alvo_id        SET NOT NULL;
--   ALTER TABLE public.sup_estoque_item DROP COLUMN localizacao;
--   ALTER TABLE public.sup_estoque_tag  DROP COLUMN localizacao, DROP COLUMN fornecedor,
--                                       DROP COLUMN pedido_id_legado;
--   ALTER TABLE public.sup_estoque_consumo DROP COLUMN pedido_id_legado;
--   ALTER TABLE public.sup_cat_alteracao   DROP COLUMN alvo_legado_id;
--   -- e, para cada tabela da lista do bloco 1:
--   --   DROP INDEX IF EXISTS public.uq_<tabela>_legado;
--   --   ALTER TABLE public.<tabela> DROP COLUMN legado_origem, DROP COLUMN legado_id;
--   -- (os dois SET NOT NULL só voltam depois de limpar as linhas do legado)
-- =====================================================================
