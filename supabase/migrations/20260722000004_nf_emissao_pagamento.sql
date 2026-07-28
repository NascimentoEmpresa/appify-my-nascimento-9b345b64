-- Controle de pagamento pelo Financeiro (Relatório de Serviços): registrado
-- depois que a NF já está concluída, então é um caso legítimo de UPDATE numa
-- linha em estado terminal. A trava de imutabilidade (nf_emissao_guard_enviada)
-- precisa abrir uma exceção só pra essas 2 colunas, sem reabrir os demais campos.

ALTER TABLE public.nf_emissao
  ADD COLUMN IF NOT EXISTS data_pagamento date,
  ADD COLUMN IF NOT EXISTS valor_pago numeric(15,2);

CREATE OR REPLACE FUNCTION public.nf_emissao_guard_enviada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_status public.nf_emissao_status;
  v_only_pagamento boolean := false;
BEGIN
  v_old_status := OLD.status;

  IF TG_OP = 'UPDATE' AND v_old_status = 'concluida' THEN
    v_only_pagamento := (to_jsonb(OLD) - ARRAY['data_pagamento', 'valor_pago', 'updated_at']::text[])
                       = (to_jsonb(NEW) - ARRAY['data_pagamento', 'valor_pago', 'updated_at']::text[]);
  END IF;

  IF v_old_status IN ('concluida', 'cancelada') AND NOT v_only_pagamento AND NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Esta NF já foi % pelo Financeiro e não pode mais ser alterada.', v_old_status;
  END IF;

  IF v_old_status = 'enviada' AND NOT (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria')) THEN
    RAISE EXCEPTION 'Esta NF já foi enviada para o Financeiro e não pode mais ser alterada. Qualquer correção deve ser feita diretamente com o setor.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
