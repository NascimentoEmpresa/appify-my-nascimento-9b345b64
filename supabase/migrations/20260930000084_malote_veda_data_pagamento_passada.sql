-- SIS-2026-0361 (complemento, achado do Iury na prática): "não era pra ser
-- permitido nem lançar nem mesmo aprovar despesas que são anterior a hoje.
-- caso a despesa não tenha sido paga, deverá só ser permitido pedir
-- reajuste de data através de solicitação de ajuste."
--
-- Hoje `malote_bloqueia_dia_pagamento` (20260930000010) tem um furo real:
-- quando `excecao = true`, a função retorna cedo e pula TODAS as checagens
-- — incluindo uma que nunca existiu: nada impede `data_pagamento` no
-- passado, exceção ou não. É a brecha que o usuário encontrou testando.
--
-- Esta migration cria um piso absoluto, sem exceção possível (diferente da
-- regra 1.1, que a Exceção pode contornar):
--   a) LANÇAR/EDITAR: `data_pagamento` < hoje é bloqueado incondicionalmente
--      no trigger — antes até da checagem de `excecao`.
--   b) APROVAR: `malote_aprovar_despesa` passa a rejeitar quando a data (a
--      que está sendo confirmada nesta aprovação, igual ou nova) já é
--      passado — mesmo que `data_pagamento` não tenha mudado nesta chamada
--      (o trigger acima só reavalia quando o valor muda; aprovar sem tocar
--      na data não disparava o trigger, e é exatamente o caso real: despesa
--      lançada com data já vencida, antes desta regra existir, sentada em
--      pendente_aprovacao). Só resta "Solicitar ajuste" (necessidade_de_
--      ajuste/motivo_ajuste, fluxo já existente) ou "Reprovar" — nenhum dos
--      dois é tocado aqui.
--
-- Pagamento de verdade (malote_pagar_despesa/malote_pagar_parcela) fica de
-- fora — já tinha bypass (`NEW.status = 'despesa_paga'`) e continua tendo:
-- pagar hoje uma despesa cuja data planejada ficou pra trás é o caso normal
-- que esta regra não deveria travar.

CREATE OR REPLACE FUNCTION public.malote_bloqueia_dia_pagamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_impedir boolean;
  v_prazo_normal date;
  v_limite_excecao time;
  v_agora_local timestamp;
BEGIN
  IF NEW.data_pagamento IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.data_pagamento IS NOT DISTINCT FROM NEW.data_pagamento THEN RETURN NEW; END IF;

  -- data_pagamento tem dois sentidos na mesma coluna: data PLANEJADA de
  -- vencimento (lançamento/aprovação) e data REAL de pagamento confirmado
  -- (malote_pagar_despesa, status despesa_paga) — fica de fora das duas
  -- checagens abaixo.
  IF NEW.status = 'despesa_paga' THEN RETURN NEW; END IF;

  v_agora_local := now() AT TIME ZONE 'America/Sao_Paulo';

  -- SIS-2026-0361 (complemento): piso absoluto — data no passado nunca é
  -- permitida, nem como Exceção (a checagem de exceção logo abaixo é sobre
  -- ANTECIPAR o prazo normal, não sobre ir pro passado).
  IF NEW.data_pagamento < v_agora_local::date THEN
    RAISE EXCEPTION 'Data de pagamento % é anterior a hoje (%) — não é permitido, nem como exceção. Se a despesa já existe com essa data, use "Pedir ajuste" para corrigir.', NEW.data_pagamento, v_agora_local::date;
  END IF;

  IF NEW.excecao THEN
    -- Regra 2.1: mesmo como exceção, pedir pagamento pra HOJE depois do
    -- horário-limite de inclusão de exceções bloqueia — não libera nem
    -- como exceção. Valor operacional (23:59) faz isso não disparar hoje.
    IF NEW.data_pagamento = v_agora_local::date THEN
      SELECT excecao_limite_inclusao_horario INTO v_limite_excecao FROM public.malote_config WHERE id = true;
      IF v_agora_local::time > v_limite_excecao THEN
        RAISE EXCEPTION 'Já passou do horário limite (%) para incluir exceção com pagamento hoje.', v_limite_excecao;
      END IF;
    END IF;
    -- Exceção continua passando por cima do bloqueio de dia bloqueado,
    -- só pra ela (comportamento já existente desde 20260915000001).
    RETURN NEW;
  END IF;

  -- Regra 1.1: pedir uma data mais cedo que o prazo normal calculado sem
  -- marcar exceção não é permitido.
  v_prazo_normal := public.malote_prazo_normal_inclusao();
  IF NEW.data_pagamento < v_prazo_normal THEN
    RAISE EXCEPTION 'Data de pagamento % está fora do prazo normal de inclusão (regra 1.1 das Configurações do Malote; hoje o prazo normal é %) — marque como Exceção.', NEW.data_pagamento, v_prazo_normal;
  END IF;

  SELECT bloqueio_impedir_lancamento INTO v_impedir FROM public.malote_config WHERE id = true;

  IF v_impedir AND public.malote_dia_esta_bloqueado(NEW.data_pagamento) THEN
    RAISE EXCEPTION 'Data de pagamento % está bloqueada no Malote (dia bloqueado, feriado ou fim de semana).', NEW.data_pagamento;
  END IF;

  RETURN NEW;
END;
$$;

-- ── Aprovar: rejeita quando a data confirmada (mesma ou nova) já é
--    passado, mesmo sem `data_pagamento` mudar nesta chamada (o trigger
--    acima só reavalia se o valor mudou; aprovar "como está" é o caso
--    real que precisa ser pego aqui). ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.malote_aprovar_despesa(
  _id uuid,
  _proximo_nivel_configurado boolean,
  _valor_aprovado numeric,
  _justificativa text,
  _forma_pagamento text,
  _informacoes_pagamento text,
  _data_pagamento date,
  _competencia date,
  _rateio_snapshot jsonb DEFAULT '[]'::jsonb
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
  v_linha jsonb;
BEGIN
  SELECT status, nivel_aprovacao_atual, excecao INTO v_status, v_nivel, v_excecao FROM public.malote_despesa WHERE id = _id;
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

  UPDATE public.malote_despesa SET
    valor_aprovado = _valor_aprovado,
    justificativa_aprovacao = _justificativa,
    forma_pagamento = _forma_pagamento,
    informacoes_pagamento = _informacoes_pagamento,
    data_pagamento = _data_pagamento,
    competencia = _competencia,
    nivel_aprovacao_atual = CASE WHEN v_nivel < 3 AND _proximo_nivel_configurado THEN v_nivel + 1 ELSE nivel_aprovacao_atual END,
    status = CASE WHEN v_nivel < 3 AND _proximo_nivel_configurado THEN status ELSE 'aguardando_pagamento' END
  WHERE id = _id;

  IF NOT (v_nivel < 3 AND _proximo_nivel_configurado) THEN
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

-- =====================================================================
-- ROLLBACK
--   -- malote_bloqueia_dia_pagamento: reverter pro CREATE OR REPLACE de
--   -- 20260930000010_malote_excecao_prazo_e_aprovador.sql (remove o bloco
--   -- "piso absoluto" logo depois do cálculo de v_agora_local).
--   -- malote_aprovar_despesa: reverter pro CREATE OR REPLACE da mesma
--   -- migration 20260930000010 (remove a checagem de _data_pagamento no
--   -- início do corpo).
