-- ============================================================================
-- SIS-2026-0758: aprovação de compra no cartão de crédito com Fluxo Especial (Sicredi 2719) com data de pagamento já vencida
-- ============================================================================
-- Sintoma: Compras lança a despesa no cartão Sicredi (paga "no dia"); quando a aprovadora do Fluxo Especial abre dias depois, a
-- data de pagamento já é anterior a hoje e a aprovação é recusada ("Data de pagamento ... é anterior a hoje"); ela precisava pedir
-- "Solicitar ajuste" e a despesa voltava ao solicitante, mesmo a compra já estando feita no cartão.
--
-- Correção: em malote_aprovar_despesa, se a forma de pagamento é cartão ativo com Fluxo Especial (malote_forma_e_cartao_fluxo_especial,
-- hoje só o Sicredi 2719), NÃO vale a recusa por data anterior a hoje nem a chave do Nível 1 depois do horário (regra 1.1). Qualquer
-- outra forma de pagamento segue exatamente como antes. Resto idêntico ao da 20261026000820.
--
-- ROLLBACK: reaplicar malote_aprovar_despesa de 20261026000820_malote_aprovar_parcelada_data_efetiva.sql.

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
  _autorizador_nome text DEFAULT NULL,
  _senha_excecao text DEFAULT NULL
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
  v_senha text;
  v_horario time;
  v_parcelado boolean;
  v_data_efetiva date;
  v_prox date;
  v_cartao_especial boolean;
  s public.malote_excecao_solicitacao%ROWTYPE;
BEGIN
  SELECT status, nivel_aprovacao_atual, excecao, forma_pagamento, COALESCE(parcelado, false)
    INTO v_status, v_nivel, v_excecao, v_forma_atual, v_parcelado
    FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;
  IF v_status <> 'pendente_aprovacao' THEN RAISE EXCEPTION 'Despesa não está pendente de aprovação.'; END IF;

  -- Despesa parcelada: data_pagamento é a data da COMPRA (rastreio) e o dinheiro sai nos vencimentos das parcelas. Vale a primeira
  -- parcela ainda em aberto; sem parcela em aberto (ou não parcelada) vale a data enviada, como antes.
  v_data_efetiva := _data_pagamento;
  IF v_parcelado THEN
    SELECT min(p.data_vencimento) INTO v_prox FROM public.malote_despesa_parcela p WHERE p.despesa_id = _id AND p.pago_em IS NULL;
    IF v_prox IS NOT NULL THEN v_data_efetiva := v_prox; END IF;
  END IF;

  -- SIS-2026-0758: compra no cartão de crédito com Fluxo Especial (Sicredi 2719) já foi feita e a despesa é paga no dia em que é
  -- lançada. Quando o aprovador abre depois (ex.: lançada na segunda, aprovada na quarta), a data "anterior a hoje" travava a
  -- aprovação e a despesa voltava para ajuste. Para esse cartão, e só ele, a data vencida e a chave do Nível 1 (regra 1.1) não valem.
  v_cartao_especial := COALESCE(public.malote_forma_e_cartao_fluxo_especial(v_forma_atual), false);

  IF NOT v_cartao_especial AND v_data_efetiva < ((now() AT TIME ZONE 'America/Sao_Paulo')::date) THEN
    RAISE EXCEPTION 'Data de pagamento % é anterior a hoje — não é possível aprovar. Peça "Solicitar ajuste" para corrigir a data antes.', v_data_efetiva;
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

  -- Nível 1 depois do horário 1.1: só com a senha de uma exceção de aprovação desta despesa, E SÓ quando o pagamento é HOJE (ou já
  -- vencido). Despesa para amanhã em diante aprova normalmente, sem chave. Despesa que já é exceção (lançada com senha) e chamadas
  -- sem sessão (jobs) também ficam de fora.
  IF v_nivel = 1 AND NOT v_cartao_especial AND NOT COALESCE(v_excecao, false) AND auth.uid() IS NOT NULL AND public.malote_n1_fora_do_prazo()
     AND v_data_efetiva <= ((now() AT TIME ZONE 'America/Sao_Paulo')::date) THEN
    SELECT inclusao_setor_horario INTO v_horario FROM public.malote_config WHERE id = true;
    v_senha := upper(btrim(COALESCE(_senha_excecao, '')));
    IF v_senha = '' THEN
      RAISE EXCEPTION 'Depois das % o Nível 1 só aprova com a senha de uma exceção de aprovação (regra 1.1). Peça a chave em "Solicitar exceção de aprovação", na própria despesa.', to_char(v_horario, 'HH24:MI');
    END IF;
    SELECT * INTO s FROM public.malote_excecao_solicitacao WHERE senha = v_senha FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Senha de exceção não encontrada.'; END IF;
    IF s.finalidade <> 'aprovacao' OR s.despesa_alvo_id IS DISTINCT FROM _id THEN
      RAISE EXCEPTION 'Esta senha não é a chave de aprovação desta despesa.';
    END IF;
    IF s.solicitante_id <> auth.uid() THEN RAISE EXCEPTION 'Esta senha foi pedida por outro usuário.'; END IF;
    IF s.status = 'utilizada' THEN RAISE EXCEPTION 'Esta senha já foi utilizada.'; END IF;
    IF s.status <> 'aprovada' THEN RAISE EXCEPTION 'Esta senha não está ativa (%).', s.status; END IF;
    IF now() > s.senha_expira_em THEN RAISE EXCEPTION 'Esta senha expirou (valia 24 horas a partir da aprovação). Peça uma nova chave.'; END IF;

    UPDATE public.malote_excecao_solicitacao
       SET status = 'utilizada', usada_em = now(), despesa_id = _id, updated_at = now()
     WHERE id = s.id;
    INSERT INTO public.malote_excecao_solicitacao_evento (solicitacao_id, tipo_evento, ator_user_id, descricao)
    VALUES (s.id, 'senha_utilizada', auth.uid(), 'Senha utilizada na aprovação do Nível 1.');
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

GRANT EXECUTE ON FUNCTION public.malote_aprovar_despesa(uuid, boolean, numeric, text, text, text, date, date, jsonb, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
