-- SIS-2026-0211 (complemento): despesa marcada como "Exceção" pode ter
-- data de pagamento num dia bloqueado — diferente de liberar o dia
-- inteiro (malote_dia_bloqueado.liberado), que valeria pra qualquer
-- lançamento. A coluna excecao já existia (desde 20260512203445) mas
-- nunca foi consumida em lugar nenhum — só aparecia como filtro Sim/Não
-- em Aprovações/Meus Itens, sem nenhuma tela deixando marcá-la.
alter table public.malote_despesa
  add column if not exists justificativa_excecao text;

CREATE OR REPLACE FUNCTION public.malote_bloqueia_dia_pagamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_impedir boolean;
BEGIN
  IF NEW.data_pagamento IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.data_pagamento IS NOT DISTINCT FROM NEW.data_pagamento THEN RETURN NEW; END IF;

  -- data_pagamento tem dois sentidos na mesma coluna: data PLANEJADA de
  -- vencimento (lançamento/aprovação — é o que este chamado pede pra
  -- bloquear) e data REAL de pagamento confirmado (malote_pagar_despesa,
  -- status despesa_paga) — PIX/boleto acontecem de verdade em fim de
  -- semana, então a confirmação do pagamento real fica de fora do bloqueio.
  IF NEW.status = 'despesa_paga' THEN RETURN NEW; END IF;

  -- Exceção: despesa marcada como excecao=true passa por cima do
  -- bloqueio, só pra ela — não libera o dia pra mais ninguém.
  IF NEW.excecao THEN RETURN NEW; END IF;

  SELECT bloqueio_impedir_lancamento INTO v_impedir FROM public.malote_config WHERE id = true;

  IF v_impedir AND public.malote_dia_esta_bloqueado(NEW.data_pagamento) THEN
    RAISE EXCEPTION 'Data de pagamento % está bloqueada no Malote (dia bloqueado, feriado ou fim de semana).', NEW.data_pagamento;
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   Reverter malote_bloqueia_dia_pagamento pro CREATE OR REPLACE anterior
--   em 20260914000001_malote_bloqueio_dia_pagamento.sql, e:
--   ALTER TABLE public.malote_despesa DROP COLUMN IF EXISTS justificativa_excecao;
