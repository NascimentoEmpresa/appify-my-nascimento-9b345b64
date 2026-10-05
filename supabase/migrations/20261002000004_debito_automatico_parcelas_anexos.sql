-- SIS-2026-0570 (Iury): parcelamento, ajuste de vencimento e anexos no Débito
-- Automático.
--
-- Decisões desta entrega (combinadas com o usuário):
--   • Parcelamento = N linhas em "DEBITO_AUTOMATICO", ligadas por
--     grupo_parcelas_id (numero_parcela / total_parcelas). Cada parcela é
--     paga, editada e anexada sozinha. Valores e datas automáticos ou manuais
--     são calculados na tela; a RPC só grava o que a tela mandar.
--   • Só PAGAS vão pro Fluxo de Caixa — já era a regra da view
--     v_debito_automatico_fluxo_caixa (WHERE status = 'pago'); parcela futura
--     fica de fora até ser paga. A aba "A vencer" da tela cobre o resto.
--   • O Débito Automático passa a alimentar SÓ o Fluxo: a criação deixa de
--     espelhar no Malote (reverte a parte de criação do SIS-2026-0444) e a
--     edição deixa de sincronizar com ele. Os 12 espelhos que já existiam
--     foram pra Lixeira do Malote e desvinculados fora desta migration.
--   • Anexos por linha: "lancamento" (nota/boleto) e "comprovante". Parcela
--     só pode ser paga com um comprovante PRÓPRIO — cada parcela, um arquivo.
--   • data_vencimento é separada de data_pagamento: vencimento é o prazo
--     original; data_pagamento é a data que vai pro Fluxo (ao pagar, a tela
--     sugere o vencimento e a analista corrige se pagou em outro dia).

-- ── 1. Colunas ───────────────────────────────────────────────────────────
ALTER TABLE public."DEBITO_AUTOMATICO"
  ADD COLUMN IF NOT EXISTS data_vencimento date,
  ADD COLUMN IF NOT EXISTS grupo_parcelas_id uuid,
  ADD COLUMN IF NOT EXISTS numero_parcela int,
  ADD COLUMN IF NOT EXISTS total_parcelas int;

CREATE INDEX IF NOT EXISTS idx_debito_automatico_grupo ON public."DEBITO_AUTOMATICO"(grupo_parcelas_id)
  WHERE grupo_parcelas_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_debito_automatico_a_vencer ON public."DEBITO_AUTOMATICO"(data_vencimento)
  WHERE status = 'pendente';

-- ── 2. View de lista: colunas novas só no FINAL (CREATE OR REPLACE) ──────
CREATE OR REPLACE VIEW public.v_debito_automatico_lista AS
SELECT
  d.id,
  d.numero,
  d.tipo_origem,
  d.tipo,
  d.data_pagamento,
  d.competencia,
  d.empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  d.contrato_id,
  c.nome AS contrato_nome,
  d.classificacao_id,
  cl.nome AS classificacao_nome,
  d.descricao,
  d.forma_pagamento,
  d.valor,
  d.status,
  d.movimentacao_par_id,
  d.created_by,
  d.created_at,
  d.updated_by,
  d.updated_at,
  d.banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  d.deleted_at,
  d.deleted_por,
  d.data_vencimento,
  d.grupo_parcelas_id,
  d.numero_parcela,
  d.total_parcelas
FROM public."DEBITO_AUTOMATICO" d
LEFT JOIN public.empresas e ON e.id = d.empresa_id
LEFT JOIN public.contratos c ON c.id = d.contrato_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = d.classificacao_id
LEFT JOIN public.malote_cartao_banco cb ON cb.id = d.banco_id;

-- ── 3. Anexos ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."DEBITO_AUTOMATICO_ANEXO" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debito_id uuid NOT NULL REFERENCES public."DEBITO_AUTOMATICO"(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('lancamento', 'comprovante')),
  nome_arquivo text NOT NULL,
  storage_path text NOT NULL,
  tamanho_bytes bigint,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_debito_automatico_anexo_debito ON public."DEBITO_AUTOMATICO_ANEXO"(debito_id, tipo);

ALTER TABLE public."DEBITO_AUTOMATICO_ANEXO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS debito_automatico_anexo_select ON public."DEBITO_AUTOMATICO_ANEXO";
CREATE POLICY debito_automatico_anexo_select ON public."DEBITO_AUTOMATICO_ANEXO"
  FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'visualizar'));

DROP POLICY IF EXISTS debito_automatico_anexo_insert ON public."DEBITO_AUTOMATICO_ANEXO";
CREATE POLICY debito_automatico_anexo_insert ON public."DEBITO_AUTOMATICO_ANEXO"
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'incluir')
    OR public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'alterar')
  );

DROP POLICY IF EXISTS debito_automatico_anexo_delete ON public."DEBITO_AUTOMATICO_ANEXO";
CREATE POLICY debito_automatico_anexo_delete ON public."DEBITO_AUTOMATICO_ANEXO"
  FOR DELETE TO authenticated
  USING (public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'alterar'));

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('debito-automatico-anexos', 'debito-automatico-anexos', false, 20971520) -- 20 MB
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "debito automatico anexo select" ON storage.objects;
CREATE POLICY "debito automatico anexo select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'debito-automatico-anexos'
    AND public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'visualizar')
  );

DROP POLICY IF EXISTS "debito automatico anexo insert" ON storage.objects;
CREATE POLICY "debito automatico anexo insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'debito-automatico-anexos'
    AND (
      public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'incluir')
      OR public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'alterar')
    )
  );

DROP POLICY IF EXISTS "debito automatico anexo delete" ON storage.objects;
CREATE POLICY "debito automatico anexo delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'debito-automatico-anexos'
    AND public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'alterar')
  );

-- ── 4. Criação simples: mesma assinatura de 20260930000282, SEM espelho no
--      Malote (o Débito Automático alimenta só o Fluxo de Caixa) ───────────
CREATE OR REPLACE FUNCTION public.debito_automatico_criar_debito(
  _data_pagamento date, _competencia date, _tipo text,
  _empresa_id uuid, _contrato_id uuid, _classificacao_id uuid,
  _descricao text, _forma_pagamento text, _valor numeric, _banco_id uuid,
  _status text DEFAULT 'pendente'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para incluir Débito Automático.';
  END IF;
  IF _banco_id IS NULL THEN
    RAISE EXCEPTION 'Informe o banco.';
  END IF;
  IF _status NOT IN ('pendente', 'pago') THEN
    RAISE EXCEPTION 'Status inválido: %', _status;
  END IF;

  INSERT INTO public."DEBITO_AUTOMATICO" (
    tipo_origem, tipo, data_pagamento, data_vencimento, competencia, empresa_id, contrato_id,
    classificacao_id, descricao, forma_pagamento, valor, banco_id, status, created_by
  ) VALUES (
    'debito_automatico', _tipo, _data_pagamento, _data_pagamento, _competencia, _empresa_id, _contrato_id,
    _classificacao_id, _descricao, _forma_pagamento, _valor, _banco_id, _status, auth.uid()
  ) RETURNING id INTO v_id;

  INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
  VALUES (v_id, 'criacao', auth.uid(), 'Débito Automático criado.');

  RETURN v_id;
END;
$$;

-- ── 5. Criação parcelada ─────────────────────────────────────────────────
-- _parcelas: [{"valor": 100.00, "data_vencimento": "2026-11-10"}, ...] já
-- calculado pela tela (automático ou manual). Todas nascem 'pendente' — só
-- entram no Fluxo quando forem pagas. Competência de cada parcela = mês do
-- vencimento. Mesmo "numero" visível pro grupo todo (padrão da Movimentação
-- Financeira), com "PARC n/N" na descrição pra aparecer assim no Fluxo.
CREATE OR REPLACE FUNCTION public.debito_automatico_criar_parcelado(
  _tipo text, _empresa_id uuid, _contrato_id uuid, _classificacao_id uuid,
  _descricao text, _forma_pagamento text, _banco_id uuid, _parcelas jsonb
) RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_total int;
  v_grupo uuid := gen_random_uuid();
  v_numero text;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_p jsonb;
  v_n int := 0;
  v_venc date;
  v_valor numeric;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para incluir Débito Automático.';
  END IF;
  IF _banco_id IS NULL THEN
    RAISE EXCEPTION 'Informe o banco.';
  END IF;
  IF _parcelas IS NULL OR jsonb_typeof(_parcelas) <> 'array' OR jsonb_array_length(_parcelas) < 2 THEN
    RAISE EXCEPTION 'Informe ao menos 2 parcelas.';
  END IF;
  v_total := jsonb_array_length(_parcelas);

  v_numero := 'DA-' || to_char(now(), 'YYYY') || '-' ||
    lpad(nextval('public.debito_automatico_numero_seq')::text, 4, '0');

  FOR v_p IN SELECT * FROM jsonb_array_elements(_parcelas) LOOP
    v_n := v_n + 1;
    v_valor := (v_p->>'valor')::numeric;
    v_venc := (v_p->>'data_vencimento')::date;
    IF v_valor IS NULL OR v_valor <= 0 THEN
      RAISE EXCEPTION 'Parcela % com valor inválido.', v_n;
    END IF;
    IF v_venc IS NULL THEN
      RAISE EXCEPTION 'Parcela % sem data de vencimento.', v_n;
    END IF;

    INSERT INTO public."DEBITO_AUTOMATICO" (
      numero, tipo_origem, tipo, data_pagamento, data_vencimento, competencia, empresa_id, contrato_id,
      classificacao_id, descricao, forma_pagamento, valor, banco_id, status,
      grupo_parcelas_id, numero_parcela, total_parcelas, created_by
    ) VALUES (
      v_numero, 'debito_automatico', _tipo, v_venc, v_venc, date_trunc('month', v_venc)::date, _empresa_id, _contrato_id,
      _classificacao_id, _descricao || ' - PARC ' || v_n || '/' || v_total, _forma_pagamento, v_valor, _banco_id, 'pendente',
      v_grupo, v_n, v_total, auth.uid()
    ) RETURNING id INTO v_id;

    INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
    VALUES (v_id, 'criacao', auth.uid(), format('Débito Automático parcelado criado (parcela %s de %s).', v_n, v_total));

    v_ids := v_ids || v_id;
  END LOOP;

  RETURN v_ids;
END;
$$;

-- ── 6. Edição: mesma de 20260930000181, + data_vencimento, SEM sync com o
--      Malote (o espelho deixou de existir) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.debito_automatico_editar(_id uuid, _campos jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_antes public."DEBITO_AUTOMATICO"%ROWTYPE;
  v_diff text := '';
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para editar Débito Automático.';
  END IF;

  SELECT * INTO v_antes FROM public."DEBITO_AUTOMATICO" WHERE id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro não encontrado: %', _id;
  END IF;

  UPDATE public."DEBITO_AUTOMATICO" SET
    data_pagamento    = COALESCE((_campos->>'data_pagamento')::date, data_pagamento),
    data_vencimento   = COALESCE((_campos->>'data_vencimento')::date, data_vencimento),
    competencia       = COALESCE((_campos->>'competencia')::date, competencia),
    empresa_id        = COALESCE((_campos->>'empresa_id')::uuid, empresa_id),
    contrato_id       = CASE WHEN _campos ? 'contrato_id' THEN (_campos->>'contrato_id')::uuid ELSE contrato_id END,
    classificacao_id  = COALESCE((_campos->>'classificacao_id')::uuid, classificacao_id),
    descricao         = COALESCE(_campos->>'descricao', descricao),
    forma_pagamento   = COALESCE(_campos->>'forma_pagamento', forma_pagamento),
    valor             = COALESCE((_campos->>'valor')::numeric, valor),
    status            = COALESCE(_campos->>'status', status),
    banco_id          = COALESCE((_campos->>'banco_id')::uuid, banco_id),
    updated_by        = auth.uid()
  WHERE id = _id;

  IF _campos ? 'valor' AND (_campos->>'valor')::numeric IS DISTINCT FROM v_antes.valor THEN
    v_diff := v_diff || format('Valor: R$ %s → R$ %s. ', v_antes.valor, _campos->>'valor');
  END IF;
  IF _campos ? 'status' AND (_campos->>'status') IS DISTINCT FROM v_antes.status THEN
    v_diff := v_diff || format('Status: %s → %s. ', v_antes.status, _campos->>'status');
  END IF;
  IF _campos ? 'data_pagamento' AND (_campos->>'data_pagamento')::date IS DISTINCT FROM v_antes.data_pagamento THEN
    v_diff := v_diff || format('Data de pagamento: %s → %s. ', v_antes.data_pagamento, _campos->>'data_pagamento');
  END IF;
  IF _campos ? 'data_vencimento' AND (_campos->>'data_vencimento')::date IS DISTINCT FROM v_antes.data_vencimento THEN
    v_diff := v_diff || format('Vencimento: %s → %s. ', v_antes.data_vencimento, _campos->>'data_vencimento');
  END IF;
  IF _campos ? 'descricao' AND (_campos->>'descricao') IS DISTINCT FROM v_antes.descricao THEN
    v_diff := v_diff || format('Descrição: "%s" → "%s". ', v_antes.descricao, _campos->>'descricao');
  END IF;
  IF _campos ? 'banco_id' AND (_campos->>'banco_id')::uuid IS DISTINCT FROM v_antes.banco_id THEN
    v_diff := v_diff || 'Banco alterado. ';
  END IF;

  INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
  VALUES (_id, 'edicao', auth.uid(), NULLIF(btrim(v_diff), ''));

  IF _campos ? 'status' AND (_campos->>'status') = 'pago' AND v_antes.status IS DISTINCT FROM 'pago' THEN
    INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
    VALUES (_id, 'pagamento', auth.uid(), 'Marcado como pago — enviado para o Fluxo de Caixa.');
  END IF;
END;
$$;

-- ── 7. Pagar (usado pela aba "A vencer") ─────────────────────────────────
-- Parcela só paga com comprovante PRÓPRIO anexado (tipo 'comprovante'); débito
-- avulso não exige — mesmo comportamento de antes. A data informada é a que
-- vai pro Fluxo de Caixa.
CREATE OR REPLACE FUNCTION public.debito_automatico_pagar(_id uuid, _data_pagamento date)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row public."DEBITO_AUTOMATICO"%ROWTYPE;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para pagar Débito Automático.';
  END IF;
  IF _data_pagamento IS NULL THEN
    RAISE EXCEPTION 'Informe a data do pagamento.';
  END IF;

  SELECT * INTO v_row FROM public."DEBITO_AUTOMATICO" WHERE id = _id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro não encontrado: %', _id;
  END IF;
  IF v_row.status = 'pago' THEN
    RAISE EXCEPTION 'Este lançamento já está pago.';
  END IF;
  IF v_row.grupo_parcelas_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public."DEBITO_AUTOMATICO_ANEXO" WHERE debito_id = _id AND tipo = 'comprovante'
  ) THEN
    RAISE EXCEPTION 'Anexe o comprovante desta parcela antes de pagar.';
  END IF;

  UPDATE public."DEBITO_AUTOMATICO"
     SET status = 'pago', data_pagamento = _data_pagamento, updated_by = auth.uid()
   WHERE id = _id;

  INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
  VALUES (_id, 'pagamento', auth.uid(),
    format('Pago em %s — enviado para o Fluxo de Caixa.', to_char(_data_pagamento, 'DD/MM/YYYY')));
END;
$$;

REVOKE ALL ON FUNCTION public.debito_automatico_criar_parcelado FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.debito_automatico_pagar FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debito_automatico_criar_parcelado TO authenticated;
GRANT EXECUTE ON FUNCTION public.debito_automatico_pagar TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.debito_automatico_pagar(uuid, date);
-- DROP FUNCTION IF EXISTS public.debito_automatico_criar_parcelado(text, uuid, uuid, uuid, text, text, uuid, jsonb);
-- -- recriar debito_automatico_criar_debito e debito_automatico_editar com o corpo de
-- -- 20260930000181 (com espelho/sincronização do Malote) + _status de 20260930000282;
-- -- recriar v_debito_automatico_lista com o corpo de 20260930000163 (sem as 4 colunas novas)
-- DROP POLICY IF EXISTS "debito automatico anexo select" ON storage.objects;
-- DROP POLICY IF EXISTS "debito automatico anexo insert" ON storage.objects;
-- DROP POLICY IF EXISTS "debito automatico anexo delete" ON storage.objects;
-- DROP TABLE IF EXISTS public."DEBITO_AUTOMATICO_ANEXO";
-- ALTER TABLE public."DEBITO_AUTOMATICO"
--   DROP COLUMN IF EXISTS data_vencimento, DROP COLUMN IF EXISTS grupo_parcelas_id,
--   DROP COLUMN IF EXISTS numero_parcela, DROP COLUMN IF EXISTS total_parcelas;
