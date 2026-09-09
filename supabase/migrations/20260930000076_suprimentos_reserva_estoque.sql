-- =====================================================================
-- Suprimentos — reserva de estoque (pré-pedido), parte 1 de 5
--
-- O gerente de Suprimentos descreveu a dor assim: "eu vou lá para a
-- aprovação, ele vai argumentar, MAS TEM 10 NO ESTOQUE — não, não, mas
-- esse aqui não foi dado baixa ainda, porque está em separação".
--
-- Hoje o sistema só conhece dois estados de mercadoria: livre ou
-- consumida (sup_estoque_tag.usado). Falta o estado do meio — separada
-- para um pedido, ainda na prateleira. Esta migration cria esse estado.
--
-- A DECISÃO QUE GOVERNA TUDO: a reserva NÃO decrementa
-- sup_estoque_tag.quantidade_massa. Ela é um livro-razão paralelo, e a
-- view de saldo subtrai. Decrementar seria mais simples para
-- concorrência, e estaria errado por três motivos:
--
--   1. `quantidade_original_massa - quantidade_massa = consumido` é a
--      fórmula da view (20260820000001:174). Ela passaria a mentir.
--   2. O inventário compara prateleira × sistema. Se a reserva
--      decrementa, o físico vira "sobra fantasma" e a contagem rotativa
--      acusa erro onde não há.
--   3. Desfazer a divergência exigiria re-incrementar, e a reserva
--      viraria um 'ajuste', poluindo a trilha do material.
--
-- O custo é que todo escritor que baixa quantidade_massa passa a ter de
-- conhecer reserva. São três hoje (sup_est_baixar, sup_est_baixar_
-- quantidade, sup_est_remover_tag — tratados na parte 4), e o trigger
-- de invariante desta migration fecha a porta para os futuros.
--
-- Esta migration NÃO tem comportamento observável: reservado = 0 em
-- tudo até a parte 3 existir.
--
-- ROLLBACK:
--   DROP VIEW IF EXISTS public.sup_estoque_saldo;
--   -- recriar a versão de 20260820000001_supply_estoque.sql:162
--   DROP TRIGGER IF EXISTS trg_sup_reserva_liberacao_no_delete ON public.sup_estoque_reserva;
--   DROP TRIGGER IF EXISTS trg_sup_tag_guard_saldo_reservado ON public.sup_estoque_tag;
--   DROP TRIGGER IF EXISTS trg_sup_tag_guard_reserva ON public.sup_estoque_tag;
--   DROP FUNCTION IF EXISTS public.sup_reserva_liberacao_no_delete();
--   DROP FUNCTION IF EXISTS public.sup_est_tag_guard_saldo_reservado();
--   DROP FUNCTION IF EXISTS public.sup_est_tag_guard_reserva();
--   DROP TABLE IF EXISTS public.sup_estoque_reserva;
--   ALTER TABLE public.sup_estoque_movimento DROP CONSTRAINT IF EXISTS sup_estoque_movimento_tipo_check;
--   ALTER TABLE public.sup_estoque_movimento ADD CONSTRAINT sup_estoque_movimento_tipo_check
--     CHECK (tipo IN ('entrada','saida','devolucao','ajuste','remocao'));
-- =====================================================================

-- ── 1. A reserva ─────────────────────────────────────────────────────
--
-- Por que tabela e não uma coluna `quantidade_reservada` em
-- sup_estoque_tag: um lote serve N pedidos, e um contador não diz PARA
-- QUEM. Liberar a reserva de um pedido exigiria recalcular o quanto a
-- partir de outro lugar — a definição de duas verdades sobre o mesmo
-- fato, que é o preço que este módulo já pagou uma vez (o comentário em
-- src/hooks/useSupPedidos.ts:107-124 conta a história).
--
-- Além disso: contador em coluna é read-modify-write; linha por reserva
-- deixa o Postgres somar sob lock, e cada delta fica auditável — quem
-- reservou, quando, para qual item de qual pedido.
--
-- Sem snapshot de codigo/tamanho/sup_item_id de propósito: vêm por JOIN
-- em tag_id. O snapshot auditável já mora em sup_estoque_movimento, que
-- sobrevive ao DELETE do item pelo trigger sup_est_mov_preenche_material().

CREATE TABLE IF NOT EXISTS public.sup_estoque_reserva (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES public.empresas(id)          ON DELETE CASCADE,
  -- NOT NULL + CASCADE nos quatro: reserva sem lote, sem pedido ou sem
  -- item de pedido não significa nada. O que protege o dado é o guard de
  -- DELETE abaixo, não um SET NULL que deixaria linha órfã viva.
  tag_id             uuid NOT NULL REFERENCES public.sup_estoque_tag(id)   ON DELETE CASCADE,
  item_estoque_id    uuid NOT NULL REFERENCES public.sup_estoque_item(id)  ON DELETE CASCADE,
  pedido_id          uuid NOT NULL REFERENCES public.sup_pedido(id)        ON DELETE CASCADE,
  pedido_item_id     uuid NOT NULL REFERENCES public.sup_pedido_item(id)   ON DELETE CASCADE,
  quantidade         integer NOT NULL CHECK (quantidade > 0),
  situacao           text NOT NULL DEFAULT 'ATIVA'
                       CHECK (situacao IN ('ATIVA','CONSUMIDA','LIBERADA','DIVERGENTE')),
  motivo             text,
  reservado_em       timestamptz NOT NULL DEFAULT now(),
  reservado_por      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reservado_por_nome text,
  fechado_em         timestamptz,
  fechado_por        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  fechado_por_nome   text
);

-- Uma reserva ATIVA por (lote, item do pedido). Reabrir depois de
-- consumir ou liberar é legítimo — por isso o índice é PARCIAL. É também
-- o que permite a divisão em CONSUMIDA + DIVERGENTE na separação parcial.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sup_reserva_ativa
  ON public.sup_estoque_reserva(tag_id, pedido_item_id) WHERE situacao = 'ATIVA';

-- O acesso quente: "quanto deste lote está reservado". Coberto com
-- INCLUDE porque roda na view de saldo, que roda em toda a tela de estoque.
CREATE INDEX IF NOT EXISTS idx_sup_reserva_tag_ativa
  ON public.sup_estoque_reserva(tag_id) INCLUDE (quantidade) WHERE situacao = 'ATIVA';

CREATE INDEX IF NOT EXISTS idx_sup_reserva_item_ativa
  ON public.sup_estoque_reserva(item_estoque_id) WHERE situacao = 'ATIVA';

CREATE INDEX IF NOT EXISTS idx_sup_reserva_pedido
  ON public.sup_estoque_reserva(pedido_id, pedido_item_id);

-- ── 2. RLS ───────────────────────────────────────────────────────────
--
-- ATENÇÃO — este é o modo de falha mais perigoso da migration inteira.
--
-- sup_estoque_saldo é security_invoker = true: roda sob a RLS de quem
-- consulta. Se a policy da reserva for MAIS RESTRITA que a da etiqueta,
-- o LEFT JOIN devolve zero, a view SUPERESTIMA o disponível, e não há
-- erro nenhum — silenciosamente, e só para o perfil errado.
--
-- Por isso a policy de SELECT copia exatamente a forma de
-- sup_estoque_tag_select (20260820000001:227) — herdar o escopo do item
-- pai pelo EXISTS —, e só ACRESCENTA quem opera pedido e separação. Mais
-- permissiva é seguro aqui; mais restrita é o bug.
--
-- O OR de sup_pedidos_materiais não é decorativo: a view
-- sup_pedido_situacao (parte 2) precisa enxergar reserva para contar
-- "itens em separação" para quem só tem a tela de pedidos.

ALTER TABLE public.sup_estoque_reserva ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sup_estoque_reserva_select ON public.sup_estoque_reserva;
CREATE POLICY sup_estoque_reserva_select ON public.sup_estoque_reserva
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sup_estoque_item ei
       WHERE ei.id = sup_estoque_reserva.item_estoque_id
    )
    OR public.can_access(auth.uid(), 'sup_pedidos_materiais', 'visualizar')
    OR public.can_access(auth.uid(), 'sup_separacao', 'visualizar')
  );

-- Sem policy de INSERT/UPDATE/DELETE de propósito: escrita só pelas RPCs
-- SECURITY DEFINER da parte 3, que reconferem a permissão à mão. Mesmo
-- desenho de sup_estoque_consumo (20260820000001:263).

-- ── 3. Guard: não apagar lote com reserva viva ───────────────────────
--
-- Trigger e não checagem dentro da RPC porque o SQL Editor também é um
-- caminho de escrita, e sup_est_remover_tag não é o único jeito de uma
-- etiqueta sumir.

CREATE OR REPLACE FUNCTION public.sup_est_tag_guard_reserva()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE v_q integer;
BEGIN
  SELECT COALESCE(SUM(r.quantidade), 0) INTO v_q
    FROM public.sup_estoque_reserva r
   WHERE r.tag_id = OLD.id AND r.situacao = 'ATIVA';

  IF v_q > 0 THEN
    RAISE EXCEPTION
      'Lote % tem % unidade(s) reservada(s) para separação. Libere a reserva antes de remover.',
      OLD.codigo, v_q;
  END IF;

  RETURN OLD;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_sup_tag_guard_reserva ON public.sup_estoque_tag;
CREATE TRIGGER trg_sup_tag_guard_reserva
  BEFORE DELETE ON public.sup_estoque_tag
  FOR EACH ROW EXECUTE FUNCTION public.sup_est_tag_guard_reserva();

-- ── 4. Guard de invariante — a peça mais importante ──────────────────
--
-- Invariante único do sistema, para toda etiqueta:
--
--     SUM(reserva.quantidade WHERE ATIVA)  <=  fisico(tag)
--
-- onde fisico = quantidade_massa para 'massa', e (usado ? 0 : 1) para
-- 'unico'.
--
-- Dispara só quando o saldo físico CAI ou a etiqueta passa a usada.
-- Devolução, entrada e correção de cadastro não entram.
--
-- >>> ORDEM OBRIGATÓRIA nas RPCs que consomem reserva: fecha a reserva
-- >>> PRIMEIRO (situacao = 'CONSUMIDA'), decrementa a etiqueta DEPOIS.
-- >>> Invertido, este trigger vê a reserva ainda ATIVA sobre o saldo já
-- >>> reduzido e recusa a própria operação legítima.

CREATE OR REPLACE FUNCTION public.sup_est_tag_guard_saldo_reservado()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE v_res integer; v_fis integer;
BEGIN
  IF NOT (
       COALESCE(NEW.quantidade_massa, 0) < COALESCE(OLD.quantidade_massa, 0)
    OR (NEW.usado AND NOT OLD.usado)
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(r.quantidade), 0) INTO v_res
    FROM public.sup_estoque_reserva r
   WHERE r.tag_id = NEW.id AND r.situacao = 'ATIVA';

  IF v_res = 0 THEN RETURN NEW; END IF;

  v_fis := CASE
             WHEN NEW.tipo = 'massa' THEN COALESCE(NEW.quantidade_massa, 0)
             WHEN NEW.usado          THEN 0
             ELSE 1
           END;

  IF v_res > v_fis THEN
    RAISE EXCEPTION
      'Lote %: sobrariam % unidade(s) física(s) para % unidade(s) reservada(s) em separação.',
      NEW.codigo, v_fis, v_res;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_sup_tag_guard_saldo_reservado ON public.sup_estoque_tag;
CREATE TRIGGER trg_sup_tag_guard_saldo_reservado
  BEFORE UPDATE ON public.sup_estoque_tag
  FOR EACH ROW EXECUTE FUNCTION public.sup_est_tag_guard_saldo_reservado();

-- ── 5. Trilha quando a reserva morre por CASCADE ─────────────────────
--
-- A tela de pedidos faz DELETE direto em sup_pedido
-- (PedidosMateriais.tsx:308), não RPC. O CASCADE some com a reserva e a
-- mercadoria reaparece no saldo sem uma única linha na trilha do
-- material. Este trigger é o que impede isso.
--
-- Duas cautelas que parecem paranoia e não são:
--
--   * pedido_id fica NULL no movimento. Numa exclusão de pedido, o
--     CASCADE apaga a linha-pai ANTES de rodar as ações referenciais, de
--     modo que o INSERT com FK para sup_pedido violaria a constraint. O
--     protocolo vai em observacao, que é texto e não tem FK.
--   * item_estoque_id é resolvido por lookup, e a função desiste se a
--     etiqueta já não existe — sinal de que quem está sendo apagado é o
--     próprio item de estoque, e aí não há material em que pendurar a
--     trilha.

CREATE OR REPLACE FUNCTION public.sup_reserva_liberacao_no_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_codigo    text;
  v_ei        uuid;
  v_protocolo text;
BEGIN
  -- Só reserva viva vira liberação. Linha já CONSUMIDA/LIBERADA/
  -- DIVERGENTE morrendo por cascata não é evento de estoque.
  IF OLD.situacao <> 'ATIVA' THEN RETURN OLD; END IF;

  SELECT tg.codigo INTO v_codigo
    FROM public.sup_estoque_tag tg WHERE tg.id = OLD.tag_id;
  IF v_codigo IS NULL THEN RETURN OLD; END IF;

  SELECT ei.id INTO v_ei
    FROM public.sup_estoque_item ei WHERE ei.id = OLD.item_estoque_id;

  IF NOT EXISTS (SELECT 1 FROM public.empresas e WHERE e.id = OLD.empresa_id) THEN
    RETURN OLD;
  END IF;

  SELECT p.pedido_id INTO v_protocolo
    FROM public.sup_pedido p WHERE p.id = OLD.pedido_id;

  INSERT INTO public.sup_estoque_movimento
    (empresa_id, item_estoque_id, codigo, tipo, quantidade, observacao,
     usuario_id, usuario_nome)
  VALUES
    (OLD.empresa_id, v_ei, v_codigo, 'liberacao', OLD.quantidade,
     format('Reserva desfeita: %s',
            COALESCE('pedido ' || v_protocolo || ' excluído', 'registro de origem excluído')),
     OLD.reservado_por, OLD.reservado_por_nome);

  RETURN OLD;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_sup_reserva_liberacao_no_delete ON public.sup_estoque_reserva;
CREATE TRIGGER trg_sup_reserva_liberacao_no_delete
  AFTER DELETE ON public.sup_estoque_reserva
  FOR EACH ROW EXECUTE FUNCTION public.sup_reserva_liberacao_no_delete();

-- ── 6. Dois tipos novos de movimento ─────────────────────────────────
--
-- A constraint original é anônima (20260820000001:136-137), então o nome
-- é descoberto e não assumido.

DO $mig$
DECLARE v_con text;
BEGIN
  SELECT c.conname INTO v_con
    FROM pg_constraint c
   WHERE c.conrelid = 'public.sup_estoque_movimento'::regclass
     AND c.contype  = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%tipo%'
     AND pg_get_constraintdef(c.oid) ILIKE '%remocao%';

  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.sup_estoque_movimento DROP CONSTRAINT %I', v_con);
  END IF;

  ALTER TABLE public.sup_estoque_movimento
    ADD CONSTRAINT sup_estoque_movimento_tipo_check
    CHECK (tipo IN ('entrada','saida','devolucao','ajuste','remocao','reserva','liberacao'));
END
$mig$;

-- ── 7. O saldo passa a ser líquido de reserva ────────────────────────
--
-- CREATE OR REPLACE e não uma view _v2: os dois consumidores reais
-- (useSaldoMaterial e sup_item_por_codigo) querem o líquido, e um
-- segundo saldo reconstruiria exatamente a doença que a §12.8 documenta
-- — duas fórmulas para o mesmo número e ninguém sabendo qual vale.
--
-- O Postgres permite trocar a EXPRESSÃO de uma coluna existente e
-- ACRESCENTAR colunas no fim, desde que nome, tipo e ordem das antigas
-- não mudem. Por isso `reservado` e `fisico` entram por último.
--
-- `disponivel` NÃO é clampado em zero de propósito: negativo é bug, e
-- esconder bug de saldo foi o que produziu esta reforma. A varredura de
-- invariante (no cabeçalho da parte 3) é a rede.
--
-- security_invoker é REAFIRMADO — não confie na herança da opção pelo
-- CREATE OR REPLACE.

CREATE OR REPLACE VIEW public.sup_estoque_saldo
WITH (security_invoker = true) AS
SELECT
  ei.id                AS item_estoque_id,
  ei.empresa_id,
  ei.almoxarifado_id,
  ei.sup_item_id,
  t.tamanho,
  (COALESCE(SUM(CASE
     WHEN t.tipo = 'massa' AND NOT t.usado THEN COALESCE(t.quantidade_massa, 0)
     WHEN t.tipo = 'unico' AND NOT t.usado THEN 1
     ELSE 0 END), 0)
   - COALESCE(SUM(r.reservado), 0))::integer AS disponivel,
  COALESCE(SUM(CASE
    WHEN t.tipo = 'massa' THEN COALESCE(t.quantidade_original_massa, 0) - COALESCE(t.quantidade_massa, 0)
    WHEN t.tipo = 'unico' AND t.usado THEN 1
    ELSE 0 END), 0)::integer AS consumido,
  count(t.id) FILTER (WHERE t.id IS NOT NULL)::integer AS etiquetas,
  -- Colunas novas, obrigatoriamente no fim.
  COALESCE(SUM(r.reservado), 0)::integer AS reservado,
  COALESCE(SUM(CASE
    WHEN t.tipo = 'massa' AND NOT t.usado THEN COALESCE(t.quantidade_massa, 0)
    WHEN t.tipo = 'unico' AND NOT t.usado THEN 1
    ELSE 0 END), 0)::integer AS fisico
  FROM public.sup_estoque_item ei
  LEFT JOIN public.sup_estoque_tag t ON t.item_estoque_id = ei.id
  LEFT JOIN LATERAL (
    SELECT SUM(rr.quantidade)::integer AS reservado
      FROM public.sup_estoque_reserva rr
     WHERE rr.tag_id = t.id AND rr.situacao = 'ATIVA'
  ) r ON true
 GROUP BY ei.id, ei.empresa_id, ei.almoxarifado_id, ei.sup_item_id, t.tamanho;

REVOKE ALL ON FUNCTION public.sup_est_tag_guard_reserva()          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_est_tag_guard_saldo_reservado()  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_reserva_liberacao_no_delete()    FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';
