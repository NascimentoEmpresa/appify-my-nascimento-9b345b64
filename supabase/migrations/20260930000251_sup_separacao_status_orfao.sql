-- =====================================================================
-- SIS-2026-0538 — pedido preso em EM SEPARACAO sem nada para separar
--
-- O CASO (PED-20260924-0408, 24/09/2026, horários em UTC):
--   12:50:28  Bernardo edita o pedido: troca BOTINA 40 por BABUCHE 40.
--   12:50:30  Bernardo faz "Conferir e reservar": 1 unidade reservada,
--             pedido vai para EM SEPARACAO.
--   12:50:57  Talis salva o modal de edição que tinha aberto ANTES da
--             edição do Bernardo, com a mesma troca. O BABUCHE dele vai sem
--             id, então sup_pedido_editar apaga o item do Bernardo e cria
--             um igual.
--
-- Apagar o sup_pedido_item cascateia para sup_estoque_reserva, e o gatilho
-- sup_reserva_liberacao_no_delete (20260930000076) devolveu o saldo com
-- trilha — o ESTOQUE ficou certo. Mas ninguém voltou o STATUS: o pedido
-- ficou em EM SEPARACAO com zero reservas ativas, e daí não havia saída:
--   • a fila de Separação (sup_sep_fila) só lista reserva ATIVA — ele some;
--   • o botão Status fica desabilitado em EM SEPARACAO;
--   • sup_sep_liberar só mudava o status se liberasse alguma coisa (v_n > 0);
--   • sup_est_baixar recusa EM SEPARACAO.
--
-- 20260930000080 (cabeçalho) decidiu de propósito que a edição pode remover
-- item com reserva ativa, porque "o CASCADE + o gatilho de liberação não
-- corrompem nada". Continua valendo para o saldo; o furo era o status, e é
-- só ele que esta migration fecha. A decisão de permitir a edição fica.
--
-- O que muda:
--   1. sup_reserva_liberacao_no_delete: quando a reserva some e o pedido
--      ainda existe, em EM SEPARACAO e sem nenhuma reserva ATIVA sobrando,
--      o pedido volta para EM PREPARACAO com linha no histórico. No gatilho,
--      e não só em sup_pedido_editar, pelo mesmo motivo do gatilho original:
--      cobre o SQL Editor e qualquer tela futura que apague item.
--      De quebra, corrige o texto do movimento, que estava INVERTIDO — dizia
--      "pedido X excluído" justamente quando o pedido NÃO foi excluído (o
--      protocolo só é encontrado quando o pedido ainda existe).
--   2. sup_sep_liberar: pedido EM SEPARACAO sem reserva ativa volta para
--      EM PREPARACAO mesmo que a chamada não tenha liberado nada. É a porta
--      de saída manual, agora com botão em Pedidos de Materiais.
--   3. Destrava o PED-20260924-0408, por nome.
--
-- ROLLBACK: ver bloco comentado no fim do arquivo.
-- =====================================================================

-- ── 1. Liberação no DELETE da reserva ────────────────────────────────
--
-- Base: 20260930000076_suprimentos_reserva_estoque.sql:242. Edições
-- marcadas com "SIS-2026-0538".
--
-- Por que o "sobrou reserva ATIVA?" funciona com várias reservas apagadas
-- no mesmo comando: o gatilho é AFTER ROW, e esses rodam no FIM do comando,
-- quando todas as linhas já sumiram. A primeira execução muda o status; as
-- seguintes já encontram EM PREPARACAO e não fazem nada.
--
-- Na exclusão do PEDIDO, o CASCADE apaga a linha-pai antes, então o SELECT
-- do protocolo não encontra nada: pedido_id fica NULL no movimento (a FK
-- recusaria) e o UPDATE de status não roda — não há pedido para voltar.

CREATE OR REPLACE FUNCTION public.sup_reserva_liberacao_no_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_codigo    text;
  v_ei        uuid;
  v_protocolo text;
  v_status    text;
  v_uid       uuid;
  v_nome      text;
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

  SELECT p.pedido_id, p.status INTO v_protocolo, v_status
    FROM public.sup_pedido p WHERE p.id = OLD.pedido_id;

  -- SIS-2026-0538: o texto estava invertido. Protocolo encontrado = o
  -- pedido existe e quem sumiu foi o ITEM (edição); não encontrado = o
  -- pedido inteiro foi excluído.
  INSERT INTO public.sup_estoque_movimento
    (empresa_id, item_estoque_id, codigo, tipo, quantidade, pedido_id, observacao,
     usuario_id, usuario_nome)
  VALUES
    (OLD.empresa_id, v_ei, v_codigo, 'liberacao', OLD.quantidade,
     -- SIS-2026-0538: com o pedido vivo a FK aceita, e o movimento passa a
     -- aparecer na trilha do pedido.
     CASE WHEN v_protocolo IS NOT NULL THEN OLD.pedido_id END,
     CASE WHEN v_protocolo IS NOT NULL
          THEN format('Reserva desfeita: item removido na edição do pedido %s', v_protocolo)
          ELSE 'Reserva desfeita: pedido excluído' END,
     OLD.reservado_por, OLD.reservado_por_nome);

  -- SIS-2026-0538: sem reserva viva, EM SEPARACAO não tem o que separar.
  -- Volta para a fila da supervisora — mesmo destino de sup_sep_liberar.
  IF v_status = 'EM SEPARACAO'
     AND NOT EXISTS (SELECT 1 FROM public.sup_estoque_reserva rr
                      WHERE rr.pedido_id = OLD.pedido_id AND rr.situacao = 'ATIVA') THEN
    v_uid  := auth.uid();
    v_nome := coalesce(public.sup_est_nome_usuario(), 'sistema');

    UPDATE public.sup_pedido SET status = 'EM PREPARACAO'
     WHERE id = OLD.pedido_id AND status = 'EM SEPARACAO';

    -- Cita o LOTE e não o nome do item: num gatilho AFTER o sup_pedido_item
    -- que causou a cascata já não existe mais para ser lido.
    INSERT INTO public.sup_pedido_historico
      (pedido_id, acao, status_anterior, status_novo, observacao, alterado_por, alterado_por_nome)
    VALUES (OLD.pedido_id, 'STATUS', 'EM SEPARACAO', 'EM PREPARACAO',
            format('Reserva do lote %s desfeita porque o item foi removido na edição — confira e reserve de novo',
                   v_codigo),
            v_uid, v_nome);
  END IF;

  RETURN OLD;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_sup_reserva_liberacao_no_delete ON public.sup_estoque_reserva;
CREATE TRIGGER trg_sup_reserva_liberacao_no_delete
  AFTER DELETE ON public.sup_estoque_reserva
  FOR EACH ROW EXECUTE FUNCTION public.sup_reserva_liberacao_no_delete();

REVOKE ALL ON FUNCTION public.sup_reserva_liberacao_no_delete() FROM PUBLIC, anon, authenticated;

-- ── 2. sup_sep_liberar ───────────────────────────────────────────────
--
-- Base: 20260930000079_suprimentos_separacao_rpcs.sql:627. Única edição:
-- a volta para EM PREPARACAO não exige mais ter liberado algo nesta chamada.

CREATE OR REPLACE FUNCTION public.sup_sep_liberar(
  p_pedido_id  uuid,
  p_reserva_id uuid DEFAULT NULL,
  p_motivo     text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_nome  text := public.sup_est_nome_usuario();
  v_ped   record;
  v_n     integer := 0;
  v_q     integer := 0;
  r       record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_pedidos_materiais', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para liberar reserva';
  END IF;

  SELECT p.id, p.status, p.pedido_id INTO v_ped
    FROM public.sup_pedido p WHERE p.id = p_pedido_id FOR UPDATE;
  IF v_ped.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;

  FOR r IN
    SELECT rr.id, rr.quantidade, rr.empresa_id, rr.item_estoque_id, rr.pedido_item_id,
           tg.codigo, tg.tamanho
      FROM public.sup_estoque_reserva rr
      JOIN public.sup_estoque_tag tg ON tg.id = rr.tag_id
     WHERE rr.pedido_id = p_pedido_id AND rr.situacao = 'ATIVA'
       AND (p_reserva_id IS NULL OR rr.id = p_reserva_id)
     FOR UPDATE OF rr
  LOOP
    UPDATE public.sup_estoque_reserva
       SET situacao = 'LIBERADA', motivo = COALESCE(p_motivo, motivo), fechado_em = now(),
           fechado_por = v_uid, fechado_por_nome = v_nome
     WHERE id = r.id;

    INSERT INTO public.sup_estoque_movimento
      (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho,
       pedido_id, pedido_item_id, observacao, usuario_id, usuario_nome)
    VALUES (r.empresa_id, r.item_estoque_id, r.codigo, 'liberacao', r.quantidade, r.tamanho,
            p_pedido_id, r.pedido_item_id,
            format('Reserva liberada do pedido %s%s', v_ped.pedido_id,
                   COALESCE(': ' || nullif(btrim(p_motivo), ''), '')),
            v_uid, v_nome);

    v_n := v_n + 1;
    v_q := v_q + r.quantidade;
  END LOOP;

  -- Sem nada reservado, o pedido volta para a fila da supervisora.
  -- SIS-2026-0538: sem o antigo "v_n > 0". Um pedido que já chegou aqui
  -- sem reserva nenhuma (a reserva sumiu por fora) também precisa sair.
  IF v_ped.status = 'EM SEPARACAO'
     AND NOT EXISTS (SELECT 1 FROM public.sup_estoque_reserva rr
                      WHERE rr.pedido_id = p_pedido_id AND rr.situacao = 'ATIVA') THEN
    UPDATE public.sup_pedido SET status = 'EM PREPARACAO' WHERE id = p_pedido_id;
    INSERT INTO public.sup_pedido_historico
      (pedido_id, acao, status_anterior, status_novo, observacao, alterado_por, alterado_por_nome)
    VALUES (p_pedido_id, 'STATUS', 'EM SEPARACAO', 'EM PREPARACAO',
            CASE WHEN v_n > 0
                 THEN format('%s reserva(s) liberada(s)', v_n)
                 ELSE 'Pedido sem reserva ativa devolvido à preparação' END
              || COALESCE(' — ' || nullif(btrim(p_motivo), ''), ''),
            v_uid, v_nome);
  END IF;

  RETURN jsonb_build_object('liberadas', v_n, 'unidades', v_q);
END $fn$;

REVOKE ALL ON FUNCTION public.sup_sep_liberar(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_sep_liberar(uuid, uuid, text) TO authenticated;

-- ── 3. Destravar o PED-20260924-0408 ─────────────────────────────────
--
-- Por NOME, não por critério genérico. Idempotente: na segunda execução o
-- status já não é EM SEPARACAO e nada acontece (nem o histórico, que só
-- entra se o UPDATE pegou a linha).

WITH destravado AS (
  UPDATE public.sup_pedido p
     SET status = 'EM PREPARACAO'
   WHERE p.pedido_id = 'PED-20260924-0408'
     AND p.status = 'EM SEPARACAO'
     AND NOT EXISTS (SELECT 1 FROM public.sup_estoque_reserva rr
                      WHERE rr.pedido_id = p.id AND rr.situacao = 'ATIVA')
  RETURNING p.id
)
INSERT INTO public.sup_pedido_historico
  (pedido_id, acao, status_anterior, status_novo, observacao, alterado_por, alterado_por_nome)
SELECT d.id, 'STATUS', 'EM SEPARACAO', 'EM PREPARACAO',
       'SIS-2026-0538: a reserva foi desfeita por uma edição simultânea em 24/09 e o pedido ficou preso em separação. Devolvido à preparação — confira e reserve de novo.',
       NULL, 'sistema'
  FROM destravado d;

NOTIFY pgrst, 'reload schema';

-- ── Conferência (rodar à parte no SQL Editor) ────────────────────────
-- Esperado: nenhuma linha. Pedido em separação sem reserva viva é o
-- sintoma deste chamado.
--
--   SELECT p.pedido_id, p.status, p.updated_at
--     FROM public.sup_pedido p
--    WHERE p.status = 'EM SEPARACAO'
--      AND NOT EXISTS (SELECT 1 FROM public.sup_estoque_reserva rr
--                       WHERE rr.pedido_id = p.id AND rr.situacao = 'ATIVA');

-- =====================================================================
-- ROLLBACK
--
-- 1. Recriar sup_reserva_liberacao_no_delete() a partir de
--    20260930000076_suprimentos_reserva_estoque.sql:242 (o trigger continua
--    o mesmo; basta o CREATE OR REPLACE FUNCTION).
-- 2. Recriar sup_sep_liberar() a partir de
--    20260930000079_suprimentos_separacao_rpcs.sql:627.
-- 3. O destravamento do PED-20260924-0408 não se desfaz: voltar para
--    EM SEPARACAO sem reserva é justamente o estado quebrado.
-- =====================================================================
