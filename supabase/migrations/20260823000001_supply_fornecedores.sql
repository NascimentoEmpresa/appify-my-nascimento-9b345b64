-- =====================================================================
-- SUPRIMENTOS — Fornecedores de volta ao módulo, ligados ao catálogo
--
-- A tela de Fornecedores tinha saído da navegação junto com o módulo antigo
-- (20260821000001) e os dados foram zerados (20260821000002), porque o
-- cadastro seria refeito. Agora ela volta, com dois acréscimos:
--
--   1. QUAIS MATERIAIS CADA FORNECEDOR FORNECE (sup_fornecedor_item),
--      ligados ao catálogo sup_item — não texto livre.
--   2. A ENTRADA DE ESTOQUE passa a escolher o fornecedor de uma lista, em
--      vez de digitar o nome. Antes era text livre em sup_estoque_item.
--
-- A tabela public.fornecedor é REAPROVEITADA de propósito, em vez de criar
-- uma sup_fornecedor: ela já é rica (CNPJ, sócios, endereço, PIX, contas
-- bancárias) e o Financeiro faz embed dela em titulo_pagar/pre_titulo_pagar.
-- Fornecedor cadastrado aqui aparece lá, que é como um ERP deve se comportar.
--
-- ROLLBACK:
--   ALTER TABLE public.sup_estoque_item DROP COLUMN IF EXISTS fornecedor_id;
--   DROP TABLE IF EXISTS public.sup_fornecedor_item;
--   UPDATE public.app_menu SET ativo = false WHERE codigo = 'fornecedores';
-- =====================================================================

-- ── 1. Menu de volta ─────────────────────────────────────────────────
-- Reativa o código 'fornecedores', que já é o que as policies da tabela
-- usam em can_access(). Criar um código novo obrigaria a reconfigurar
-- permissão e a reescrever quatro policies sem ganho nenhum.
UPDATE public.app_menu am
   SET ativo = true, nome = 'Fornecedores', ordem = 5
  FROM public.app_modulo m
 WHERE m.id = am.modulo_id AND m.codigo = 'suprimentos' AND am.codigo = 'fornecedores';

-- ── 2. O que cada fornecedor fornece ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sup_fornecedor_item (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_id uuid NOT NULL REFERENCES public.fornecedor(id) ON DELETE CASCADE,
  sup_item_id   uuid NOT NULL REFERENCES public.sup_item(id)   ON DELETE CASCADE,
  -- Referência opcional do fornecedor para o mesmo material (código do
  -- catálogo dele), útil na hora de conferir a nota.
  codigo_fornecedor text,
  observacao    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fornecedor_id, sup_item_id)
);
CREATE INDEX IF NOT EXISTS idx_sup_forn_item_forn ON public.sup_fornecedor_item(fornecedor_id);
CREATE INDEX IF NOT EXISTS idx_sup_forn_item_item ON public.sup_fornecedor_item(sup_item_id);

ALTER TABLE public.sup_fornecedor_item ENABLE ROW LEVEL SECURITY;

-- Mesma autoridade da tela de Fornecedores, para não existirem dois lugares
-- decidindo quem mexe no mesmo cadastro.
DROP POLICY IF EXISTS sup_forn_item_select ON public.sup_fornecedor_item;
CREATE POLICY sup_forn_item_select ON public.sup_fornecedor_item FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'fornecedores', 'visualizar')
    OR public.can_access(auth.uid(), 'sup_estoque', 'visualizar')
  );

DROP POLICY IF EXISTS sup_forn_item_write ON public.sup_fornecedor_item;
CREATE POLICY sup_forn_item_write ON public.sup_fornecedor_item FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'fornecedores', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'fornecedores', 'alterar'));

-- ── 3. Estoque aponta para o fornecedor cadastrado ───────────────────
ALTER TABLE public.sup_estoque_item
  ADD COLUMN IF NOT EXISTS fornecedor_id uuid REFERENCES public.fornecedor(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sup_estoque_item_forn ON public.sup_estoque_item(fornecedor_id);

-- A coluna de texto continua existindo e NÃO é dropada: guarda o que já foi
-- digitado antes de existir cadastro. A tela passa a gravar só o id; o texto
-- vira histórico e pode ser removido quando ninguém mais o exibir.
COMMENT ON COLUMN public.sup_estoque_item.fornecedor IS
  'Legado: nome digitado antes de existir cadastro de fornecedor. Use fornecedor_id.';

-- Casa por nome o que já estava digitado, se houver correspondente.
UPDATE public.sup_estoque_item ei
   SET fornecedor_id = f.id
  FROM public.fornecedor f
 WHERE ei.fornecedor_id IS NULL
   AND coalesce(ei.fornecedor, '') <> ''
   AND public.sup_norm_nome(f.razao_social) = public.sup_norm_nome(ei.fornecedor);

-- ── 4. Entrada de estoque aceita o fornecedor por id ─────────────────
-- Único trecho alterado: grava fornecedor_id além do texto. O resto da
-- função é idêntico ao de 20260820000002.
CREATE OR REPLACE FUNCTION public.sup_est_entrada(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_nome    text := public.sup_est_nome_usuario();
  v_almox   uuid := (p_payload->>'almoxarifado_id')::uuid;
  v_mat     uuid := (p_payload->>'sup_item_id')::uuid;
  v_forn    uuid := nullif(p_payload->>'fornecedor_id', '')::uuid;
  v_empresa uuid;
  v_item    uuid;
  v_seq     int;
  v_criadas int := 0;
  v_rej     jsonb := '[]'::jsonb;
  u         jsonb;
  cod       text;
  v_tipo    text;
  v_qtd     int;
  v_tam     text;
  v_valor   numeric;
  r_exist   record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_estoque', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para dar entrada no estoque';
  END IF;

  SELECT a.empresa_id INTO v_empresa FROM public.almoxarifado a WHERE a.id = v_almox;
  IF v_empresa IS NULL THEN RAISE EXCEPTION 'Almoxarifado não encontrado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sup_item i WHERE i.id = v_mat AND i.empresa_id = v_empresa) THEN
    RAISE EXCEPTION 'Material não pertence à empresa deste almoxarifado';
  END IF;

  INSERT INTO public.sup_estoque_item
    (empresa_id, almoxarifado_id, sup_item_id, valor_unitario, estoque_minimo,
     fornecedor, fornecedor_id, validade)
  VALUES (v_empresa, v_almox, v_mat,
          COALESCE((p_payload->>'valor_unitario')::numeric, 0),
          COALESCE((p_payload->>'estoque_minimo')::int, 0),
          nullif(p_payload->>'fornecedor', ''),
          v_forn,
          nullif(p_payload->>'validade', '')::date)
  ON CONFLICT (almoxarifado_id, sup_item_id) DO UPDATE
    SET valor_unitario = COALESCE(nullif(excluded.valor_unitario, 0), public.sup_estoque_item.valor_unitario),
        estoque_minimo = GREATEST(excluded.estoque_minimo, public.sup_estoque_item.estoque_minimo),
        fornecedor     = COALESCE(excluded.fornecedor, public.sup_estoque_item.fornecedor),
        fornecedor_id  = COALESCE(excluded.fornecedor_id, public.sup_estoque_item.fornecedor_id),
        validade       = COALESCE(excluded.validade, public.sup_estoque_item.validade)
  RETURNING id INTO v_item;

  SELECT COALESCE(max(t.sequencia), 0) INTO v_seq
    FROM public.sup_estoque_tag t WHERE t.item_estoque_id = v_item;

  FOR u IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'unidades', '[]'::jsonb)) LOOP
    v_tipo  := COALESCE(u->>'tipo', 'unico');
    v_tam   := nullif(u->>'tamanho', '');
    v_valor := nullif(u->>'valor_unitario', '')::numeric;

    FOR cod IN
      SELECT CASE WHEN v_tipo = 'massa' THEN u->>'codigo' ELSE x END
        FROM jsonb_array_elements_text(
          CASE WHEN v_tipo = 'massa' THEN jsonb_build_array(u->>'codigo')
               ELSE COALESCE(u->'codigos', '[]'::jsonb) END) AS x
    LOOP
      cod := upper(trim(cod));
      CONTINUE WHEN cod IS NULL OR cod = '';
      v_qtd := CASE WHEN v_tipo = 'massa' THEN GREATEST(COALESCE((u->>'quantidade')::int, 1), 1) END;

      SELECT t.id, t.usado, t.tipo, t.quantidade_massa, i.nome AS material
        INTO r_exist
        FROM public.sup_estoque_tag t
        JOIN public.sup_estoque_item ei ON ei.id = t.item_estoque_id
        JOIN public.sup_item i ON i.id = ei.sup_item_id
       WHERE t.codigo = cod;

      IF FOUND THEN
        IF NOT r_exist.usado
           AND (r_exist.tipo = 'unico' OR COALESCE(r_exist.quantidade_massa, 0) > 0) THEN
          v_rej := v_rej || jsonb_build_object(
            'codigo', cod,
            'motivo', format('Etiqueta já está ativa no material "%s"', r_exist.material));
          CONTINUE;
        END IF;
        DELETE FROM public.sup_estoque_tag t WHERE t.id = r_exist.id;
      END IF;

      v_seq := v_seq + 1;
      INSERT INTO public.sup_estoque_tag
        (item_estoque_id, codigo, tamanho, sequencia, tipo,
         quantidade_massa, quantidade_original_massa, valor_unitario, estado)
      VALUES (v_item, cod, v_tam, v_seq, v_tipo,
              v_qtd, v_qtd, v_valor,
              COALESCE(nullif(u->>'estado', ''), 'novo'));

      INSERT INTO public.sup_estoque_movimento
        (empresa_id, item_estoque_id, codigo, tipo, quantidade, tamanho,
         observacao, usuario_id, usuario_nome)
      VALUES (v_empresa, v_item, cod, 'entrada', COALESCE(v_qtd, 1), v_tam,
              nullif(p_payload->>'observacao', ''), v_uid, v_nome);

      v_criadas := v_criadas + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'item_estoque_id', v_item, 'criadas', v_criadas, 'rejeitadas', v_rej);
END $$;

REVOKE EXECUTE ON FUNCTION public.sup_est_entrada(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sup_est_entrada(jsonb) TO authenticated;

-- ── 5. Conferência ───────────────────────────────────────────────────
SELECT am.codigo, am.nome, am.ativo FROM public.app_menu am
  JOIN public.app_modulo m ON m.id = am.modulo_id
 WHERE m.codigo = 'suprimentos' AND am.ativo ORDER BY am.ordem;

NOTIFY pgrst, 'reload schema';
