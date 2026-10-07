-- SIS-2026-0455 — Reativar material removido do enxoval (18/09/2026)
--
-- Pedido: reincluir no enxoval um material cuja remoção ainda aguardava
-- aprovação. A causa raiz era o vínculo inativo permanecer na tabela e a
-- aprovação posterior apagar um vínculo que já havia sido reativado.
-- Esta edição protege a exclusão do vínculo função ↔ item nesse caso.

CREATE OR REPLACE FUNCTION public.sup_cat_decidir_lote(
  p_lote_id uuid, p_status text, p_comentario text DEFAULT NULL
) RETURNS public.sup_cat_lote
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text;
  v_lote public.sup_cat_lote;
  r      record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_catalogo_aprovacao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para aprovar catálogo';
  END IF;
  IF p_status NOT IN ('APROVADO','REPROVADO') THEN
    RAISE EXCEPTION 'Status inválido: %', p_status;
  END IF;

  SELECT * INTO v_lote FROM public.sup_cat_lote l WHERE l.id = p_lote_id FOR UPDATE;
  IF v_lote.id IS NULL THEN RAISE EXCEPTION 'Lote não encontrado'; END IF;
  -- Idempotência: decidir duas vezes é erro, não silêncio (legado §11.3).
  IF v_lote.status <> 'PENDENTE' THEN
    RAISE EXCEPTION 'Lote já foi decidido (status atual: %)', v_lote.status;
  END IF;

  FOR r IN
    SELECT a.tipo_entidade, a.tipo_acao, a.alvo_id
      FROM public.sup_cat_alteracao a
     WHERE a.lote_id = p_lote_id AND a.status = 'PENDENTE'
  LOOP
    IF p_status = 'APROVADO' THEN
      IF r.tipo_acao = 'criar' THEN
        CASE r.tipo_entidade
          WHEN 'posto'       THEN UPDATE public.sup_posto       SET aprovado = true WHERE id = r.alvo_id;
          WHEN 'funcao'      THEN UPDATE public.sup_funcao      SET aprovado = true WHERE id = r.alvo_id;
          WHEN 'item'        THEN UPDATE public.sup_item        SET aprovado = true WHERE id = r.alvo_id;
          WHEN 'funcao_item' THEN
            UPDATE public.sup_funcao_item SET aprovado = true WHERE id = r.alvo_id;
            -- O material vinculado vai junto. Sem isto, material sem
            -- proposta própria (os 304 do legado) ficava aprovado no
            -- enxoval e invisível no sup_ext_itens — incidente do CEITEC.
            UPDATE public.sup_item i
               SET aprovado = true
              FROM public.sup_funcao_item fi
             WHERE fi.id = r.alvo_id
               AND i.id = fi.item_id
               AND i.aprovado = false;
          ELSE NULL; -- 'opcoes' acompanha o item, não tem flag própria
        END CASE;
      ELSIF r.tipo_acao = 'excluir' THEN
        CASE r.tipo_entidade
          WHEN 'posto'       THEN DELETE FROM public.sup_posto       WHERE id = r.alvo_id;
          WHEN 'funcao'      THEN DELETE FROM public.sup_funcao      WHERE id = r.alvo_id;
          WHEN 'item'        THEN DELETE FROM public.sup_item        WHERE id = r.alvo_id;
          -- EDIÇÃO 20261006150000: se a remoção foi desfeita e o vínculo reativado
          -- antes da aprovação, aprovar o lote não pode apagar o material.
          WHEN 'funcao_item' THEN DELETE FROM public.sup_funcao_item WHERE id = r.alvo_id AND NOT ativo;
          ELSE NULL;
        END CASE;
      END IF;
    ELSE -- REPROVADO
      IF r.tipo_acao = 'criar' THEN
        CASE r.tipo_entidade
          WHEN 'posto'       THEN DELETE FROM public.sup_posto       WHERE id = r.alvo_id AND aprovado = false;
          WHEN 'funcao'      THEN DELETE FROM public.sup_funcao      WHERE id = r.alvo_id AND aprovado = false;
          WHEN 'item'        THEN DELETE FROM public.sup_item        WHERE id = r.alvo_id AND aprovado = false;
          WHEN 'funcao_item' THEN DELETE FROM public.sup_funcao_item WHERE id = r.alvo_id AND aprovado = false;
          ELSE NULL;
        END CASE;
      ELSIF r.tipo_acao = 'excluir' THEN
        CASE r.tipo_entidade
          WHEN 'posto'       THEN UPDATE public.sup_posto       SET ativo = true WHERE id = r.alvo_id;
          WHEN 'funcao'      THEN UPDATE public.sup_funcao      SET ativo = true WHERE id = r.alvo_id;
          WHEN 'item'        THEN UPDATE public.sup_item        SET ativo = true WHERE id = r.alvo_id;
          WHEN 'funcao_item' THEN UPDATE public.sup_funcao_item SET ativo = true WHERE id = r.alvo_id;
          ELSE NULL;
        END CASE;
      END IF;
    END IF;
  END LOOP;

  -- ── EDIÇÃO 0165: o que foi aprovado e não tem estoque vira pré-entrada ──
  --
  -- Roda depois do loop, de propósito: o loop é que acaba de aprovar os
  -- materiais, e a fila tem de enxergar o estado final. Um SELECT só, em
  -- vez de uma linha dentro de cada ramo do CASE.
  --
  -- Entra material tocado por 'item' (alvo_id É o sup_item) e por
  -- 'funcao_item' (alvo_id é o vínculo; o material sai do item_id dele) —
  -- decisão de 16/09/2026: todo material do lote sem ficha, não só o criado
  -- ali, porque material antigo do legado nunca teve proposta própria.
  IF p_status = 'APROVADO' THEN
    INSERT INTO public.sup_pre_entrada (empresa_id, sup_item_id, origem, lote_id, contexto, created_by)
    SELECT DISTINCT ON (i.id) i.empresa_id, i.id, 'catalogo', p_lote_id, a.contexto, v_uid
      FROM public.sup_cat_alteracao a
      JOIN public.sup_item i
        ON i.id = CASE
             WHEN a.tipo_entidade = 'item' THEN a.alvo_id
             ELSE (SELECT fi.item_id FROM public.sup_funcao_item fi WHERE fi.id = a.alvo_id)
           END
     WHERE a.lote_id   = p_lote_id
       AND a.tipo_acao = 'criar'
       AND a.tipo_entidade IN ('item', 'funcao_item')
       AND i.ativo
       -- Já tem ficha de estoque? Conta a ficha do próprio material E a dos
       -- TAMANHOS dele: desde a 20260930000163 o saldo da JAQUETA mora na
       -- JAQUETA M, e sem o item_pai_id aqui toda jaqueta com estoque
       -- entraria na fila como se não tivesse nenhuma.
       AND NOT EXISTS (
         SELECT 1
           FROM public.sup_estoque_item ei
           JOIN public.sup_item f ON f.id = ei.sup_item_id
          WHERE f.id = i.id OR f.item_pai_id = i.id
       )
       -- Já está na fila (outro lote tocou o mesmo material): não duplica.
       AND NOT EXISTS (
         SELECT 1 FROM public.sup_pre_entrada pe
          WHERE pe.sup_item_id = i.id AND pe.situacao = 'PENDENTE'
       )
     ORDER BY i.id, a.created_at
    ON CONFLICT DO NOTHING;
  END IF;

  SELECT p.display_name INTO v_nome FROM public.profiles p WHERE p.id = v_uid;

  UPDATE public.sup_cat_alteracao a SET status = p_status WHERE a.lote_id = p_lote_id;
  UPDATE public.sup_cat_lote l
     SET status = p_status, comentario = p_comentario, decidido_por = v_uid,
         decidido_por_nome = v_nome, data_resposta = now()
   WHERE l.id = p_lote_id
  RETURNING * INTO v_lote;

  RETURN v_lote;
END $$;

REVOKE ALL ON FUNCTION public.sup_cat_decidir_lote(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_cat_decidir_lote(uuid, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── ROLLBACK ──────────────────────────────────────────────────────────────
-- Reexecutar a definição de sup_cat_decidir_lote da migration 0165, com a
-- linha original de funcao_item sem "AND NOT ativo".
