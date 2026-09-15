-- =====================================================================
-- ESTOQUE — trocar o TIPO do material na edição, e o CA do lote passa a
-- ser sobrescrito pela lista oficial que o SST anexa
--
-- PEDIDOS (15/09/2026, tela /app/suprimentos/estoque-etiquetas)
--   a) Trocar o tipo do item (uniforme, EPI, insumo, equipamento...) no
--      "Editar", ficando no histórico. Caso real da tela: AVENTAL DE NAPA
--      cadastrado como Uniforme.
--   b) Um campo para digitar o CA à mão em QUALQUER item, quando precisar.
--      A regra: sempre que o SST atualizar a lista de CA em /app/sst/controle-ca,
--      todo lote do estoque cujo CA bate com a lista nova é sobrescrito pelo
--      oficial — inclusive o que foi digitado à mão.
--
-- O QUE ENTRA
--   1. sup_estoque_alteracao.origem — 'edicao' (pessoa, pelo Editar) ou
--      'sst_catalogo' (lista oficial). A tela usa para dizer de onde veio.
--   2. sst_ca_sincronizacao.lotes_atualizados / estoque_erro — quantos lotes
--      a carga sobrescreveu, para o painel do SST mostrar o efeito.
--   3. sup_est_editar_item — reprodução fiel de
--      20260930000107_sup_estoque_editar_material.sql:101, com as edições
--      marcadas "EDIÇÃO 0161": aceita a chave `tipo`.
--   4. sst_ca_aplicar_no_estoque — gatilho na conclusão da carga do catálogo.
--   5. sst_ca_situacao_catalogo — reprodução de
--      20260930000001_caepi_anexo_pelo_sistema.sql:116 com as duas colunas
--      novas no retorno.
--
-- DECISÕES
--   • Tipo é do CATÁLOGO (sup_item), como o nome: muda em todo almoxarifado,
--     pedido e enxoval. Mesma exigência do rename — `sup_catalogo/alterar` —
--     e também vira rascunho em sup_cat_alteracao para quem aprova o
--     catálogo enxergar. Não é detalhe: tirar um item de 'epi' desliga a
--     trava de CA dele (sst_ca_guard_baixa só olha tipo 'epi').
--   • O CA do lote já era por lote (SIS-2026-0222: remessas diferentes têm
--     certificados diferentes). O que muda é só a TELA, que deixa de mostrar
--     o campo apenas para EPI. O banco nunca restringiu por tipo.
--   • "Bate com a lista nova" = o número do lote, só dígitos, existe no
--     catálogo E foi gravado por ESTA carga (atualizado_em >= iniciado_em,
--     com 1 hora de folga para o relógio do PC do worker).
--     O catálogo é upsert e nunca apaga: sem esse corte, CA que saiu do
--     arquivo do Ministério continuaria "batendo" com um dado velho.
--   • O que se sobrescreve: o número (vira a forma oficial, só dígitos —
--     "CA 12.345" → "12345") e a validade (a do Ministério). Validade nula
--     no arquivo não apaga a do lote.
--   • Só lote NA PRATELEIRA: `NOT usado` e material não excluído. Lote usado
--     pertence ao pedido que o levou — a mesma regra do Editar.
--   • Gatilho, não passo no worker: vale para anexo pela tela, pasta ou site,
--     e o worker (que roda na máquina do Eduardo) não precisa ser atualizado
--     nem reiniciado.
--   • O gatilho NUNCA derruba a carga. O worker não confere o erro do UPDATE
--     que marca concluido_em (worker/src/caepi.js:545); se esse UPDATE
--     falhasse, a carga ficaria pendente e o ciclo de 60s recarregaria 42 mil
--     CAs por minuto — foi o que aconteceu em 26/08/2026 por outro motivo.
--     Falha na aplicação ao estoque desfaz SÓ ela (bloco EXCEPTION = savepoint)
--     e fica em estoque_erro, que o painel mostra.
--
-- Idempotente. ROLLBACK no rodapé.
-- =====================================================================

-- ── 1. De onde veio a alteração ──────────────────────────────────────
ALTER TABLE public.sup_estoque_alteracao
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'edicao';

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'sup_estoque_alteracao_origem_check') THEN
    ALTER TABLE public.sup_estoque_alteracao
      ADD CONSTRAINT sup_estoque_alteracao_origem_check
      CHECK (origem IN ('edicao', 'sst_catalogo'));
  END IF;
END
$mig$;

COMMENT ON COLUMN public.sup_estoque_alteracao.origem IS
  'edicao = pessoa pelo Editar do estoque · sst_catalogo = lista oficial de CA anexada pelo SST (sobrescreve o CA do lote).';

-- ── 2. O efeito de cada carga no estoque ─────────────────────────────
ALTER TABLE public.sst_ca_sincronizacao
  ADD COLUMN IF NOT EXISTS lotes_atualizados integer,
  ADD COLUMN IF NOT EXISTS estoque_erro      text;

-- ── 3. A edição, agora com o tipo ────────────────────────────────────
--
-- Rótulo do tipo, igual ao da tela (src/lib/suprimentos/tiposMaterial.ts).
-- Função à parte para o histórico não gravar "limpeza" onde a tela diz
-- "Material de limpeza".
CREATE OR REPLACE FUNCTION public.sup_rotulo_tipo_item(p_tipo text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_tipo
    WHEN 'uniforme'    THEN 'Uniforme'
    WHEN 'epi'         THEN 'EPI'
    WHEN 'limpeza'     THEN 'Material de limpeza'
    WHEN 'insumo'      THEN 'Insumo'
    WHEN 'equipamento' THEN 'Equipamento'
    ELSE p_tipo
  END;
$$;

--
-- Payload: só as chaves que mudaram. Chave ausente = não mexe; chave com
-- null = apaga o valor.
--   { nome, tipo, valor_unitario, preco_valido_ate, estoque_minimo,
--     fornecedor_id, observacoes,
--     lotes: [{ id, tamanho, ca_numero, ca_validade, quantidade }] }
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
  v_tipo     text;   -- EDIÇÃO 0161: o tipo que vale depois desta edição
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
  v_tipo := v_mat.tipo;   -- EDIÇÃO 0161

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

  -- ── EDIÇÃO 0161: Tipo (catálogo) ──
  -- Mesma lógica do nome logo acima: é do catálogo, exige o catálogo, e
  -- deixa rascunho para quem aprova. O rótulo no histórico é o da tela
  -- (src/lib/suprimentos/tiposMaterial.ts), não o valor cru do CHECK.
  IF p ? 'tipo' THEN
    v_tipo := lower(btrim(COALESCE(p->>'tipo', '')));
    IF v_tipo NOT IN ('uniforme', 'epi', 'insumo', 'equipamento', 'limpeza') THEN
      RAISE EXCEPTION 'Tipo de material inválido: %', COALESCE(nullif(v_tipo, ''), '(vazio)');
    END IF;

    IF v_tipo IS DISTINCT FROM v_mat.tipo THEN
      IF NOT public.can_access(v_uid, 'sup_catalogo', 'alterar') THEN
        RAISE EXCEPTION 'Trocar o tipo do material exige permissão de alterar no Catálogo';
      END IF;

      UPDATE public.sup_item i SET tipo = v_tipo WHERE i.id = v_mat.id;

      v_log := v_log || jsonb_build_object('campo', 'Tipo do material',
        'antes',  public.sup_rotulo_tipo_item(v_mat.tipo),
        'depois', public.sup_rotulo_tipo_item(v_tipo));

      INSERT INTO public.sup_cat_alteracao
        (empresa_id, tipo_entidade, tipo_acao, alvo_id, dados, contexto,
         descricao, status, criado_por, criado_por_nome)
      VALUES (v_mat.empresa_id, 'item', 'editar', v_mat.id,
              jsonb_build_object('campo', 'tipo', 'de', v_mat.tipo, 'para', v_tipo,
                                 'origem', 'estoque', 'motivo', v_motivo),
              jsonb_build_object('item', COALESCE(v_nome_mat, v_mat.nome)),
              format('Tipo de "%s": %s → %s (pelo Estoque)', COALESCE(v_nome_mat, v_mat.nome),
                     public.sup_rotulo_tipo_item(v_mat.tipo), public.sup_rotulo_tipo_item(v_tipo)),
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

      -- EDIÇÃO 0161: o tipo que vale é o de DEPOIS desta edição.
      IF v_tipo = 'epi' THEN
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
     valor_anterior, valor_novo, motivo, usuario_id, usuario_nome, origem)
  SELECT v_item.empresa_id, v_item.id, v_item.sup_item_id,
         NULLIF(x->>'tag_id', '')::uuid, x->>'codigo', x->>'campo',
         x->>'antes', x->>'depois', v_motivo, v_uid, v_nome, 'edicao'
    FROM jsonb_array_elements(v_log) x;

  RETURN jsonb_build_object('alteracoes', jsonb_array_length(v_log) + v_correcoes);
END $$;

REVOKE EXECUTE ON FUNCTION public.sup_est_editar_item(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sup_est_editar_item(uuid, jsonb, text) TO authenticated;

-- ── 4. A lista oficial sobrescreve o CA do estoque ───────────────────
--
-- Dispara no instante em que o worker marca a carga como concluída
-- (worker/src/caepi.js:545) — só na transição, e só em carga sem erro.
-- BEFORE para poder gravar lotes_atualizados na própria linha sem um
-- segundo UPDATE (que re-dispararia o gatilho).
CREATE OR REPLACE FUNCTION public.sst_ca_aplicar_no_estoque()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  a        record;
  v_n      integer := 0;
  v_ator   text := COALESCE(nullif(btrim(NEW.enviado_por_nome), ''), 'SST — lista oficial de CA');
  v_motivo text := 'Lista oficial de CA atualizada pelo SST'
                   || COALESCE(' (arquivo ' || nullif(btrim(NEW.arquivo_nome), '') || ')', '')
                   || ': número e validade do CA substituídos pelos do Ministério.';
BEGIN
  BEGIN
    FOR a IN
      SELECT t.id, t.codigo, t.ca_numero, t.ca_validade,
             ei.id AS ei_id, ei.empresa_id, ei.sup_item_id,
             c.ca_numero AS ca_oficial,
             COALESCE(c.validade, t.ca_validade) AS validade_oficial
        FROM public.sup_estoque_tag t
        JOIN public.sup_estoque_item ei ON ei.id = t.item_estoque_id
        JOIN public.sst_ca_catalogo c
          ON c.ca_numero = regexp_replace(t.ca_numero, '\D', '', 'g')
       WHERE NOT t.usado
         AND ei.arquivado_em IS NULL
         AND nullif(btrim(t.ca_numero), '') IS NOT NULL
         -- Só o que ESTA carga gravou — ver DECISÕES no cabeçalho. A folga
         -- de 1 hora é o relógio: atualizado_em vem do relógio do PC do
         -- worker (caepi.js, gravar()), iniciado_em do banco. Cargas são
         -- semanais, então a folga não deixa passar CA de carga anterior.
         AND c.atualizado_em >= NEW.iniciado_em - interval '1 hour'
         AND (t.ca_numero IS DISTINCT FROM c.ca_numero
              OR (c.validade IS NOT NULL AND t.ca_validade IS DISTINCT FROM c.validade))
       FOR UPDATE OF t
    LOOP
      UPDATE public.sup_estoque_tag tg
         SET ca_numero = a.ca_oficial, ca_validade = a.validade_oficial
       WHERE tg.id = a.id;

      -- Mesmo formato do Editar, para a aba Histórico do material juntar as
      -- duas coisas numa trilha só. usuario_id = quem anexou o arquivo.
      INSERT INTO public.sup_estoque_alteracao
        (empresa_id, item_estoque_id, sup_item_id, tag_id, codigo, campo,
         valor_anterior, valor_novo, motivo, usuario_id, usuario_nome, origem)
      SELECT a.empresa_id, a.ei_id, a.sup_item_id, a.id, a.codigo, x.campo,
             x.antes, x.depois, v_motivo, NEW.enviado_por, v_ator, 'sst_catalogo'
        FROM (VALUES
               ('Nº do CA', a.ca_numero, a.ca_oficial),
               ('Validade do CA', to_char(a.ca_validade, 'DD/MM/YYYY'),
                                  to_char(a.validade_oficial, 'DD/MM/YYYY'))
             ) AS x(campo, antes, depois)
       WHERE x.antes IS DISTINCT FROM x.depois;

      v_n := v_n + 1;
    END LOOP;

    NEW.lotes_atualizados := v_n;
    NEW.estoque_erro      := NULL;
  EXCEPTION WHEN OTHERS THEN
    -- Desfaz só a aplicação ao estoque (o bloco é um savepoint); a carga do
    -- catálogo segue concluída. Ver DECISÕES: derrubar aqui travaria o worker.
    NEW.lotes_atualizados := NULL;
    NEW.estoque_erro      := left(SQLERRM, 500);
    RAISE WARNING 'sst_ca_aplicar_no_estoque: %', SQLERRM;
  END;

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.sst_ca_aplicar_no_estoque() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sst_ca_aplicar_no_estoque ON public.sst_ca_sincronizacao;
CREATE TRIGGER trg_sst_ca_aplicar_no_estoque
  BEFORE UPDATE OF concluido_em ON public.sst_ca_sincronizacao
  FOR EACH ROW
  WHEN (OLD.concluido_em IS NULL AND NEW.concluido_em IS NOT NULL AND NEW.erro IS NULL)
  EXECUTE FUNCTION public.sst_ca_aplicar_no_estoque();

-- ── 5. Situação do catálogo, com o efeito no estoque ─────────────────
-- Reprodução de 20260930000001:116 + lotes_atualizados e estoque_erro da
-- última carga concluída. DROP antes porque o RETURNS TABLE mudou.
DROP FUNCTION IF EXISTS public.sst_ca_situacao_catalogo();

CREATE FUNCTION public.sst_ca_situacao_catalogo()
RETURNS TABLE (
  total_cas         integer,
  carregado_em      timestamptz,
  dias_desde        integer,
  arquivo_nome      text,
  enviado_por_nome  text,
  processando       boolean,
  ultimo_erro       text,
  lotes_atualizados integer,
  estoque_erro      text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT
    (SELECT count(*)::integer FROM public.sst_ca_catalogo),
    u.concluido_em,
    CASE WHEN u.concluido_em IS NULL THEN NULL
         ELSE (CURRENT_DATE - u.concluido_em::date)::integer END,
    u.arquivo_nome,
    u.enviado_por_nome,
    EXISTS (
      SELECT 1 FROM public.sst_ca_sincronizacao p
       WHERE p.arquivo_path IS NOT NULL AND p.concluido_em IS NULL AND p.erro IS NULL
    ),
    (SELECT e.erro FROM public.sst_ca_sincronizacao e
      WHERE e.erro IS NOT NULL ORDER BY e.iniciado_em DESC LIMIT 1),
    u.lotes_atualizados,
    u.estoque_erro
  FROM (
    SELECT * FROM public.sst_ca_sincronizacao
     WHERE concluido_em IS NOT NULL AND erro IS NULL
     ORDER BY concluido_em DESC LIMIT 1
  ) u
  RIGHT JOIN (SELECT 1) x ON true;
$fn$;

REVOKE ALL ON FUNCTION public.sst_ca_situacao_catalogo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_ca_situacao_catalogo() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Conferência (rodar à parte) ──────────────────────────────────────
--   SELECT tgname FROM pg_trigger WHERE tgname = 'trg_sst_ca_aplicar_no_estoque';
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'sup_estoque_alteracao' AND column_name = 'origem';
--   -- Quantos lotes a PRÓXIMA carga sobrescreveria hoje (sem o corte por
--   -- atualizado_em, que só existe na hora da carga):
--   SELECT count(*) FROM public.sup_estoque_tag t
--     JOIN public.sup_estoque_item ei ON ei.id = t.item_estoque_id
--     JOIN public.sst_ca_catalogo c ON c.ca_numero = regexp_replace(t.ca_numero, '\D', '', 'g')
--    WHERE NOT t.usado AND ei.arquivado_em IS NULL
--      AND (t.ca_numero IS DISTINCT FROM c.ca_numero
--           OR (c.validade IS NOT NULL AND t.ca_validade IS DISTINCT FROM c.validade));

-- ── ROLLBACK ─────────────────────────────────────────────────────────
--   DROP TRIGGER IF EXISTS trg_sst_ca_aplicar_no_estoque ON public.sst_ca_sincronizacao;
--   DROP FUNCTION IF EXISTS public.sst_ca_aplicar_no_estoque();
--   sup_est_editar_item: recriar a partir de
--     20260930000107_sup_estoque_editar_material.sql:101
--   DROP FUNCTION IF EXISTS public.sup_rotulo_tipo_item(text);  -- depois do de cima
--   sst_ca_situacao_catalogo: DROP e recriar a partir de
--     20260930000001_caepi_anexo_pelo_sistema.sql:116
--   ALTER TABLE public.sst_ca_sincronizacao
--     DROP COLUMN IF EXISTS lotes_atualizados, DROP COLUMN IF EXISTS estoque_erro;
--   ALTER TABLE public.sup_estoque_alteracao DROP CONSTRAINT IF EXISTS sup_estoque_alteracao_origem_check;
--   ALTER TABLE public.sup_estoque_alteracao DROP COLUMN IF EXISTS origem;
--   NOTIFY pgrst, 'reload schema';
