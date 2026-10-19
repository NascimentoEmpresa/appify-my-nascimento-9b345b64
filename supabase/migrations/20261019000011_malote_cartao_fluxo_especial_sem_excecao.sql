-- [SEM-CHAMADO] Malote: despesa de cartão de crédito com Fluxo Especial volta a não exigir exceção.
--
-- A Solicitação de Exceção (SIS-2026-0668, senha aprovada pelo N2) passou a ser exigida para qualquer data anterior ao prazo
-- normal de inclusão e tirou o Fluxo Especial do cartão (SIS-2026-0439): a compra já foi feita e o pagamento é o vencimento da
-- fatura, que costuma cair "hoje". Agora, para forma de pagamento com Fluxo Especial que tenha cartão ativo cadastrado
-- (malote_cartao_credito.tipo_forma_pagamento = despesa.forma_pagamento), o trigger de data de pagamento deixa passar sem
-- prazo 1.1, dia bloqueado nem horário 2.1. Data no passado continua proibida. A tela preenche Data de Pagamento e
-- Competência com o próximo vencimento do cartão.
--
-- Só recria a função (mesmo corpo da 20261015000001 + a exceção acima); o trigger não muda.
-- Idempotente. ROLLBACK: reaplicar a função malote_bloqueia_dia_pagamento da 20261015000001_malote_excecao_solicitacao.sql.

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

  -- data_pagamento é também a data REAL do pagamento confirmado (despesa_paga): fora das checagens.
  IF NEW.status = 'despesa_paga' THEN RETURN NEW; END IF;

  v_agora_local := now() AT TIME ZONE 'America/Sao_Paulo';

  -- SIS-2026-0361: piso absoluto — data no passado nunca, nem como exceção.
  IF NEW.data_pagamento < v_agora_local::date THEN
    RAISE EXCEPTION 'Data de pagamento % é anterior a hoje (%) — não é permitido, nem como exceção. Se a despesa já existe com essa data, use "Pedir ajuste" para corrigir.', NEW.data_pagamento, v_agora_local::date;
  END IF;

  -- [SEM-CHAMADO] Compra no cartão de crédito com Fluxo Especial (SIS-2026-0439): já foi feita, e a data de pagamento é o
  -- vencimento da fatura (a tela preenche sozinha). Fica fora das regras de prazo (1.1), dia bloqueado e horário (2.1) e
  -- não exige exceção. O piso "não anterior a hoje" acima continua valendo.
  IF EXISTS (
    SELECT 1
      FROM public.malote_forma_pagamento fp
      JOIN public.malote_cartao_credito cc ON cc.tipo_forma_pagamento = fp.nome AND cc.ativo
     WHERE fp.nome = NEW.forma_pagamento AND fp.fluxo_aprovacao = 'especial'
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.excecao THEN
    -- Regra 2.1: mesmo como exceção, pagamento para HOJE depois do horário-limite de inclusão não passa.
    IF NEW.data_pagamento = v_agora_local::date THEN
      SELECT excecao_limite_inclusao_horario INTO v_limite_excecao FROM public.malote_config WHERE id = true;
      IF v_agora_local::time > v_limite_excecao THEN
        RAISE EXCEPTION 'Já passou do horário limite (%) para incluir exceção com pagamento hoje.', v_limite_excecao;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- Regra 1.1 (SIS-2026-0250): data mais cedo que o prazo normal exige exceção. Sem sessão (job de rolagem,
  -- SIS-2026-0664) a regra não se aplica: o job só empurra a data para a frente.
  IF auth.uid() IS NOT NULL THEN
    v_prazo_normal := public.malote_prazo_normal_inclusao();
    IF NEW.data_pagamento < v_prazo_normal THEN
      RAISE EXCEPTION 'Data de pagamento % está fora do prazo normal de inclusão (regra 1.1 das Configurações do Malote; hoje o prazo normal é %) — peça uma exceção em Malote › Solicitar Exceção.', NEW.data_pagamento, v_prazo_normal;
    END IF;
  END IF;

  SELECT bloqueio_impedir_lancamento INTO v_impedir FROM public.malote_config WHERE id = true;

  IF v_impedir AND public.malote_dia_esta_bloqueado(NEW.data_pagamento, NEW.classificacao_id) THEN
    RAISE EXCEPTION 'Data de pagamento % está bloqueada no Malote (dia bloqueado, feriado ou fim de semana) — peça uma exceção em Malote › Solicitar Exceção.', NEW.data_pagamento;
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
