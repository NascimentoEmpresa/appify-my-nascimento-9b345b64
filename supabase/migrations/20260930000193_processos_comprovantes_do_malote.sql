-- =========================================================================
-- Jurídico › Processos: comprovantes de pagamento vinculados ao processo
--
-- PEDIDO (18/09/2026, Pablo)
--   Dentro do cadastro do processo, ver os comprovantes de pagamento que já
--   estão no Malote — vinculação AUTOMÁTICA sempre que possível, e opção de
--   anexar/vincular à mão quando não der. Sem subir o mesmo arquivo de novo.
--
-- COMO VINCULA
--   • Automático: a despesa do Malote leva o número CNJ do processo no nome
--     ("ACORDO PARCELA 6 DE 8 ... PROCESSO 0020268-73.2025.5.04.0451"). A RPC
--     extrai o número (regex do CNJ) do nome/descrição/motivo e casa com
--     JUR_PROCESSOS.numero_processo. Hoje: 25 despesas com número, 23 batem.
--   • Manual (despesa existe, mas sem o número no nome): o Jurídico informa o
--     número da despesa (DM-2026-0921) → JUR_PROCESSO_MALOTE_VINCULO.
--   • Manual (arquivo avulso, nada no Malote): upload em JUR_PROCESSO_COMPROVANTE,
--     bucket privado juridico-comprovantes.
--
-- O comprovante em si continua no bucket do Malote (malote-anexos, leitura
-- por qualquer autenticado) — a tela abre por URL assinada, sem cópia.
--
-- ACESSO: mesma régua da JUR_PROCESSOS (has_screen_access 'processos').
-- As RPCs são SECURITY DEFINER porque o Jurídico não passa na RLS do Malote
-- (visibilidade por setor/empresa) — aqui ele só enxerga o recorte do
-- processo, nunca a lista do Malote.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Vínculo manual processo ↔ despesa do Malote ─────────────────────
CREATE TABLE IF NOT EXISTS public."JUR_PROCESSO_MALOTE_VINCULO" (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  processo_id  bigint NOT NULL REFERENCES public."JUR_PROCESSOS"(id) ON DELETE CASCADE,
  despesa_id   uuid   NOT NULL REFERENCES public.malote_despesa(id) ON DELETE CASCADE,
  observacao   text,
  criado_por   uuid DEFAULT auth.uid(),
  criado_por_nome text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (processo_id, despesa_id)
);
ALTER TABLE public."JUR_PROCESSO_MALOTE_VINCULO" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public."JUR_PROCESSO_MALOTE_VINCULO" TO authenticated;
DROP POLICY IF EXISTS jur_processo_malote_vinculo_gate ON public."JUR_PROCESSO_MALOTE_VINCULO";
CREATE POLICY jur_processo_malote_vinculo_gate ON public."JUR_PROCESSO_MALOTE_VINCULO"
  FOR ALL TO authenticated
  USING (has_screen_access(auth.uid(), 'processos', 'visualizar'::app_acao))
  WITH CHECK (has_screen_access(auth.uid(), 'processos', 'visualizar'::app_acao));

-- ── 2) Comprovante avulso (arquivo anexado à mão) ───────────────────────
CREATE TABLE IF NOT EXISTS public."JUR_PROCESSO_COMPROVANTE" (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  processo_id   bigint NOT NULL REFERENCES public."JUR_PROCESSOS"(id) ON DELETE CASCADE,
  nome          text NOT NULL,
  storage_path  text NOT NULL,
  tipo          text,
  tamanho       bigint,
  descricao     text,
  valor         numeric(14,2),
  data_pagamento date,
  criado_por    uuid DEFAULT auth.uid(),
  criado_por_nome text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jur_processo_comprovante_proc_idx ON public."JUR_PROCESSO_COMPROVANTE" (processo_id, id);
ALTER TABLE public."JUR_PROCESSO_COMPROVANTE" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public."JUR_PROCESSO_COMPROVANTE" TO authenticated;
DROP POLICY IF EXISTS jur_processo_comprovante_gate ON public."JUR_PROCESSO_COMPROVANTE";
CREATE POLICY jur_processo_comprovante_gate ON public."JUR_PROCESSO_COMPROVANTE"
  FOR ALL TO authenticated
  USING (has_screen_access(auth.uid(), 'processos', 'visualizar'::app_acao))
  WITH CHECK (has_screen_access(auth.uid(), 'processos', 'visualizar'::app_acao));

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('juridico-comprovantes', 'juridico-comprovantes', false, 26214400)
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS juridico_comprovantes_select ON storage.objects;
CREATE POLICY juridico_comprovantes_select ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'juridico-comprovantes' AND has_screen_access(auth.uid(), 'processos', 'visualizar'::app_acao));
DROP POLICY IF EXISTS juridico_comprovantes_insert ON storage.objects;
CREATE POLICY juridico_comprovantes_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'juridico-comprovantes' AND has_screen_access(auth.uid(), 'processos', 'visualizar'::app_acao));
DROP POLICY IF EXISTS juridico_comprovantes_delete ON storage.objects;
CREATE POLICY juridico_comprovantes_delete ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'juridico-comprovantes' AND has_screen_access(auth.uid(), 'processos', 'visualizar'::app_acao));

-- ── 3) A lista: automático + manual, numa chamada ───────────────────────
CREATE OR REPLACE FUNCTION public.jur_processo_pagamentos(_processo_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_num text;
  v_out jsonb;
BEGIN
  IF NOT has_screen_access(auth.uid(), 'processos', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Sem acesso aos processos.';
  END IF;
  SELECT numero_processo INTO v_num FROM public."JUR_PROCESSOS" WHERE id = _processo_id;
  IF v_num IS NULL THEN RAISE EXCEPTION 'Processo #% não existe.', _processo_id; END IF;

  WITH desp AS (
    SELECT d.*,
           CASE WHEN v.id IS NOT NULL THEN 'malote_manual' ELSE 'malote_auto' END AS origem_vinculo,
           v.id AS vinculo_id
      FROM public.malote_despesa d
      -- O mesmo número pode ter mais de uma linha em JUR_PROCESSOS (carga do
      -- sistema antigo); a tela consolida por número, então aqui também.
      LEFT JOIN public."JUR_PROCESSO_MALOTE_VINCULO" v ON v.despesa_id = d.id
        AND v.processo_id IN (SELECT id FROM public."JUR_PROCESSOS" WHERE numero_processo = v_num)
     WHERE d.deleted_at IS NULL
       AND (v.id IS NOT NULL
            OR (v_num <> '' AND v_num = ANY (
                 -- todo número CNJ que aparece no texto da despesa
                 ARRAY(SELECT m[1] FROM regexp_matches(
                    coalesce(d.nome, '') || ' ' || coalesce(d.descricao, '') || ' ' || coalesce(d.motivo, '') || ' ' || coalesce(d.observacao_pagamento, ''),
                    '(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})', 'g') AS m))))
  )
  SELECT jsonb_build_object(
    'numero_processo', v_num,
    'malote', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'despesa_id', d.id, 'numero', d.numero, 'nome', d.nome, 'status', d.status,
        'valor_total', d.valor_total, 'valor_aprovado', d.valor_aprovado,
        'data_pagamento', d.data_pagamento, 'pago_em', d.pago_em,
        'forma_pagamento', d.forma_pagamento,
        'comprovante_path', d.comprovante_pagamento_path,
        'observacao_pagamento', d.observacao_pagamento,
        'origem', d.origem_vinculo, 'vinculo_id', d.vinculo_id,
        'parcelas', coalesce((
          SELECT jsonb_agg(jsonb_build_object('numero_parcela', p.numero_parcela, 'valor', p.valor, 'data_vencimento', p.data_vencimento,
                                              'status', p.status, 'comprovante_path', p.comprovante_pagamento_path, 'pago_em', p.pago_em, 'data_pagamento_real', p.data_pagamento_real)
                           ORDER BY p.numero_parcela)
            FROM public.malote_despesa_parcela p WHERE p.despesa_id = d.id), '[]'::jsonb)
      ) ORDER BY coalesce(d.pago_em, d.data_pagamento::timestamptz, d.created_at) DESC)
      FROM desp d), '[]'::jsonb),
    'anexos', coalesce((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id DESC) FROM public."JUR_PROCESSO_COMPROVANTE" c
       WHERE c.processo_id IN (SELECT id FROM public."JUR_PROCESSOS" WHERE numero_processo = v_num)), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.jur_processo_pagamentos(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jur_processo_pagamentos(bigint) TO authenticated;

-- ── 4) Vincular à mão pelo número da despesa (DM-2026-0921) ─────────────
CREATE OR REPLACE FUNCTION public.jur_processo_vincular_despesa(_processo_id bigint, _numero_despesa text, _observacao text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_desp public.malote_despesa%ROWTYPE;
  v_nome text;
BEGIN
  IF NOT has_screen_access(auth.uid(), 'processos', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Sem acesso aos processos.';
  END IF;
  SELECT * INTO v_desp FROM public.malote_despesa WHERE upper(btrim(numero)) = upper(btrim(_numero_despesa)) AND deleted_at IS NULL;
  IF v_desp.id IS NULL THEN RAISE EXCEPTION 'Despesa % não encontrada no Malote.', _numero_despesa; END IF;
  SELECT coalesce(display_name, email) INTO v_nome FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public."JUR_PROCESSO_MALOTE_VINCULO" (processo_id, despesa_id, observacao, criado_por_nome)
  VALUES (_processo_id, v_desp.id, nullif(btrim(coalesce(_observacao, '')), ''), v_nome)
  ON CONFLICT (processo_id, despesa_id) DO NOTHING;
  RETURN jsonb_build_object('despesa_id', v_desp.id, 'numero', v_desp.numero, 'nome', v_desp.nome, 'status', v_desp.status, 'tem_comprovante', v_desp.comprovante_pagamento_path IS NOT NULL);
END $fn$;
REVOKE ALL ON FUNCTION public.jur_processo_vincular_despesa(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jur_processo_vincular_despesa(bigint, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.jur_processo_vincular_despesa(bigint, text, text);
-- DROP FUNCTION IF EXISTS public.jur_processo_pagamentos(bigint);
-- DROP POLICY IF EXISTS juridico_comprovantes_select ON storage.objects;
-- DROP POLICY IF EXISTS juridico_comprovantes_insert ON storage.objects;
-- DROP POLICY IF EXISTS juridico_comprovantes_delete ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'juridico-comprovantes';  -- só com o bucket vazio
-- DROP TABLE IF EXISTS public."JUR_PROCESSO_COMPROVANTE";
-- DROP TABLE IF EXISTS public."JUR_PROCESSO_MALOTE_VINCULO";
-- NOTIFY pgrst, 'reload schema';
