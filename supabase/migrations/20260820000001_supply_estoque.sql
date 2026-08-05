-- =====================================================================
-- SUPPLY / COMPRAS — Fase 2, parte 1 de 2: CONTROLE DE ESTOQUE POR ETIQUETA
--
-- Implanta o Subsistema 4 do legado (REPLICAR-MODULO-COMPRAS.md §6), o mais
-- denso do módulo, e prepara o acoplamento com a fila de pedidos (§5.6) —
-- que o próprio documento chama de "coração operacional".
--
-- CONCEITO CENTRAL: o estoque é rastreado por ETIQUETA FÍSICA, impressa pela
-- empresa e bipada com pistola na entrada, na saída e na devolução. Existem
-- duas naturezas de etiqueta:
--
--   única  → 1 etiqueta = 1 peça específica (uniforme, EPI serializado).
--            Não tem saldo: existe ou foi consumida.
--   massa  → 1 etiqueta = um lote de N unidades que vai decrementando
--            (caixa de 100 luvas). Serve vários pedidos.
--
-- TRÊS CORREÇÕES ESTRUTURAIS EM RELAÇÃO AO LEGADO:
--
--   §12.7 — pedido_item_id NO LUGAR DE equipamento_index.
--     No legado a etiqueta se amarrava à POSIÇÃO do item no array JSON do
--     pedido. Editar o pedido reordenava o array e quebrava todas as
--     associações em silêncio. A Fase 1 já criou sup_pedido_item com id
--     próprio; aqui a amarração é por id estável e a fragilidade some.
--
--   §12.8 — SALDO SÓ POR VIEW, NUNCA COLUNA DENORMALIZADA.
--     O legado mantinha quantidade_total por trigger E recalculava na query
--     de listagem, com fórmulas DIFERENTES para etiqueta em massa consumida.
--     Aqui existe uma fórmula só, em sup_estoque_saldo.
--
--   §12.9 — LEDGER COM ÍNDICE ÚNICO.
--     O legado fazia SELECT-antes-de-UPSERT sem restrição de unicidade,
--     sujeito a corrida se dois operadores mexessem no mesmo pedido.
--
-- Além disso, o item de estoque aponta para o material do CATÁLOGO
-- (sup_item). É isso que permite recusar a etiqueta de uma camiseta na linha
-- de uma botina — hoje, no legado, nada impede.
--
-- ROLLBACK:
--   DROP VIEW IF EXISTS public.sup_estoque_saldo;
--   DROP TABLE IF EXISTS public.sup_estoque_movimento, public.sup_estoque_consumo,
--     public.sup_estoque_tag, public.sup_estoque_item CASCADE;
--   DELETE FROM public.app_menu WHERE codigo = 'sup_estoque';
-- =====================================================================

-- ── 1. Item de estoque ───────────────────────────────────────────────
--
-- Um material do catálogo, num almoxarifado. Reusa public.almoxarifado, que
-- já existe com empresa/contrato/tipo e um registro MATRIZ por empresa —
-- melhor que o campo de texto livre "localizacao" do legado, porque permite
-- somar saldo por depósito.
CREATE TABLE IF NOT EXISTS public.sup_estoque_item (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES public.empresas(id)     ON DELETE CASCADE,
  almoxarifado_id uuid NOT NULL REFERENCES public.almoxarifado(id) ON DELETE RESTRICT,
  sup_item_id     uuid NOT NULL REFERENCES public.sup_item(id)     ON DELETE RESTRICT,
  valor_unitario  numeric(12,2) NOT NULL DEFAULT 0,
  estoque_minimo  integer NOT NULL DEFAULT 0,
  fornecedor      text,
  validade        date,
  observacoes     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (almoxarifado_id, sup_item_id)
);
CREATE INDEX IF NOT EXISTS idx_sup_estoque_item_empresa ON public.sup_estoque_item(empresa_id);
CREATE INDEX IF NOT EXISTS idx_sup_estoque_item_material ON public.sup_estoque_item(sup_item_id);

-- ── 2. Etiqueta ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sup_estoque_tag (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_estoque_id           uuid NOT NULL REFERENCES public.sup_estoque_item(id) ON DELETE CASCADE,
  -- O código impresso na etiqueta física (código de barras, ~24 dígitos).
  -- UNIQUE global: a mesma etiqueta nunca pode estar ativa em dois itens.
  codigo                    text NOT NULL UNIQUE,
  tamanho                   text,
  sequencia                 integer NOT NULL DEFAULT 1,
  tipo                      text NOT NULL DEFAULT 'unico'
                              CHECK (tipo IN ('unico','massa')),
  quantidade_massa          integer,
  quantidade_original_massa integer,
  valor_unitario            numeric(12,2),   -- sobrepõe o valor do item
  -- Estado fica na ETIQUETA, não no item: uma peça devolvida e higienizada é
  -- uma peça específica, não um item de estoque paralelo (o legado tinha
  -- 'estado' no item, o que obrigava a duplicar o cadastro).
  estado                    text NOT NULL DEFAULT 'novo'
                              CHECK (estado IN ('novo','higienizado')),
  usado                     boolean NOT NULL DEFAULT false,
  pedido_id                 uuid REFERENCES public.sup_pedido(id)      ON DELETE SET NULL,
  pedido_item_id            uuid REFERENCES public.sup_pedido_item(id) ON DELETE SET NULL,
  usado_em                  timestamptz,
  usado_por                 uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  usado_por_nome            text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sup_tag_massa_valida CHECK (
    (tipo = 'massa' AND quantidade_massa IS NOT NULL AND quantidade_massa >= 0)
    OR (tipo = 'unico' AND quantidade_massa IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_sup_tag_item   ON public.sup_estoque_tag(item_estoque_id);
CREATE INDEX IF NOT EXISTS idx_sup_tag_usado  ON public.sup_estoque_tag(usado);
CREATE INDEX IF NOT EXISTS idx_sup_tag_pedido ON public.sup_estoque_tag(pedido_id, pedido_item_id);

-- ── 3. Ledger das etiquetas em massa ─────────────────────────────────
--
-- Registra quanto de cada etiqueta em massa foi consumido por cada item de
-- pedido. É o que permite o CONTROLE POR DELTA (§6.6): reabrir o pedido e
-- ajustar a quantidade para mais ou para menos sem corromper o saldo.
CREATE TABLE IF NOT EXISTS public.sup_estoque_consumo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo          text NOT NULL,
  item_estoque_id uuid REFERENCES public.sup_estoque_item(id) ON DELETE CASCADE,
  pedido_id       uuid NOT NULL REFERENCES public.sup_pedido(id)      ON DELETE CASCADE,
  pedido_item_id  uuid NOT NULL REFERENCES public.sup_pedido_item(id) ON DELETE CASCADE,
  quantidade      integer NOT NULL DEFAULT 1 CHECK (quantidade >= 0),
  consumido_em    timestamptz NOT NULL DEFAULT now(),
  consumido_por   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  consumido_por_nome text
);
-- §12.9: o legado não tinha esta restrição e fazia SELECT-antes-de-UPSERT,
-- sujeito a corrida se dois operadores mexessem no mesmo pedido ao mesmo tempo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sup_consumo_tag_item
  ON public.sup_estoque_consumo(codigo, pedido_item_id);
CREATE INDEX IF NOT EXISTS idx_sup_consumo_pedido ON public.sup_estoque_consumo(pedido_id);

-- ── 4. Trilha de movimento ───────────────────────────────────────────
--
-- O legado não tem: quem deu entrada, quem devolveu e quando se perdia.
-- Como a operação bipa em três momentos (entrada, saída, devolução), a
-- trilha é o que torna o estoque auditável.
CREATE TABLE IF NOT EXISTS public.sup_estoque_movimento (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  item_estoque_id uuid REFERENCES public.sup_estoque_item(id) ON DELETE SET NULL,
  codigo          text,
  tipo            text NOT NULL
                    CHECK (tipo IN ('entrada','saida','devolucao','ajuste','remocao')),
  quantidade      integer NOT NULL DEFAULT 1,
  tamanho         text,
  pedido_id       uuid REFERENCES public.sup_pedido(id)      ON DELETE SET NULL,
  pedido_item_id  uuid REFERENCES public.sup_pedido_item(id) ON DELETE SET NULL,
  observacao      text,
  usuario_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  usuario_nome    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sup_mov_item ON public.sup_estoque_movimento(item_estoque_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sup_mov_data ON public.sup_estoque_movimento(created_at DESC);

DROP TRIGGER IF EXISTS trg_sup_estoque_item_updated ON public.sup_estoque_item;
CREATE TRIGGER trg_sup_estoque_item_updated BEFORE UPDATE ON public.sup_estoque_item
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 5. Saldo — A ÚNICA fórmula do sistema ────────────────────────────
--
-- §12.8: no legado o trigger e a query de listagem calculavam isto de formas
-- diferentes para etiqueta em massa consumida, e ninguém sabia qual estava
-- certo. Aqui é view: não existe cópia para divergir.
--
-- security_invoker: a view respeita a RLS de quem consulta, em vez de rodar
-- com os direitos do dono.
CREATE OR REPLACE VIEW public.sup_estoque_saldo
WITH (security_invoker = true) AS
SELECT
  ei.id                AS item_estoque_id,
  ei.empresa_id,
  ei.almoxarifado_id,
  ei.sup_item_id,
  t.tamanho,
  COALESCE(SUM(CASE
    WHEN t.tipo = 'massa' AND NOT t.usado THEN COALESCE(t.quantidade_massa, 0)
    WHEN t.tipo = 'unico' AND NOT t.usado THEN 1
    ELSE 0 END), 0)::integer AS disponivel,
  COALESCE(SUM(CASE
    WHEN t.tipo = 'massa' THEN COALESCE(t.quantidade_original_massa, 0) - COALESCE(t.quantidade_massa, 0)
    WHEN t.tipo = 'unico' AND t.usado THEN 1
    ELSE 0 END), 0)::integer AS consumido,
  count(t.id) FILTER (WHERE t.id IS NOT NULL)::integer AS etiquetas
  FROM public.sup_estoque_item ei
  LEFT JOIN public.sup_estoque_tag t ON t.item_estoque_id = ei.id
 GROUP BY ei.id, ei.empresa_id, ei.almoxarifado_id, ei.sup_item_id, t.tamanho;

-- ── 6. RLS ───────────────────────────────────────────────────────────
--
-- Mesmo padrão do resto do módulo: can_access() para "pode abrir a tela",
-- SEMPRE combinado com o escopo de empresa via user_empresa — can_access
-- sozinho nunca é visibilidade por linha.
--
-- Nas subqueries EXISTS toda coluna é qualificada com o nome da tabela
-- externa: coluna solta dentro de um EXISTS já se ligou à PK da tabela
-- interna neste projeto, sem erro de sintaxe e sem aviso.
--
-- Usuário externo (sessão anônima) não tem perfil de acesso nem linha em
-- user_empresa, então é negado em tudo aqui por construção.

ALTER TABLE public.sup_estoque_item      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sup_estoque_tag       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sup_estoque_consumo   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sup_estoque_movimento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sup_estoque_item_select ON public.sup_estoque_item;
CREATE POLICY sup_estoque_item_select ON public.sup_estoque_item FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_estoque', 'visualizar')
    AND sup_estoque_item.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS sup_estoque_item_write ON public.sup_estoque_item;
CREATE POLICY sup_estoque_item_write ON public.sup_estoque_item FOR ALL TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_estoque', 'alterar')
    AND sup_estoque_item.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.can_access(auth.uid(), 'sup_estoque', 'alterar')
    AND sup_estoque_item.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
  );

-- Etiqueta, ledger e movimento herdam o escopo do item de estoque pai — o
-- EXISTS reaproveita as policies acima em vez de duplicar a regra.
DROP POLICY IF EXISTS sup_estoque_tag_select ON public.sup_estoque_tag;
CREATE POLICY sup_estoque_tag_select ON public.sup_estoque_tag FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sup_estoque_item ei
     WHERE ei.id = sup_estoque_tag.item_estoque_id
  ));

DROP POLICY IF EXISTS sup_estoque_tag_write ON public.sup_estoque_tag;
CREATE POLICY sup_estoque_tag_write ON public.sup_estoque_tag FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sup_estoque_item ei
     WHERE ei.id = sup_estoque_tag.item_estoque_id
       AND public.can_access(auth.uid(), 'sup_estoque', 'alterar')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.sup_estoque_item ei
     WHERE ei.id = sup_estoque_tag.item_estoque_id
       AND public.can_access(auth.uid(), 'sup_estoque', 'alterar')
  ));

DROP POLICY IF EXISTS sup_estoque_consumo_select ON public.sup_estoque_consumo;
CREATE POLICY sup_estoque_consumo_select ON public.sup_estoque_consumo FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_estoque', 'visualizar')
    OR public.can_access(auth.uid(), 'sup_pedidos_materiais', 'visualizar')
  );

DROP POLICY IF EXISTS sup_estoque_mov_select ON public.sup_estoque_movimento;
CREATE POLICY sup_estoque_mov_select ON public.sup_estoque_movimento FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_estoque', 'visualizar')
    AND sup_estoque_movimento.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
  );

-- Escrita em ledger e movimento só pelas RPCs da parte 2 (SECURITY DEFINER),
-- que reconferem a permissão à mão. Sem policy de INSERT aqui de propósito:
-- ninguém grava consumo por fora do algoritmo de delta.

-- ── 7. Menu ──────────────────────────────────────────────────────────
-- Sem seed de permissão, como todo o resto do ERP: a liberação é feita em
-- /app/administracao?tab=modulos.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sup_estoque', 'Estoque & Etiquetas', '/app/suprimentos/estoque-etiquetas', 63, true
  FROM public.app_modulo m
 WHERE m.codigo = 'suprimentos'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

NOTIFY pgrst, 'reload schema';
