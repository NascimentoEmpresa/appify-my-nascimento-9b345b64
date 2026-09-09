-- =====================================================================
-- Suprimentos — contagem rotativa, parte 3 de 5
--
-- Depende de 20260930000074 e 20260930000075.
--
-- Vem ANTES das RPCs de separação (parte 4) porque sup_sep_divergencia
-- grava nesta fila: a tabela precisa existir primeiro.
--
-- O QUE O GERENTE PEDIU
--
--   "Aí ela já vai ter que fazer uma correção desse estoque. Talvez seja
--   até de geral, uma inconsistência de dizer para ela: esse produto
--   necessita uma contagem rotativa. Cria uma lista para ela. E aí
--   talvez até um relatório para nós dizer: olha só, no mês teve 30
--   itens que teve necessidade de contagem rotativa, porque o estoque
--   estava errado."
--
-- Hoje isso não vira registro nenhum — é conversa. Sem o registro, a
-- frase que ele repete na reunião continua verdadeira: "eu não sei que
-- período que ele se perdeu o número".
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sup_est_inventario_quantidade(uuid, jsonb, text);
--   ALTER TABLE public.sup_estoque_inventario_tag
--     DROP COLUMN IF EXISTS quantidade_esperada, DROP COLUMN IF EXISTS quantidade_encontrada;
--   DROP TABLE IF EXISTS public.sup_estoque_contagem_fila;
--   -- e recriar sup_est_inventario a partir de 20260910000003:84
-- =====================================================================

-- ── 1. A fila ────────────────────────────────────────────────────────
--
-- UMA LINHA POR OCORRÊNCIA, sem chave única por material. Três
-- divergências no mesmo produto são três motivos e três provas; colapsar
-- em uma linha destrói justamente a informação que o gerente quer levar
-- para a diretoria. A tela agrupa por material na hora de exibir; a
-- contagem fecha todas as abertas daquele material de uma vez.
--
-- `codigo` é snapshot de propósito: as FKs de tag/pedido são SET NULL,
-- e quando o lote suspeito for removido o registro tem que continuar
-- dizendo QUAL etiqueta sumiu — é literalmente a investigação que o
-- gerente descreve (câmeras, relatórios, quem deu baixa).

CREATE TABLE IF NOT EXISTS public.sup_estoque_contagem_fila (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES public.empresas(id)            ON DELETE CASCADE,
  item_estoque_id     uuid NOT NULL REFERENCES public.sup_estoque_item(id)    ON DELETE CASCADE,
  sup_item_id         uuid REFERENCES public.sup_item(id)                     ON DELETE SET NULL,
  tag_id              uuid REFERENCES public.sup_estoque_tag(id)              ON DELETE SET NULL,
  codigo              text,
  tamanho             text,
  origem              text NOT NULL DEFAULT 'separacao'
                        CHECK (origem IN ('separacao','manual','minimo')),
  reserva_id          uuid REFERENCES public.sup_estoque_reserva(id)          ON DELETE SET NULL,
  pedido_id           uuid REFERENCES public.sup_pedido(id)                   ON DELETE SET NULL,
  pedido_item_id      uuid REFERENCES public.sup_pedido_item(id)              ON DELETE SET NULL,
  quantidade_esperada integer,
  quantidade_faltante integer,
  motivo              text NOT NULL,
  situacao            text NOT NULL DEFAULT 'ABERTA'
                        CHECK (situacao IN ('ABERTA','CONTADA','CANCELADA')),
  inventario_id       uuid REFERENCES public.sup_estoque_inventario(id)       ON DELETE SET NULL,
  aberta_em           timestamptz NOT NULL DEFAULT now(),
  aberta_por          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  aberta_por_nome     text,
  fechada_em          timestamptz,
  fechada_por         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  fechada_por_nome    text
);

CREATE INDEX IF NOT EXISTS idx_sup_contagem_aberta
  ON public.sup_estoque_contagem_fila(item_estoque_id) WHERE situacao = 'ABERTA';
CREATE INDEX IF NOT EXISTS idx_sup_contagem_tag_aberta
  ON public.sup_estoque_contagem_fila(tag_id) WHERE situacao = 'ABERTA';
CREATE INDEX IF NOT EXISTS idx_sup_contagem_data
  ON public.sup_estoque_contagem_fila(aberta_em DESC);

ALTER TABLE public.sup_estoque_contagem_fila ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sup_contagem_fila_select ON public.sup_estoque_contagem_fila;
CREATE POLICY sup_contagem_fila_select ON public.sup_estoque_contagem_fila
  FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_estoque', 'visualizar')
    OR public.can_access(auth.uid(), 'sup_estoque_inventario', 'visualizar')
  );

-- Sem policy de escrita: só as RPCs SECURITY DEFINER alimentam e fecham
-- a fila. Mesmo desenho de sup_estoque_consumo e sup_estoque_reserva.

-- ── 2. Inventário que mede QUANTIDADE, não só presença ───────────────
--
-- Duas colunas nullable, para as linhas já gravadas continuarem válidas.
-- O inventário por código (sup_est_inventario) responde "o lote existe";
-- a divergência que a separação produz é "o lote tem 7 e não 10", e essa
-- ele não sabe medir.

ALTER TABLE public.sup_estoque_inventario_tag
  ADD COLUMN IF NOT EXISTS quantidade_esperada   integer,
  ADD COLUMN IF NOT EXISTS quantidade_encontrada integer;

-- 'divergente' = o lote está lá, com quantidade diferente da do sistema.
-- Sem esse quarto estado, contar 7 de 10 teria de mentir escolhendo entre
-- 'encontrada' (esconde a falta) e 'faltante' (some com as 7 que existem).
DO $mig$
DECLARE v_con text;
BEGIN
  SELECT c.conname INTO v_con FROM pg_constraint c
   WHERE c.conrelid = 'public.sup_estoque_inventario_tag'::regclass AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%estranha%';
  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.sup_estoque_inventario_tag DROP CONSTRAINT %I', v_con);
  END IF;

  ALTER TABLE public.sup_estoque_inventario_tag
    ADD CONSTRAINT sup_estoque_inventario_tag_situacao_check
    CHECK (situacao IN ('encontrada','faltante','estranha','divergente'));
END
$mig$;

-- ── 3. O inventário por código passa a fechar a fila ─────────────────
--
-- Mesma assinatura de 20260910000003:84 e mesmo corpo — a única adição é
-- o UPDATE final. Nenhum chamador muda, e a permissão já era a certa
-- (sup_estoque_inventario | visualizar). Quem contou, contou: a tarefa
-- daquele material acabou.

CREATE OR REPLACE FUNCTION public.sup_est_inventario(
  p_item_estoque_id uuid,
  p_codigos         text[],
  p_observacao      text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid         uuid := auth.uid();
  v_nome        text := public.sup_est_nome_usuario();
  v_item        record;
  v_inv         uuid;
  v_bipadas     text[];
  v_esperadas   text[];
  v_encontradas text[];
  v_faltantes   text[];
  v_estranhas   text[];
  v_fechadas    integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_estoque_inventario', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para registrar inventário';
  END IF;

  SELECT ei.id, ei.empresa_id, ei.sup_item_id INTO v_item
    FROM public.sup_estoque_item ei WHERE ei.id = p_item_estoque_id;
  IF v_item.id IS NULL THEN RAISE EXCEPTION 'Material de estoque não encontrado'; END IF;

  -- Normaliza o que veio da pistola: maiúsculo, sem espaço, sem vazio, sem repetido.
  SELECT COALESCE(array_agg(DISTINCT upper(btrim(c))), '{}')
    INTO v_bipadas
    FROM unnest(COALESCE(p_codigos, '{}')) AS c
   WHERE btrim(COALESCE(c, '')) <> '';

  -- O universo conferível são as etiquetas LIVRES. Etiqueta já baixada para um
  -- pedido não deveria estar na prateleira, então não entra como "faltante".
  SELECT COALESCE(array_agg(tg.codigo), '{}')
    INTO v_esperadas
    FROM public.sup_estoque_tag tg
   WHERE tg.item_estoque_id = p_item_estoque_id AND tg.usado = false;

  SELECT COALESCE(array_agg(x), '{}') INTO v_encontradas
    FROM unnest(v_esperadas) x WHERE x = ANY (v_bipadas);
  SELECT COALESCE(array_agg(x), '{}') INTO v_faltantes
    FROM unnest(v_esperadas) x WHERE NOT (x = ANY (v_bipadas));
  SELECT COALESCE(array_agg(x), '{}') INTO v_estranhas
    FROM unnest(v_bipadas) x WHERE NOT (x = ANY (v_esperadas));

  INSERT INTO public.sup_estoque_inventario
    (empresa_id, item_estoque_id, sup_item_id, esperadas, encontradas, divergencia,
     observacao, usuario_id, usuario_nome)
  VALUES (v_item.empresa_id, v_item.id, v_item.sup_item_id,
          cardinality(v_esperadas), cardinality(v_encontradas),
          cardinality(v_encontradas) - cardinality(v_esperadas),
          nullif(btrim(COALESCE(p_observacao, '')), ''), v_uid, v_nome)
  RETURNING id INTO v_inv;

  INSERT INTO public.sup_estoque_inventario_tag (inventario_id, codigo, situacao)
  SELECT v_inv, x, 'encontrada' FROM unnest(v_encontradas) x
  UNION ALL SELECT v_inv, x, 'faltante'  FROM unnest(v_faltantes) x
  UNION ALL SELECT v_inv, x, 'estranha'  FROM unnest(v_estranhas) x
  ON CONFLICT (inventario_id, codigo) DO NOTHING;

  -- Um único movimento, para o inventário aparecer na MESMA linha do tempo das
  -- entradas e saídas. `quantidade` é o que foi conferido de fato.
  INSERT INTO public.sup_estoque_movimento
    (empresa_id, item_estoque_id, sup_item_id, codigo, tipo, quantidade,
     observacao, usuario_id, usuario_nome)
  VALUES (v_item.empresa_id, v_item.id, v_item.sup_item_id, NULL, 'ajuste',
          cardinality(v_encontradas),
          format('Inventário: %s de %s etiquetas conferidas, divergência %s%s',
                 cardinality(v_encontradas), cardinality(v_esperadas),
                 cardinality(v_encontradas) - cardinality(v_esperadas),
                 CASE WHEN cardinality(v_estranhas) > 0
                      THEN format(' · %s etiqueta(s) estranha(s)', cardinality(v_estranhas))
                      ELSE '' END),
          v_uid, v_nome);

  -- NOVO: contar este material encerra as pendências de contagem rotativa
  -- dele. A fila é uma lista de tarefas, e esta tarefa acabou de ser feita.
  UPDATE public.sup_estoque_contagem_fila
     SET situacao = 'CONTADA', inventario_id = v_inv, fechada_em = now(),
         fechada_por = v_uid, fechada_por_nome = v_nome
   WHERE item_estoque_id = p_item_estoque_id AND situacao = 'ABERTA';
  GET DIAGNOSTICS v_fechadas = ROW_COUNT;

  -- NENHUM UPDATE em sup_estoque_tag. É proposital: ver o comentário do bloco 2
  -- de 20260907000003 — o inventário REGISTRA, não corrige. Corrigir aqui
  -- destruiria a prova de que algo sumiu.
  RETURN jsonb_build_object(
    'inventario_id',      v_inv,
    'esperadas',          cardinality(v_esperadas),
    'encontradas',        cardinality(v_encontradas),
    'divergencia',        cardinality(v_encontradas) - cardinality(v_esperadas),
    'faltantes',          to_jsonb(v_faltantes),
    'estranhas',          to_jsonb(v_estranhas),
    'contagens_fechadas', v_fechadas);
END $fn$;

-- ── 4. Inventário por quantidade ─────────────────────────────────────
--
-- p_contagens = [{"codigo":"ABC","quantidade":7}, ...]
--
-- Também não corrige nada. A diferença para o irmão acima é que ele sabe
-- dizer "o lote existe mas tem 7 de 10", que é exatamente a divergência
-- que a separação produz.

CREATE OR REPLACE FUNCTION public.sup_est_inventario_quantidade(
  p_item_estoque_id uuid,
  p_contagens       jsonb,
  p_observacao      text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid       uuid := auth.uid();
  v_nome      text := public.sup_est_nome_usuario();
  v_item      record;
  v_inv       uuid;
  v_esp_total integer := 0;
  v_enc_total integer := 0;
  v_linhas    jsonb   := '[]'::jsonb;
  v_fechadas  integer := 0;
  t           record;
  v_cont      integer;
  v_sit       text;
  e           record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_estoque_inventario', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para registrar inventário';
  END IF;

  SELECT ei.id, ei.empresa_id, ei.sup_item_id INTO v_item
    FROM public.sup_estoque_item ei WHERE ei.id = p_item_estoque_id;
  IF v_item.id IS NULL THEN RAISE EXCEPTION 'Material de estoque não encontrado'; END IF;

  INSERT INTO public.sup_estoque_inventario
    (empresa_id, item_estoque_id, sup_item_id, esperadas, encontradas, divergencia,
     observacao, usuario_id, usuario_nome)
  VALUES (v_item.empresa_id, v_item.id, v_item.sup_item_id, 0, 0, 0,
          nullif(btrim(COALESCE(p_observacao, '')), ''), v_uid, v_nome)
  RETURNING id INTO v_inv;

  -- Cada lote livre do material, comparado com o que a pessoa contou.
  FOR t IN
    SELECT tg.codigo,
           CASE WHEN tg.tipo = 'massa' THEN COALESCE(tg.quantidade_massa, 0) ELSE 1 END AS esperada
      FROM public.sup_estoque_tag tg
     WHERE tg.item_estoque_id = p_item_estoque_id AND tg.usado = false
     ORDER BY tg.codigo
  LOOP
    SELECT COALESCE(MAX((x->>'quantidade')::int), -1) INTO v_cont
      FROM jsonb_array_elements(COALESCE(p_contagens, '[]'::jsonb)) x
     WHERE upper(btrim(x->>'codigo')) = upper(btrim(t.codigo));

    IF v_cont < 0 THEN v_cont := 0; END IF;

    v_sit := CASE WHEN v_cont = 0            THEN 'faltante'
                  WHEN v_cont = t.esperada   THEN 'encontrada'
                  ELSE 'divergente' END;

    INSERT INTO public.sup_estoque_inventario_tag
      (inventario_id, codigo, situacao, quantidade_esperada, quantidade_encontrada)
    VALUES (v_inv, t.codigo, v_sit, t.esperada, v_cont)
    ON CONFLICT (inventario_id, codigo) DO NOTHING;

    v_esp_total := v_esp_total + t.esperada;
    v_enc_total := v_enc_total + v_cont;
    IF v_sit <> 'encontrada' THEN
      v_linhas := v_linhas || jsonb_build_object(
        'codigo', t.codigo, 'situacao', v_sit,
        'esperada', t.esperada, 'encontrada', v_cont);
    END IF;
  END LOOP;

  -- Contado e não reconhecido: ou é de outro material, ou já foi baixado.
  FOR e IN
    SELECT upper(btrim(x->>'codigo')) AS codigo, COALESCE((x->>'quantidade')::int, 0) AS q
      FROM jsonb_array_elements(COALESCE(p_contagens, '[]'::jsonb)) x
     WHERE btrim(COALESCE(x->>'codigo', '')) <> ''
       AND NOT EXISTS (
         SELECT 1 FROM public.sup_estoque_tag tg
          WHERE tg.item_estoque_id = p_item_estoque_id AND tg.usado = false
            AND upper(btrim(tg.codigo)) = upper(btrim(x->>'codigo')))
  LOOP
    INSERT INTO public.sup_estoque_inventario_tag
      (inventario_id, codigo, situacao, quantidade_esperada, quantidade_encontrada)
    VALUES (v_inv, e.codigo, 'estranha', 0, e.q)
    ON CONFLICT (inventario_id, codigo) DO NOTHING;
    v_linhas := v_linhas || jsonb_build_object(
      'codigo', e.codigo, 'situacao', 'estranha', 'esperada', 0, 'encontrada', e.q);
  END LOOP;

  UPDATE public.sup_estoque_inventario
     SET esperadas = v_esp_total, encontradas = v_enc_total,
         divergencia = v_enc_total - v_esp_total
   WHERE id = v_inv;

  INSERT INTO public.sup_estoque_movimento
    (empresa_id, item_estoque_id, sup_item_id, codigo, tipo, quantidade,
     observacao, usuario_id, usuario_nome)
  VALUES (v_item.empresa_id, v_item.id, v_item.sup_item_id, NULL, 'ajuste', v_enc_total,
          format('Inventário por quantidade: %s de %s unidades contadas, divergência %s',
                 v_enc_total, v_esp_total, v_enc_total - v_esp_total),
          v_uid, v_nome);

  UPDATE public.sup_estoque_contagem_fila
     SET situacao = 'CONTADA', inventario_id = v_inv, fechada_em = now(),
         fechada_por = v_uid, fechada_por_nome = v_nome
   WHERE item_estoque_id = p_item_estoque_id AND situacao = 'ABERTA';
  GET DIAGNOSTICS v_fechadas = ROW_COUNT;

  RETURN jsonb_build_object(
    'inventario_id',      v_inv,
    'esperadas',          v_esp_total,
    'encontradas',        v_enc_total,
    'divergencia',        v_enc_total - v_esp_total,
    'divergencias',       v_linhas,
    'contagens_fechadas', v_fechadas);
END $fn$;

REVOKE ALL ON FUNCTION public.sup_est_inventario(uuid, text[], text)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_est_inventario_quantidade(uuid, jsonb, text)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_est_inventario(uuid, text[], text)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_est_inventario_quantidade(uuid, jsonb, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
