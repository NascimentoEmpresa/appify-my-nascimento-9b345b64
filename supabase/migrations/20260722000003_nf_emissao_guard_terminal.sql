-- Endurece a trava de imutabilidade: NF concluída ou cancelada é estado
-- terminal e não pode ser reaberta/alterada por ninguém além de admin
-- (correção excepcional direto no banco). "controladoria" continua podendo
-- alterar uma NF "enviada" — é o papel do Financeiro validando a nota —
-- mas deixa de ter passe livre depois que a validação já foi concluída.
CREATE OR REPLACE FUNCTION public.nf_emissao_guard_enviada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_status public.nf_emissao_status;
BEGIN
  v_old_status := OLD.status;

  IF v_old_status IN ('concluida', 'cancelada') AND NOT has_role(auth.uid(), 'admin') THEN
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
