-- SIS-2026-0211: "Dias Bloqueados" (Configurações) e o toggle "Impedir
-- lançamento em dias bloqueados" existiam na tela mas nunca eram
-- consultados em lugar nenhum — dava pra lançar E aprovar despesa com
-- data de pagamento em dia bloqueado. Corrige com um trigger único na
-- malote_despesa (cobre lançamento e aprovação, que gravam o mesmo campo
-- data_pagamento na mesma tabela).
--
-- Também adiciona bloqueio de fim de semana por padrão, com exceção por
-- data: uma linha em malote_dia_bloqueado com liberado=true LIBERA aquele
-- dia específico mesmo sendo sábado/domingo.
alter table public.malote_config
  add column if not exists bloqueio_fins_de_semana boolean not null default true;

alter table public.malote_dia_bloqueado
  add column if not exists liberado boolean not null default false;

CREATE OR REPLACE FUNCTION public.malote_dia_esta_bloqueado(_data date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.malote_dia_bloqueado WHERE data = _data AND liberado) THEN false
    WHEN EXISTS (SELECT 1 FROM public.malote_dia_bloqueado WHERE data = _data AND NOT liberado) THEN true
    WHEN (SELECT bloqueio_fins_de_semana FROM public.malote_config WHERE id = true)
         AND extract(isodow FROM _data) IN (6, 7) THEN true
    ELSE false
  END;
$$;

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

  SELECT bloqueio_impedir_lancamento INTO v_impedir FROM public.malote_config WHERE id = true;

  IF v_impedir AND public.malote_dia_esta_bloqueado(NEW.data_pagamento) THEN
    RAISE EXCEPTION 'Data de pagamento % está bloqueada no Malote (dia bloqueado, feriado ou fim de semana).', NEW.data_pagamento;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS malote_despesa_bloqueia_dia_pagamento ON public.malote_despesa;
CREATE TRIGGER malote_despesa_bloqueia_dia_pagamento
  BEFORE INSERT OR UPDATE ON public.malote_despesa
  FOR EACH ROW EXECUTE FUNCTION public.malote_bloqueia_dia_pagamento();

REVOKE ALL ON FUNCTION public.malote_dia_esta_bloqueado(date) FROM public, anon;
REVOKE ALL ON FUNCTION public.malote_bloqueia_dia_pagamento() FROM public, anon;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP TRIGGER IF EXISTS malote_despesa_bloqueia_dia_pagamento ON public.malote_despesa;
--   DROP FUNCTION IF EXISTS public.malote_bloqueia_dia_pagamento();
--   DROP FUNCTION IF EXISTS public.malote_dia_esta_bloqueado(date);
--   ALTER TABLE public.malote_dia_bloqueado DROP COLUMN IF EXISTS liberado;
--   ALTER TABLE public.malote_config DROP COLUMN IF EXISTS bloqueio_fins_de_semana;
