-- =====================================================================
-- ESTOQUE — editar o material, com histórico de quem mudou o quê
--
-- O QUE FALTAVA (14/09/2026)
-- Em /app/suprimentos/estoque-etiquetas não havia como corrigir nada depois
-- da entrada: nome digitado errado, custo, mínimo, fornecedor, tamanho ou CA
-- do lote, e a quantidade que o inventário apontou como errada. O inventário
-- só REGISTRA (regra confirmada pelo Eduardo, 20260907000003) — a correção é
-- o passo humano depois da apuração, e não tinha onde ser feita.
--
-- O QUE ENTRA
--   1. sup_estoque_alteracao — uma linha por CAMPO alterado: antes, depois,
--      quem, quando e o motivo (obrigatório). A aba Histórico do material
--      junta estas linhas com os movimentos.
--   2. Movimento 'correcao' — quantidade de lote corrigida à mão. Tipo
--      próprio para não se confundir com 'ajuste', que é o inventário (e o
--      inventário não corrige nada). `quantidade` é a diferença, com sinal.
--   3. sup_est_editar_item — tudo numa transação, só o que veio no payload.
--
-- DECISÕES
--   • Nome é do CATÁLOGO (sup_item): muda em todo almoxarifado, pedido e
--     enxoval. Exige `sup_catalogo/alterar` além de `sup_estoque/alterar`,
--     que é o que a policy de sup_item já exige de quem edita pelo catálogo.
--     Nome repetido é recusado — duas "BOTINA" foram a causa do "0 em
--     estoque" corrigido na 20260930000105. O rename também vira rascunho
--     em sup_cat_alteracao, como a renomeação de função já faz, para quem
--     aprova o catálogo enxergar.
--   • Etiqueta USADA não se edita: pertence ao pedido que a levou.
--   • Quantidade só em lote por quantidade ('massa'). Corrigir mexe junto na
--     quantidade original, senão a diferença apareceria como "já usada".
--     Não desce abaixo do reservado para separação, e em EPI com CA bloqueado
--     não desce (a trava sst_ca_guard_baixa não distingue correção de
--     entrega — o descarte desse lote é pelo "Excluir do estoque").
--   • CA do lote pode ser corrigido mesmo para um CA vencido: registrar a
--     verdade é o que faz a trava de saída funcionar. Barrar aqui obrigaria
--     a mentir para conseguir salvar. Fica no histórico com quem e por quê.
--
-- Idempotente. ROLLBACK no rodapé.
-- =====================================================================

-- ── 1. Histórico de edição ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sup_estoque_alteracao (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES public.empresas(id)         ON DELETE CASCADE,
  -- SET NULL nos três: o histórico tem de sobreviver à exclusão do material
  -- e do lote. A leitura é por sup_item_id, como a de sup_estoque_movimento.
  item_estoque_id uuid REFERENCES public.sup_estoque_item(id)          ON DELETE SET NULL,
  sup_item_id     uuid REFERENCES public.sup_item(id)                  ON DELETE SET NULL,
  tag_id          uuid REFERENCES public.sup_estoque_tag(id)           ON DELETE SET NULL,
  -- Snapshot do código do lote: o tag_id vira NULL se o lote for removido.
  codigo          text,
  campo           text NOT NULL,
  valor_anterior  text,
  valor_novo      text,
  motivo          text NOT NULL,
  usuario_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  usuario_nome    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sup_alteracao_material
  ON public.sup_estoque_alteracao(sup_item_id, created_at DESC);

ALTER TABLE public.sup_estoque_alteracao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sup_estoque_alteracao_select ON public.sup_estoque_alteracao;
CREATE POLICY sup_estoque_alteracao_select ON public.sup_estoque_alteracao
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'sup_estoque', 'visualizar'));

-- Sem policy de escrita: só sup_est_editar_item grava. Histórico que o
-- próprio usuário pode reescrever não é histórico.
GRANT SELECT ON public.sup_estoque_alteracao TO authenticated;

-- ── 2. Movimento 'correcao' ──────────────────────────────────────────
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
    CHECK (tipo IN ('entrada','saida','devolucao','ajuste','remocao','reserva','liberacao','correcao'));
END
$mig$;

-- ── 3. A edição ──────────────────────────────────────────────────────
--
-- Payload: só as chaves que mudaram. Chave ausente = não mexe; chave com
-- null = apaga o valor.
--   { nome, valor_unitario, preco_valido_ate, estoque_minimo, fornecedor_id,
--     observacoes, lotes: [{ id, tamanho, ca_numero, ca_validade, quantidade }] }
CREATE OR REPLACE FUNCTION public.sup_est_editar_item(
  p_item_estoque_id uuid, p_payload jsonb, p_motivo text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_nome     text := public.sup_est_nome_usuario();
  v_motivo   text := nullif(btrim(COALESCE(p_motivo, '')), '');
  p          jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_item     record;
  v_mat      record;
  v_dup      record;
  v_bloq     record;
  t          record;
  l          jsonb;
  -- [{campo, antes, depois, tag_id, codigo}] — vira sup_estoque_alteracao no fim.
  v_log      jsonb := '[]'::jsonb;
  v_correcoes int := 0;
  v_nome_mat text;
  v_valor    numeric(12,2);
  v_validade date;
  v_minimo   int;
  v_forn     uuid;
  v_obs      text;
  v_tam      text;
  v_ca_num   text;
  v_ca_val   date;
  v_qtd      int;
  v_delta    int;
  v_res      int;
  v_pedidos  text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_estoque', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para editar material do estoque';
  END IF;
  IF v_motivo IS NULL THEN RAISE EXCEPTION 'Informe o motivo da alteração'; END IF;

  SELECT ei.* INTO v_item FROM public.sup_estoque_item ei
   WHERE ei.id = p_item_estoque_id FOR UPDATE;
  IF v_item.id IS NULL THEN RAISE EXCEPTION 'Material não encontrado no estoque'; END IF;
  IF v_item.arquivado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Este material foi excluído do estoque';
  END IF;

  SELECT i.* INTO v_mat FROM public.sup_item i WHERE i.id = v_item.sup_item_id FOR UPDATE;

  -- ── Nome (catálogo) ──
  IF p ? 'nome' THEN
    -- Mesma forma que o catálogo grava: maiúsculas, sem espaço sobrando.
    v_nome_mat := upper(regexp_replace(btrim(COALESCE(p->>'nome', '')), '\s+', ' ', 'g'));
    IF v_nome_mat = '' THEN RAISE EXCEPTION 'O nome do material não pode ficar vazio'; END IF;

    IF v_nome_mat IS DISTINCT FROM v_mat.nome THEN
      IF NOT public.can_access(v_uid, 'sup_catalogo', 'alterar') THEN
        RAISE EXCEPTION 'Renomear material exige permissão de alterar no Catálogo';
      END IF;

      -- Inativo de OUTRA empresa pode repetir (são as cópias aposentadas da
      -- 20260930000105); da mesma empresa não, que o UNIQUE (empresa_id, nome)
      -- recusaria com uma mensagem que ninguém entende.
      SELECT i.nome, i.codigo INTO v_dup FROM public.sup_item i
       WHERE i.id <> v_mat.id
         AND upper(regexp_replace(btrim(i.nome), '\s+', ' ', 'g')) = v_nome_mat
         AND (i.ativo OR i.empresa_id = v_mat.empresa_id)
       LIMIT 1;
      IF FOUND THEN
        RAISE EXCEPTION 'Já existe outro material chamado % (código %). Use outro nome.',
          v_dup.nome, COALESCE(v_dup.codigo, '—');
      END IF;

      UPDATE public.sup_item i SET nome = v_nome_mat WHERE i.id = v_mat.id;

      v_log := v_log || jsonb_build_object('campo', 'Nome do material',
                                           'antes', v_mat.nome, 'depois', v_nome_mat);

      INSERT INTO public.sup_cat_alteracao
        (empresa_id, tipo_entidade, tipo_acao, alvo_id, dados, contexto,
         descricao, status, criado_por, criado_por_nome)
      VALUES (v_mat.empresa_id, 'item', 'editar', v_mat.id,
              jsonb_build_object('de', v_mat.nome, 'para', v_nome_mat,
                                 'origem', 'estoque', 'motivo', v_motivo),
              jsonb_build_object('item', v_nome_mat),
              format('Renomear material "%s" → "%s" (pelo Estoque)', v_mat.nome, v_nome_mat),
              'RASCUNHO', v_uid, v_nome);
    END IF;
  END IF;

  -- ── Cadastro do item de estoque ──
  v_valor := CASE WHEN p ? 'valor_unitario'
                  THEN round(COALESCE(NULLIF(p->>'valor_unitario', '')::numeric, 0), 2)
                  ELSE v_item.valor_unitario END;
  v_validade := CASE WHEN p ? 'preco_valido_ate'
                     THEN NULLIF(p->>'preco_valido_ate', '')::date
                     ELSE v_item.preco_valido_ate END;
  v_minimo := CASE WHEN p ? 'estoque_minimo'
                   THEN COALESCE(NULLIF(p->>'estoque_minimo', '')::int, 0)
                   ELSE v_item.estoque_minimo END;
  v_forn := CASE WHEN p ? 'fornecedor_id'
                 THEN NULLIF(p->>'fornecedor_id', '')::uuid
                 ELSE v_item.fornecedor_id END;
  v_obs := CASE WHEN p ? 'observacoes'
                THEN NULLIF(btrim(p->>'observacoes'), '')
                ELSE v_item.observacoes END;

  IF v_valor  < 0 THEN RAISE EXCEPTION 'O valor unitário não pode ser negativo'; END IF;
  IF v_minimo < 0 THEN RAISE EXCEPTION 'O estoque mínimo não pode ser negativo'; END IF;
  IF v_forn IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.fornecedor f WHERE f.id = v_forn) THEN
    RAISE EXCEPTION 'Fornecedor não encontrado';
  END IF;

  IF v_valor IS DISTINCT FROM v_item.valor_unitario THEN
    v_log := v_log || jsonb_build_object('campo', 'Valor unitário',
      'antes',  'R$ ' || replace(to_char(v_item.valor_unitario, 'FM999999990.00'), '.', ','),
      'depois', 'R$ ' || replace(to_char(v_valor, 'FM999999990.00'), '.', ','));
  END IF;
  IF v_validade IS DISTINCT FROM v_item.preco_valido_ate THEN
    v_log := v_log || jsonb_build_object('campo', 'Preço válido até',
      'antes', to_char(v_item.preco_valido_ate, 'DD/MM/YYYY'), 'depois', to_char(v_validade, 'DD/MM/YYYY'));
  END IF;
  IF v_minimo IS DISTINCT FROM v_item.estoque_minimo THEN
    v_log := v_log || jsonb_build_object('campo', 'Estoque mínimo',
      'antes', v_item.estoque_minimo::text, 'depois', v_minimo::text);
  END IF;
  IF v_forn IS DISTINCT FROM v_item.fornecedor_id THEN
    v_log := v_log || jsonb_build_object('campo', 'Fornecedor',
      'antes',  (SELECT COALESCE(f.nome_fantasia, f.razao_social) FROM public.fornecedor f WHERE f.id = v_item.fornecedor_id),
      'depois', (SELECT COALESCE(f.nome_fantasia, f.razao_social) FROM public.fornecedor f WHERE f.id = v_forn));
  END IF;
  IF v_obs IS DISTINCT FROM v_item.observacoes THEN
    v_log := v_log || jsonb_build_object('campo', 'Observações',
      'antes', v_item.observacoes, 'depois', v_obs);
  END IF;

  -- UM update só: trg_sup_item_preco_registra dispara por UPDATE, e dois
  -- updates gravariam duas linhas no histórico de preços.
  IF v_valor    IS DISTINCT FROM v_item.valor_unitario
  OR v_validade IS DISTINCT FROM v_item.preco_valido_ate
  OR v_minimo   IS DISTINCT FROM v_item.estoque_minimo
  OR v_forn     IS DISTINCT FROM v_item.fornecedor_id
  OR v_obs      IS DISTINCT FROM v_item.observacoes THEN
    UPDATE public.sup_estoque_item ei
       SET valor_unitario = v_valor, preco_valido_ate = v_validade,
           estoque_minimo = v_minimo, fornecedor_id = v_forn, observacoes = v_obs
     WHERE ei.id = v_item.id;

    -- O gatilho de preço grava origem 'entrada' fixo. Preço mudado na edição
    -- não é compra: vira 'ajuste'. now() é o instante da transação, então
    -- pega exatamente a linha que o gatilho acabou de gravar.
    UPDATE public.sup_item_preco pr
       SET origem = 'ajuste'
     WHERE pr.item_estoque_id = v_item.id
       AND pr.registrado_em   = now()
       AND pr.origem          = 'entrada';
  END IF;

  -- ── Lotes ──
  FOR l IN SELECT * FROM jsonb_array_elements(COALESCE(p->'lotes', '[]'::jsonb)) LOOP
    SELECT tg.* INTO t FROM public.sup_estoque_tag tg
     WHERE tg.id = NULLIF(l->>'id', '')::uuid AND tg.item_estoque_id = v_item.id
       FOR UPDATE;
    IF t.id IS NULL THEN RAISE EXCEPTION 'Lote não pertence a este material'; END IF;
    IF t.usado THEN
      RAISE EXCEPTION 'O lote % já foi entregue em pedido e não pode ser editado', t.codigo;
    END IF;

    v_tam    := CASE WHEN l ? 'tamanho'     THEN NULLIF(btrim(l->>'tamanho'), '')   ELSE t.tamanho     END;
    v_ca_num := CASE WHEN l ? 'ca_numero'   THEN NULLIF(btrim(l->>'ca_numero'), '') ELSE t.ca_numero   END;
    v_ca_val := CASE WHEN l ? 'ca_validade' THEN NULLIF(l->>'ca_validade', '')::date ELSE t.ca_validade END;
    v_qtd    := t.quantidade_massa;
    v_delta  := 0;

    IF l ? 'quantidade' THEN
      IF t.tipo <> 'massa' THEN
        RAISE EXCEPTION 'A etiqueta antiga % conta uma unidade só. Para tirá-la do estoque, use a lixeira do lote.', t.codigo;
      END IF;
      v_qtd := (l->>'quantidade')::int;
      IF v_qtd IS NULL OR v_qtd < 0 THEN RAISE EXCEPTION 'Quantidade inválida no lote %', t.codigo; END IF;
      v_delta := v_qtd - COALESCE(t.quantidade_massa, 0);
    END IF;

    IF v_delta < 0 THEN
      -- Os dois gatilhos barrariam de todo jeito, mas com o código interno do
      -- lote. Aqui a mensagem diz o pedido e o que fazer.
      SELECT COALESCE(SUM(r.quantidade), 0), string_agg(DISTINCT pe.pedido_id, ', ')
        INTO v_res, v_pedidos
        FROM public.sup_estoque_reserva r
        JOIN public.sup_pedido pe ON pe.id = r.pedido_id
       WHERE r.tag_id = t.id AND r.situacao = 'ATIVA';
      IF v_qtd < v_res THEN
        RAISE EXCEPTION '% unidade(s) deste lote estão reservadas para separação (pedido %). A quantidade não pode ficar abaixo disso.',
          v_res, v_pedidos;
      END IF;

      IF v_mat.tipo = 'epi' THEN
        SELECT * INTO v_bloq FROM public.sst_ca_bloqueio(v_ca_num, v_ca_val);
        IF v_bloq.bloqueado THEN
          RAISE EXCEPTION 'O CA deste lote está bloqueado (%), e a trava de CA não deixa reduzir a quantidade. Para descartar, use "Excluir do estoque".',
            v_bloq.motivo;
        END IF;
      END IF;
    END IF;

    IF v_tam    IS DISTINCT FROM t.tamanho
    OR v_ca_num IS DISTINCT FROM t.ca_numero
    OR v_ca_val IS DISTINCT FROM t.ca_validade
    OR v_delta <> 0 THEN
      UPDATE public.sup_estoque_tag tg
         SET tamanho     = v_tam,
             ca_numero   = v_ca_num,
             ca_validade = v_ca_val,
             quantidade_massa = CASE WHEN tg.tipo = 'massa' THEN v_qtd ELSE tg.quantidade_massa END,
             -- Original anda junto: consumido = original − atual, e a correção
             -- não é consumo.
             quantidade_original_massa = CASE WHEN tg.tipo = 'massa'
                                              THEN COALESCE(tg.quantidade_original_massa, 0) + v_delta
                                              ELSE tg.quantidade_original_massa END
       WHERE tg.id = t.id;
    END IF;

    IF v_tam IS DISTINCT FROM t.tamanho THEN
      v_log := v_log || jsonb_build_object('campo', 'Tamanho', 'antes', t.tamanho, 'depois', v_tam,
                                           'tag_id', t.id, 'codigo', t.codigo);
    END IF;
    IF v_ca_num IS DISTINCT FROM t.ca_numero THEN
      v_log := v_log || jsonb_build_object('campo', 'Nº do CA', 'antes', t.ca_numero, 'depois', v_ca_num,
                                           'tag_id', t.id, 'codigo', t.codigo);
    END IF;
    IF v_ca_val IS DISTINCT FROM t.ca_validade THEN
      v_log := v_log || jsonb_build_object('campo', 'Validade do CA',
                                           'antes', to_char(t.ca_validade, 'DD/MM/YYYY'),
                                           'depois', to_char(v_ca_val, 'DD/MM/YYYY'),
                                           'tag_id', t.id, 'codigo', t.codigo);
    END IF;

    -- Quantidade vai para a trilha de MOVIMENTO, não para a de alteração:
    -- é saldo, e a linha do tempo já soma os dois lados.
    IF v_delta <> 0 THEN
      INSERT INTO public.sup_estoque_movimento
        (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho,
         observacao, usuario_id, usuario_nome)
      VALUES (v_item.empresa_id, v_item.id, t.codigo, 'correcao', v_delta, v_tam,
              format('Quantidade do lote: %s → %s. Motivo: %s',
                     COALESCE(t.quantidade_massa, 0), v_qtd, v_motivo),
              v_uid, v_nome);
      v_correcoes := v_correcoes + 1;
    END IF;
  END LOOP;

  IF jsonb_array_length(v_log) = 0 AND v_correcoes = 0 THEN
    RAISE EXCEPTION 'Nenhuma alteração para salvar';
  END IF;

  INSERT INTO public.sup_estoque_alteracao
    (empresa_id, item_estoque_id, sup_item_id, tag_id, codigo, campo,
     valor_anterior, valor_novo, motivo, usuario_id, usuario_nome)
  SELECT v_item.empresa_id, v_item.id, v_item.sup_item_id,
         NULLIF(x->>'tag_id', '')::uuid, x->>'codigo', x->>'campo',
         x->>'antes', x->>'depois', v_motivo, v_uid, v_nome
    FROM jsonb_array_elements(v_log) x;

  RETURN jsonb_build_object('alteracoes', jsonb_array_length(v_log) + v_correcoes);
END $$;

REVOKE EXECUTE ON FUNCTION public.sup_est_editar_item(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sup_est_editar_item(uuid, jsonb, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Conferência (rodar à parte) ──────────────────────────────────────
--   SELECT proname FROM pg_proc WHERE proname = 'sup_est_editar_item';
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'sup_estoque_movimento_tipo_check';

-- ── ROLLBACK ─────────────────────────────────────────────────────────
--   DROP FUNCTION IF EXISTS public.sup_est_editar_item(uuid, jsonb, text);
--   DROP TABLE IF EXISTS public.sup_estoque_alteracao;
--   -- A CHECK só volta sem 'correcao' se não houver nenhuma correção gravada:
--   --   SELECT count(*) FROM public.sup_estoque_movimento WHERE tipo = 'correcao';
--   ALTER TABLE public.sup_estoque_movimento DROP CONSTRAINT IF EXISTS sup_estoque_movimento_tipo_check;
--   ALTER TABLE public.sup_estoque_movimento ADD CONSTRAINT sup_estoque_movimento_tipo_check
--     CHECK (tipo IN ('entrada','saida','devolucao','ajuste','remocao','reserva','liberacao'));
--   NOTIFY pgrst, 'reload schema';
