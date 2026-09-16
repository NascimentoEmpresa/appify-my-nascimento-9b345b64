-- =====================================================================
-- ESTOQUE — Pré-Entrada de Itens: a ponte entre o Catálogo e a prateleira
--
-- PEDIDO (16/09/2026)
--   "Ao criar uma aprovação de catálogo em /app/suprimentos/catalogo e ela
--    ser aprovada em /app/suprimentos/catalogo/aprovacoes, se o item não
--    existe no estoque ele vai para /app/suprimentos/estoque-etiquetas
--    dentro do botão 'Pré-Entrada de Itens'. Aí alguém clica no item,
--    preenche as informações normais de entrada e dá entrada — e só então o
--    item começa a existir no estoque."
--
-- O BURACO QUE ISSO FECHA
--   Hoje o material aprovado no Catálogo é invisível para o Estoque. Ele
--   existe em sup_item (com código, aprovado = true, já no enxoval de uma
--   função), mas não tem ficha em sup_estoque_item — e a tela de Estoque lê
--   sup_estoque_item. Ou seja: ninguém no almoxarifado fica sabendo que
--   passou a existir um material que vão ter de comprar e guardar. O
--   encarregado pede, e a primeira notícia é a falta.
--
--   Era exatamente o caso dos 304 materiais do ETL do legado citados na
--   20260930000097, e continua valendo para todo material novo.
--
-- COMO FUNCIONA
--   1. Aprovar um lote enfileira em sup_pre_entrada todo material do lote
--      que ainda não tem ficha de estoque — não só o criado naquele lote.
--      Material antigo que nunca recebeu entrada aparece na primeira vez que
--      alguém mexer nele pelo Catálogo, que é quando ele volta a importar.
--   2. A fila carrega o `contexto` do rascunho (contrato · posto · função),
--      porque "GORRO TÉRMICO" sozinho não diz a ninguém do almoxarifado por
--      que aquilo apareceu.
--   3. Dar entrada fecha a pendência SOZINHO, por gatilho em
--      sup_estoque_item — não pela tela. Assim a fila esvazia por qualquer
--      caminho de entrada (o modal, a NF de Entrada, importação futura), e
--      não só pelo botão que estamos criando agora.
--
-- SEM MENU NOVO
--   A Pré-Entrada é um modal dentro de Estoque & Etiquetas, não uma rota.
--   Quem enxerga o estoque enxerga a fila (é leitura de estoque); dar
--   entrada e dispensar continuam exigindo `sup_estoque | alterar`, a mesma
--   permissão de sempre. Nenhum app_menu novo, nenhuma semeadura.
--
-- ROLLBACK ao final do arquivo.
-- =====================================================================

-- ── 1. A fila ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sup_pre_entrada (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES public.empresas(id)  ON DELETE CASCADE,
  -- CASCADE, e não RESTRICT: reprovar um lote apaga o sup_item recém-criado
  -- (sup_cat_decidir_lote, ramo REPROVADO/criar). Uma pendência órfã
  -- apontando para material que não existe mais não é informação, é lixo.
  sup_item_id         uuid NOT NULL REFERENCES public.sup_item(id)  ON DELETE CASCADE,
  origem              text NOT NULL DEFAULT 'catalogo'
                        CHECK (origem IN ('catalogo', 'manual')),
  lote_id             uuid REFERENCES public.sup_cat_lote(id)       ON DELETE SET NULL,
  -- Copiado de sup_cat_alteracao.contexto: {contrato, posto, funcao, item}.
  -- Copiado, e não lido por join: o contexto é o que era VERDADE na
  -- aprovação, e a função pode ser renomeada depois.
  contexto            jsonb NOT NULL DEFAULT '{}'::jsonb,
  situacao            text NOT NULL DEFAULT 'PENDENTE'
                        CHECK (situacao IN ('PENDENTE', 'CONCLUIDA', 'DISPENSADA')),
  motivo_dispensa     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES auth.users(id),
  resolvido_em        timestamptz,
  resolvido_por       uuid REFERENCES auth.users(id),
  resolvido_por_nome  text
);

COMMENT ON TABLE public.sup_pre_entrada IS
  'Materiais aprovados no Catalogo que ainda nao tem ficha de estoque. Fila do botao "Pre-Entrada de Itens" em Estoque & Etiquetas.';

-- Uma pendência ABERTA por material. É o que deixa o gancho da aprovação
-- ser reexecutado (dois lotes tocando o mesmo material) sem duplicar a
-- linha, e é o alvo do ON CONFLICT lá embaixo. Parcial de propósito: o
-- histórico de pendências já concluídas fica.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sup_pre_entrada_aberta
  ON public.sup_pre_entrada(sup_item_id) WHERE situacao = 'PENDENTE';

CREATE INDEX IF NOT EXISTS idx_sup_pre_entrada_situacao
  ON public.sup_pre_entrada(situacao);

ALTER TABLE public.sup_pre_entrada ENABLE ROW LEVEL SECURITY;

-- Sem recorte de empresa, como todo o módulo desde a 20260901000001
-- (empresa no Suprimentos é informação visual, não filtro).
DROP POLICY IF EXISTS sup_pre_entrada_select ON public.sup_pre_entrada;
CREATE POLICY sup_pre_entrada_select ON public.sup_pre_entrada FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'sup_estoque', 'visualizar'));

-- Só UPDATE: quem enfileira é sup_cat_decidir_lote (SECURITY DEFINER), e
-- quem conclui é o gatilho. Não existe caminho de INSERT pelo usuário, e
-- por isso não existe policy de INSERT.
DROP POLICY IF EXISTS sup_pre_entrada_update ON public.sup_pre_entrada;
CREATE POLICY sup_pre_entrada_update ON public.sup_pre_entrada FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'sup_estoque', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'sup_estoque', 'alterar'));

-- ── 2. Dar entrada fecha a pendência, venha de onde vier ─────────────
--
-- No gatilho da ficha de estoque, não na tela. sup_estoque_item é o ponto
-- por onde TODA entrada passa (sup_est_entrada_quantidade faz o upsert
-- dela), então qualquer caminho presente ou futuro fecha a fila de graça.
--
-- Fecha a pendência do item que recebeu a entrada E a do pai: desde a
-- 20260930000163 a ficha nasce no item do TAMANHO ("JAQUETA M"), enquanto
-- quem entrou na fila pelo Catálogo é o base ("JAQUETA") — sem o pai aqui,
-- a JAQUETA ficaria na fila para sempre depois de receber três tamanhos.
CREATE OR REPLACE FUNCTION public.sup_pre_entrada_concluir()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  UPDATE public.sup_pre_entrada pe
     SET situacao           = 'CONCLUIDA',
         resolvido_em       = now(),
         resolvido_por      = v_uid,
         resolvido_por_nome = (SELECT p.display_name FROM public.profiles p WHERE p.id = v_uid)
   WHERE pe.situacao = 'PENDENTE'
     AND pe.sup_item_id IN (
       SELECT i.id       FROM public.sup_item i WHERE i.id = NEW.sup_item_id
       UNION
       SELECT i.item_pai_id FROM public.sup_item i
        WHERE i.id = NEW.sup_item_id AND i.item_pai_id IS NOT NULL
     );
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_sup_pre_entrada_concluir ON public.sup_estoque_item;
CREATE TRIGGER trg_sup_pre_entrada_concluir
  AFTER INSERT ON public.sup_estoque_item
  FOR EACH ROW EXECUTE FUNCTION public.sup_pre_entrada_concluir();

-- ── 3. Dispensar ─────────────────────────────────────────────────────
--
-- Nem todo material aprovado vai para a prateleira: tem o que é comprado e
-- entregue direto no contrato, e tem o que o Catálogo cadastrou por engano.
-- Sem uma saída, a fila acumula para sempre e vira uma lista que ninguém
-- olha — que é o destino de toda fila sem baixa.
CREATE OR REPLACE FUNCTION public.sup_pre_entrada_dispensar(
  p_id uuid, p_motivo text DEFAULT NULL
)
RETURNS public.sup_pre_entrada
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.sup_pre_entrada;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_estoque', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para mexer na pré-entrada';
  END IF;

  UPDATE public.sup_pre_entrada pe
     SET situacao           = 'DISPENSADA',
         motivo_dispensa    = NULLIF(btrim(COALESCE(p_motivo, '')), ''),
         resolvido_em       = now(),
         resolvido_por      = v_uid,
         resolvido_por_nome = (SELECT p.display_name FROM public.profiles p WHERE p.id = v_uid)
   WHERE pe.id = p_id AND pe.situacao = 'PENDENTE'
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Pendência não encontrada ou já resolvida';
  END IF;
  RETURN v_row;
END;
$fn$;

REVOKE ALL ON FUNCTION public.sup_pre_entrada_dispensar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_pre_entrada_dispensar(uuid, text) TO authenticated;

-- ── 4. Aprovar o lote enfileira o que não tem estoque ────────────────
--
-- Corpo idêntico ao de 20260930000097:59; muda SÓ o bloco novo marcado
-- "EDIÇÃO 0165", depois do loop e antes de fechar o lote.
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
          WHEN 'funcao_item' THEN DELETE FROM public.sup_funcao_item WHERE id = r.alvo_id;
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

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK
--
--   -- 1. Recriar sup_cat_decidir_lote sem o bloco "EDIÇÃO 0165"
--   --    (corpo de 20260930000097_supply_enxoval_aprovado_libera_material.sql:59-148).
--   DROP TRIGGER  IF EXISTS trg_sup_pre_entrada_concluir ON public.sup_estoque_item;
--   DROP FUNCTION IF EXISTS public.sup_pre_entrada_concluir();
--   DROP FUNCTION IF EXISTS public.sup_pre_entrada_dispensar(uuid, text);
--   DROP TABLE    IF EXISTS public.sup_pre_entrada;
--   NOTIFY pgrst, 'reload schema';
-- ─────────────────────────────────────────────────────────────────────
