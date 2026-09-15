-- =====================================================================
-- ESTOQUE — excluir o MATERIAL inteiro do estoque, não só um lote
--
-- O QUE FALTAVA (14/09/2026)
-- Em /app/suprimentos/estoque-etiquetas a única exclusão era a lixeira do
-- lote, dentro do modal do material (sup_est_remover_tag). Material cadastrado
-- no almoxarifado errado, ou lote de EPI inteiro descartado, exigia apagar
-- entrada por entrada — e a linha continuava na lista mesmo zerada.
--
-- A REGRA (decidida pelo Eduardo): ZERAR E ARQUIVAR
--   • todo lote com saldo sai da prateleira, cada um com seu movimento de
--     'remocao' e o motivo — a trilha continua dizendo o que saiu e por quê;
--   • material que NUNCA atendeu pedido é apagado de vez;
--   • material que JÁ atendeu pedido é ARQUIVADO: some da lista, mas a linha
--     de sup_estoque_item fica. É ela que segura, por CASCADE, o ledger
--     sup_estoque_consumo e as etiquetas usadas com pedido_id — apagar
--     tiraria dos pedidos antigos o registro de qual lote e qual custo saiu
--     para eles.
--
-- POR QUE APAGAR OS LOTES LIVRES EM VEZ DE ZERAR A QUANTIDADE
-- `sst_ca_guard_baixa` (20260930000018) barra QUALQUER redução de
-- quantidade de lote de EPI com CA vencido. Zerar esbarraria nele justamente
-- no caso que mais precisa desta função — o descarte das máscaras com CA
-- vencido. O DELETE do lote não passa por esse gatilho, e é o mesmo caminho
-- que a lixeira do lote já usa. Lote com reserva ATIVA continua barrado
-- (aqui, com mensagem que cita o pedido, e em sup_est_tag_guard_reserva).
--
-- ENTRADA NOVA DESARQUIVA SOZINHA
-- sup_est_entrada_quantidade faz ON CONFLICT (almoxarifado_id, sup_item_id)
-- — cairia na linha arquivada e o material recebido ficaria invisível. O
-- gatilho da parte 3 devolve o material à lista sempre que um lote nasce
-- ou volta a ter saldo (entrada, NF, devolução), por qualquer caminho.
--
-- Idempotente. ROLLBACK no rodapé.
-- =====================================================================

-- ── 1. Colunas de arquivamento ───────────────────────────────────────
ALTER TABLE public.sup_estoque_item
  ADD COLUMN IF NOT EXISTS arquivado_em       timestamptz,
  ADD COLUMN IF NOT EXISTS arquivado_por      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS arquivado_por_nome text,
  ADD COLUMN IF NOT EXISTS arquivado_motivo   text;

COMMENT ON COLUMN public.sup_estoque_item.arquivado_em IS
  'Preenchida por sup_est_excluir_item quando o material sai do estoque mas já atendeu pedido. A tela esconde; a linha fica para o histórico dos pedidos. Volta a NULL sozinha na próxima entrada.';

-- ── 2. A exclusão ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sup_est_excluir_item(p_item_estoque_id uuid, p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_nome    text := public.sup_est_nome_usuario();
  v_motivo  text := nullif(btrim(COALESCE(p_motivo, '')), '');
  v_item    record;
  v_pedidos text;
  v_unid    int := 0;
  v_lotes   int := 0;
  t         record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  -- Mesma ação da lixeira do lote: quem pode apagar um lote pode apagar todos.
  IF NOT public.can_access(v_uid, 'sup_estoque', 'excluir') THEN
    RAISE EXCEPTION 'Sem permissão para excluir material do estoque';
  END IF;
  IF v_motivo IS NULL THEN RAISE EXCEPTION 'Informe o motivo da exclusão'; END IF;

  SELECT ei.* INTO v_item
    FROM public.sup_estoque_item ei
   WHERE ei.id = p_item_estoque_id
     FOR UPDATE;
  IF v_item.id IS NULL THEN RAISE EXCEPTION 'Material não encontrado no estoque'; END IF;
  IF v_item.arquivado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Este material já foi excluído do estoque';
  END IF;

  -- O gatilho de reserva barraria de qualquer jeito, mas com "Lote L260914-…",
  -- que ninguém na tela reconhece. Aqui a mensagem diz qual pedido travou.
  SELECT string_agg(DISTINCT p.pedido_id, ', ') INTO v_pedidos
    FROM public.sup_estoque_reserva r
    JOIN public.sup_pedido p ON p.id = r.pedido_id
   WHERE r.item_estoque_id = v_item.id AND r.situacao = 'ATIVA';
  IF v_pedidos IS NOT NULL THEN
    RAISE EXCEPTION 'Este material está reservado para separação (pedido %). Conclua ou libere a separação antes de excluir.', v_pedidos;
  END IF;

  -- Só lote com saldo na prateleira. Etiqueta usada e lote zerado ficam: são
  -- o registro do que foi para cada pedido.
  FOR t IN
    SELECT tg.id, tg.codigo, tg.tamanho,
           CASE WHEN tg.tipo = 'massa' THEN COALESCE(tg.quantidade_massa, 0) ELSE 1 END AS qtd
      FROM public.sup_estoque_tag tg
     WHERE tg.item_estoque_id = v_item.id
       AND NOT tg.usado
       AND (tg.tipo = 'unico' OR COALESCE(tg.quantidade_massa, 0) > 0)
     ORDER BY tg.sequencia
       FOR UPDATE
  LOOP
    -- Movimento ANTES do DELETE: sup_est_mov_preenche_material precisa do
    -- item vivo para ancorar o histórico no sup_item.
    INSERT INTO public.sup_estoque_movimento
      (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho,
       observacao, usuario_id, usuario_nome)
    VALUES (v_item.empresa_id, v_item.id, t.codigo, 'remocao', t.qtd, t.tamanho,
            'Material excluído do estoque: ' || v_motivo, v_uid, v_nome);

    DELETE FROM public.sup_estoque_tag tg WHERE tg.id = t.id;
    v_unid  := v_unid + t.qtd;
    v_lotes := v_lotes + 1;
  END LOOP;

  -- Material já zerado: sem lote para registrar, mas a exclusão em si tem de
  -- aparecer na trilha, com quem e por quê.
  IF v_lotes = 0 THEN
    INSERT INTO public.sup_estoque_movimento
      (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho,
       observacao, usuario_id, usuario_nome)
    VALUES (v_item.empresa_id, v_item.id, NULL, 'remocao', 0, NULL,
            'Material excluído do estoque: ' || v_motivo, v_uid, v_nome);
  END IF;

  -- Pendência de contagem de um material que saiu do estoque não tem mais o
  -- que contar. Fica CANCELADA, não apagada — é prova de investigação.
  UPDATE public.sup_estoque_contagem_fila f
     SET situacao = 'CANCELADA', fechada_em = now(),
         fechada_por = v_uid, fechada_por_nome = v_nome
   WHERE f.item_estoque_id = v_item.id AND f.situacao = 'ABERTA';

  -- Algo aqui pende da linha por CASCADE? Então arquiva. Senão, apaga.
  IF EXISTS (SELECT 1 FROM public.sup_estoque_tag tg      WHERE tg.item_estoque_id = v_item.id)
  OR EXISTS (SELECT 1 FROM public.sup_estoque_consumo c   WHERE c.item_estoque_id  = v_item.id)
  OR EXISTS (SELECT 1 FROM public.sup_estoque_contagem_fila f WHERE f.item_estoque_id = v_item.id)
  THEN
    -- Mínimo zerado: material arquivado com mínimo > 0 ficaria para sempre
    -- "abaixo do mínimo" e pedindo reposição de algo que se decidiu tirar.
    UPDATE public.sup_estoque_item ei
       SET arquivado_em = now(), arquivado_por = v_uid,
           arquivado_por_nome = v_nome, arquivado_motivo = v_motivo,
           estoque_minimo = 0
     WHERE ei.id = v_item.id;
    RETURN jsonb_build_object('acao', 'arquivou', 'unidades', v_unid, 'lotes', v_lotes);
  END IF;

  DELETE FROM public.sup_estoque_item ei WHERE ei.id = v_item.id;
  RETURN jsonb_build_object('acao', 'apagou', 'unidades', v_unid, 'lotes', v_lotes);
END $$;

REVOKE EXECUTE ON FUNCTION public.sup_est_excluir_item(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sup_est_excluir_item(uuid, text) TO authenticated;

-- ── 3. Saldo de volta → material de volta à lista ────────────────────
--
-- Gatilho, e não mudança nas RPCs de entrada/devolução: são quatro caminhos
-- (entrada antiga, entrada por quantidade, NF, devolução) e o próximo que
-- surgir também esqueceria de desarquivar.
CREATE OR REPLACE FUNCTION public.sup_est_item_desarquiva()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND NOT (
       (OLD.usado AND NOT NEW.usado)
    OR COALESCE(NEW.quantidade_massa, 0) > COALESCE(OLD.quantidade_massa, 0)
  ) THEN
    RETURN NEW;
  END IF;

  UPDATE public.sup_estoque_item ei
     SET arquivado_em = NULL, arquivado_por = NULL,
         arquivado_por_nome = NULL, arquivado_motivo = NULL
   WHERE ei.id = NEW.item_estoque_id AND ei.arquivado_em IS NOT NULL;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_sup_tag_desarquiva_item ON public.sup_estoque_tag;
CREATE TRIGGER trg_sup_tag_desarquiva_item
  AFTER INSERT OR UPDATE OF usado, quantidade_massa ON public.sup_estoque_tag
  FOR EACH ROW EXECUTE FUNCTION public.sup_est_item_desarquiva();

REVOKE ALL ON FUNCTION public.sup_est_item_desarquiva() FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';

-- ── Conferência (rodar à parte) ──────────────────────────────────────
--   SELECT proname FROM pg_proc
--    WHERE proname IN ('sup_est_excluir_item', 'sup_est_item_desarquiva');
--   SELECT count(*) FILTER (WHERE arquivado_em IS NOT NULL) AS arquivados
--     FROM public.sup_estoque_item;

-- ── ROLLBACK ─────────────────────────────────────────────────────────
--   DROP TRIGGER IF EXISTS trg_sup_tag_desarquiva_item ON public.sup_estoque_tag;
--   DROP FUNCTION IF EXISTS public.sup_est_item_desarquiva();
--   DROP FUNCTION IF EXISTS public.sup_est_excluir_item(uuid, text);
--   -- As colunas só depois de conferir que nenhum material está arquivado —
--   -- sem elas, os arquivados voltariam a aparecer na lista, zerados:
--   ALTER TABLE public.sup_estoque_item
--     DROP COLUMN IF EXISTS arquivado_motivo,
--     DROP COLUMN IF EXISTS arquivado_por_nome,
--     DROP COLUMN IF EXISTS arquivado_por,
--     DROP COLUMN IF EXISTS arquivado_em;
--   NOTIFY pgrst, 'reload schema';
