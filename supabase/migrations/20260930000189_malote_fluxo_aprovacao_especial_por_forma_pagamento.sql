-- SIS-2026-0439 (Iury): compra no cartão de crédito já foi feita na hora —
-- não faz sentido passar pelo fluxo normal N1→N2→N3 da Classificação, ela
-- só precisa de UM aprovador fixo antes de ir pro financeiro pagar.
--
-- "Fluxo Especial" fica configurado por FORMA DE PAGAMENTO (malote_forma_
-- pagamento — o catálogo nomeado tipo "Cartão Sicredi 119 - Final 2719",
-- não o tipo genérico "Cartão"), com um aprovador único fixo. Despesa
-- lançada com essa forma de pagamento: quando esse aprovador aprova, pula
-- direto pra 'aguardando_pagamento', ignorando quantos níveis a
-- Classificação tiver configurado.
--
-- Complemento (Iury, mesma conversa): quem aprova no fluxo especial (ex.
-- Calita) muitas vezes só está "assinando" uma autorização que já veio de
-- outra pessoa por fora do sistema (verbal/WhatsApp) — autorizador_nome
-- registra quem de fato autorizou, sem exigir que essa pessoa tenha conta
-- no ERP (texto livre, não FK pra auth.users).
--
-- ROLLBACK:
--   ALTER TABLE public.malote_forma_pagamento DROP COLUMN IF EXISTS fluxo_aprovacao;
--   ALTER TABLE public.malote_forma_pagamento DROP COLUMN IF EXISTS aprovador_especial_user_id;
--   ALTER TABLE public.malote_despesa DROP COLUMN IF EXISTS autorizador_nome;
--   (recriar malote_e_aprovador_do_nivel/malote_sou_aprovador_configurado/
--    malote_aprovar_despesa com o corpo de 20260930000084_malote_veda_data_pagamento_passada.sql)
--   NOTIFY pgrst, 'reload schema';

ALTER TABLE public.malote_forma_pagamento
  ADD COLUMN fluxo_aprovacao text NOT NULL DEFAULT 'normal' CHECK (fluxo_aprovacao IN ('normal', 'especial')),
  ADD COLUMN aprovador_especial_user_id uuid REFERENCES auth.users(id);

ALTER TABLE public.malote_despesa
  ADD COLUMN autorizador_nome text;

-- ── malote_e_aprovador_do_nivel: fluxo especial ignora nível/Classificação ──
CREATE OR REPLACE FUNCTION public.malote_e_aprovador_do_nivel(_despesa_id uuid, _nivel smallint, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN fp.fluxo_aprovacao = 'especial' THEN _user_id = fp.aprovador_especial_user_id
    ELSE (CASE _nivel
      WHEN 1 THEN _user_id = ANY(c.aprovador1_user_ids)
      WHEN 2 THEN _user_id = ANY(c.aprovador2_user_ids)
      WHEN 3 THEN _user_id = ANY(c.aprovador3_user_ids)
      ELSE false
    END)
  END
  FROM public.malote_despesa d
  LEFT JOIN public.malote_forma_pagamento fp ON fp.nome = d.forma_pagamento
  JOIN public.planejamento_orcamentario_classificacao c ON c.id = d.classificacao_id
  WHERE d.id = _despesa_id;
$$;

CREATE OR REPLACE FUNCTION public.malote_sou_aprovador_configurado(_despesa_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.malote_despesa d
    LEFT JOIN public.malote_forma_pagamento fp ON fp.nome = d.forma_pagamento
    JOIN public.planejamento_orcamentario_classificacao c ON c.id = d.classificacao_id
    WHERE d.id = _despesa_id
      AND (
        (fp.fluxo_aprovacao = 'especial' AND _user_id = fp.aprovador_especial_user_id)
        OR (
          fp.fluxo_aprovacao IS DISTINCT FROM 'especial'
          AND (
            _user_id = ANY(c.aprovador1_user_ids)
            OR _user_id = ANY(c.aprovador2_user_ids)
            OR _user_id = ANY(c.aprovador3_user_ids)
          )
        )
      )
  );
$$;

-- ── malote_aprovar_despesa: fluxo especial sempre finaliza em 1 aprovação ──
CREATE OR REPLACE FUNCTION public.malote_aprovar_despesa(
  _id uuid,
  _proximo_nivel_configurado boolean,
  _valor_aprovado numeric,
  _justificativa text,
  _forma_pagamento text,
  _informacoes_pagamento text,
  _data_pagamento date,
  _competencia date,
  _rateio_snapshot jsonb DEFAULT '[]'::jsonb,
  _autorizador_nome text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_nivel smallint;
  v_excecao boolean;
  v_forma_atual text;
  v_fluxo_especial boolean;
  v_finaliza boolean;
  v_linha jsonb;
BEGIN
  SELECT status, nivel_aprovacao_atual, excecao, forma_pagamento
    INTO v_status, v_nivel, v_excecao, v_forma_atual
    FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;
  IF v_status <> 'pendente_aprovacao' THEN RAISE EXCEPTION 'Despesa não está pendente de aprovação.'; END IF;

  IF _data_pagamento < ((now() AT TIME ZONE 'America/Sao_Paulo')::date) THEN
    RAISE EXCEPTION 'Data de pagamento % é anterior a hoje — não é possível aprovar. Peça "Solicitar ajuste" para corrigir a data antes.', _data_pagamento;
  END IF;

  IF NOT (
    public.malote_pode('aprovar')
    AND (public.malote_e_aprovador_do_nivel(_id, v_nivel, auth.uid())
         OR public.malote_supervisor_por_cargo(auth.uid())
         OR (v_excecao AND public.malote_gerente_financeiro(auth.uid()))
         OR public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'Sem permissão para aprovar esta despesa.';
  END IF;

  SELECT fp.fluxo_aprovacao = 'especial' INTO v_fluxo_especial
    FROM public.malote_forma_pagamento fp WHERE fp.nome = v_forma_atual;
  v_finaliza := COALESCE(v_fluxo_especial, false) OR NOT (v_nivel < 3 AND _proximo_nivel_configurado);

  UPDATE public.malote_despesa SET
    valor_aprovado = _valor_aprovado,
    justificativa_aprovacao = _justificativa,
    forma_pagamento = _forma_pagamento,
    informacoes_pagamento = _informacoes_pagamento,
    data_pagamento = _data_pagamento,
    competencia = _competencia,
    autorizador_nome = COALESCE(_autorizador_nome, autorizador_nome),
    nivel_aprovacao_atual = CASE WHEN v_finaliza THEN nivel_aprovacao_atual ELSE v_nivel + 1 END,
    status = CASE WHEN v_finaliza THEN 'aguardando_pagamento' ELSE status END
  WHERE id = _id;

  IF v_finaliza THEN
    FOR v_linha IN SELECT * FROM jsonb_array_elements(_rateio_snapshot)
    LOOP
      UPDATE public.malote_despesa_rateio_linha
      SET orcado_snapshot = (v_linha->>'orcado')::numeric,
          utilizado_com_lancamento_snapshot = (v_linha->>'utilizado_com_lancamento')::numeric,
          congelado_em = now()
      WHERE id = (v_linha->>'linha_id')::uuid
        AND despesa_id = _id;
    END LOOP;
  END IF;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, nivel, ator_user_id)
  VALUES (_id, 'aprovacao_nivel', _justificativa, v_nivel, auth.uid());
END;
$$;

NOTIFY pgrst, 'reload schema';
