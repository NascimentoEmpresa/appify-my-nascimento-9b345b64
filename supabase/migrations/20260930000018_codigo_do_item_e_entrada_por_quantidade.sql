-- =========================================================================
-- Código do item para a vida inteira, e entrada por quantidade
--
-- PEDIDO DO CASSIO (ajuste 7 da revisão de 27/08/2026)
-- "Em /estoque-etiquetas criar código do item pra sempre, um código que sempre
-- será do item a vida inteira. Só altera as quantidades desse item ligado a
-- esse código. Não ter mais tags — ser algo parecido com mercado: cada item,
-- ao invés de ter uma tag, ter um código interno do produto, onde somente é
-- adicionado quantidades dele, mais nada. Tag única e em massa deixar de
-- existir."
--
-- O PROBLEMA QUE ELE ESTÁ RESOLVENDO (na fala dele, no 0207)
-- "Tu tem duas canecas iguais. Se eu peguei essa caneca aqui, eu abro o
-- sistema e não olho o código. Esse aqui é o tag 02, só que eu dou baixa no
-- 01. Já está errado o meu estoque." Etiqueta por unidade cria uma escolha que
-- não tem resposta certa: duas peças idênticas, dois códigos, e quem separa
-- não tem como saber qual é qual. O erro é do desenho, não do estoquista.
--
-- O QUE MUDA
-- O código passa a ser DO PRODUTO, não da peça. Bipa-se o produto e informa-se
-- a quantidade — igual a mercado. Duas canecas iguais são o mesmo código, e a
-- pergunta simplesmente deixa de existir.
--
-- ─────────────────────────────────────────────────────────────────────────
-- POR QUE `sup_estoque_tag` NÃO É APAGADA
--
-- Hoje há 12.686 linhas ali. Dessas, 3.287 já foram consumidas e 1.084 estão
-- ligadas a um pedido — é o registro de qual peça foi para qual colaborador.
-- Apagar isso atenderia o ajuste 7 e quebraria o 0222, que o Cassio também
-- pediu: "a botina do Eduardo vence daqui a seis meses, quando vencer como é
-- que eu vou saber pra trocar?".
--
-- Então a tabela permanece, com outro papel: cada linha deixa de ser UMA PEÇA
-- e passa a ser UM LOTE de entrada — quantidade, custo, estado e CA daquela
-- remessa. É o que `tipo = 'massa'` já fazia; o que morre é o `tipo = 'unico'`,
-- a etiqueta por peça. Do lado de fora ninguém digita nem imprime lote: o
-- usuário vê o código do produto e uma quantidade, que é exatamente o pedido.
--
-- Isso também é o que um mercado faz de verdade. A etiqueta de gôndola é do
-- produto; os lotes existem atrás, e é por eles que se sabe qual validade sai
-- primeiro.
--
-- SEM MIGRAÇÃO DE DADOS, DE PROPÓSITO
-- As 12.504 etiquetas únicas que ainda existem continuam válidas e vão sendo
-- consumidas normalmente — `sup_estoque_saldo` soma as duas formas desde
-- sempre, então o saldo nunca fica errado durante a transição. Entrada nova
-- nasce lote; etiqueta antiga escoa sozinha. Nenhum UPDATE em massa, nenhum
-- backup necessário, nenhuma janela de risco para o usuário final.
--
-- Idempotente.
-- ROLLBACK no fim do arquivo.
-- =========================================================================

-- ── 1. O código do produto ───────────────────────────────────────────────
--
-- Sequência global, não por empresa: o leitor de código de barras não sabe em
-- qual empresa o usuário está logado. Código repetido entre empresas faria a
-- bipagem resolver para dois produtos diferentes — o mesmo tipo de ambiguidade
-- que este ajuste veio eliminar.
--
-- Sete dígitos, só numérico: qualquer leitor 1D comum lê, e não colide em
-- comprimento com o que já se bipa por aqui (chave de NF-e tem 44, etiqueta
-- antiga ~24).
--
-- `codigo_barras` continua existindo e é outra coisa: é o EAN do FABRICANTE,
-- usado para casar item de nota fiscal na importação de XML. Um é nosso e
-- nunca muda; o outro é do fornecedor e muda quando ele troca a embalagem.

CREATE SEQUENCE IF NOT EXISTS public.sup_item_codigo_seq AS bigint START WITH 1;

ALTER TABLE public.sup_item ADD COLUMN IF NOT EXISTS codigo text;

COMMENT ON COLUMN public.sup_item.codigo IS
  'Codigo interno do produto, gerado uma vez e imutavel. E o que se bipa no estoque. Nao confundir com codigo_barras, que e o EAN do fabricante.';

-- Backfill em ordem de criação, para o número acompanhar a idade do cadastro
-- em vez de sair aleatório.
UPDATE public.sup_item i
   SET codigo = lpad(nextval('public.sup_item_codigo_seq')::text, 7, '0')
  FROM (
    SELECT id FROM public.sup_item WHERE codigo IS NULL ORDER BY created_at, id
  ) ordenado
 WHERE i.id = ordenado.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sup_item_codigo
  ON public.sup_item(codigo) WHERE codigo IS NOT NULL;

-- Item novo já nasce com código.
CREATE OR REPLACE FUNCTION public.sup_item_gerar_codigo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NULLIF(btrim(NEW.codigo), '') IS NULL THEN
    NEW.codigo := lpad(nextval('public.sup_item_codigo_seq')::text, 7, '0');
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_sup_item_gerar_codigo ON public.sup_item;
CREATE TRIGGER trg_sup_item_gerar_codigo
  BEFORE INSERT ON public.sup_item
  FOR EACH ROW EXECUTE FUNCTION public.sup_item_gerar_codigo();

-- ── 2. "Pra sempre" é uma trava, não uma promessa ────────────────────────
--
-- O pedido foi literal: "um código que sempre será do item a vida inteira".
-- Sem trava isso dura até a primeira tela de edição que mande o campo junto
-- por engano — e aí etiqueta impressa, histórico e planilha exportada passam a
-- apontar para outro produto, em silêncio.

CREATE OR REPLACE FUNCTION public.sup_item_codigo_imutavel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF OLD.codigo IS NOT NULL AND NEW.codigo IS DISTINCT FROM OLD.codigo THEN
    RAISE EXCEPTION 'O código do item (%) não pode ser alterado — ele acompanha o produto pela vida inteira', OLD.codigo;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_sup_item_codigo_imutavel ON public.sup_item;
CREATE TRIGGER trg_sup_item_codigo_imutavel
  BEFORE UPDATE ON public.sup_item
  FOR EACH ROW EXECUTE FUNCTION public.sup_item_codigo_imutavel();

-- ── 3. Bipar o produto ───────────────────────────────────────────────────
--
-- Aceita o código interno OU o EAN do fabricante, porque na prática o
-- estoquista vai bipar o que estiver impresso na caixa. Devolve o saldo já
-- somado, que é o que ele quer ver ao bipar.

CREATE OR REPLACE FUNCTION public.sup_item_por_codigo(p_codigo text)
RETURNS TABLE (
  sup_item_id uuid,
  codigo      text,
  nome        text,
  tipo        text,
  empresa_id  uuid,
  ativo       boolean,
  disponivel  integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT i.id, i.codigo, i.nome, i.tipo, i.empresa_id, i.ativo,
         COALESCE((
           SELECT SUM(s.disponivel)::integer
             FROM public.sup_estoque_saldo s
            WHERE s.sup_item_id = i.id
         ), 0)
    FROM public.sup_item i
   WHERE NULLIF(btrim(p_codigo), '') IS NOT NULL
     AND (i.codigo = btrim(p_codigo) OR i.codigo_barras = btrim(p_codigo))
   LIMIT 1;
$fn$;

-- ── 4. Entrada por quantidade ────────────────────────────────────────────
--
-- O coração do ajuste. Onde antes se digitava N códigos de etiqueta para dar
-- entrada em N peças, agora se informa o produto e um número.
--
-- Cada chamada cria UM lote, e lotes não se fundem de propósito: remessas
-- diferentes têm custo, CA e validade diferentes, e é por lote que a saída
-- sabe o que vence primeiro. Fundir tornaria o custo uma média — e o Cassio foi
-- explícito no 0199 de que média não serve ("o último valor pago").
--
-- A RPC antiga `sup_est_entrada` continua existindo e funcionando. Nada que já
-- roda hoje quebra por causa deste arquivo.

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

  INSERT INTO public.sup_estoque_item
    (empresa_id, almoxarifado_id, sup_item_id, valor_unitario, estoque_minimo, fornecedor, validade)
  VALUES (v_empresa, v_almox, v_mat,
          COALESCE(v_valor, 0),
          COALESCE((p_payload->>'estoque_minimo')::int, 0),
          NULLIF(p_payload->>'fornecedor', ''),
          NULLIF(p_payload->>'validade', '')::date)
  ON CONFLICT (almoxarifado_id, sup_item_id) DO UPDATE
    SET valor_unitario = COALESCE(NULLIF(excluded.valor_unitario, 0), public.sup_estoque_item.valor_unitario),
        estoque_minimo = GREATEST(excluded.estoque_minimo, public.sup_estoque_item.estoque_minimo),
        fornecedor     = COALESCE(excluded.fornecedor, public.sup_estoque_item.fornecedor),
        validade       = COALESCE(excluded.validade, public.sup_estoque_item.validade)
  RETURNING id INTO v_item;

  SELECT COALESCE(max(t.sequencia), 0) + 1 INTO v_seq
    FROM public.sup_estoque_tag t WHERE t.item_estoque_id = v_item;

  -- O código do lote é interno: nunca é impresso nem digitado por ninguém. Ele
  -- existe porque `sup_estoque_tag.codigo` é NOT NULL UNIQUE desde a origem, e
  -- é o que amarra o ledger `sup_estoque_consumo` a esta remessa.
  v_lote := upper(left('L' || to_char(now(), 'YYMMDD') || '-' ||
                       replace(gen_random_uuid()::text, '-', ''), 24));

  INSERT INTO public.sup_estoque_tag
    (item_estoque_id, codigo, tamanho, sequencia, tipo,
     quantidade_massa, quantidade_original_massa, valor_unitario, estado,
     ca_numero, ca_validade)
  VALUES (v_item, v_lote, v_tam, v_seq, 'massa',
          v_qtd, v_qtd, v_valor, v_estado,
          v_ca_num, v_ca_val)
  RETURNING id INTO v_lote_id;

  INSERT INTO public.sup_estoque_movimento
    (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho,
     usuario_id, usuario_nome, observacao)
  VALUES (v_empresa, v_item, v_lote, 'entrada', v_qtd, v_tam,
          v_uid, v_nome, NULLIF(btrim(p_payload->>'observacao'), ''));

  RETURN jsonb_build_object(
    'item_estoque_id', v_item,
    'lote_id', v_lote_id,
    'quantidade', v_qtd
  );
END $$;

-- ── 5. O furo que a entrada por quantidade abriria no bloqueio de CA ─────
--
-- `sst_ca_guard_baixa` (ajuste 9) dispara em `pedido_id IS DISTINCT FROM`.
-- Isso cobria a etiqueta única, que ganha `pedido_id` ao ser usada. Mas lote
-- só recebe `pedido_id` quando ZERA: consumir 3 de um lote de 10 não mexe no
-- campo, e o gatilho não roda.
--
-- Enquanto quase tudo era etiqueta única isso passava despercebido. Com a
-- entrada virando lote, passaria a ser o caminho normal — ou seja, o ajuste 9
-- deixaria de valer justamente por causa do ajuste 7.
--
-- Agora o gatilho também roda quando a quantidade do lote DIMINUI.

CREATE OR REPLACE FUNCTION public.sst_ca_guard_baixa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_tipo    text;
  v_bloq    record;
  v_consumo boolean;
BEGIN
  -- Duas formas de sair do estoque:
  --   etiqueta única → ganha pedido_id
  --   lote           → perde quantidade
  -- Devolução (a quantidade sobe), inventário e correção de dado não entram.
  v_consumo :=
    (NEW.pedido_id IS NOT NULL AND NEW.pedido_id IS DISTINCT FROM OLD.pedido_id)
    OR (COALESCE(NEW.quantidade_massa, 0) < COALESCE(OLD.quantidade_massa, 0));

  IF NOT v_consumo THEN RETURN NEW; END IF;

  SELECT i.tipo INTO v_tipo
    FROM public.sup_estoque_item ei
    JOIN public.sup_item i ON i.id = ei.sup_item_id
   WHERE ei.id = NEW.item_estoque_id;

  IF coalesce(v_tipo, '') <> 'epi' THEN RETURN NEW; END IF;

  SELECT * INTO v_bloq FROM public.sst_ca_bloqueio(NEW.ca_numero, NEW.ca_validade);

  IF v_bloq.bloqueado THEN
    RAISE EXCEPTION 'Item %: %', NEW.codigo, v_bloq.motivo;
  END IF;

  RETURN NEW;
END;
$fn$;

-- ── 6. Saída por quantidade, do lote mais velho para o mais novo ─────────
--
-- Quem separa informa produto e quantidade; o sistema escolhe de quais lotes
-- tirar. A ordem é a que evita perda: CA vencendo primeiro, depois entrada
-- mais antiga. É o "primeiro que vence, primeiro que sai" do mercado.
--
-- Convive com `sup_est_baixar`, que continua atendendo a tela atual e as
-- etiquetas antigas ainda em circulação.

CREATE OR REPLACE FUNCTION public.sup_est_baixar_quantidade(
  p_pedido_id      uuid,
  p_pedido_item_id uuid,
  p_quantidade     integer,
  p_observacao     text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_nome   text := public.sup_est_nome_usuario();
  v_pi     record;
  v_falta  int  := GREATEST(COALESCE(p_quantidade, 0), 0);
  v_tirar  int;
  v_resta  int;
  v_lotes  jsonb := '[]'::jsonb;
  t        record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_pedidos_materiais', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para atualizar pedidos';
  END IF;
  IF v_falta <= 0 THEN RAISE EXCEPTION 'Informe uma quantidade maior que zero'; END IF;

  SELECT pi.id, pi.item_id, pi.nome_item, pi.tamanho INTO v_pi
    FROM public.sup_pedido_item pi
   WHERE pi.id = p_pedido_item_id AND pi.pedido_id = p_pedido_id;
  IF v_pi.id IS NULL THEN RAISE EXCEPTION 'Item não pertence a este pedido'; END IF;

  FOR t IN
    SELECT tg.id, tg.codigo, tg.quantidade_massa, tg.tamanho,
           ei.id AS ei_id, ei.empresa_id
      FROM public.sup_estoque_tag tg
      JOIN public.sup_estoque_item ei ON ei.id = tg.item_estoque_id
     WHERE ei.sup_item_id = v_pi.item_id
       AND tg.tipo = 'massa'
       AND NOT tg.usado
       AND COALESCE(tg.quantidade_massa, 0) > 0
       AND (v_pi.tamanho IS NULL OR tg.tamanho IS NOT DISTINCT FROM v_pi.tamanho)
     ORDER BY tg.ca_validade NULLS LAST, tg.created_at
     FOR UPDATE OF tg
  LOOP
    EXIT WHEN v_falta <= 0;
    v_tirar := LEAST(v_falta, t.quantidade_massa);
    v_resta := t.quantidade_massa - v_tirar;

    UPDATE public.sup_estoque_tag tg
       SET quantidade_massa = v_resta,
           usado            = (v_resta <= 0),
           pedido_id        = CASE WHEN v_resta <= 0 THEN p_pedido_id ELSE tg.pedido_id END,
           pedido_item_id   = CASE WHEN v_resta <= 0 THEN v_pi.id     ELSE tg.pedido_item_id END,
           usado_em         = CASE WHEN v_resta <= 0 THEN now()       ELSE tg.usado_em END,
           usado_por        = CASE WHEN v_resta <= 0 THEN v_uid       ELSE tg.usado_por END,
           usado_por_nome   = CASE WHEN v_resta <= 0 THEN v_nome      ELSE tg.usado_por_nome END
     WHERE tg.id = t.id;

    -- O ledger guarda o TOTAL por (lote, item do pedido), não o delta — é o
    -- que permite recalcular quando o pedido é reaberto.
    INSERT INTO public.sup_estoque_consumo
      (codigo, item_estoque_id, pedido_id, pedido_item_id, quantidade,
       consumido_por, consumido_por_nome)
    VALUES (t.codigo, t.ei_id, p_pedido_id, v_pi.id, v_tirar, v_uid, v_nome)
    ON CONFLICT (codigo, pedido_item_id) DO UPDATE
      SET quantidade         = public.sup_estoque_consumo.quantidade + excluded.quantidade,
          consumido_em       = now(),
          consumido_por      = excluded.consumido_por,
          consumido_por_nome = excluded.consumido_por_nome;

    INSERT INTO public.sup_estoque_movimento
      (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho,
       pedido_id, pedido_item_id, usuario_id, usuario_nome, observacao)
    VALUES (t.empresa_id, t.ei_id, t.codigo, 'saida', v_tirar, t.tamanho,
            p_pedido_id, v_pi.id, v_uid, v_nome, p_observacao);

    v_lotes := v_lotes || jsonb_build_object('lote', t.codigo, 'quantidade', v_tirar);
    v_falta := v_falta - v_tirar;
  END LOOP;

  IF v_falta > 0 THEN
    -- Sem saldo: desfaz tudo. Baixa pela metade seria pior que recusar, porque
    -- o separador não teria como saber o que saiu e o que não saiu.
    RAISE EXCEPTION 'Saldo insuficiente de "%": faltam % unidade(s)', v_pi.nome_item, v_falta;
  END IF;

  RETURN jsonb_build_object('baixado', p_quantidade, 'lotes', v_lotes);
END $$;

-- ── 7. Permissões ────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.sup_item_gerar_codigo()           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_item_codigo_imutavel()        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_item_por_codigo(text)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_est_entrada_quantidade(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_est_baixar_quantidade(uuid, uuid, integer, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.sup_item_por_codigo(text)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_est_entrada_quantidade(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_est_baixar_quantidade(uuid, uuid, integer, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--
--   DROP FUNCTION IF EXISTS public.sup_est_baixar_quantidade(uuid, uuid, integer, text);
--   DROP FUNCTION IF EXISTS public.sup_est_entrada_quantidade(jsonb);
--   DROP FUNCTION IF EXISTS public.sup_item_por_codigo(text);
--   DROP TRIGGER  IF EXISTS trg_sup_item_codigo_imutavel ON public.sup_item;
--   DROP FUNCTION IF EXISTS public.sup_item_codigo_imutavel();
--   DROP TRIGGER  IF EXISTS trg_sup_item_gerar_codigo ON public.sup_item;
--   DROP FUNCTION IF EXISTS public.sup_item_gerar_codigo();
--   DROP INDEX    IF EXISTS public.idx_sup_item_codigo;
--   ALTER TABLE public.sup_item DROP COLUMN IF EXISTS codigo;
--   DROP SEQUENCE IF EXISTS public.sup_item_codigo_seq;
--   -- E recriar sst_ca_guard_baixa pela definição de 20260930000012.
-- =========================================================================
