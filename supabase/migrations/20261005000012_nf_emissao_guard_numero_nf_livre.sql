-- ============================================================================
-- nf_emissao_guard_enviada: 'numero_nf' passa a ser campo livre em NF concluída
-- ============================================================================
-- SIS-2026-0582: o Nº da NF é preenchido pelo Financeiro (Ana) na Reconciliação,
-- com a NF já 'concluida'. O guard só liberava os campos de pagamento/reconciliação
-- (v_campos_livres) para quem não tem 'excluir' — então salvar o Nº NF dava
-- "Esta NF já foi concluida pelo Financeiro e não pode mais ser alterada."
--
-- Única mudança em relação à versão de 20260809000010: 'numero_nf' entra em
-- v_campos_livres. O resto da NF concluída continua imutável.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.nf_emissao_guard_enviada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_status public.nf_emissao_status;
  v_only_pagamento boolean := false;
  v_campos_livres text[] := ARRAY[
    'data_pagamento', 'valor_pago',
    'situacao_site_pmt', 'situacao_dominio',
    'desconto_conta_vinculada', 'recebimento_extra', 'falta_receber', 'pago_a_mais',
    'numero_nf',
    'updated_at'
  ];
BEGIN
  v_old_status := OLD.status;

  IF TG_OP = 'UPDATE' AND v_old_status = 'concluida' THEN
    v_only_pagamento := (to_jsonb(OLD) - v_campos_livres) = (to_jsonb(NEW) - v_campos_livres);
  END IF;

  IF v_old_status IN ('concluida', 'cancelada') AND NOT v_only_pagamento AND NOT public.can_access(auth.uid(), 'nf-emissao', 'excluir') THEN
    RAISE EXCEPTION 'Esta NF já foi % pelo Financeiro e não pode mais ser alterada.', v_old_status;
  END IF;

  IF v_old_status = 'enviada' AND NOT public.can_access(auth.uid(), 'nf-emissao', 'incluir') THEN
    RAISE EXCEPTION 'Esta NF já foi enviada para o Financeiro e não pode mais ser alterada. Qualquer correção deve ser feita diretamente com o setor.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK: reaplicar a função de 20260809000010_lote8f_nf_emissao_conta_garantida.sql
-- (mesma definição, sem 'numero_nf' em v_campos_livres).
