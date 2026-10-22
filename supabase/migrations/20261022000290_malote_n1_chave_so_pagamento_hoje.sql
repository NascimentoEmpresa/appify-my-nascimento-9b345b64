-- ============================================================================
-- [SEM-CHAMADO] Malote: a chave do Nível 1 depois do horário 1.1 só vale para pagamento de HOJE (ou vencido)
-- ============================================================================
-- Caso real (Ruan, financeiro, 22/10/2026): despesa para pagar AMANHÃ, aprovada no Nível 1 depois das 12h, pedia a senha de exceção.
-- Não faz sentido: o horário 1.1 existe para dar tempo de pagar no mesmo dia; despesa com pagamento em data futura não tem pressa. É a
-- mesma lógica da regra 1.2 do Nível 1 (justificativa só quando o pagamento é hoje ou já está vencido, SIS-2026-0272).
--
-- Muda só uma condição de malote_aprovar_despesa (resto idêntico ao da 20261021000020, BLOCO 6): a chave de aprovação só é exigida
-- quando _data_pagamento (a data que está sendo aprovada) é hoje ou anterior (hoje no horário de Brasília).
--
-- ROLLBACK: reaplicar malote_aprovar_despesa do BLOCO 6 de 20261021000020_malote_n1_prazo_chave_aprovacao.sql (sem a linha
--   "AND _data_pagamento <= ...").

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
  s public.malote_excecao_solicitacao%ROWTYPE;
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

  -- Nível 1 depois do horário 1.1: só com a senha de uma exceção de aprovação desta despesa, E SÓ quando o pagamento é HOJE (ou já
  -- vencido). Despesa para amanhã em diante aprova normalmente, sem chave. Despesa que já é exceção (lançada com senha) e chamadas
  -- sem sessão (jobs) também ficam de fora.
  IF v_nivel = 1 AND NOT COALESCE(v_excecao, false) AND auth.uid() IS NOT NULL AND public.malote_n1_fora_do_prazo()
     AND _data_pagamento <= ((now() AT TIME ZONE 'America/Sao_Paulo')::date) THEN
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
