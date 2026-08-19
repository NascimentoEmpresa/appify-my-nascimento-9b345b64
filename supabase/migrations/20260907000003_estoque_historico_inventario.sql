-- =====================================================================
-- ESTOQUE — histórico legível no modal do material, e Inventário
--
-- Chamado: em /app/suprimentos/estoque-etiquetas, abrir um material mostra só
-- as etiquetas. O usuário quer a vida inteira do item ali — o que entrou, o que
-- saiu e PARA QUAL PEDIDO, devoluções, remoções e inventários, sempre com a
-- etiqueta, o usuário, a data e a hora.
--
-- O livro-razão já existia e já estava sendo escrito: `sup_estoque_movimento`
-- recebe linha de sup_est_entrada, sup_est_baixar, sup_est_devolver e
-- sup_est_remover_tag desde a 20260820000002. Só ninguém lia. Esta migration
-- resolve o que faltava para poder ler, e acrescenta o Inventário.
--
-- ── O FURO QUE ESTA MIGRATION TAPA ──────────────────────────────────
-- `sup_estoque_movimento.item_estoque_id` é ON DELETE SET NULL, e
-- `sup_est_remover_tag` APAGA o `sup_estoque_item` quando remove a última
-- etiqueta dele. Ou seja: some o material e todo o histórico dele fica órfão,
-- com item_estoque_id nulo — invisível para sempre.
--
-- É exatamente a investigação que motivou o chamado que isso inviabiliza:
-- rastrear a etiqueta que "sumiu do nada" depende de o histórico sobreviver ao
-- desaparecimento da linha de estoque. Por isso o movimento passa a apontar
-- também para `sup_item` (o material do catálogo), que esse fluxo não apaga.
--
-- Idempotente.
-- ROLLBACK no rodapé.
-- =====================================================================

-- ── 1. Movimento ancorado no material ────────────────────────────────
ALTER TABLE public.sup_estoque_movimento
  ADD COLUMN IF NOT EXISTS sup_item_id uuid REFERENCES public.sup_item(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.sup_estoque_movimento.sup_item_id IS
  'Material do catálogo. Existe porque item_estoque_id vira NULL quando a última etiqueta é removida e o sup_estoque_item é apagado — sem esta coluna o histórico ficaria órfão justo no caso que mais interessa auditar.';

UPDATE public.sup_estoque_movimento m
   SET sup_item_id = ei.sup_item_id
  FROM public.sup_estoque_item ei
 WHERE ei.id = m.item_estoque_id AND m.sup_item_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_sup_mov_material
  ON public.sup_estoque_movimento(sup_item_id, created_at DESC);

-- Trigger em vez de mexer nas quatro RPCs que gravam movimento: assim nenhum
-- caminho de escrita futuro pode esquecer de preencher. Roda ANTES do INSERT,
-- quando o item ainda existe (a remoção insere o movimento e só depois apaga).
CREATE OR REPLACE FUNCTION public.sup_est_mov_preenche_material()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.sup_item_id IS NULL AND NEW.item_estoque_id IS NOT NULL THEN
    SELECT ei.sup_item_id INTO NEW.sup_item_id
      FROM public.sup_estoque_item ei WHERE ei.id = NEW.item_estoque_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sup_mov_material ON public.sup_estoque_movimento;
CREATE TRIGGER trg_sup_mov_material
  BEFORE INSERT ON public.sup_estoque_movimento
  FOR EACH ROW EXECUTE FUNCTION public.sup_est_mov_preenche_material();

-- ── 2. Inventário ────────────────────────────────────────────────────
--
-- REGRA, confirmada pelo Eduardo: o inventário NÃO CORRIGE NADA. Ele confronta
-- a etiqueta física com a do sistema, grava a divergência, e a apuração (ver
-- câmera, ver relatório, achar quem deu baixa) é trabalho humano depois. Se ele
-- baixasse etiqueta sozinho, destruiria a prova que o time precisa analisar.
--
-- Cabeça + linhas em vez de texto solto em `observacao`: "quais etiquetas
-- sumiram no inventário de agosto" tem que ser uma consulta, não uma leitura.
CREATE TABLE IF NOT EXISTS public.sup_estoque_inventario (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  item_estoque_id uuid REFERENCES public.sup_estoque_item(id) ON DELETE SET NULL,
  sup_item_id     uuid REFERENCES public.sup_item(id)         ON DELETE SET NULL,
  esperadas       integer NOT NULL DEFAULT 0,
  encontradas     integer NOT NULL DEFAULT 0,
  divergencia     integer NOT NULL DEFAULT 0,
  observacao      text,
  usuario_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  usuario_nome    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sup_inv_material
  ON public.sup_estoque_inventario(sup_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.sup_estoque_inventario_tag (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventario_id uuid NOT NULL REFERENCES public.sup_estoque_inventario(id) ON DELETE CASCADE,
  codigo        text NOT NULL,
  -- 'estranha' = bipada mas não pertence a este material, ou já está usada.
  -- Sem esse terceiro estado, bipar a etiqueta errada contaria como acerto e o
  -- inventário fecharia certo escondendo um erro.
  situacao      text NOT NULL CHECK (situacao IN ('encontrada', 'faltante', 'estranha')),
  UNIQUE (inventario_id, codigo)
);
CREATE INDEX IF NOT EXISTS idx_sup_inv_tag_codigo
  ON public.sup_estoque_inventario_tag(codigo);

ALTER TABLE public.sup_estoque_inventario     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sup_estoque_inventario_tag ENABLE ROW LEVEL SECURITY;

-- Leitura pela permissão da tela, SEM recorte por empresa — o mesmo desenho que
-- a 20260901000001 deixou em todo o Suprimentos.
DROP POLICY IF EXISTS sup_inv_select ON public.sup_estoque_inventario;
CREATE POLICY sup_inv_select ON public.sup_estoque_inventario
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'sup_estoque', 'visualizar'));

DROP POLICY IF EXISTS sup_inv_tag_select ON public.sup_estoque_inventario_tag;
CREATE POLICY sup_inv_tag_select ON public.sup_estoque_inventario_tag
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'sup_estoque', 'visualizar'));

-- Escrita só pela RPC (SECURITY DEFINER). Nenhuma policy de INSERT/UPDATE:
-- inventário é registro de auditoria e não se edita pela tela.

-- ── 3. A RPC do inventário ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sup_est_inventario(
  p_item_estoque_id uuid,
  p_codigos         text[],
  p_observacao      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
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
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_estoque', 'alterar') THEN
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

  -- NENHUM UPDATE em sup_estoque_tag. É proposital: ver o comentário do bloco 2.
  RETURN jsonb_build_object(
    'inventario_id', v_inv,
    'esperadas',     cardinality(v_esperadas),
    'encontradas',   cardinality(v_encontradas),
    'divergencia',   cardinality(v_encontradas) - cardinality(v_esperadas),
    'faltantes',     to_jsonb(v_faltantes),
    'estranhas',     to_jsonb(v_estranhas));
END $$;

-- ── 4. Motivo na remoção de etiqueta ─────────────────────────────────
-- O chamado pede "1 pedido removido (motivo xxx)". A função não aceitava
-- justificativa. DROP antes do CREATE porque acrescentar parâmetro cria uma
-- SOBRECARGA em vez de substituir — ficariam duas versões vivas, e a tela
-- continuaria chamando a antiga sem motivo.
DROP FUNCTION IF EXISTS public.sup_est_remover_tag(text);
CREATE OR REPLACE FUNCTION public.sup_est_remover_tag(p_codigo text, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text := public.sup_est_nome_usuario();
  t      record;
  v_rest int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_estoque', 'excluir') THEN
    RAISE EXCEPTION 'Sem permissão para remover etiqueta';
  END IF;

  SELECT tg.*, ei.id AS ei_id, ei.empresa_id INTO t
    FROM public.sup_estoque_tag tg
    JOIN public.sup_estoque_item ei ON ei.id = tg.item_estoque_id
   WHERE tg.codigo = upper(trim(p_codigo)) FOR UPDATE OF tg;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Etiqueta não encontrada'; END IF;

  INSERT INTO public.sup_estoque_movimento
    (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho,
     observacao, usuario_id, usuario_nome)
  VALUES (t.empresa_id, t.ei_id, t.codigo, 'remocao', 1, t.tamanho,
          nullif(btrim(COALESCE(p_motivo, '')), ''), v_uid, v_nome);

  IF t.tipo = 'massa' AND COALESCE(t.quantidade_massa, 0) > 1 THEN
    UPDATE public.sup_estoque_tag tg
       SET quantidade_massa = tg.quantidade_massa - 1 WHERE tg.id = t.id;
    RETURN jsonb_build_object('acao', 'decrementou',
             'saldo', COALESCE(t.quantidade_massa, 0) - 1);
  END IF;

  DELETE FROM public.sup_estoque_tag tg WHERE tg.id = t.id;

  SELECT count(*) INTO v_rest
    FROM public.sup_estoque_tag tg WHERE tg.item_estoque_id = t.ei_id;

  IF v_rest = 0 THEN
    DELETE FROM public.sup_estoque_item ei WHERE ei.id = t.ei_id;
    RETURN jsonb_build_object('acao', 'removeu_item');
  END IF;

  WITH nova AS (
    SELECT tg.id, row_number() OVER (ORDER BY tg.sequencia, tg.created_at) AS n
      FROM public.sup_estoque_tag tg WHERE tg.item_estoque_id = t.ei_id
  )
  UPDATE public.sup_estoque_tag tg SET sequencia = nova.n
    FROM nova WHERE nova.id = tg.id;

  RETURN jsonb_build_object('acao', 'removeu', 'restantes', v_rest);
END $$;

-- ── 5. Grants ────────────────────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.sup_est_inventario(uuid, text[], text)',
    'public.sup_est_remover_tag(text, text)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

GRANT SELECT ON public.sup_estoque_inventario,
               public.sup_estoque_inventario_tag TO authenticated;

-- ── Conferência ──────────────────────────────────────────────────────
SELECT count(*) FILTER (WHERE sup_item_id IS NOT NULL) AS movimentos_com_material,
       count(*)                                        AS movimentos_total
  FROM public.sup_estoque_movimento;

SELECT proname, pg_get_function_identity_arguments(oid) AS args
  FROM pg_proc WHERE proname IN ('sup_est_inventario', 'sup_est_remover_tag')
 ORDER BY 1;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.sup_est_inventario(uuid, text[], text);
--   DROP TABLE IF EXISTS public.sup_estoque_inventario_tag, public.sup_estoque_inventario;
--   DROP TRIGGER IF EXISTS trg_sup_mov_material ON public.sup_estoque_movimento;
--   DROP FUNCTION IF EXISTS public.sup_est_mov_preenche_material();
--   ALTER TABLE public.sup_estoque_movimento DROP COLUMN IF EXISTS sup_item_id;
--   DROP FUNCTION IF EXISTS public.sup_est_remover_tag(text, text);
--   -- e repor sup_est_remover_tag(text) da 20260820000002
-- =====================================================================
