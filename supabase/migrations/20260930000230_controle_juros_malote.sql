-- SIS-2026-0524 (Iury, mockup em S:\...\Juros no pagamento e novo sub para
-- juros): "criar a possibilidade do financeiro incluir o valor que a
-- despesa teve de juros no momento do pagamento junto com um submódulo
-- para controle desses valores." Dois pedaços:
--   1. O modal de "Confirmar Pagamento" (malote_pagar_despesa/
--      malote_pagar_parcela) ganha um campo opcional de Juros (R$).
--   2. Novo submódulo "Controle de Juros" (Financeiro), listando toda
--      despesa/parcela paga com juros > 0, com status de cobrança
--      (pendente_cobrar/cobrado) e ação de marcar como cobrado.
--
-- Decisões confirmadas com o usuário:
--   - Juros funciona por despesa (não-parcelada) E por parcela (cada
--     parcela paga com atraso pode ter seu próprio juros) — por isso as
--     colunas entram nas duas tabelas, não só em malote_despesa.
--   - Só entra no controle o que for pago pelo modal de Confirmar
--     Pagamento — nenhum outro caminho de pagamento existe hoje.
--   - "Marcar como cobrado" é só status interno — NÃO gera lançamento no
--     Fluxo de Caixa (cobrança em si acontece fora do sistema).
--   - Menu próprio, semeado pro perfil "Malote" (mesmo público de
--     Pagamento Malote).
--
-- "Vencida"/computado não se aplica aqui (diferente do SIS-2026-0473) — só
-- 2 status reais: pendente_cobrar (padrão ao gravar juros > 0) e cobrado.

-- ── 1. Colunas novas ────────────────────────────────────────────────────
ALTER TABLE public.malote_despesa
  ADD COLUMN valor_juros numeric,
  ADD COLUMN juros_status text CHECK (juros_status IN ('pendente_cobrar', 'cobrado')),
  ADD COLUMN juros_cobrado_em timestamptz,
  ADD COLUMN juros_cobrado_por uuid REFERENCES auth.users(id);

ALTER TABLE public.malote_despesa_parcela
  ADD COLUMN valor_juros numeric,
  ADD COLUMN juros_status text CHECK (juros_status IN ('pendente_cobrar', 'cobrado')),
  ADD COLUMN juros_cobrado_em timestamptz,
  ADD COLUMN juros_cobrado_por uuid REFERENCES auth.users(id);

-- ── 2. malote_pagar_despesa/malote_pagar_parcela ganham _valor_juros ────
-- DEFAULT NULL: não quebra nenhuma chamada existente. NULL/0 = sem juros,
-- não seta juros_status (a linha não aparece no Controle de Juros).
CREATE OR REPLACE FUNCTION public.malote_pagar_despesa(
  _id uuid,
  _data_pagamento date,
  _comprovante_path text,
  _observacao text,
  _rateio_snapshot jsonb DEFAULT '[]'::jsonb,
  _forma_pagamento text DEFAULT NULL,
  _banco_id uuid DEFAULT NULL,
  _valor_juros numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_parcelado boolean;
  v_linha jsonb;
BEGIN
  SELECT status, parcelado INTO v_status, v_parcelado FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;
  IF v_parcelado THEN RAISE EXCEPTION 'Despesa parcelada — pague cada parcela individualmente.'; END IF;
  IF v_status NOT IN ('aguardando_pagamento', 'pronto_para_pagar') THEN
    RAISE EXCEPTION 'Despesa não está em uma etapa de pagamento válida.';
  END IF;
  IF _data_pagamento IS NULL THEN RAISE EXCEPTION 'Data do pagamento é obrigatória.'; END IF;
  IF _comprovante_path IS NULL OR btrim(_comprovante_path) = '' THEN
    RAISE EXCEPTION 'Comprovante de pagamento é obrigatório.';
  END IF;

  IF NOT (
    public.malote_pode_pagar()
    OR public.malote_supervisor_por_cargo(auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para pagar esta despesa.';
  END IF;

  UPDATE public.malote_despesa SET
    status = 'despesa_paga',
    data_pagamento = _data_pagamento,
    comprovante_pagamento_path = _comprovante_path,
    observacao_pagamento = _observacao,
    pago_em = now(),
    pago_por = auth.uid(),
    forma_pagamento = COALESCE(_forma_pagamento, forma_pagamento),
    banco_id = _banco_id,
    valor_juros = _valor_juros,
    juros_status = CASE WHEN _valor_juros > 0 THEN 'pendente_cobrar' ELSE NULL END
  WHERE id = _id;

  FOR v_linha IN SELECT * FROM jsonb_array_elements(_rateio_snapshot)
  LOOP
    UPDATE public.malote_despesa_rateio_linha
    SET orcado_snapshot = (v_linha->>'orcado')::numeric,
        utilizado_com_lancamento_snapshot = (v_linha->>'utilizado_com_lancamento')::numeric,
        congelado_em = now()
    WHERE id = (v_linha->>'linha_id')::uuid
      AND despesa_id = _id
      AND congelado_em IS NULL;
  END LOOP;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, ator_user_id)
  VALUES (_id, 'despesa_paga', _observacao, auth.uid());
END;
$$;

REVOKE ALL ON FUNCTION public.malote_pagar_despesa(uuid, date, text, text, jsonb, text, uuid, numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.malote_pagar_despesa(uuid, date, text, text, jsonb, text, uuid, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.malote_pagar_parcela(
  _despesa_id uuid,
  _parcela_id uuid,
  _data_pagamento date,
  _comprovante_path text,
  _observacao text,
  _rateio_snapshot jsonb DEFAULT '[]'::jsonb,
  _forma_pagamento text DEFAULT NULL,
  _banco_id uuid DEFAULT NULL,
  _valor_juros numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status_despesa text;
  v_status_parcela text;
  v_parcela_despesa_id uuid;
  v_numero_parcela int;
  v_total_parcelas int;
  v_linha jsonb;
  v_restantes int;
BEGIN
  SELECT status INTO v_status_despesa FROM public.malote_despesa WHERE id = _despesa_id;
  IF v_status_despesa IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;
  IF v_status_despesa NOT IN ('aguardando_pagamento', 'pronto_para_pagar') THEN
    RAISE EXCEPTION 'Despesa não está em uma etapa de pagamento válida.';
  END IF;

  SELECT status, despesa_id, numero_parcela INTO v_status_parcela, v_parcela_despesa_id, v_numero_parcela
  FROM public.malote_despesa_parcela WHERE id = _parcela_id FOR UPDATE;
  IF v_status_parcela IS NULL THEN RAISE EXCEPTION 'Parcela não encontrada.'; END IF;
  IF v_parcela_despesa_id <> _despesa_id THEN RAISE EXCEPTION 'Parcela não pertence a esta despesa.'; END IF;
  IF v_status_parcela = 'paga' THEN RAISE EXCEPTION 'Parcela já está paga.'; END IF;

  IF _data_pagamento IS NULL THEN RAISE EXCEPTION 'Data do pagamento é obrigatória.'; END IF;
  IF _comprovante_path IS NULL OR btrim(_comprovante_path) = '' THEN
    RAISE EXCEPTION 'Comprovante de pagamento é obrigatório.';
  END IF;

  IF NOT (
    public.malote_pode_pagar()
    OR public.malote_supervisor_por_cargo(auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para pagar esta parcela.';
  END IF;

  UPDATE public.malote_despesa_parcela SET
    status = 'paga',
    data_pagamento_real = _data_pagamento,
    comprovante_pagamento_path = _comprovante_path,
    observacao_pagamento = _observacao,
    pago_em = now(),
    pago_por = auth.uid(),
    banco_id = _banco_id,
    valor_juros = _valor_juros,
    juros_status = CASE WHEN _valor_juros > 0 THEN 'pendente_cobrar' ELSE NULL END
  WHERE id = _parcela_id;

  SELECT count(*) INTO v_restantes
  FROM public.malote_despesa_parcela WHERE despesa_id = _despesa_id AND status <> 'paga';

  SELECT count(*) INTO v_total_parcelas
  FROM public.malote_despesa_parcela WHERE despesa_id = _despesa_id;

  IF v_restantes = 0 THEN
    UPDATE public.malote_despesa SET
      status = 'despesa_paga',
      data_pagamento = _data_pagamento,
      comprovante_pagamento_path = _comprovante_path,
      observacao_pagamento = _observacao,
      pago_em = now(),
      pago_por = auth.uid(),
      forma_pagamento = COALESCE(_forma_pagamento, forma_pagamento),
      banco_id = _banco_id
    WHERE id = _despesa_id;

    FOR v_linha IN SELECT * FROM jsonb_array_elements(_rateio_snapshot)
    LOOP
      UPDATE public.malote_despesa_rateio_linha
      SET orcado_snapshot = (v_linha->>'orcado')::numeric,
          utilizado_com_lancamento_snapshot = (v_linha->>'utilizado_com_lancamento')::numeric,
          congelado_em = now()
      WHERE id = (v_linha->>'linha_id')::uuid
        AND despesa_id = _despesa_id
        AND congelado_em IS NULL;
    END LOOP;
  END IF;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, ator_user_id)
  VALUES (
    _despesa_id,
    'despesa_paga',
    coalesce(_observacao || ' — ', '') || format('Parcela %s/%s paga.', v_numero_parcela, v_total_parcelas),
    auth.uid()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.malote_pagar_parcela(uuid, uuid, date, text, text, jsonb, text, uuid, numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.malote_pagar_parcela(uuid, uuid, date, text, text, jsonb, text, uuid, numeric) TO authenticated;

-- ── 3. RPC: marcar juros como cobrado (despesa ou parcela) ──────────────
-- Não usa RLS de UPDATE de malote_despesa/malote_despesa_parcela (essas
-- são restritas a created_by/lançador/admin) — quem trabalha Controle de
-- Juros normalmente não é nada disso, então a checagem é a própria
-- permissão do menu novo, feita aqui dentro (SECURITY DEFINER).
CREATE OR REPLACE FUNCTION public.malote_juros_marcar_cobrado(_origem text, _id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-controle-juros', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar o Controle de Juros.';
  END IF;
  IF _origem NOT IN ('despesa', 'parcela') THEN
    RAISE EXCEPTION 'Origem inválida: %', _origem;
  END IF;

  IF _origem = 'despesa' THEN
    UPDATE public.malote_despesa
    SET juros_status = 'cobrado', juros_cobrado_em = now(), juros_cobrado_por = auth.uid()
    WHERE id = _id AND juros_status = 'pendente_cobrar';
  ELSE
    UPDATE public.malote_despesa_parcela
    SET juros_status = 'cobrado', juros_cobrado_em = now(), juros_cobrado_por = auth.uid()
    WHERE id = _id AND juros_status = 'pendente_cobrar';
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro não encontrado ou já cobrado.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.malote_juros_marcar_cobrado(text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.malote_juros_marcar_cobrado(text, uuid) TO authenticated;

-- ── 4. View de listagem — despesa (não-parcelada) UNION parcela ─────────
-- security_invoker = true e sem RLS própria: depende da RLS de SELECT já
-- ampla de malote_despesa (malote_pagamento:aprovar já dá visão ampla —
-- mesmo público que vai usar esta tela) e malote_despesa_parcela (mesma
-- condição, ver malote_parcela_all). Não precisa de policy nova.
CREATE VIEW public.v_controle_juros_malote AS
SELECT
  d.id AS despesa_id,
  NULL::uuid AS parcela_id,
  d.numero,
  d.data_pagamento,
  d.classificacao_id,
  cl.nome AS classificacao_nome,
  d.nome AS nome_despesa,
  d.valor_juros,
  d.created_by AS solicitante_id,
  COALESCE(p.display_name, p.email) AS solicitante_nome,
  d.juros_status,
  d.juros_cobrado_em,
  NULL::int AS numero_parcela,
  NULL::int AS numero_parcelas
FROM public.malote_despesa d
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = d.classificacao_id
LEFT JOIN public.profiles p ON p.id = d.created_by
WHERE d.valor_juros IS NOT NULL AND d.valor_juros > 0 AND NOT d.parcelado

UNION ALL

SELECT
  d.id AS despesa_id,
  mp.id AS parcela_id,
  d.numero,
  mp.data_pagamento_real AS data_pagamento,
  d.classificacao_id,
  cl.nome AS classificacao_nome,
  d.nome AS nome_despesa,
  mp.valor_juros,
  d.created_by AS solicitante_id,
  COALESCE(p.display_name, p.email) AS solicitante_nome,
  mp.juros_status,
  mp.juros_cobrado_em,
  mp.numero_parcela,
  d.numero_parcelas
FROM public.malote_despesa_parcela mp
JOIN public.malote_despesa d ON d.id = mp.despesa_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = d.classificacao_id
LEFT JOIN public.profiles p ON p.id = d.created_by
WHERE mp.valor_juros IS NOT NULL AND mp.valor_juros > 0;

ALTER VIEW public.v_controle_juros_malote SET (security_invoker = true);
GRANT SELECT ON public.v_controle_juros_malote TO authenticated;

-- ── 5. Menu + permissão (J2: seed obrigatório) ──────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'financeiro-controle-juros', 'Financeiro — Controle de Juros',
  '/app/financeiro/controle-juros', 36
FROM public.app_modulo m WHERE m.codigo = 'financeiro'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'financeiro-controle-juros', acao.nome::public.app_acao, true
FROM public.perfil_acesso pa
CROSS JOIN (VALUES ('visualizar'), ('incluir'), ('alterar'), ('exportar')) AS acao(nome)
WHERE pa.nome = 'Malote'
ON CONFLICT (perfil_id, menu_codigo, acao) DO UPDATE SET allow = true;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'financeiro-controle-juros';
--   DELETE FROM public.app_menu WHERE codigo = 'financeiro-controle-juros';
--   DROP VIEW IF EXISTS public.v_controle_juros_malote;
--   DROP FUNCTION IF EXISTS public.malote_juros_marcar_cobrado(text, uuid);
--   DROP FUNCTION IF EXISTS public.malote_pagar_parcela(uuid, uuid, date, text, text, jsonb, text, uuid, numeric);
--   DROP FUNCTION IF EXISTS public.malote_pagar_despesa(uuid, date, text, text, jsonb, text, uuid, numeric);
--   -- (recriar as duas com a assinatura anterior, 7 parâmetros, ver
--   -- 20260930000039_malote_pagamento_banco.sql)
--   ALTER TABLE public.malote_despesa_parcela
--     DROP COLUMN IF EXISTS valor_juros, DROP COLUMN IF EXISTS juros_status,
--     DROP COLUMN IF EXISTS juros_cobrado_em, DROP COLUMN IF EXISTS juros_cobrado_por;
--   ALTER TABLE public.malote_despesa
--     DROP COLUMN IF EXISTS valor_juros, DROP COLUMN IF EXISTS juros_status,
--     DROP COLUMN IF EXISTS juros_cobrado_em, DROP COLUMN IF EXISTS juros_cobrado_por;
-- =====================================================================
