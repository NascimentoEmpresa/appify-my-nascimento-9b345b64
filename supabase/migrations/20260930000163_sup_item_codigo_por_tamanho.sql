-- =====================================================================
-- ESTOQUE — cada TAMANHO é um item, com código próprio
--
-- PEDIDO (15/09/2026, tela /app/suprimentos/estoque-etiquetas)
--   "Jaqueta tamanho M precisa de uma linha com o código gerado dela.
--    Jaqueta tamanho P precisa de uma linha com o código gerado dela.
--    Jaqueta tamanho G precisa de uma linha com o código gerado dela.
--    Não pode ser um item só de jaqueta e dentro dela os tamanhos: cada
--    código ser de cada tamanho."
--
-- COMO ERA
--   Um sup_item "JAQUETA" (código 0001001) e, dentro da ficha de estoque
--   dele, lotes com tamanho M, P, G, EGG... O código do ajuste 7
--   (20260930000018) era do PRODUTO e o tamanho morava no LOTE. Na tela,
--   uma linha só, com os tamanhos em etiquetinha; na prateleira, o mesmo
--   código valendo para a jaqueta P e para a G.
--
-- COMO FICA
--   "JAQUETA" continua existindo, e é o que o catálogo, o enxoval e o pedido
--   usam — o encarregado continua pedindo "JAQUETA, tam. M". Cada tamanho
--   vira um sup_item FILHO dele (item_pai_id + tamanho), chamado
--   "JAQUETA M", com o código de 7 dígitos gerado pelo gatilho de sempre e
--   travado pela trava de sempre. É o filho que tem ficha de estoque, lotes,
--   saldo, mínimo, preço e histórico. É o que o mercado chama de SKU: um
--   código por tamanho.
--
-- POR QUE UM ITEM FILHO, E NÃO SÓ UM CÓDIGO POR (ITEM, TAMANHO)
--   Um código solto por tamanho daria linhas separadas na tela, mas tudo o
--   que a tela faz com a linha — mínimo, preço, editar, excluir, inventário,
--   histórico — continuaria sendo do material inteiro. "Não pode ser um item
--   só de jaqueta" é exatamente isso. Sendo um sup_item de verdade, cada
--   tamanho ganha tudo isso sem uma linha nova nas telas de estoque.
--
-- O QUE ISSO EXIGE DO RESTO
--   O pedido aponta para o BASE (sup_pedido_item.item_id = JAQUETA) e o
--   estoque passa a estar nos FILHOS. As seis funções que casam "item do
--   pedido → lote" com `ei.sup_item_id = pi.item_id` passam a aceitar o base
--   ou um filho dele (sup_item_da_familia). O filtro de tamanho que já
--   existia continua fazendo o resto. Reproduções fiéis, com as mudanças
--   marcadas "EDIÇÃO 0163":
--     sup_est_validar            20260820000002:153
--     sup_est_baixar             20260930000114:183
--     sup_est_baixar_quantidade  20260930000080:262
--     sup_est_resolver_codigos   20260930000114:450
--     sup_sep_sugerir            20260930000079:92
--     sup_sep_reservar           20260930000079:188
--   E quatro pelo lado do estoque:
--     sup_est_entrada_quantidade 20260930000018:168 — o tamanho leva ao filho
--     sup_est_editar_item        20260930000161:105 — nome e tipo vão para o
--                                base; trocar o tamanho do lote muda o lote
--                                de item
--     sup_item_por_codigo        20260930000018:132 — o saldo do base soma os
--                                tamanhos
--     sst_ca_estoque             20260927000001:222 — o laudo é do base
--
-- "X", "U" E "ÚNICO" NÃO SÃO TAMANHO
--   Em produção há 115 pares (material, tamanho) com "X", 26 com "U" e 3
--   com "UNICO" — o "sem tamanho" do sistema antigo. Criar "LUVA X" com
--   código novo trocaria o código de material que nunca teve grade. Esses
--   continuam no item base, como hoje: sup_tamanho_da_variante devolve NULL
--   para eles, e a tela usa a mesma lista (src/lib/suprimentos/tamanhoDoItem.ts).
--
-- MATERIAL NOVO DIGITADO NA ENTRADA
--   "Quando vai criar um item novo na entrada de estoque, se for um item
--   novo digitado pela primeira vez, ele não habilita dar entrada." A tela só
--   deixava escolher do catálogo. sup_est_criar_material cadastra na hora,
--   com `sup_estoque/alterar` — a mesma permissão de dar entrada.
--
-- OS DADOS QUE JÁ EXISTEM (parte 8)
--   Medido em 15/09/2026: 263 fichas de estoque com tamanho, 633 pares
--   (material, tamanho), nenhuma ficha misturando lote com e sem tamanho,
--   nenhum nome "MATERIAL TAMANHO" já usado por outro item. Cada lote vai
--   para a ficha do filho do tamanho dele, e o que pende do lote vai junto:
--   consumo (ledger), reserva, contagem rotativa, movimento e alteração. O
--   histórico de preço do base é copiado para cada tamanho. Nada é apagado:
--   a ficha do base que fica sem lote nenhum é ARQUIVADA (e volta sozinha se
--   um dia entrar lote sem tamanho nela — gatilho da 20260930000106). Tudo o
--   que muda fica em tmp_sup_item_tamanho_log, que é o que o ROLLBACK usa.
--
--   Mínimo: com um tamanho só, o mínimo do material passa para ele. Com
--   vários, cada tamanho começa em 0 — o mínimo da jaqueta inteira não diz
--   quanto de cada tamanho, e copiar 15 para cada um poria todos no
--   vermelho de uma vez. Quem sabe o número de cada tamanho ajusta no Editar.
--
-- O QUE NÃO MUDA
--   Pedidos, enxovais, a grade de tamanhos do catálogo (sup_item_opcao), os
--   códigos que já existem, e o código dos lotes — que continua existindo
--   por dentro (é ele que amarra o ledger e o CA de cada remessa) e só sai da
--   TELA do estoque.
--
-- Idempotente: rodar de novo não duplica nada. Se der deadlock (pedido
-- sendo baixado no mesmo instante), é só rodar outra vez — a transação é
-- única. ROLLBACK no rodapé.
-- =====================================================================

BEGIN;

-- ── 1. O item de um tamanho ──────────────────────────────────────────
ALTER TABLE public.sup_item
  ADD COLUMN IF NOT EXISTS item_pai_id uuid REFERENCES public.sup_item(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS tamanho     text;

COMMENT ON COLUMN public.sup_item.item_pai_id IS
  'Preenchida só no item de um TAMANHO ("JAQUETA M" aponta para "JAQUETA"). O base é o que catálogo, enxoval e pedido usam; o filho é o que tem estoque e código próprio. Imutável depois de criado.';
COMMENT ON COLUMN public.sup_item.tamanho IS
  'Tamanho que este item É, normalizado por sup_tamanho_da_variante. Só existe junto de item_pai_id.';

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sup_item_variante_check') THEN
    ALTER TABLE public.sup_item
      ADD CONSTRAINT sup_item_variante_check
      CHECK ((item_pai_id IS NULL) = (tamanho IS NULL) AND item_pai_id IS DISTINCT FROM id);
  END IF;
END
$mig$;

-- Um item por tamanho: é o que impede duas "JAQUETA M" com códigos diferentes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sup_item_variante
  ON public.sup_item(item_pai_id, tamanho) WHERE item_pai_id IS NOT NULL;

-- ── 2. Funções de apoio ──────────────────────────────────────────────

-- O tamanho que vira item próprio, já na forma gravada ("m " → "M").
-- NULL = sem tamanho de verdade: vazio, ou o "sem tamanho" do sistema
-- antigo (ver o cabeçalho). Espelho exato de tamanhoDaVariante() no front.
--
-- O translate não é enfeite: upper('único') só vira 'ÚNICO' se o locale do
-- banco souber maiúscula de letra acentuada. Em locale C sai 'úNICO', e o
-- "único" digitado com acento viraria um item "LUVA úNICO".
CREATE OR REPLACE FUNCTION public.sup_tamanho_da_variante(p_tamanho text)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE
           WHEN v.t = '' OR translate(v.t, 'Úú', 'UU') IN ('X', 'U', 'UN', 'UNICO', '-') THEN NULL
           ELSE v.t
         END
    FROM (SELECT upper(regexp_replace(btrim(COALESCE(p_tamanho, '')), '\s+', ' ', 'g')) AS t) v;
$fn$;

-- O base de um item (ele mesmo, se não for tamanho de nenhum).
--
-- SECURITY DEFINER porque é usada DENTRO de sup_estoque_saldo, que é
-- security_invoker: sem isso a coluna nova da view dependeria de quem
-- consulta enxergar sup_item, e erraria em silêncio para o perfil errado —
-- o mesmo modo de falha que 20260930000076 §2 descreve para a reserva.
-- Não expõe nada além de um id.
CREATE OR REPLACE FUNCTION public.sup_item_raiz(p_item uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT COALESCE((SELECT i.item_pai_id FROM public.sup_item i WHERE i.id = p_item), p_item);
$fn$;

-- "Este lote pode atender este item do pedido?" pelo lado do material: o
-- lote é do próprio item pedido, ou de um tamanho dele. O tamanho em si
-- continua conferido por quem chama, como sempre foi.
CREATE OR REPLACE FUNCTION public.sup_item_da_familia(p_item uuid, p_base uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $fn$
  SELECT p_item = p_base
      OR EXISTS (SELECT 1 FROM public.sup_item v
                  WHERE v.id = p_item AND v.item_pai_id = p_base);
$fn$;

-- O item de um tamanho, criado na primeira vez que ele aparece.
--
-- Recebe o base ou um tamanho (bipado o código de "JAQUETA M" e informado
-- "G", a resposta é "JAQUETA G"). Sem tamanho de verdade devolve o que
-- recebeu: ninguém "tira" o tamanho de JAQUETA M.
--
-- Interna: só as RPCs SECURITY DEFINER a chamam. Não tem GRANT de propósito
-- — criar item de catálogo pela API não é uma porta que deva existir.
CREATE OR REPLACE FUNCTION public.sup_item_variante(p_item uuid, p_tamanho text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_tam  text := public.sup_tamanho_da_variante(p_tamanho);
  v_item record;
  v_base record;
  v_id   uuid;
  v_nome text;
  v_dup  record;
BEGIN
  SELECT i.id, i.item_pai_id, i.tamanho INTO v_item
    FROM public.sup_item i WHERE i.id = p_item;
  IF v_item.id IS NULL THEN RAISE EXCEPTION 'Material não encontrado'; END IF;

  IF v_tam IS NULL THEN RETURN v_item.id; END IF;
  IF v_item.item_pai_id IS NOT NULL AND v_item.tamanho = v_tam THEN RETURN v_item.id; END IF;

  SELECT i.* INTO v_base FROM public.sup_item i
   WHERE i.id = COALESCE(v_item.item_pai_id, v_item.id);

  SELECT i.id INTO v_id FROM public.sup_item i
   WHERE i.item_pai_id = v_base.id AND i.tamanho = v_tam;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  v_nome := v_base.nome || ' ' || v_tam;

  -- O UNIQUE (empresa_id, nome) recusaria com uma mensagem que ninguém
  -- entende. Medido em 15/09/2026: nenhum caso hoje — é guarda.
  SELECT i.nome, i.codigo INTO v_dup FROM public.sup_item i
   WHERE i.empresa_id = v_base.empresa_id AND i.nome = v_nome;
  IF FOUND THEN
    RAISE EXCEPTION 'Já existe um material chamado % (código %) fora da grade de %. Renomeie um dos dois no Catálogo antes de dar entrada no tamanho %.',
      v_dup.nome, COALESCE(v_dup.codigo, '—'), v_base.nome, v_tam;
  END IF;

  -- O código sai do gatilho trg_sup_item_gerar_codigo, como qualquer item.
  INSERT INTO public.sup_item
    (empresa_id, nome, tipo, ativo, aprovado, created_by, item_pai_id, tamanho)
  VALUES (v_base.empresa_id, v_nome, v_base.tipo, true, v_base.aprovado, auth.uid(),
          v_base.id, v_tam)
  ON CONFLICT (item_pai_id, tamanho) WHERE item_pai_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;

  -- Duas entradas do mesmo tamanho novo no mesmo instante: a outra criou.
  IF v_id IS NULL THEN
    SELECT i.id INTO v_id FROM public.sup_item i
     WHERE i.item_pai_id = v_base.id AND i.tamanho = v_tam;
  END IF;

  RETURN v_id;
END
$fn$;

-- ── 3. Nome e tipo do tamanho são os do base ─────────────────────────
--
-- "JAQUETA M" é "JAQUETA" + "M". Se o nome do filho pudesse ser editado à
-- parte, um dia a JAQUETA vira "JAQUETA AZUL" e a M continua "JAQUETA M" —
-- e o tipo, pior: EPI com um tamanho fora de 'epi' escaparia da trava de CA
-- (sst_ca_guard_baixa só olha o tipo do item do lote).
--
-- Por isso: o filho recusa nome/tipo que não sejam os do base, e o base
-- repassa os dele a todos os filhos. O de quem aparece como filho também
-- não muda depois de criado — é a mesma lógica do código (trava de 0018 §2).

CREATE OR REPLACE FUNCTION public.sup_item_variante_guarda()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_base record;
BEGIN
  IF NEW.item_pai_id IS DISTINCT FROM OLD.item_pai_id
  OR NEW.tamanho     IS DISTINCT FROM OLD.tamanho THEN
    RAISE EXCEPTION 'O tamanho de um item (e de qual material ele é tamanho) não muda depois de criado';
  END IF;

  IF NEW.item_pai_id IS NOT NULL
     AND (NEW.nome IS DISTINCT FROM OLD.nome OR NEW.tipo IS DISTINCT FROM OLD.tipo) THEN
    SELECT i.nome, i.tipo INTO v_base FROM public.sup_item i WHERE i.id = NEW.item_pai_id;
    IF NEW.nome IS DISTINCT FROM v_base.nome || ' ' || NEW.tamanho
    OR NEW.tipo IS DISTINCT FROM v_base.tipo THEN
      RAISE EXCEPTION '"%" é o tamanho % de "%": o nome e o tipo vêm de lá. Altere "%".',
        OLD.nome, NEW.tamanho, v_base.nome, v_base.nome;
    END IF;
  END IF;

  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_sup_item_variante_guarda ON public.sup_item;
CREATE TRIGGER trg_sup_item_variante_guarda
  BEFORE UPDATE ON public.sup_item
  FOR EACH ROW EXECUTE FUNCTION public.sup_item_variante_guarda();

CREATE OR REPLACE FUNCTION public.sup_item_variante_propaga()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  UPDATE public.sup_item v
     SET nome     = NEW.nome || ' ' || v.tamanho,
         tipo     = NEW.tipo,
         aprovado = NEW.aprovado
   WHERE v.item_pai_id = NEW.id
     AND (v.nome     IS DISTINCT FROM NEW.nome || ' ' || v.tamanho
       OR v.tipo     IS DISTINCT FROM NEW.tipo
       OR v.aprovado IS DISTINCT FROM NEW.aprovado);
  RETURN NULL;
END
$fn$;

DROP TRIGGER IF EXISTS trg_sup_item_variante_propaga ON public.sup_item;
CREATE TRIGGER trg_sup_item_variante_propaga
  AFTER UPDATE OF nome, tipo, aprovado ON public.sup_item
  FOR EACH ROW WHEN (NEW.item_pai_id IS NULL)
  EXECUTE FUNCTION public.sup_item_variante_propaga();

-- Lote que nasce sem tamanho na ficha de um tamanho recebe o tamanho dela.
--
-- O caso real é a NF: sup_nf_entrada chama sup_est_entrada sem tamanho
-- (20260926000004:291). Se a nota for vinculada a "JAQUETA M", o lote
-- nasceria sem tamanho — e o pedido "JAQUETA, tam. M" não o acharia, porque
-- a separação filtra o lote pelo tamanho do pedido. Gatilho, e não mudança
-- em sup_est_entrada, pelo mesmo motivo de 20260930000106 §3: todo caminho
-- de entrada, inclusive o próximo, fica coberto.
CREATE OR REPLACE FUNCTION public.sup_est_tag_tamanho_do_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_tam text;
BEGIN
  IF NULLIF(btrim(COALESCE(NEW.tamanho, '')), '') IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT i.tamanho INTO v_tam
    FROM public.sup_estoque_item ei
    JOIN public.sup_item i ON i.id = ei.sup_item_id
   WHERE ei.id = NEW.item_estoque_id;

  IF v_tam IS NOT NULL THEN NEW.tamanho := v_tam; END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_sup_tag_tamanho_do_item ON public.sup_estoque_tag;
CREATE TRIGGER trg_sup_tag_tamanho_do_item
  BEFORE INSERT ON public.sup_estoque_tag
  FOR EACH ROW EXECUTE FUNCTION public.sup_est_tag_tamanho_do_item();

-- ── 4. Saldo: o base enxerga os tamanhos ─────────────────────────────
--
-- Reprodução de 20260930000076:328 com UMA coluna nova, no fim (o Postgres
-- só aceita coluna nova depois das antigas no CREATE OR REPLACE VIEW).
-- É por ela que o modal de baixa pergunta "quanto tem de JAQUETA, tam. M"
-- sem saber que o estoque está na JAQUETA M (useSaldoMaterial).
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
  COALESCE(SUM(r.reservado), 0)::integer AS reservado,
  COALESCE(SUM(CASE
    WHEN t.tipo = 'massa' AND NOT t.usado THEN COALESCE(t.quantidade_massa, 0)
    WHEN t.tipo = 'unico' AND NOT t.usado THEN 1
    ELSE 0 END), 0)::integer AS fisico,
  -- EDIÇÃO 0163: o material base (o próprio item, se não for tamanho).
  public.sup_item_raiz(ei.sup_item_id) AS sup_item_base_id
  FROM public.sup_estoque_item ei
  LEFT JOIN public.sup_estoque_tag t ON t.item_estoque_id = ei.id
  LEFT JOIN LATERAL (
    SELECT SUM(rr.quantidade)::integer AS reservado
      FROM public.sup_estoque_reserva rr
     WHERE rr.tag_id = t.id AND rr.situacao = 'ATIVA'
  ) r ON true
 GROUP BY ei.id, ei.empresa_id, ei.almoxarifado_id, ei.sup_item_id, t.tamanho;

-- ── 5. Material novo, digitado na entrada ────────────────────────────
--
-- Nasce com aprovado = false e SEM rascunho em sup_cat_alteracao, de
-- propósito:
--   • aprovado só governa o que o encarregado vê, e ele só vê material que
--     está no enxoval de uma função (sup_ext_itens). Quando o Catálogo puser
--     este material num enxoval, a aprovação do enxoval libera o material
--     junto (20260930000097);
--   • um rascunho de "criar" seria desfeito na reprovação apagando o
--     sup_item — que a essa altura já tem estoque, e o DELETE esbarraria no
--     ON DELETE RESTRICT de sup_estoque_item, travando a decisão do lote
--     inteiro.
--
-- Nome já existente devolve o existente: digitar "LUVA NITRILICA" duas
-- vezes não pode criar duas. E "JAQUETA M" com "JAQUETA" no catálogo é o
-- tamanho M dele, não material novo — cadastrar à parte criaria exatamente
-- o item solto que esta migration existe para acabar.
CREATE OR REPLACE FUNCTION public.sup_est_criar_material(
  p_almoxarifado_id uuid, p_nome text, p_tipo text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_nome    text := upper(regexp_replace(btrim(COALESCE(p_nome, '')), '\s+', ' ', 'g'));
  v_tipo    text := lower(btrim(COALESCE(p_tipo, '')));
  v_empresa uuid;
  v_ex      record;
  v_base    record;
  v_id      uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_estoque', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para dar entrada no estoque';
  END IF;
  IF length(v_nome) < 2 THEN RAISE EXCEPTION 'Informe o nome do material'; END IF;
  -- A mesma lista de sup_est_editar_item (20260930000161) e do CHECK
  -- sup_item_tipo_check (20260930000013).
  IF v_tipo NOT IN ('uniforme', 'epi', 'insumo', 'equipamento', 'limpeza') THEN
    RAISE EXCEPTION 'Escolha o tipo do material';
  END IF;

  -- A empresa do material é a do almoxarifado: sup_est_entrada_quantidade
  -- recusa material de outra empresa.
  SELECT a.empresa_id INTO v_empresa FROM public.almoxarifado a WHERE a.id = p_almoxarifado_id;
  IF v_empresa IS NULL THEN RAISE EXCEPTION 'Almoxarifado não encontrado'; END IF;

  SELECT i.id, i.codigo, i.nome, i.ativo INTO v_ex
    FROM public.sup_item i
   WHERE i.empresa_id = v_empresa
     AND upper(regexp_replace(btrim(i.nome), '\s+', ' ', 'g')) = v_nome
   ORDER BY i.ativo DESC
   LIMIT 1;
  IF v_ex.id IS NOT NULL THEN
    IF NOT v_ex.ativo THEN
      RAISE EXCEPTION 'Já existe um material chamado % (código %), desativado no Catálogo. Reative-o lá em vez de cadastrar de novo.',
        v_ex.nome, COALESCE(v_ex.codigo, '—');
    END IF;
    RETURN jsonb_build_object('id', v_ex.id, 'codigo', v_ex.codigo, 'nome', v_ex.nome, 'criado', false);
  END IF;

  -- Base mais comprido primeiro: "CAMISA POLO G" é tamanho G de
  -- "CAMISA POLO", não tamanho "POLO G" de "CAMISA". Tamanho é uma palavra
  -- só, pela mesma razão.
  SELECT b.nome, substr(v_nome, length(b.nome) + 2) AS tam INTO v_base
    FROM public.sup_item b
   WHERE b.empresa_id = v_empresa AND b.ativo AND b.item_pai_id IS NULL
     AND left(v_nome, length(b.nome) + 1) = b.nome || ' '
     AND position(' ' IN substr(v_nome, length(b.nome) + 2)) = 0
     AND public.sup_tamanho_da_variante(substr(v_nome, length(b.nome) + 2)) IS NOT NULL
   ORDER BY length(b.nome) DESC
   LIMIT 1;
  IF v_base.nome IS NOT NULL THEN
    RAISE EXCEPTION '"%" é o tamanho % de "%". Escolha "%" na lista e informe o tamanho %.',
      v_nome, v_base.tam, v_base.nome, v_base.nome, v_base.tam;
  END IF;

  INSERT INTO public.sup_item (empresa_id, nome, tipo, ativo, aprovado, created_by)
  VALUES (v_empresa, v_nome, v_tipo, true, false, v_uid)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'codigo', (SELECT i.codigo FROM public.sup_item i WHERE i.id = v_id),
    'nome', v_nome,
    'criado', true);
END
$fn$;

-- ── 6. Entrada e edição (lado do estoque) ────────────────────────────

-- sup_est_entrada_quantidade — reprodução de 20260930000018:168.
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
    'quantidade', v_qtd,
    -- EDIÇÃO 0163: o item que recebeu (o do tamanho), para a tela dizer o código.
    'sup_item_id', v_mat,
    'codigo_item', (SELECT i.codigo FROM public.sup_item i WHERE i.id = v_mat),
    'nome_item',   (SELECT i.nome   FROM public.sup_item i WHERE i.id = v_mat)
  );
END $$;

-- sup_est_editar_item — reprodução de 20260930000161:105.
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

-- ── 7. Pedido → lote: o base aceita os tamanhos ──────────────────────

-- sup_est_validar — reprodução de 20260820000002:153.
CREATE OR REPLACE FUNCTION public.sup_est_validar(
  p_codigos text[], p_pedido_id uuid DEFAULT NULL, p_pedido_item_id uuid DEFAULT NULL
) RETURNS TABLE (
  codigo text, valido boolean, motivo text, material text, tamanho text,
  tipo text, disponivel int, valor_unitario numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_mat_esperado uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT (public.can_access(v_uid, 'sup_estoque', 'visualizar')
       OR public.can_access(v_uid, 'sup_pedidos_materiais', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  IF p_pedido_item_id IS NOT NULL THEN
    SELECT pi.item_id INTO v_mat_esperado
      FROM public.sup_pedido_item pi WHERE pi.id = p_pedido_item_id;
  END IF;

  RETURN QUERY
  SELECT
    c.cod,
    CASE
      WHEN t.id IS NULL THEN false
      -- EDIÇÃO 0163: a etiqueta pode ser de um TAMANHO do material pedido.
      WHEN v_mat_esperado IS NOT NULL AND NOT public.sup_item_da_familia(ei.sup_item_id, v_mat_esperado) THEN false
      WHEN t.usado AND t.pedido_id IS DISTINCT FROM p_pedido_id THEN false
      WHEN t.tipo = 'massa' AND COALESCE(t.quantidade_massa, 0) <= 0
           AND t.pedido_id IS DISTINCT FROM p_pedido_id THEN false
      ELSE true
    END,
    CASE
      WHEN t.id IS NULL THEN 'Não existe no estoque'
      WHEN v_mat_esperado IS NOT NULL AND NOT public.sup_item_da_familia(ei.sup_item_id, v_mat_esperado)  -- EDIÇÃO 0163
        THEN format('Etiqueta é do material "%s", não do que foi pedido', i.nome)
      WHEN t.usado AND t.pedido_id IS DISTINCT FROM p_pedido_id
        THEN format('Já utilizada no pedido %s', COALESCE(pe.pedido_id, '—'))
      WHEN t.tipo = 'massa' AND COALESCE(t.quantidade_massa, 0) <= 0
           AND t.pedido_id IS DISTINCT FROM p_pedido_id THEN 'Etiqueta esgotada'
      ELSE NULL
    END,
    i.nome, t.tamanho, t.tipo,
    CASE WHEN t.tipo = 'massa' THEN COALESCE(t.quantidade_massa, 0)
         WHEN t.usado THEN 0 ELSE 1 END,
    COALESCE(t.valor_unitario, ei.valor_unitario)
  FROM unnest(p_codigos) AS c(cod)
  LEFT JOIN public.sup_estoque_tag  t  ON t.codigo = upper(trim(c.cod))
  LEFT JOIN public.sup_estoque_item ei ON ei.id = t.item_estoque_id
  LEFT JOIN public.sup_item         i  ON i.id = ei.sup_item_id
  LEFT JOIN public.sup_pedido       pe ON pe.id = t.pedido_id;
END $$;

-- sup_est_baixar — reprodução de 20260930000114:183.
CREATE OR REPLACE FUNCTION public.sup_est_baixar(p_pedido_id uuid, p_status text, p_observacao text, p_baixas jsonb, p_envio jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid       uuid := auth.uid();
  v_nome      text := public.sup_est_nome_usuario();
  v_ped       record;
  b           jsonb;
  v_ok        int := 0;
  v_tent      int := 0;
  v_rej       jsonb := '[]'::jsonb;
  t           record;
  v_pi        record;
  v_existente int;
  v_delta     int;
  v_desejada  int;
  v_novo      int;
  v_mudou_st  boolean;
  v_tipo_envio text := upper(nullif(btrim(p_envio->>'tipo'), ''));
  v_rastreio   text := nullif(btrim(p_envio->>'rastreio'), '');
  v_mudou_envio boolean;
  v_res_outros int;
  v_desc      text[] := ARRAY[]::text[];   -- EDIÇÃO 0114
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_pedidos_materiais', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para atualizar pedidos';
  END IF;

  SELECT * INTO v_ped FROM public.sup_pedido p WHERE p.id = p_pedido_id FOR UPDATE;
  IF v_ped.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;

  -- Pedido EM SEPARACAO sai pelas RPCs sup_sep_*, não por aqui.
  --
  -- O motivo é real, não estético: esta função grava sup_estoque_consumo
  -- com o total ABSOLUTO (SET quantidade = excluded.quantidade), enquanto
  -- sup_sep_confirmar grava ADITIVO. Os dois caminhos sobre a mesma chave
  -- (codigo, pedido_item_id) se sobrescrevem em silêncio e corrompem o
  -- ledger. O modal antigo volta a valer quando o pedido chega em
  -- AGUARDANDO ENVIO.
  IF v_ped.status = 'EM SEPARACAO' THEN
    RAISE EXCEPTION 'Pedido % está em separação. Confirme ou libere a separação antes de baixar por aqui.',
      v_ped.pedido_id;
  END IF;

  -- A guarda precisa estar no banco: despacho também pode acontecer por
  -- script ou SQL Editor, e a tela não é uma fronteira de integridade.
  IF p_status = 'DESPACHADO' THEN
    IF v_tipo_envio IS NULL OR v_tipo_envio NOT IN ('SUPERVISOR', 'CORREIO') THEN
      RAISE EXCEPTION 'Informe o tipo de envio para despachar o pedido';
    END IF;
    IF v_tipo_envio = 'CORREIO' AND v_rastreio IS NULL THEN
      RAISE EXCEPTION 'Informe o ID de rastreio dos Correios';
    END IF;
  END IF;

  FOR b IN SELECT * FROM jsonb_array_elements(COALESCE(p_baixas, '[]'::jsonb)) LOOP
    v_tent := v_tent + 1;

    SELECT pi.id, pi.item_id, pi.nome_item INTO v_pi
      FROM public.sup_pedido_item pi
     WHERE pi.id = (b->>'pedido_item_id')::uuid AND pi.pedido_id = p_pedido_id;
    IF v_pi.id IS NULL THEN
      v_rej := v_rej || jsonb_build_object('codigo', b->>'codigo',
                 'motivo', 'Item não pertence a este pedido');
      CONTINUE;
    END IF;

    SELECT tg.*, ei.sup_item_id, ei.id AS ei_id, ei.empresa_id, i.nome AS material
      INTO t
      FROM public.sup_estoque_tag tg
      JOIN public.sup_estoque_item ei ON ei.id = tg.item_estoque_id
      JOIN public.sup_item i ON i.id = ei.sup_item_id
     WHERE tg.codigo = upper(trim(b->>'codigo'))
     FOR UPDATE OF tg;

    IF t.id IS NULL THEN
      v_rej := v_rej || jsonb_build_object('codigo', b->>'codigo',
                 'motivo', 'Não existe no estoque');
      CONTINUE;
    END IF;

    -- EDIÇÃO 0163: o lote pode estar num TAMANHO do material pedido.
    IF NOT public.sup_item_da_familia(t.sup_item_id, v_pi.item_id) THEN
      v_rej := v_rej || jsonb_build_object('codigo', t.codigo,
                 'motivo', format('Etiqueta é de "%s", e o pedido é de "%s"', t.material, v_pi.nome_item));
      CONTINUE;
    END IF;

    IF t.tipo = 'unico' THEN
      IF t.usado AND t.pedido_id IS DISTINCT FROM p_pedido_id THEN
        v_rej := v_rej || jsonb_build_object('codigo', t.codigo,
                   'motivo', format('Já utilizada no pedido %s',
                     COALESCE((SELECT p2.pedido_id FROM public.sup_pedido p2 WHERE p2.id = t.pedido_id), '—')));
        CONTINUE;
      END IF;

      IF EXISTS (SELECT 1 FROM public.sup_estoque_reserva rr
                  WHERE rr.tag_id = t.id AND rr.situacao = 'ATIVA'
                    AND rr.pedido_item_id <> v_pi.id) THEN
        v_rej := v_rej || jsonb_build_object('codigo', t.codigo,
                   'motivo', 'Peça reservada para outro pedido em separação');
        CONTINUE;
      END IF;

      UPDATE public.sup_estoque_tag tg
         SET usado = true, pedido_id = p_pedido_id, pedido_item_id = v_pi.id,
             usado_em = now(), usado_por = v_uid, usado_por_nome = v_nome
       WHERE tg.id = t.id;

      INSERT INTO public.sup_estoque_movimento
        (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho,
         pedido_id, pedido_item_id, usuario_id, usuario_nome)
      VALUES (t.empresa_id, t.ei_id, t.codigo, 'saida', 1, t.tamanho,
              p_pedido_id, v_pi.id, v_uid, v_nome);
      v_ok := v_ok + 1;
      -- EDIÇÃO 0114
      v_desc := v_desc || format('%s: %s (1 un.%s)', v_pi.nome_item, t.codigo,
                                 COALESCE(', CA ' || nullif(btrim(t.ca_numero), ''), ''));
    ELSE
      v_desejada := GREATEST(COALESCE((b->>'quantidade')::int, 1), 0);

      SELECT COALESCE(cs.quantidade, 0) INTO v_existente
        FROM public.sup_estoque_consumo cs
       WHERE cs.codigo = t.codigo AND cs.pedido_item_id = v_pi.id;
      v_existente := COALESCE(v_existente, 0);
      v_delta := v_desejada - v_existente;

      IF v_delta = 0 THEN CONTINUE; END IF;

      IF v_delta > 0 AND COALESCE(t.quantidade_massa, 0) <= 0 THEN
        v_rej := v_rej || jsonb_build_object('codigo', t.codigo, 'motivo', 'Etiqueta esgotada');
        CONTINUE;
      END IF;
      -- Consulta SEPARADA e já sob o lock da etiqueta: subquery de outra
      -- tabela dentro do WHERE que trava não é reavaliada pelo EvalPlanQual.
      SELECT COALESCE(SUM(rr.quantidade), 0) INTO v_res_outros
        FROM public.sup_estoque_reserva rr
       WHERE rr.tag_id = t.id AND rr.situacao = 'ATIVA'
         AND rr.pedido_item_id <> v_pi.id;

      IF v_delta > COALESCE(t.quantidade_massa, 0) - v_res_outros THEN
        v_rej := v_rej || jsonb_build_object('codigo', t.codigo,
                   'motivo', CASE WHEN v_res_outros > 0
                     THEN format('Quantidade adicional (%s) maior que a livre (%s): %s unidade(s) reservada(s) para outro pedido em separação',
                                 v_delta, COALESCE(t.quantidade_massa, 0) - v_res_outros, v_res_outros)
                     ELSE format('Quantidade adicional (%s) maior que a disponível (%s)',
                                 v_delta, COALESCE(t.quantidade_massa, 0)) END);
        CONTINUE;
      END IF;

      v_novo := COALESCE(t.quantidade_massa, 0) - v_delta;
      UPDATE public.sup_estoque_tag tg
         SET quantidade_massa = GREATEST(v_novo, 0),
             usado = (v_novo <= 0),
             pedido_id = CASE WHEN v_novo <= 0 THEN p_pedido_id ELSE tg.pedido_id END,
             pedido_item_id = CASE WHEN v_novo <= 0 THEN v_pi.id ELSE tg.pedido_item_id END,
             usado_em = CASE WHEN v_novo <= 0 THEN now() ELSE tg.usado_em END,
             usado_por = CASE WHEN v_novo <= 0 THEN v_uid ELSE tg.usado_por END,
             usado_por_nome = CASE WHEN v_novo <= 0 THEN v_nome ELSE tg.usado_por_nome END
       WHERE tg.id = t.id;

      IF v_desejada = 0 THEN
        DELETE FROM public.sup_estoque_consumo cs
         WHERE cs.codigo = t.codigo AND cs.pedido_item_id = v_pi.id;
      ELSE
        INSERT INTO public.sup_estoque_consumo
          (codigo, item_estoque_id, pedido_id, pedido_item_id, quantidade,
           consumido_por, consumido_por_nome)
        VALUES (t.codigo, t.ei_id, p_pedido_id, v_pi.id, v_desejada, v_uid, v_nome)
        ON CONFLICT (codigo, pedido_item_id) DO UPDATE
          SET quantidade = excluded.quantidade, consumido_em = now(),
              consumido_por = excluded.consumido_por,
              consumido_por_nome = excluded.consumido_por_nome;
      END IF;

      INSERT INTO public.sup_estoque_movimento
        (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho,
         pedido_id, pedido_item_id, usuario_id, usuario_nome, observacao)
      VALUES (t.empresa_id, t.ei_id, t.codigo,
              CASE WHEN v_delta > 0 THEN 'saida' ELSE 'devolucao' END,
              abs(v_delta), t.tamanho, p_pedido_id, v_pi.id, v_uid, v_nome,
              format('Ajuste de %s para %s', v_existente, v_desejada));
      v_ok := v_ok + 1;
      -- EDIÇÃO 0114: o total do código no item, que é o que o operador vê.
      v_desc := v_desc || CASE WHEN v_desejada = 0
                             THEN format('%s: %s (desfeito)', v_pi.nome_item, t.codigo)
                             ELSE format('%s: %s (%s un.%s)', v_pi.nome_item, t.codigo, v_desejada,
                                         COALESCE(', CA ' || nullif(btrim(t.ca_numero), ''), '')) END;
    END IF;
  END LOOP;

  IF v_tent > 0 AND v_ok = 0 AND jsonb_array_length(v_rej) > 0 THEN
    RAISE EXCEPTION 'Nenhuma etiqueta pôde ser baixada: %',
      (SELECT string_agg(x->>'motivo', '; ') FROM jsonb_array_elements(v_rej) x);
  END IF;

  v_mudou_st := p_status IS NOT NULL AND p_status <> v_ped.status;
  v_mudou_envio := p_envio IS NOT NULL AND (
    v_tipo_envio IS DISTINCT FROM v_ped.envio_tipo
    OR v_rastreio IS DISTINCT FROM v_ped.envio_rastreio
  );

  IF v_mudou_st
     OR COALESCE(p_observacao, '') IS DISTINCT FROM COALESCE(v_ped.observacao, '')
     OR v_mudou_envio THEN
    UPDATE public.sup_pedido p
       SET status = COALESCE(p_status, p.status),
           observacao = nullif(p_observacao, ''),
           envio_tipo = CASE WHEN p_envio IS NULL THEN p.envio_tipo ELSE v_tipo_envio END,
           envio_rastreio = CASE WHEN p_envio IS NULL THEN p.envio_rastreio ELSE v_rastreio END
     WHERE p.id = p_pedido_id;

    INSERT INTO public.sup_pedido_historico
      (pedido_id, acao, status_anterior, status_novo, observacao, alterado_por, alterado_por_nome)
    VALUES (p_pedido_id,
            CASE WHEN NOT v_mudou_st THEN 'EDITADO'
                 WHEN p_status = 'CANCELADO' THEN 'CANCELADO' ELSE 'STATUS' END,
            CASE WHEN v_mudou_st THEN v_ped.status END,
            COALESCE(p_status, v_ped.status), nullif(p_observacao, ''), v_uid, v_nome);
  END IF;

  -- EDIÇÃO 0114: era um ELSIF depois do bloco acima, com o texto
  -- "N etiqueta(s) baixada(s) do estoque" — sem código, e sumia quando o
  -- status mudava na mesma chamada. Agora é uma linha própria, com os
  -- códigos, para a troca "desvinculei o errado, designei o certo" ficar
  -- inteira no histórico do pedido.
  IF v_ok > 0 THEN
    INSERT INTO public.sup_pedido_historico
      (pedido_id, acao, status_novo, campo, valor_novo, alterado_por, alterado_por_nome)
    VALUES (p_pedido_id, 'EDITADO', COALESCE(p_status, v_ped.status), 'estoque_designado',
            array_to_string(v_desc, ' · '), v_uid, v_nome);
  END IF;

  RETURN jsonb_build_object('baixadas', v_ok, 'rejeitadas', v_rej);
END $fn$;

-- sup_est_baixar_quantidade — reprodução de 20260930000080:262.
CREATE OR REPLACE FUNCTION public.sup_est_baixar_quantidade(p_pedido_id uuid, p_pedido_item_id uuid, p_quantidade integer, p_observacao text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_nome   text := public.sup_est_nome_usuario();
  v_pi     record;
  v_falta  int  := GREATEST(COALESCE(p_quantidade, 0), 0);
  v_tirar  int;
  v_livre  int;
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
     WHERE public.sup_item_da_familia(ei.sup_item_id, v_pi.item_id)  -- EDIÇÃO 0163
       AND tg.tipo = 'massa'
       AND NOT tg.usado
       AND COALESCE(tg.quantidade_massa, 0) > 0
       AND (v_pi.tamanho IS NULL OR tg.tamanho IS NOT DISTINCT FROM v_pi.tamanho)
     ORDER BY tg.ca_validade NULLS LAST, tg.created_at
     FOR UPDATE OF tg
  LOOP
    EXIT WHEN v_falta <= 0;
    -- Consulta separada e já sob o FOR UPDATE do lote: o reservado nunca
    -- entra no WHERE que trava, porque o EvalPlanQual não reavalia
    -- subquery de outra tabela.
    SELECT COALESCE(t.quantidade_massa, 0)
           - COALESCE((SELECT SUM(rr.quantidade) FROM public.sup_estoque_reserva rr
                        WHERE rr.tag_id = t.id AND rr.situacao = 'ATIVA'), 0)
      INTO v_livre;
    CONTINUE WHEN v_livre <= 0;

    v_tirar := LEAST(v_falta, v_livre);
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

    -- O ledger guarda o TOTAL por (lote, item do pedido), não o delta.
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
    -- Sem saldo: desfaz tudo. Baixa pela metade seria pior que recusar.
    RAISE EXCEPTION 'Saldo insuficiente de "%": faltam % unidade(s)', v_pi.nome_item, v_falta;
  END IF;

  RETURN jsonb_build_object('baixado', p_quantidade, 'lotes', v_lotes);
END $fn$;

-- sup_est_resolver_codigos — reprodução de 20260930000114:450.
CREATE OR REPLACE FUNCTION public.sup_est_resolver_codigos(p_linhas jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid       uuid := auth.uid();
  v_out       jsonb := '[]'::jsonb;
  l           jsonb;
  v_cod       text;
  v_falta     integer;
  v_pegar     integer;
  v_bloqueadas integer;
  v_lotes     jsonb;
  v_pi        record;
  v_prod      record;
  t           record;
  v_bloq      record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_pedidos_materiais', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para atualizar pedidos';
  END IF;

  FOR l IN SELECT * FROM jsonb_array_elements(COALESCE(p_linhas, '[]'::jsonb)) LOOP
    v_cod := upper(btrim(COALESCE(l->>'codigo', '')));

    IF v_cod = '' THEN
      v_out := v_out || jsonb_build_object('codigo', v_cod, 'tipo', 'desconhecido');
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM public.sup_estoque_tag tg WHERE tg.codigo = v_cod) THEN
      v_out := v_out || jsonb_build_object('codigo', v_cod, 'tipo', 'lote');
      CONTINUE;
    END IF;

    -- SELECT INTO sem linha zera o record: não sobra nada da volta anterior.
    SELECT pi.id, pi.item_id, pi.tamanho INTO v_pi
      FROM public.sup_pedido_item pi
     WHERE pi.id = (l->>'pedido_item_id')::uuid;

    -- O EAN pode se repetir entre cadastros; o do próprio item ganha.
    SELECT i.id, i.codigo, i.nome, i.tipo, i.item_pai_id, i.tamanho INTO v_prod  -- EDIÇÃO 0163
      FROM public.sup_item i
     WHERE i.codigo = v_cod OR i.codigo_barras = v_cod
     ORDER BY (i.id = v_pi.item_id) DESC NULLS LAST,
              (i.item_pai_id = v_pi.item_id) DESC NULLS LAST,  -- EDIÇÃO 0163
              (i.codigo = v_cod) DESC
     LIMIT 1;

    IF v_prod.id IS NULL THEN
      v_out := v_out || jsonb_build_object('codigo', v_cod, 'tipo', 'desconhecido');
      CONTINUE;
    END IF;
    -- EDIÇÃO 0163: o código de um TAMANHO do item pedido também serve,
    -- desde que seja o tamanho pedido; pedido sem tamanho aceita qualquer um.
    -- JAQUETA G bipada para "JAQUETA, tam. M" é outro produto: é a peça
    -- errada na mão, e o código por tamanho existe justamente para pegar isso.
    IF v_pi.item_id IS DISTINCT FROM v_prod.id
       AND NOT COALESCE(
             v_prod.item_pai_id = v_pi.item_id
             AND (public.sup_tamanho_da_variante(v_pi.tamanho) IS NULL
                  OR v_prod.tamanho = public.sup_tamanho_da_variante(v_pi.tamanho)),
             false) THEN
      v_out := v_out || jsonb_build_object('codigo', v_cod, 'tipo', 'outro_produto',
                 'produto', jsonb_build_object('codigo', v_prod.codigo, 'nome', v_prod.nome));
      CONTINUE;
    END IF;

    v_falta := CASE WHEN COALESCE(l->>'quantidade', '') ~ '^\d+$'
                    THEN GREATEST((l->>'quantidade')::int, 1) ELSE 1 END;
    v_bloqueadas := 0;
    v_lotes := '[]'::jsonb;

    FOR t IN
      SELECT tg.codigo, tg.ca_numero, tg.ca_validade,
             (CASE WHEN tg.tipo = 'massa' THEN COALESCE(tg.quantidade_massa, 0) ELSE 1 END)
             - COALESCE((SELECT SUM(rr.quantidade) FROM public.sup_estoque_reserva rr
                          WHERE rr.tag_id = tg.id AND rr.situacao = 'ATIVA'), 0) AS livre
        FROM public.sup_estoque_tag tg
        JOIN public.sup_estoque_item ei ON ei.id = tg.item_estoque_id
       -- EDIÇÃO 0163: código do base cobre os tamanhos dele, com o filtro de
       -- tamanho do pedido; código de um tamanho cobre só aquele tamanho, e
       -- o tamanho já foi conferido acima.
       WHERE public.sup_item_da_familia(ei.sup_item_id, v_prod.id)
         AND NOT tg.usado
         AND (v_pi.tamanho IS NULL OR v_prod.item_pai_id IS NOT NULL
              OR tg.tamanho IS NOT DISTINCT FROM v_pi.tamanho)
         AND NOT EXISTS (SELECT 1 FROM public.sup_estoque_contagem_fila cf
                          WHERE cf.tag_id = tg.id AND cf.situacao = 'ABERTA')
       ORDER BY tg.ca_validade NULLS LAST, tg.created_at, tg.id
    LOOP
      EXIT WHEN v_falta <= 0;
      CONTINUE WHEN t.livre <= 0;

      IF v_prod.tipo = 'epi' THEN
        SELECT * INTO v_bloq FROM public.sst_ca_bloqueio(t.ca_numero, t.ca_validade);
        IF v_bloq.bloqueado THEN
          v_bloqueadas := v_bloqueadas + t.livre;
          CONTINUE;
        END IF;
      END IF;

      v_pegar := LEAST(v_falta, t.livre);
      v_falta := v_falta - v_pegar;
      v_lotes := v_lotes || jsonb_build_object(
        'codigo', t.codigo, 'quantidade', v_pegar,
        'ca_numero', nullif(btrim(t.ca_numero), ''), 'ca_validade', t.ca_validade);
    END LOOP;

    v_out := v_out || jsonb_build_object(
      'codigo', v_cod, 'tipo', 'produto',
      'produto', jsonb_build_object('codigo', v_prod.codigo, 'nome', v_prod.nome),
      'lotes', v_lotes, 'faltam', v_falta, 'bloqueadas', v_bloqueadas);
  END LOOP;

  RETURN v_out;
END $fn$;

-- sup_sep_sugerir — reprodução de 20260930000079:92.
CREATE OR REPLACE FUNCTION public.sup_sep_sugerir(p_pedido_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_itens  jsonb := '[]'::jsonb;
  pi       record;
  t        record;
  v_falta  integer;
  v_pegar  integer;
  v_lotes  jsonb;
  v_ja     integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_pedidos_materiais', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para preparar pedidos';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sup_pedido p WHERE p.id = p_pedido_id) THEN
    RAISE EXCEPTION 'Pedido não encontrado';
  END IF;

  FOR pi IN
    SELECT x.id, x.item_id, x.nome_item, x.tamanho, x.quantidade
      FROM public.sup_pedido_item x
     WHERE x.pedido_id = p_pedido_id
     ORDER BY x.ordem NULLS LAST, x.created_at
  LOOP
    -- O que este item já resolveu: o que saiu de verdade mais o que já
    -- está reservado. Reabrir a tela não pode sugerir de novo o mesmo.
    SELECT COALESCE((SELECT SUM(cc.quantidade) FROM public.sup_estoque_consumo cc
                      WHERE cc.pedido_item_id = pi.id), 0)
         + COALESCE((SELECT count(*) FROM public.sup_estoque_tag tg
                      WHERE tg.pedido_item_id = pi.id AND tg.tipo = 'unico' AND tg.usado), 0)
         + COALESCE((SELECT SUM(rr.quantidade) FROM public.sup_estoque_reserva rr
                      WHERE rr.pedido_item_id = pi.id AND rr.situacao = 'ATIVA'), 0)
      INTO v_ja;

    v_falta := GREATEST(COALESCE(pi.quantidade, 0) - COALESCE(v_ja, 0), 0);
    v_lotes := '[]'::jsonb;

    IF pi.item_id IS NOT NULL AND v_falta > 0 THEN
      FOR t IN
        SELECT tg.id, tg.codigo, tg.tipo, tg.tamanho, tg.ca_numero, tg.ca_validade,
               tg.valor_unitario, tg.localizacao, ei.id AS ei_id,
               (CASE WHEN tg.tipo = 'massa' THEN COALESCE(tg.quantidade_massa, 0) ELSE 1 END)
               - COALESCE((SELECT SUM(rr.quantidade) FROM public.sup_estoque_reserva rr
                            WHERE rr.tag_id = tg.id AND rr.situacao = 'ATIVA'), 0) AS livre
          FROM public.sup_estoque_tag tg
          JOIN public.sup_estoque_item ei ON ei.id = tg.item_estoque_id
         WHERE public.sup_item_da_familia(ei.sup_item_id, pi.item_id)  -- EDIÇÃO 0163
           AND NOT tg.usado
           AND (pi.tamanho IS NULL OR tg.tamanho IS NOT DISTINCT FROM pi.tamanho)
           -- Lote com contagem rotativa aberta fica de fora: se ele já deu
           -- divergência, sugerir de novo amanhã produz a mesma divergência.
           AND NOT EXISTS (SELECT 1 FROM public.sup_estoque_contagem_fila cf
                            WHERE cf.tag_id = tg.id AND cf.situacao = 'ABERTA')
         ORDER BY tg.ca_validade NULLS LAST, tg.created_at, tg.id
      LOOP
        EXIT WHEN v_falta <= 0;
        CONTINUE WHEN t.livre <= 0;

        v_pegar := LEAST(v_falta, t.livre);
        v_falta := v_falta - v_pegar;

        v_lotes := v_lotes || jsonb_build_object(
          'tag_id', t.id, 'codigo', t.codigo, 'tipo', t.tipo, 'tamanho', t.tamanho,
          'quantidade', v_pegar, 'livre', t.livre, 'localizacao', t.localizacao,
          'valor_unitario', t.valor_unitario,
          'ca_numero', t.ca_numero, 'ca_validade', t.ca_validade,
          -- Alerta, e NÃO exclusão: quem decide usar um lote com CA
          -- bloqueado é a pessoa. O trigger sst_ca_guard_baixa recusaria
          -- na confirmação, e é melhor a supervisora saber disso agora.
          'alerta', CASE WHEN t.ca_validade IS NOT NULL AND t.ca_validade < current_date
                         THEN 'CA vencido em ' || to_char(t.ca_validade, 'DD/MM/YYYY')
                         ELSE NULL END);
      END LOOP;
    END IF;

    v_itens := v_itens || jsonb_build_object(
      'pedido_item_id', pi.id, 'item_id', pi.item_id, 'nome_item', pi.nome_item,
      'tamanho', pi.tamanho, 'quantidade_pedida', pi.quantidade,
      'ja_resolvido', COALESCE(v_ja, 0), 'faltante', v_falta, 'lotes', v_lotes);
  END LOOP;

  RETURN jsonb_build_object('pedido_id', p_pedido_id, 'itens', v_itens);
END $fn$;

-- sup_sep_reservar — reprodução de 20260930000079:188.
CREATE OR REPLACE FUNCTION public.sup_sep_reservar(
  p_pedido_id  uuid,
  p_reservas   jsonb,
  p_observacao text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_nome    text := public.sup_est_nome_usuario();
  v_ped     record;
  v_total   integer := 0;
  v_faltas  jsonb := '[]'::jsonb;
  v_rej     jsonb := '[]'::jsonb;
  it        record;
  lo        record;
  v_pi      record;
  v_tag     record;
  v_res_tag integer;
  v_livre   integer;
  v_dar     integer;
  v_pedido_falta integer;
  v_antes   text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_pedidos_materiais', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para preparar pedidos';
  END IF;

  SELECT p.id, p.status, p.pedido_id, p.empresa_id INTO v_ped
    FROM public.sup_pedido p WHERE p.id = p_pedido_id FOR UPDATE;
  IF v_ped.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;
  IF v_ped.status IN ('DESPACHADO','CANCELADO') THEN
    RAISE EXCEPTION 'Pedido % está % e não aceita separação.', v_ped.pedido_id, v_ped.status;
  END IF;
  v_antes := v_ped.status;

  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(p_reservas, '[]'::jsonb)) AS e(v)
  LOOP
    SELECT x.id, x.item_id, x.nome_item, x.tamanho, x.quantidade INTO v_pi
      FROM public.sup_pedido_item x
     WHERE x.id = (it.v->>'pedido_item_id')::uuid AND x.pedido_id = p_pedido_id;

    IF v_pi.id IS NULL THEN
      v_rej := v_rej || jsonb_build_object('pedido_item_id', it.v->>'pedido_item_id',
                                           'motivo', 'Item não pertence a este pedido');
      CONTINUE;
    END IF;

    v_pedido_falta := 0;

    FOR lo IN SELECT * FROM jsonb_array_elements(COALESCE(it.v->'lotes', '[]'::jsonb)) AS e(v)
    LOOP
      -- Passo 1 do protocolo: serializa por material.
      PERFORM pg_advisory_xact_lock(hashtext('sup_est_item:' || v_pi.item_id::text)::bigint);

      -- Passo 3: trava a etiqueta pela condição FÍSICA (nunca pela reserva).
      SELECT tg.id, tg.codigo, tg.tipo, tg.quantidade_massa, tg.usado, tg.tamanho,
             tg.item_estoque_id, ei.empresa_id, ei.sup_item_id
        INTO v_tag
        FROM public.sup_estoque_tag tg
        JOIN public.sup_estoque_item ei ON ei.id = tg.item_estoque_id
       WHERE tg.id = (lo.v->>'tag_id')::uuid
       FOR UPDATE OF tg;

      IF v_tag.id IS NULL THEN
        v_rej := v_rej || jsonb_build_object('tag_id', lo.v->>'tag_id',
                                             'motivo', 'Lote não existe');
        CONTINUE;
      END IF;
      -- EDIÇÃO 0163: o lote pode estar num TAMANHO do material pedido.
      IF v_pi.item_id IS NULL OR NOT public.sup_item_da_familia(v_tag.sup_item_id, v_pi.item_id) THEN
        v_rej := v_rej || jsonb_build_object('codigo', v_tag.codigo,
                   'motivo', format('Lote é de outro material, não de %s', v_pi.nome_item));
        CONTINUE;
      END IF;
      IF v_tag.usado THEN
        v_rej := v_rej || jsonb_build_object('codigo', v_tag.codigo,
                                             'motivo', 'Lote já foi consumido');
        CONTINUE;
      END IF;

      -- Passo 4: só agora, e em consulta separada, o reservado.
      SELECT COALESCE(SUM(rr.quantidade), 0) INTO v_res_tag
        FROM public.sup_estoque_reserva rr
       WHERE rr.tag_id = v_tag.id AND rr.situacao = 'ATIVA';

      v_livre := (CASE WHEN v_tag.tipo = 'massa' THEN COALESCE(v_tag.quantidade_massa, 0) ELSE 1 END)
                 - v_res_tag;
      v_dar   := LEAST(GREATEST(COALESCE((lo.v->>'quantidade')::int, 0), 0), GREATEST(v_livre, 0));

      IF v_dar <= 0 THEN
        v_pedido_falta := v_pedido_falta + GREATEST(COALESCE((lo.v->>'quantidade')::int, 0), 0);
        v_rej := v_rej || jsonb_build_object('codigo', v_tag.codigo,
                   'motivo', 'Sem saldo livre neste lote (já reservado para outro pedido)');
        CONTINUE;
      END IF;

      v_pedido_falta := v_pedido_falta
                        + GREATEST(COALESCE((lo.v->>'quantidade')::int, 0) - v_dar, 0);

      INSERT INTO public.sup_estoque_reserva
        (empresa_id, tag_id, item_estoque_id, pedido_id, pedido_item_id, quantidade,
         reservado_por, reservado_por_nome)
      VALUES (v_tag.empresa_id, v_tag.id, v_tag.item_estoque_id, p_pedido_id, v_pi.id,
              v_dar, v_uid, v_nome)
      ON CONFLICT (tag_id, pedido_item_id) WHERE situacao = 'ATIVA'
      DO UPDATE SET quantidade   = public.sup_estoque_reserva.quantidade + excluded.quantidade,
                    reservado_em = now();

      INSERT INTO public.sup_estoque_movimento
        (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho,
         pedido_id, pedido_item_id, observacao, usuario_id, usuario_nome)
      VALUES (v_tag.empresa_id, v_tag.item_estoque_id, v_tag.codigo, 'reserva', v_dar,
              v_tag.tamanho, p_pedido_id, v_pi.id,
              format('Reservado para separação do pedido %s', v_ped.pedido_id), v_uid, v_nome);

      v_total := v_total + v_dar;
    END LOOP;

    IF v_pedido_falta > 0 THEN
      v_faltas := v_faltas || jsonb_build_object(
        'pedido_item_id', v_pi.id, 'nome_item', v_pi.nome_item,
        'tamanho', v_pi.tamanho, 'faltam', v_pedido_falta);
    END IF;
  END LOOP;

  IF v_total > 0 AND v_ped.status <> 'EM SEPARACAO' THEN
    UPDATE public.sup_pedido SET status = 'EM SEPARACAO' WHERE id = p_pedido_id;

    INSERT INTO public.sup_pedido_historico
      (pedido_id, acao, status_anterior, status_novo, observacao, alterado_por, alterado_por_nome)
    VALUES (p_pedido_id, 'STATUS', v_antes, 'EM SEPARACAO',
            nullif(btrim(COALESCE(p_observacao, '')), ''), v_uid, v_nome);
  END IF;

  IF v_total > 0 THEN
    INSERT INTO public.sup_pedido_historico
      (pedido_id, acao, observacao, alterado_por, alterado_por_nome)
    VALUES (p_pedido_id, 'SEPARACAO',
            format('Pré-pedido confirmado: %s unidade(s) reservada(s)%s',
                   v_total,
                   CASE WHEN jsonb_array_length(v_faltas) > 0
                        THEN format(' · %s item(ns) sem saldo', jsonb_array_length(v_faltas))
                        ELSE '' END),
            v_uid, v_nome);
  END IF;

  RETURN jsonb_build_object('reservadas', v_total, 'faltantes', v_faltas, 'rejeitadas', v_rej);
END $fn$;

-- ── 8. Bipar o código e o painel de CA ───────────────────────────────

-- sup_item_por_codigo — reprodução de 20260930000018:132.
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
            -- EDIÇÃO 0163: o base soma os tamanhos dele.
            WHERE s.sup_item_id = i.id OR s.sup_item_base_id = i.id
         ), 0)
    FROM public.sup_item i
   WHERE NULLIF(btrim(p_codigo), '') IS NOT NULL
     AND (i.codigo = btrim(p_codigo) OR i.codigo_barras = btrim(p_codigo))
   LIMIT 1;
$fn$;

-- sst_ca_estoque — reprodução de 20260927000001:222.
CREATE OR REPLACE FUNCTION public.sst_ca_estoque(p_dias_alerta integer DEFAULT 60)
RETURNS TABLE (
  sup_item_id uuid, material text, almoxarifado text,
  codigo text, ca_numero text, ca_validade date,
  situacao text, dias_restantes integer,
  tem_laudo boolean, validade_minima_meses integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.id, i.nome, a.nome, t.codigo, t.ca_numero, t.ca_validade,
         public.sst_situacao_ca(t.ca_validade, p_dias_alerta),
         (t.ca_validade - CURRENT_DATE)::integer,
         (l.id IS NOT NULL), l.validade_minima_meses
    FROM public.sup_estoque_tag t
    JOIN public.sup_estoque_item ei ON ei.id = t.item_estoque_id
    JOIN public.sup_item i          ON i.id  = ei.sup_item_id
    LEFT JOIN public.almoxarifado a ON a.id  = ei.almoxarifado_id
    -- EDIÇÃO 0163: o laudo é do material base; o lote pode estar num tamanho dele.
    LEFT JOIN public.sst_laudo_epi l ON l.sup_item_id = public.sup_item_raiz(i.id) AND l.ativo
   WHERE i.tipo = 'epi'
     AND NOT t.usado
     AND (public.can_access(auth.uid(), 'sst_ca', 'visualizar')
          OR public.can_access(auth.uid(), 'sup_estoque', 'visualizar'))
   ORDER BY (t.ca_validade IS NULL), t.ca_validade NULLS LAST;
$$;

-- ── 9. Permissões ────────────────────────────────────────────────────
-- CREATE OR REPLACE mantém o que cada função já tinha; reafirmado aqui
-- para quem ler este arquivo não precisar caçar nas originais.
REVOKE ALL ON FUNCTION public.sup_tamanho_da_variante(text)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_item_raiz(uuid)                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_item_da_familia(uuid, uuid)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_item_variante(uuid, text)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sup_item_variante_guarda()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sup_item_variante_propaga()         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sup_est_tag_tamanho_do_item()       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sup_est_criar_material(uuid, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.sup_tamanho_da_variante(text)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_item_raiz(uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_item_da_familia(uuid, uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_est_criar_material(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.sup_est_entrada_quantidade(jsonb)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_est_editar_item(uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_est_validar(text[], uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_est_baixar(uuid, text, text, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_est_baixar_quantidade(uuid, uuid, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_est_resolver_codigos(jsonb)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_sep_sugerir(uuid)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_sep_reservar(uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_item_por_codigo(text)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sst_ca_estoque(integer)             FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.sup_est_entrada_quantidade(jsonb)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_est_editar_item(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_est_validar(text[], uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_est_baixar(uuid, text, text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_est_baixar_quantidade(uuid, uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_est_resolver_codigos(jsonb)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_sep_sugerir(uuid)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_sep_reservar(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_item_por_codigo(text)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.sst_ca_estoque(integer)             TO authenticated;

-- ── 10. O estoque que já existe passa para os tamanhos ───────────────

-- tmp_*: R2 permite o DROP depois que a divisão estiver conferida.
CREATE TABLE IF NOT EXISTS public.tmp_sup_item_tamanho_log (
  id            bigserial PRIMARY KEY,
  tabela        text NOT NULL,
  acao          text NOT NULL,        -- criar | mover | arquivar
  linha_id      text,
  codigo        text,                 -- código do lote, nas linhas de sup_estoque_tag
  ei_antigo     uuid,
  ei_novo       uuid,
  item_antigo   uuid,
  item_novo     uuid,
  registrado_em timestamptz NOT NULL DEFAULT now()
);

-- Sem policy nenhuma: só o SQL Editor enxerga. Mesmo desenho do log de
-- 20260930000105.
ALTER TABLE public.tmp_sup_item_tamanho_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tmp_sup_item_tamanho_log FROM anon, authenticated;

DO $divide$
DECLARE
  c      record;
  v_var  uuid;
  v_ei   uuid;
BEGIN
  -- Um par por (ficha do base, tamanho de verdade). O cursor é aberto uma
  -- vez: os lotes que o laço move não mudam a lista que ele percorre.
  FOR c IN
    WITH pares AS (
      SELECT DISTINCT ei.id AS ei_id, ei.sup_item_id, ei.almoxarifado_id,
             public.sup_tamanho_da_variante(t.tamanho) AS tam
        FROM public.sup_estoque_tag t
        JOIN public.sup_estoque_item ei ON ei.id = t.item_estoque_id
        JOIN public.sup_item i          ON i.id  = ei.sup_item_id
       WHERE ei.arquivado_em IS NULL
         AND i.item_pai_id IS NULL
         AND public.sup_tamanho_da_variante(t.tamanho) IS NOT NULL
    )
    SELECT p.*, count(*) OVER (PARTITION BY p.ei_id) AS n_tamanhos
      FROM pares p
     ORDER BY p.ei_id, p.tam
  LOOP
    v_var := public.sup_item_variante(c.sup_item_id, c.tam);

    -- A ficha do tamanho, com o cadastro da ficha do base.
    v_ei := NULL;
    INSERT INTO public.sup_estoque_item
      (empresa_id, almoxarifado_id, sup_item_id, valor_unitario, estoque_minimo,
       fornecedor, fornecedor_id, validade, preco_valido_ate, observacoes, localizacao)
    SELECT p.empresa_id, p.almoxarifado_id, v_var, p.valor_unitario,
           CASE WHEN c.n_tamanhos = 1 THEN p.estoque_minimo ELSE 0 END,
           p.fornecedor, p.fornecedor_id, p.validade, p.preco_valido_ate, p.observacoes, p.localizacao
      FROM public.sup_estoque_item p
     WHERE p.id = c.ei_id
    ON CONFLICT (almoxarifado_id, sup_item_id) DO NOTHING
    RETURNING id INTO v_ei;

    IF v_ei IS NOT NULL THEN
      INSERT INTO public.tmp_sup_item_tamanho_log
        (tabela, acao, linha_id, ei_antigo, ei_novo, item_antigo, item_novo)
      VALUES ('sup_estoque_item', 'criar', v_ei::text, c.ei_id, v_ei, c.sup_item_id, v_var);

      -- O gatilho de preço (trg_sup_item_preco_registra) acabou de gravar o
      -- valor copiado como se fosse uma entrada de hoje. Não foi: sai, e
      -- entra a história do base, com as datas e origens de verdade.
      DELETE FROM public.sup_item_preco pr WHERE pr.item_estoque_id = v_ei;
      INSERT INTO public.sup_item_preco
        (empresa_id, sup_item_id, item_estoque_id, almoxarifado_id,
         valor_unitario, valor_anterior, valido_ate, origem,
         fornecedor_id, fornecedor_nome, documento,
         registrado_em, registrado_por, registrado_por_nome)
      SELECT pr.empresa_id, v_var, v_ei, pr.almoxarifado_id,
             pr.valor_unitario, pr.valor_anterior, pr.valido_ate, pr.origem,
             pr.fornecedor_id, pr.fornecedor_nome, pr.documento,
             pr.registrado_em, pr.registrado_por, pr.registrado_por_nome
        FROM public.sup_item_preco pr
       WHERE pr.item_estoque_id = c.ei_id;
    ELSE
      SELECT e.id INTO v_ei FROM public.sup_estoque_item e
       WHERE e.almoxarifado_id = c.almoxarifado_id AND e.sup_item_id = v_var;
    END IF;

    -- Os lotes do tamanho.
    WITH mov AS (
      UPDATE public.sup_estoque_tag t
         SET item_estoque_id = v_ei
       WHERE t.item_estoque_id = c.ei_id
         AND public.sup_tamanho_da_variante(t.tamanho) = c.tam
      RETURNING t.id, t.codigo
    )
    INSERT INTO public.tmp_sup_item_tamanho_log
      (tabela, acao, linha_id, codigo, ei_antigo, ei_novo, item_antigo, item_novo)
    SELECT 'sup_estoque_tag', 'mover', m.id::text, m.codigo, c.ei_id, v_ei, c.sup_item_id, v_var
      FROM mov m;

    -- O que pende de cada lote vai com ele. Consumo e movimento são por
    -- código do lote, e só os da ficha do base: código de etiqueta antiga
    -- já foi reciclado entre materiais (20260820000002), e o movimento de
    -- outro material com o mesmo código não é deste.
    WITH mov AS (
      UPDATE public.sup_estoque_consumo x
         SET item_estoque_id = v_ei
       WHERE x.item_estoque_id = c.ei_id
         AND x.codigo IN (SELECT l.codigo FROM public.tmp_sup_item_tamanho_log l
                           WHERE l.tabela = 'sup_estoque_tag' AND l.ei_novo = v_ei)
      RETURNING x.id
    )
    INSERT INTO public.tmp_sup_item_tamanho_log (tabela, acao, linha_id, ei_antigo, ei_novo)
    SELECT 'sup_estoque_consumo', 'mover', m.id::text, c.ei_id, v_ei FROM mov m;

    WITH mov AS (
      UPDATE public.sup_estoque_reserva x
         SET item_estoque_id = v_ei
       WHERE x.item_estoque_id = c.ei_id
         AND x.tag_id::text IN (SELECT l.linha_id FROM public.tmp_sup_item_tamanho_log l
                                 WHERE l.tabela = 'sup_estoque_tag' AND l.ei_novo = v_ei)
      RETURNING x.id
    )
    INSERT INTO public.tmp_sup_item_tamanho_log (tabela, acao, linha_id, ei_antigo, ei_novo)
    SELECT 'sup_estoque_reserva', 'mover', m.id::text, c.ei_id, v_ei FROM mov m;

    WITH alvo AS (
      SELECT x.id, x.sup_item_id FROM public.sup_estoque_contagem_fila x
       WHERE x.item_estoque_id = c.ei_id
         AND x.tag_id::text IN (SELECT l.linha_id FROM public.tmp_sup_item_tamanho_log l
                                 WHERE l.tabela = 'sup_estoque_tag' AND l.ei_novo = v_ei)
    ), mov AS (
      UPDATE public.sup_estoque_contagem_fila x
         SET item_estoque_id = v_ei, sup_item_id = v_var
        FROM alvo a
       WHERE x.id = a.id
      RETURNING x.id, a.sup_item_id AS antigo
    )
    INSERT INTO public.tmp_sup_item_tamanho_log
      (tabela, acao, linha_id, ei_antigo, ei_novo, item_antigo, item_novo)
    SELECT 'sup_estoque_contagem_fila', 'mover', m.id::text, c.ei_id, v_ei, m.antigo, v_var FROM mov m;

    -- Movimento e alteração leem por sup_item_id (useHistoricoDoMaterial,
    -- useAlteracoesDoMaterial): é isto que leva a história do lote para a
    -- linha do tamanho. Movimento sem lote (inventário, exclusão do
    -- material) é do material inteiro e fica no base.
    WITH alvo AS (
      SELECT x.id, x.sup_item_id FROM public.sup_estoque_movimento x
       WHERE x.item_estoque_id = c.ei_id
         AND x.codigo IN (SELECT l.codigo FROM public.tmp_sup_item_tamanho_log l
                           WHERE l.tabela = 'sup_estoque_tag' AND l.ei_novo = v_ei)
    ), mov AS (
      UPDATE public.sup_estoque_movimento x
         SET item_estoque_id = v_ei, sup_item_id = v_var
        FROM alvo a
       WHERE x.id = a.id
      RETURNING x.id, a.sup_item_id AS antigo
    )
    INSERT INTO public.tmp_sup_item_tamanho_log
      (tabela, acao, linha_id, ei_antigo, ei_novo, item_antigo, item_novo)
    SELECT 'sup_estoque_movimento', 'mover', m.id::text, c.ei_id, v_ei, m.antigo, v_var FROM mov m;

    WITH alvo AS (
      SELECT x.id, x.sup_item_id FROM public.sup_estoque_alteracao x
       WHERE x.item_estoque_id = c.ei_id
         AND x.tag_id::text IN (SELECT l.linha_id FROM public.tmp_sup_item_tamanho_log l
                                 WHERE l.tabela = 'sup_estoque_tag' AND l.ei_novo = v_ei)
    ), mov AS (
      UPDATE public.sup_estoque_alteracao x
         SET item_estoque_id = v_ei, sup_item_id = v_var
        FROM alvo a
       WHERE x.id = a.id
      RETURNING x.id, a.sup_item_id AS antigo
    )
    INSERT INTO public.tmp_sup_item_tamanho_log
      (tabela, acao, linha_id, ei_antigo, ei_novo, item_antigo, item_novo)
    SELECT 'sup_estoque_alteracao', 'mover', m.id::text, c.ei_id, v_ei, m.antigo, v_var FROM mov m;
  END LOOP;

  -- Ficha do base que ficou sem lote nenhum sai da lista. Arquivada, não
  -- apagada: o movimento sem lote e o histórico de preço do base ficam
  -- pendurados nela. O mínimo fica como estava, para o ROLLBACK.
  WITH arq AS (
    UPDATE public.sup_estoque_item ei
       SET arquivado_em       = now(),
           arquivado_por      = NULL,
           arquivado_por_nome = 'Migração 20260930000163',
           arquivado_motivo   = 'Cada tamanho passou a ser um item com código próprio; os lotes foram para eles.'
     WHERE ei.id IN (SELECT DISTINCT l.ei_antigo FROM public.tmp_sup_item_tamanho_log l
                      WHERE l.tabela = 'sup_estoque_tag')
       AND ei.arquivado_em IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.sup_estoque_tag t WHERE t.item_estoque_id = ei.id)
    RETURNING ei.id
  )
  INSERT INTO public.tmp_sup_item_tamanho_log (tabela, acao, linha_id, ei_antigo)
  SELECT 'sup_estoque_item', 'arquivar', a.id::text, a.id FROM arq a;
END
$divide$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Conferência (é o resultado que o SQL Editor mostra no fim) ───────
-- Esperado na primeira execução, pelos dados de 15/09/2026:
--   sup_estoque_item/criar 489, sup_estoque_tag/mover 11926,
--   sup_estoque_item/arquivar 120, itens por tamanho 489,
--   sup_estoque_consumo/mover 944, sup_estoque_movimento/mover 102,
--   sup_estoque_reserva/mover 45, sup_estoque_contagem_fila/mover 0,
--   sup_estoque_alteracao/mover 2 (mais o que tiver entrado desde então),
-- e as duas linhas "ainda_no_base" com 0.
SELECT tabela, acao, count(*) AS linhas
  FROM public.tmp_sup_item_tamanho_log
 GROUP BY 1, 2
UNION ALL
SELECT 'itens por tamanho (sup_item com item_pai_id)', '-', count(*)
  FROM public.sup_item WHERE item_pai_id IS NOT NULL
UNION ALL
-- Lote com tamanho de verdade ainda na ficha de um base: esperado 0.
SELECT 'ainda_no_base: lote com tamanho em ficha ativa do base', '-', count(*)
  FROM public.sup_estoque_tag t
  JOIN public.sup_estoque_item ei ON ei.id = t.item_estoque_id
  JOIN public.sup_item i          ON i.id  = ei.sup_item_id
 WHERE ei.arquivado_em IS NULL AND i.item_pai_id IS NULL
   AND public.sup_tamanho_da_variante(t.tamanho) IS NOT NULL
UNION ALL
-- Lote cujo tamanho não bate com o do item em que está: esperado 0.
SELECT 'ainda_no_base: lote em tamanho errado', '-', count(*)
  FROM public.sup_estoque_tag t
  JOIN public.sup_estoque_item ei ON ei.id = t.item_estoque_id
  JOIN public.sup_item i          ON i.id  = ei.sup_item_id
 WHERE i.item_pai_id IS NOT NULL
   AND public.sup_tamanho_da_variante(t.tamanho) IS DISTINCT FROM i.tamanho
 ORDER BY 1, 2;

-- =====================================================================
-- ROLLBACK — desfaz pelo log, na ordem inversa. Rodar inteiro de uma vez,
-- e ANTES de haver entrada nova num tamanho. Para conferir:
--   SELECT count(*) FROM public.sup_estoque_tag t
--     JOIN public.sup_estoque_item ei ON ei.id = t.item_estoque_id
--    WHERE t.id::text NOT IN (SELECT linha_id FROM public.tmp_sup_item_tamanho_log
--                              WHERE tabela = 'sup_estoque_tag')
--      AND ei.sup_item_id IN (SELECT id FROM public.sup_item WHERE item_pai_id IS NOT NULL);
-- Tem de dar 0. Se não der, esses lotes nasceram depois e precisam ir para
-- a ficha do base à mão, com o tamanho, antes do passo 5.
-- =====================================================================
-- BEGIN;
-- -- 1. fichas do base voltam à lista
-- UPDATE public.sup_estoque_item ei
--    SET arquivado_em = NULL, arquivado_por = NULL, arquivado_por_nome = NULL, arquivado_motivo = NULL
--   FROM public.tmp_sup_item_tamanho_log l
--  WHERE l.tabela = 'sup_estoque_item' AND l.acao = 'arquivar' AND ei.id = l.ei_antigo;
-- -- 2. o que pendia dos lotes volta para a ficha e o item do base
-- UPDATE public.sup_estoque_alteracao x SET item_estoque_id = l.ei_antigo, sup_item_id = l.item_antigo
--   FROM public.tmp_sup_item_tamanho_log l WHERE l.tabela = 'sup_estoque_alteracao' AND x.id::text = l.linha_id;
-- UPDATE public.sup_estoque_movimento x SET item_estoque_id = l.ei_antigo, sup_item_id = l.item_antigo
--   FROM public.tmp_sup_item_tamanho_log l WHERE l.tabela = 'sup_estoque_movimento' AND x.id::text = l.linha_id;
-- UPDATE public.sup_estoque_contagem_fila x SET item_estoque_id = l.ei_antigo, sup_item_id = l.item_antigo
--   FROM public.tmp_sup_item_tamanho_log l WHERE l.tabela = 'sup_estoque_contagem_fila' AND x.id::text = l.linha_id;
-- UPDATE public.sup_estoque_reserva x SET item_estoque_id = l.ei_antigo
--   FROM public.tmp_sup_item_tamanho_log l WHERE l.tabela = 'sup_estoque_reserva' AND x.id::text = l.linha_id;
-- UPDATE public.sup_estoque_consumo x SET item_estoque_id = l.ei_antigo
--   FROM public.tmp_sup_item_tamanho_log l WHERE l.tabela = 'sup_estoque_consumo' AND x.id::text = l.linha_id;
-- -- 3. os lotes voltam
-- UPDATE public.sup_estoque_tag x SET item_estoque_id = l.ei_antigo
--   FROM public.tmp_sup_item_tamanho_log l WHERE l.tabela = 'sup_estoque_tag' AND x.id::text = l.linha_id;
-- -- 4. movimentos novos nas fichas dos tamanhos (baixas depois da migration)
-- --    vão para a ficha do base, para o DELETE do passo 5 não deixá-los órfãos
-- UPDATE public.sup_estoque_movimento x SET item_estoque_id = l.ei_antigo, sup_item_id = l.item_antigo
--   FROM public.tmp_sup_item_tamanho_log l
--  WHERE l.tabela = 'sup_estoque_item' AND l.acao = 'criar' AND x.item_estoque_id = l.ei_novo;
-- -- 5. as fichas criadas e os itens por tamanho (o histórico de preço
-- --    copiado sai junto, pelo CASCADE de sup_item_preco.sup_item_id)
-- DELETE FROM public.sup_estoque_item ei USING public.tmp_sup_item_tamanho_log l
--  WHERE l.tabela = 'sup_estoque_item' AND l.acao = 'criar' AND ei.id = l.ei_novo;
-- DELETE FROM public.sup_item WHERE item_pai_id IS NOT NULL;
-- -- 6. o resto do schema
-- DROP TRIGGER IF EXISTS trg_sup_tag_tamanho_do_item ON public.sup_estoque_tag;
-- DROP TRIGGER IF EXISTS trg_sup_item_variante_propaga ON public.sup_item;
-- DROP TRIGGER IF EXISTS trg_sup_item_variante_guarda ON public.sup_item;
-- DROP FUNCTION IF EXISTS public.sup_est_tag_tamanho_do_item();
-- DROP FUNCTION IF EXISTS public.sup_item_variante_propaga();
-- DROP FUNCTION IF EXISTS public.sup_item_variante_guarda();
-- DROP FUNCTION IF EXISTS public.sup_est_criar_material(uuid, text, text);
-- --   Recriar, pelas definições citadas no cabeçalho: sup_est_entrada_quantidade,
-- --   sup_est_editar_item, sup_est_validar, sup_est_baixar,
-- --   sup_est_baixar_quantidade, sup_est_resolver_codigos, sup_sep_sugerir,
-- --   sup_sep_reservar, sup_item_por_codigo, sst_ca_estoque.
-- --   A view sup_estoque_saldo: DROP VIEW e recriar pela 20260930000076:328
-- --   (CREATE OR REPLACE não tira coluna).
-- DROP FUNCTION IF EXISTS public.sup_item_variante(uuid, text);
-- DROP FUNCTION IF EXISTS public.sup_item_da_familia(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.sup_item_raiz(uuid);   -- depois da view
-- DROP FUNCTION IF EXISTS public.sup_tamanho_da_variante(text);
-- DROP INDEX IF EXISTS public.idx_sup_item_variante;
-- ALTER TABLE public.sup_item DROP CONSTRAINT IF EXISTS sup_item_variante_check;
-- ALTER TABLE public.sup_item DROP COLUMN IF EXISTS tamanho, DROP COLUMN IF EXISTS item_pai_id;
-- DROP TABLE public.tmp_sup_item_tamanho_log;
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';
