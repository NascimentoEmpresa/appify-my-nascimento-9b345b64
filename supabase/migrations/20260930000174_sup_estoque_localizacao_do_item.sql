-- =====================================================================
-- ESTOQUE — localização física do item, informada na entrada
--
-- PEDIDO (17/09/2026, tela /app/suprimentos/estoque-etiquetas)
--   "No modal que aparece pedindo as informações do item que entrará no
--    estoque, adicione um campo de escrever número ou letra, com o título
--    'Localização' e placeholder 'diga a localização física do item', e
--    isso vire uma informação normal daquele item/código do item."
--
-- ONDE ISSO MORA
--   `sup_estoque_item.localizacao` JÁ EXISTE desde 20260903000001 (carga do
--   sistema antigo, que tinha o endereço de prateleira em texto livre —
--   "F-04-08", "D4.10", "A2.07"). Em produção, 742 fichas já têm endereço
--   vindo do legado (medido em 17/09/2026), e a coluna nunca teve tela: quem
--   dava entrada aqui não conseguia informar, e quem procurava na prateleira
--   não conseguia ler. Esta migration só liga a coluna ao fluxo — não cria
--   estrutura nova, e é por isso que ela também não pode APAGAR o que já
--   está lá (ver o COALESCE da entrada).
--
--   A FONTE é a ficha (almoxarifado, item), não o lote: cada tamanho é um
--   item com código próprio desde 20260930000163, e quem procura na
--   prateleira procura o CÓDIGO. Endereço por lote seria dizer que a mesma
--   "JAQUETA M" está em dois lugares ao mesmo tempo. O lote recebe uma cópia
--   pela razão explicada no fim deste cabeçalho.
--
-- O QUE MUDA, EM DUAS FUNÇÕES — reproduções fiéis de 20260930000163, com as
-- mudanças marcadas "EDIÇÃO 0174":
--   sup_est_entrada_quantidade 20260930000163:447 — lê `localizacao` do
--     payload e grava na ficha. Informada, sobrescreve a que estava lá
--     (mudar de prateleira é dizer a nova na entrada seguinte); vazia,
--     preserva — senão toda entrada feita sem preencher apagaria o endereço
--     que veio do legado.
--   sup_est_editar_item        20260930000163:572 — aceita `localizacao`
--     como já aceita `observacoes`, e registra a troca no histórico de
--     alterações do item. Sem isto, endereço digitado errado ficaria errado
--     para sempre.
--
-- Mudar de prateleira, seja pela entrada ou pela edição, leva os lotes ainda
-- livres daquele código para o endereço novo: é a mesma pilha que andou de
-- estante. Lote já entregue não se mexe — ele é histórico do pedido.
--
-- Uma entrada com vários tamanhos grava a MESMA prateleira em cada item
-- criado, do mesmo jeito que valor, mínimo e validade do preço já valem para
-- todos — é uma chamada por remessa e cada uma leva o campo.
--
-- POR QUE O ENDEREÇO TAMBÉM VAI PARA O LOTE
--   A tela de Separação (/app/suprimentos/separacao) já mostra a prateleira
--   há tempo, mas lê `sup_estoque_tag.localizacao` — a coluna irmã, que só
--   tinha valores vindos do sistema antigo. É a tela em que alguém realmente
--   anda até a estante. Então o lote nasce com o endereço do código e
--   acompanha quando ele muda na edição (só os lotes livres; lote entregue é
--   histórico do pedido). A ficha do item continua sendo a fonte — o lote é
--   cópia para a separação não precisar de um JOIN a mais em seis funções.
-- =====================================================================

-- ── 1. A coluna (defensivo: o Lovable regenera schema, e 0903 é antiga) ──
ALTER TABLE public.sup_estoque_item ADD COLUMN IF NOT EXISTS localizacao text;
COMMENT ON COLUMN public.sup_estoque_item.localizacao IS
  'Endereço físico na prateleira (ex.: F-04-08, D4.10, A3). Texto livre, informado na entrada e editável na ficha. Não é o almoxarifado — esse é o almoxarifado_id.';

-- ── 2. Entrada por quantidade ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sup_est_entrada_quantidade(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_nome     text := public.sup_est_nome_usuario();
  v_almox    uuid := (p_payload->>'almoxarifado_id')::uuid;
  v_mat      uuid;
  v_codigo   text := NULLIF(btrim(p_payload->>'codigo_item'), '');
  v_empresa  uuid;
  v_item     uuid;
  v_qtd      int  := COALESCE((p_payload->>'quantidade')::int, 0);
  v_tam      text := NULLIF(btrim(p_payload->>'tamanho'), '');
  v_valor    numeric := NULLIF(p_payload->>'valor_unitario', '')::numeric;
  v_estado   text := COALESCE(NULLIF(btrim(p_payload->>'estado'), ''), 'novo');
  v_ca_num   text := NULLIF(btrim(p_payload->>'ca_numero'), '');
  v_ca_val   date := NULLIF(p_payload->>'ca_validade', '')::date;
  v_tipo_mat text;
  v_bloq     record;
  v_lote     text;
  v_lote_id  uuid;
  v_seq      int;
  v_tam_item text;   -- EDIÇÃO 0163
  v_local    text := NULLIF(btrim(p_payload->>'localizacao'), '');   -- EDIÇÃO 0174
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_estoque', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para dar entrada no estoque';
  END IF;

  IF v_qtd <= 0 THEN RAISE EXCEPTION 'Informe uma quantidade maior que zero'; END IF;

  SELECT a.empresa_id INTO v_empresa FROM public.almoxarifado a WHERE a.id = v_almox;
  IF v_empresa IS NULL THEN RAISE EXCEPTION 'Almoxarifado não encontrado'; END IF;

  -- Aceita o id (escolha na tela) ou o código bipado (leitor físico).
  v_mat := NULLIF(p_payload->>'sup_item_id', '')::uuid;
  IF v_mat IS NULL AND v_codigo IS NOT NULL THEN
    SELECT i.id INTO v_mat FROM public.sup_item i
     WHERE (i.codigo = v_codigo OR i.codigo_barras = v_codigo)
       AND i.empresa_id = v_empresa
     LIMIT 1;
    IF v_mat IS NULL THEN
      RAISE EXCEPTION 'Nenhum item desta empresa tem o código %', v_codigo;
    END IF;
  END IF;
  IF v_mat IS NULL THEN RAISE EXCEPTION 'Informe o item ou o código do item'; END IF;

  SELECT i.tipo INTO v_tipo_mat FROM public.sup_item i
   WHERE i.id = v_mat AND i.empresa_id = v_empresa;
  IF v_tipo_mat IS NULL THEN
    RAISE EXCEPTION 'Material não pertence à empresa deste almoxarifado';
  END IF;

  -- EPI com CA vencido/suspenso/cancelado é barrado JÁ NA ENTRADA.
  --
  -- O ajuste 9 barrava só na saída, e foi a leitura certa enquanto o problema
  -- era o estoque que já existia. Mas o Cassio contou a origem: "tenho mais de
  -- 300 máscaras com CA vencido no estoque, o sistema não pede a validade do
  -- CA na entrada". Barrar aqui é fechar a torneira, não só enxugar o chão.
  IF v_tipo_mat = 'epi' THEN
    SELECT * INTO v_bloq FROM public.sst_ca_bloqueio(v_ca_num, v_ca_val);
    IF v_bloq.bloqueado THEN
      RAISE EXCEPTION 'Não é possível dar entrada neste EPI: %', v_bloq.motivo;
    END IF;
  END IF;

  -- EDIÇÃO 0163: cada tamanho é um item com código próprio. O tamanho
  -- informado leva a entrada ao item daquele tamanho — criado aqui na
  -- primeira vez, com código novo. Item escolhido (ou bipado) que já É um
  -- tamanho fica nele. "X", "U" e "ÚNICO" não são tamanho: ficam no base.
  -- O EPI e a empresa foram conferidos acima pelo item escolhido; o item do
  -- tamanho herda os dois.
  v_mat := public.sup_item_variante(v_mat, v_tam);
  SELECT i.tamanho INTO v_tam_item FROM public.sup_item i WHERE i.id = v_mat;
  v_tam := COALESCE(v_tam_item, v_tam);

  -- EDIÇÃO 0174: a localização vem da entrada e é do ITEM (do código dele),
  -- não da remessa — quem procura na prateleira procura o código, e a
  -- prateleira do código é uma só. Em ficha que já existe ela SOBRESCREVE
  -- quando foi informada (mudar de prateleira é dizer a nova na entrada
  -- seguinte); vindo vazia, o COALESCE preserva a que estava lá.
  INSERT INTO public.sup_estoque_item
    (empresa_id, almoxarifado_id, sup_item_id, valor_unitario, estoque_minimo, fornecedor, validade,
     localizacao)
  VALUES (v_empresa, v_almox, v_mat,
          COALESCE(v_valor, 0),
          COALESCE((p_payload->>'estoque_minimo')::int, 0),
          NULLIF(p_payload->>'fornecedor', ''),
          NULLIF(p_payload->>'validade', '')::date,
          v_local)
  ON CONFLICT (almoxarifado_id, sup_item_id) DO UPDATE
    SET valor_unitario = COALESCE(NULLIF(excluded.valor_unitario, 0), public.sup_estoque_item.valor_unitario),
        estoque_minimo = GREATEST(excluded.estoque_minimo, public.sup_estoque_item.estoque_minimo),
        fornecedor     = COALESCE(excluded.fornecedor, public.sup_estoque_item.fornecedor),
        validade       = COALESCE(excluded.validade, public.sup_estoque_item.validade),
        localizacao    = COALESCE(excluded.localizacao, public.sup_estoque_item.localizacao)
  RETURNING id INTO v_item;

  -- EDIÇÃO 0174: prateleira nova informada, o que já está livre neste código
  -- vai junto. Quem recebe e diz "agora é B-01" moveu a pilha inteira, não só
  -- a caixa de hoje — e a Separação lê o endereço do LOTE, então sem isto a
  -- mesma "JAQUETA M" apareceria em duas estantes na lista de separação.
  -- Lote já entregue fica como está: é histórico do pedido que o levou.
  IF v_local IS NOT NULL THEN
    UPDATE public.sup_estoque_tag tg
       SET localizacao = v_local
     WHERE tg.item_estoque_id = v_item
       AND NOT tg.usado
       AND tg.localizacao IS DISTINCT FROM v_local;
  END IF;

  -- A prateleira que ficou valendo para este código — a informada agora, ou
  -- a que a ficha já tinha.
  SELECT ei.localizacao INTO v_local FROM public.sup_estoque_item ei WHERE ei.id = v_item;

  SELECT COALESCE(max(t.sequencia), 0) + 1 INTO v_seq
    FROM public.sup_estoque_tag t WHERE t.item_estoque_id = v_item;

  -- O código do lote é interno: nunca é impresso nem digitado por ninguém. Ele
  -- existe porque `sup_estoque_tag.codigo` é NOT NULL UNIQUE desde a origem, e
  -- é o que amarra o ledger `sup_estoque_consumo` a esta remessa.
  v_lote := upper(left('L' || to_char(now(), 'YYMMDD') || '-' ||
                       replace(gen_random_uuid()::text, '-', ''), 24));

  -- EDIÇÃO 0174: o lote nasce com a prateleira do código. Parece repetição da
  -- ficha, e é — mas é a Separação que precisa dela: a lista de separação lê
  -- `sup_estoque_tag.localizacao` (coluna de 20260903000001, até aqui só com
  -- valores vindos do sistema antigo). Sem esta linha, todo lote novo chegaria
  -- na separação sem endereço, e o campo que a pessoa acabou de preencher não
  -- apareceria justamente na tela em que se anda até a estante.
  INSERT INTO public.sup_estoque_tag
    (item_estoque_id, codigo, tamanho, sequencia, tipo,
     quantidade_massa, quantidade_original_massa, valor_unitario, estado,
     ca_numero, ca_validade, localizacao)
  VALUES (v_item, v_lote, v_tam, v_seq, 'massa',
          v_qtd, v_qtd, v_valor, v_estado,
          v_ca_num, v_ca_val, v_local)
  RETURNING id INTO v_lote_id;

  INSERT INTO public.sup_estoque_movimento
    (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho,
     usuario_id, usuario_nome, observacao)
  VALUES (v_empresa, v_item, v_lote, 'entrada', v_qtd, v_tam,
          v_uid, v_nome, NULLIF(btrim(p_payload->>'observacao'), ''));

  RETURN jsonb_build_object(
    'item_estoque_id', v_item,
    'lote_id', v_lote_id,
    'quantidade', v_qtd,
    -- EDIÇÃO 0163: o item que recebeu (o do tamanho), para a tela dizer o código.
    'sup_item_id', v_mat,
    'codigo_item', (SELECT i.codigo FROM public.sup_item i WHERE i.id = v_mat),
    'nome_item',   (SELECT i.nome   FROM public.sup_item i WHERE i.id = v_mat),
    -- EDIÇÃO 0174: a prateleira que ficou valendo para este código.
    'localizacao', v_local
  );
END $$;

-- ── 3. Edição da ficha do item ───────────────────────────────────────
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
  v_local    text;     -- EDIÇÃO 0174: prateleira do código
  v_tam      text;
  v_ca_num   text;
  v_ca_val   date;
  v_qtd      int;
  v_delta    int;
  v_res      int;
  v_pedidos  text;
  v_base     record;   -- EDIÇÃO 0163: o material base (ele mesmo, se não for tamanho)
  v_alvo     uuid;     -- EDIÇÃO 0163: o item do tamanho novo de um lote
  v_alvo_ei  uuid;
  v_alvo_tam text;
  v_alvo_nome text;
  v_mov_qtd  int;
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

  -- EDIÇÃO 0163: nome e tipo de um TAMANHO são os do base ("JAQUETA M" é
  -- "JAQUETA" + "M"). A edição vai para o base, e o gatilho
  -- trg_sup_item_variante_propaga repassa a todos os tamanhos. O nome que
  -- chega é o do base — a tela mostra "JAQUETA", não "JAQUETA M".
  IF v_mat.item_pai_id IS NOT NULL THEN
    SELECT i.* INTO v_base FROM public.sup_item i WHERE i.id = v_mat.item_pai_id FOR UPDATE;
  ELSE
    v_base := v_mat;
  END IF;

  -- ── Nome (catálogo) ──
  -- EDIÇÃO 0163: daqui até o cadastro do item de estoque, v_mat virou
  -- v_base — nome e tipo são do material base.
  IF p ? 'nome' THEN
    -- Mesma forma que o catálogo grava: maiúsculas, sem espaço sobrando.
    v_nome_mat := upper(regexp_replace(btrim(COALESCE(p->>'nome', '')), '\s+', ' ', 'g'));
    IF v_nome_mat = '' THEN RAISE EXCEPTION 'O nome do material não pode ficar vazio'; END IF;

    IF v_nome_mat IS DISTINCT FROM v_base.nome THEN
      IF NOT public.can_access(v_uid, 'sup_catalogo', 'alterar') THEN
        RAISE EXCEPTION 'Renomear material exige permissão de alterar no Catálogo';
      END IF;

      -- Inativo de OUTRA empresa pode repetir (são as cópias aposentadas da
      -- 20260930000105); da mesma empresa não, que o UNIQUE (empresa_id, nome)
      -- recusaria com uma mensagem que ninguém entende.
      SELECT i.nome, i.codigo INTO v_dup FROM public.sup_item i
       WHERE i.id <> v_base.id
         AND upper(regexp_replace(btrim(i.nome), '\s+', ' ', 'g')) = v_nome_mat
         AND (i.ativo OR i.empresa_id = v_base.empresa_id)
       LIMIT 1;
      IF FOUND THEN
        RAISE EXCEPTION 'Já existe outro material chamado % (código %). Use outro nome.',
          v_dup.nome, COALESCE(v_dup.codigo, '—');
      END IF;

      UPDATE public.sup_item i SET nome = v_nome_mat WHERE i.id = v_base.id;

      v_log := v_log || jsonb_build_object('campo', 'Nome do material',
                                           'antes', v_base.nome, 'depois', v_nome_mat);

      INSERT INTO public.sup_cat_alteracao
        (empresa_id, tipo_entidade, tipo_acao, alvo_id, dados, contexto,
         descricao, status, criado_por, criado_por_nome)
      VALUES (v_base.empresa_id, 'item', 'editar', v_base.id,
              jsonb_build_object('de', v_base.nome, 'para', v_nome_mat,
                                 'origem', 'estoque', 'motivo', v_motivo),
              jsonb_build_object('item', v_nome_mat),
              format('Renomear material "%s" → "%s" (pelo Estoque)', v_base.nome, v_nome_mat),
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

    IF v_tipo IS DISTINCT FROM v_base.tipo THEN
      IF NOT public.can_access(v_uid, 'sup_catalogo', 'alterar') THEN
        RAISE EXCEPTION 'Trocar o tipo do material exige permissão de alterar no Catálogo';
      END IF;

      UPDATE public.sup_item i SET tipo = v_tipo WHERE i.id = v_base.id;

      v_log := v_log || jsonb_build_object('campo', 'Tipo do material',
        'antes',  public.sup_rotulo_tipo_item(v_base.tipo),
        'depois', public.sup_rotulo_tipo_item(v_tipo));

      INSERT INTO public.sup_cat_alteracao
        (empresa_id, tipo_entidade, tipo_acao, alvo_id, dados, contexto,
         descricao, status, criado_por, criado_por_nome)
      VALUES (v_base.empresa_id, 'item', 'editar', v_base.id,
              jsonb_build_object('campo', 'tipo', 'de', v_base.tipo, 'para', v_tipo,
                                 'origem', 'estoque', 'motivo', v_motivo),
              jsonb_build_object('item', COALESCE(v_nome_mat, v_base.nome)),
              format('Tipo de "%s": %s → %s (pelo Estoque)', COALESCE(v_nome_mat, v_base.nome),
                     public.sup_rotulo_tipo_item(v_base.tipo), public.sup_rotulo_tipo_item(v_tipo)),
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
  -- EDIÇÃO 0174: a localização é do item de estoque, como observações. A
  -- chave ausente mantém o que está lá; chave presente e vazia APAGA — é
  -- assim que se diz "esse código não tem prateleira fixa".
  v_local := CASE WHEN p ? 'localizacao'
                  THEN NULLIF(btrim(p->>'localizacao'), '')
                  ELSE v_item.localizacao END;

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
  IF v_local IS DISTINCT FROM v_item.localizacao THEN
    v_log := v_log || jsonb_build_object('campo', 'Localização',
      'antes', v_item.localizacao, 'depois', v_local);
  END IF;

  -- UM update só: trg_sup_item_preco_registra dispara por UPDATE, e dois
  -- updates gravariam duas linhas no histórico de preços.
  IF v_valor    IS DISTINCT FROM v_item.valor_unitario
  OR v_validade IS DISTINCT FROM v_item.preco_valido_ate
  OR v_minimo   IS DISTINCT FROM v_item.estoque_minimo
  OR v_forn     IS DISTINCT FROM v_item.fornecedor_id
  OR v_obs      IS DISTINCT FROM v_item.observacoes
  OR v_local    IS DISTINCT FROM v_item.localizacao THEN
    UPDATE public.sup_estoque_item ei
       SET valor_unitario = v_valor, preco_valido_ate = v_validade,
           estoque_minimo = v_minimo, fornecedor_id = v_forn, observacoes = v_obs,
           localizacao    = v_local
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

  -- EDIÇÃO 0174: a Separação lê a prateleira do LOTE. Mudou o endereço do
  -- código, os lotes que ainda estão livres mudam com ele — senão a lista de
  -- separação continuaria mandando a pessoa à estante antiga. Lote já
  -- entregue fica como está: ele é histórico do pedido que o levou.
  IF v_local IS DISTINCT FROM v_item.localizacao THEN
    UPDATE public.sup_estoque_tag tg
       SET localizacao = v_local
     WHERE tg.item_estoque_id = v_item.id
       AND NOT tg.usado;
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
    -- EDIÇÃO 0163: tamanho trocado muda o lote de ITEM. Cada tamanho tem
    -- código próprio, então "este lote é G, não M" quer dizer que ele é da
    -- JAQUETA G. O lote vai para a ficha daquele tamanho no mesmo
    -- almoxarifado (criada se preciso), com a reserva ativa junto, e as duas
    -- trilhas contam a passagem: sai de uma ficha, entra na outra. Consumo e
    -- movimentos antigos ficam onde aconteceram.
    IF v_tam IS DISTINCT FROM t.tamanho THEN
      v_alvo := public.sup_item_variante(v_base.id, v_tam);
      IF v_alvo IS DISTINCT FROM v_item.sup_item_id THEN
        SELECT i.nome, i.tamanho INTO v_alvo_nome, v_alvo_tam
          FROM public.sup_item i WHERE i.id = v_alvo;

        INSERT INTO public.sup_estoque_item
          (empresa_id, almoxarifado_id, sup_item_id, valor_unitario, estoque_minimo,
           fornecedor, fornecedor_id, preco_valido_ate, localizacao)
        VALUES (v_item.empresa_id, v_item.almoxarifado_id, v_alvo, v_valor, 0,
                v_item.fornecedor, v_forn, v_validade, v_item.localizacao)
        ON CONFLICT (almoxarifado_id, sup_item_id) DO NOTHING;
        -- Ficha nova: o gatilho de preço gravou 'entrada'. Não é compra.
        UPDATE public.sup_item_preco pr SET origem = 'ajuste'
         WHERE pr.sup_item_id = v_alvo AND pr.registrado_em = now() AND pr.origem = 'entrada';

        SELECT ei.id INTO v_alvo_ei FROM public.sup_estoque_item ei
         WHERE ei.almoxarifado_id = v_item.almoxarifado_id AND ei.sup_item_id = v_alvo;

        -- Mover o lote não passa pelo gatilho que desarquiva
        -- (20260930000106 §3 olha usado/quantidade): a ficha de destino,
        -- se estava arquivada, volta à lista aqui.
        UPDATE public.sup_estoque_item ei
           SET arquivado_em = NULL, arquivado_por = NULL,
               arquivado_por_nome = NULL, arquivado_motivo = NULL
         WHERE ei.id = v_alvo_ei AND ei.arquivado_em IS NOT NULL;

        UPDATE public.sup_estoque_tag tg
           SET item_estoque_id = v_alvo_ei, tamanho = COALESCE(v_alvo_tam, v_tam)
         WHERE tg.id = t.id;
        UPDATE public.sup_estoque_reserva r SET item_estoque_id = v_alvo_ei
         WHERE r.tag_id = t.id AND r.situacao = 'ATIVA';

        v_mov_qtd := CASE WHEN t.tipo = 'massa' THEN COALESCE(v_qtd, 0) ELSE 1 END;
        INSERT INTO public.sup_estoque_movimento
          (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho,
           observacao, usuario_id, usuario_nome)
        VALUES
          (v_item.empresa_id, v_item.id, t.codigo, 'correcao', -v_mov_qtd, t.tamanho,
           format('Lote passou para %s (tamanho %s → %s). Motivo: %s',
                  v_alvo_nome, COALESCE(t.tamanho, '—'), COALESCE(v_tam, '—'), v_motivo),
           v_uid, v_nome),
          (v_item.empresa_id, v_alvo_ei, t.codigo, 'correcao', v_mov_qtd, COALESCE(v_alvo_tam, v_tam),
           format('Lote veio de %s (tamanho %s → %s). Motivo: %s',
                  v_mat.nome, COALESCE(t.tamanho, '—'), COALESCE(v_tam, '—'), v_motivo),
           v_uid, v_nome);

        INSERT INTO public.sup_estoque_alteracao
          (empresa_id, item_estoque_id, sup_item_id, tag_id, codigo, campo,
           valor_anterior, valor_novo, motivo, usuario_id, usuario_nome, origem)
        VALUES (v_item.empresa_id, v_alvo_ei, v_alvo, t.id, t.codigo, 'Tamanho',
                t.tamanho, COALESCE(v_alvo_tam, v_tam), v_motivo, v_uid, v_nome, 'edicao');

        -- A ficha de onde o lote saiu, se ficou sem lote nenhum, sai da
        -- lista (arquivada, como em 20260930000106).
        IF NOT EXISTS (SELECT 1 FROM public.sup_estoque_tag tg WHERE tg.item_estoque_id = v_item.id) THEN
          UPDATE public.sup_estoque_item ei
             SET arquivado_em = now(), arquivado_por = v_uid, arquivado_por_nome = v_nome,
                 arquivado_motivo = 'Os lotes passaram para os itens por tamanho. Motivo: ' || v_motivo
           WHERE ei.id = v_item.id;
        END IF;
      END IF;
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

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- --   A coluna NÃO deve ser derrubada: ela é de 20260903000001 e tem os
-- --   endereços vindos do sistema antigo. Para desfazer só o comportamento,
-- --   recriar as duas funções pelas definições de 20260930000163
-- --   (sup_est_entrada_quantidade em :447, sup_est_editar_item em :572) e:
-- --
-- --   NOTIFY pgrst, 'reload schema';
