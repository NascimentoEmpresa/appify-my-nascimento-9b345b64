-- =========================================================================
-- SIS-2026-0222 — Laudo do SST e controle de CA de EPI
--
-- O laudo define a validade mínima que o CA precisa ter no recebimento. O CA
-- fica na etiqueta física porque remessas do mesmo material podem ter
-- certificados e vencimentos diferentes.
--
-- Idempotente.
-- ROLLBACK:
--   DELETE FROM public.perfil_acesso_permissao
--    WHERE menu_codigo IN ('sst_laudo', 'sst_ca');
--   DELETE FROM public.app_menu WHERE codigo IN ('sst_laudo', 'sst_ca');
--   DROP POLICY IF EXISTS sst_laudo_select ON public.sst_laudo_epi;
--   DROP FUNCTION IF EXISTS public.sst_laudo_inativar(uuid, text);
--   DROP FUNCTION IF EXISTS public.sst_laudo_emitir(uuid, integer, text, text, text, text);
--   DROP FUNCTION IF EXISTS public.sst_ca_entregue(integer);
--   DROP FUNCTION IF EXISTS public.sst_ca_estoque(integer);
--   DROP FUNCTION IF EXISTS public.sst_situacao_ca(date, integer);
--   DROP INDEX IF EXISTS public.idx_sup_tag_ca_validade;
--   ALTER TABLE public.sup_estoque_tag DROP COLUMN IF EXISTS ca_validade;
--   ALTER TABLE public.sup_estoque_tag DROP COLUMN IF EXISTS ca_numero;
--   DROP TABLE IF EXISTS public.sst_laudo_epi;
--   -- Restaurar sup_est_entrada a partir de 20260823000001_supply_fornecedores.sql.
-- =========================================================================

-- ── 1) Laudos de EPI ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sst_laudo_epi (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sup_item_id           uuid NOT NULL REFERENCES public.sup_item(id) ON DELETE CASCADE,
  validade_minima_meses integer NOT NULL CHECK (validade_minima_meses > 0),
  ca_referencia         text,
  riscos                text NOT NULL,
  especificacao         text,
  observacoes           text,
  ativo                 boolean NOT NULL DEFAULT true,
  emitido_por           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  emitido_por_nome      text,
  emitido_em            timestamptz NOT NULL DEFAULT now(),
  inativado_por         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  inativado_em          timestamptz,
  motivo_inativacao     text
);

CREATE INDEX IF NOT EXISTS idx_sst_laudo_item
  ON public.sst_laudo_epi(sup_item_id, ativo);

-- Um material só pode ter um laudo ativo; os anteriores ficam no histórico.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sst_laudo_ativo
  ON public.sst_laudo_epi(sup_item_id) WHERE ativo;

GRANT SELECT ON public.sst_laudo_epi TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.sst_laudo_epi FROM authenticated, anon;

-- ── 2) CA por etiqueta física ────────────────────────────────────────────

ALTER TABLE public.sup_estoque_tag
  ADD COLUMN IF NOT EXISTS ca_numero   text,
  ADD COLUMN IF NOT EXISTS ca_validade date;

CREATE INDEX IF NOT EXISTS idx_sup_tag_ca_validade
  ON public.sup_estoque_tag(ca_validade)
  WHERE ca_validade IS NOT NULL AND NOT usado;

-- ── 3) Situação única do CA ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sst_situacao_ca(
  p_validade date,
  p_dias_alerta integer DEFAULT 60
)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_validade IS NULL                                  THEN 'sem_ca'
    WHEN p_validade < CURRENT_DATE                           THEN 'vencido'
    -- O próprio dia da validade ainda vale; a antecedência começa amanhã.
    WHEN p_validade = CURRENT_DATE                           THEN 'valido'
    WHEN p_validade <= CURRENT_DATE + p_dias_alerta          THEN 'vencendo'
    ELSE 'valido'
  END;
$$;

-- ── 4) Entrada de estoque com CA ─────────────────────────────────────────
--
-- A ocorrência vigente de sup_est_entrada antes desta migration é a de
-- 20260823000001_supply_fornecedores.sql. O corpo abaixo preserva
-- fornecedor_id e acrescenta somente a leitura, validação e gravação do CA.

CREATE OR REPLACE FUNCTION public.sup_est_entrada(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid                     uuid := auth.uid();
  v_nome                    text := public.sup_est_nome_usuario();
  v_almox                   uuid := (p_payload->>'almoxarifado_id')::uuid;
  v_mat                     uuid := (p_payload->>'sup_item_id')::uuid;
  v_forn                    uuid := nullif(p_payload->>'fornecedor_id', '')::uuid;
  v_empresa                 uuid;
  v_item                    uuid;
  v_seq                     int;
  v_criadas                 int := 0;
  v_rej                     jsonb := '[]'::jsonb;
  v_validade_minima_meses   integer;
  v_ca_numero               text;
  v_ca_validade             date;
  u                         jsonb;
  cod                       text;
  v_tipo                    text;
  v_qtd                     int;
  v_tam                     text;
  v_valor                   numeric;
  r_exist                   record;
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

  SELECT l.validade_minima_meses
    INTO v_validade_minima_meses
    FROM public.sst_laudo_epi l
   WHERE l.sup_item_id = v_mat
     AND l.ativo;

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
    v_tipo        := COALESCE(u->>'tipo', 'unico');
    v_tam         := nullif(u->>'tamanho', '');
    v_valor       := nullif(u->>'valor_unitario', '')::numeric;
    v_ca_numero   := nullif(trim(u->>'ca_numero'), '');
    v_ca_validade := nullif(u->>'ca_validade', '')::date;

    IF v_validade_minima_meses IS NOT NULL AND v_ca_validade IS NULL THEN
      RAISE EXCEPTION 'EPI com laudo do SST exige a validade do CA na entrada';
    END IF;
    IF v_validade_minima_meses IS NOT NULL
       AND v_ca_validade < CURRENT_DATE + make_interval(months => v_validade_minima_meses) THEN
      RAISE EXCEPTION 'CA vence em %, antes do mínimo de % meses exigido pelo laudo do SST',
        v_ca_validade, v_validade_minima_meses;
    END IF;

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
         quantidade_massa, quantidade_original_massa, valor_unitario, estado,
         ca_numero, ca_validade)
      VALUES (v_item, cod, v_tam, v_seq, v_tipo,
              v_qtd, v_qtd, v_valor,
              COALESCE(nullif(u->>'estado', ''), 'novo'),
              v_ca_numero, v_ca_validade);

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

REVOKE ALL ON FUNCTION public.sup_est_entrada(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_est_entrada(jsonb) TO authenticated;

-- ── 5) Painéis de CA ─────────────────────────────────────────────────────

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
    LEFT JOIN public.sst_laudo_epi l ON l.sup_item_id = i.id AND l.ativo
   WHERE i.tipo = 'epi'
     AND NOT t.usado
     AND (public.can_access(auth.uid(), 'sst_ca', 'visualizar')
          OR public.can_access(auth.uid(), 'sup_estoque', 'visualizar'))
   ORDER BY (t.ca_validade IS NULL), t.ca_validade NULLS LAST;
$$;

CREATE OR REPLACE FUNCTION public.sst_ca_entregue(p_dias_alerta integer DEFAULT 60)
RETURNS TABLE (
  colaborador text, matricula text, contrato text,
  material text, codigo text, ca_numero text, ca_validade date,
  situacao text, dias_restantes integer, entregue_em timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.nome_colaborador, p.matricula_colaborador, p.contrato_nome,
         i.nome, t.codigo, t.ca_numero, t.ca_validade,
         public.sst_situacao_ca(t.ca_validade, p_dias_alerta),
         (t.ca_validade - CURRENT_DATE)::integer, t.usado_em
    FROM public.sup_estoque_tag t
    JOIN public.sup_estoque_item ei ON ei.id = t.item_estoque_id
    JOIN public.sup_item i          ON i.id  = ei.sup_item_id
    JOIN public.sup_pedido p        ON p.id  = t.pedido_id
   WHERE i.tipo = 'epi'
     AND t.usado
     AND t.ca_validade IS NOT NULL
     AND t.ca_validade <= CURRENT_DATE + p_dias_alerta
     AND (public.can_access(auth.uid(), 'sst_ca', 'visualizar')
          OR public.can_access(auth.uid(), 'sup_estoque', 'visualizar'))
   ORDER BY t.ca_validade;
$$;

-- ── 6) Emissão e inativação de laudo ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sst_laudo_emitir(
  p_sup_item_id uuid,
  p_validade_minima_meses integer,
  p_riscos text,
  p_ca_referencia text,
  p_especificacao text,
  p_observacoes text
)
RETURNS public.sst_laudo_epi
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_laudo public.sst_laudo_epi;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sst_laudo', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para emitir laudo de EPI';
  END IF;
  IF nullif(trim(p_riscos), '') IS NULL THEN
    RAISE EXCEPTION 'Informe os riscos que este EPI protege';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sup_item i WHERE i.id = p_sup_item_id AND i.tipo = 'epi'
  ) THEN
    RAISE EXCEPTION 'Laudo de SST só se aplica a EPI';
  END IF;

  UPDATE public.sst_laudo_epi
     SET ativo = false,
         inativado_por = v_uid,
         inativado_em = now(),
         motivo_inativacao = 'Substituído por novo laudo'
   WHERE sup_item_id = p_sup_item_id
     AND ativo;

  INSERT INTO public.sst_laudo_epi (
    sup_item_id, validade_minima_meses, ca_referencia, riscos,
    especificacao, observacoes, emitido_por, emitido_por_nome
  )
  VALUES (
    p_sup_item_id, p_validade_minima_meses,
    nullif(trim(p_ca_referencia), ''), trim(p_riscos),
    nullif(trim(p_especificacao), ''), nullif(trim(p_observacoes), ''),
    v_uid, public.sup_malote_nome_ator()
  )
  RETURNING * INTO v_laudo;

  RETURN v_laudo;
END $$;

CREATE OR REPLACE FUNCTION public.sst_laudo_inativar(p_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sst_laudo', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para inativar laudo de EPI';
  END IF;
  IF nullif(trim(p_motivo), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da inativação';
  END IF;

  UPDATE public.sst_laudo_epi
     SET ativo = false,
         inativado_por = v_uid,
         inativado_em = now(),
         motivo_inativacao = trim(p_motivo)
   WHERE id = p_id;
END $$;

-- ── 7) RLS: leitura permitida aos públicos definidos; escrita só por RPC ─

ALTER TABLE public.sst_laudo_epi ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sst_laudo_select ON public.sst_laudo_epi;
CREATE POLICY sst_laudo_select ON public.sst_laudo_epi
  FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'sst_laudo', 'visualizar')
    OR public.can_access(auth.uid(), 'sst_ca', 'visualizar')
    OR public.can_access(auth.uid(), 'sup_estoque', 'visualizar')
    OR public.can_access(auth.uid(), 'sup_cotacoes_malote', 'visualizar')
  );

-- ── 8) Menus e deny-by-default ───────────────────────────────────────────

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sst_laudo', 'Laudos de EPI', '/app/sst/laudos',
       COALESCE((SELECT max(ordem) FROM public.app_menu WHERE modulo_id = m.id), 0) + 10,
       true
  FROM public.app_modulo m
 WHERE m.codigo = 'sst'
ON CONFLICT (modulo_id, codigo) DO UPDATE
   SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ativo = true;

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sst_ca', 'Controle de CA', '/app/sst/controle-ca',
       COALESCE((SELECT max(ordem) FROM public.app_menu WHERE modulo_id = m.id), 0) + 10,
       true
  FROM public.app_modulo m
 WHERE m.codigo = 'sst'
ON CONFLICT (modulo_id, codigo) DO UPDATE
   SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ativo = true;

-- Uma regra apenas no perfil concede_tudo marca os menus como configurados:
-- usuários comuns ficam sem acesso até a liberação em Acesso por Usuário.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, menu.codigo, acao.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES ('sst_laudo'), ('sst_ca')) AS menu(codigo)
 CROSS JOIN (VALUES
    ('visualizar'::public.app_acao),
    ('incluir'::public.app_acao),
    ('alterar'::public.app_acao),
    ('excluir'::public.app_acao)
 ) AS acao(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- ── 9) Privilégios das funções ───────────────────────────────────────────

REVOKE ALL ON FUNCTION public.sst_situacao_ca(date, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sst_ca_estoque(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sst_ca_entregue(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sst_laudo_emitir(uuid, integer, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sst_laudo_inativar(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.sst_situacao_ca(date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sst_ca_estoque(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sst_ca_entregue(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sst_laudo_emitir(uuid, integer, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sst_laudo_inativar(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
