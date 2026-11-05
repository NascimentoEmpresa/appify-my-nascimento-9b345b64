-- ============================================================================
-- SIS-2026-0794 — Conta vinculada: data e valor efetivamente recebido, por NF
-- ============================================================================
-- Hoje a NF só guarda quanto foi DESCONTADO para a conta vinculada
-- (nf_emissao.desconto_conta_vinculada). O que o cliente efetivamente depositou
-- nessa conta não é registrado, e ninguém enxerga a pendência (descontado −
-- recebido) para ir atrás da resolução.
--
--   1. nf_emissao.conta_vinculada_data_recebimento  date            (quando entrou na conta vinculada)
--   2. nf_emissao.conta_vinculada_valor_recebido    numeric(14,2)   (quanto entrou; 0 = nada recebido ainda)
--   3. nf_emissao_guard_enviada: os dois campos entram na lista de campos livres da NF
--      concluída (são do mesmo grupo de "reconciliação" que desconto_conta_vinculada,
--      recebimento_extra, falta_receber e pago_a_mais). Sem isso o Financeiro, que só tem
--      'alterar' e não 'excluir', ficaria barrado ao salvar a reconciliação.
--      O resto da função é idêntico à versão de 20261008000004.
--
-- A pendência não é coluna: é calculada na tela (desconto − recebido, nunca negativa),
-- para nunca ficar defasada se o desconto da nota for corrigido depois.
--
-- ROLLBACK:
--   ALTER TABLE public.nf_emissao DROP COLUMN conta_vinculada_data_recebimento, DROP COLUMN conta_vinculada_valor_recebido;
--   (reaplicar nf_emissao_guard_enviada de 20261008000004_nf_emissao_descontos_pos_emissao_fora_da_nf.sql)

ALTER TABLE public.nf_emissao
  ADD COLUMN IF NOT EXISTS conta_vinculada_data_recebimento date,
  ADD COLUMN IF NOT EXISTS conta_vinculada_valor_recebido numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.nf_emissao DROP CONSTRAINT IF EXISTS nf_emissao_conta_vinculada_recebido_nao_negativo;
ALTER TABLE public.nf_emissao
  ADD CONSTRAINT nf_emissao_conta_vinculada_recebido_nao_negativo CHECK (conta_vinculada_valor_recebido >= 0);

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
    'conta_vinculada_data_recebimento', 'conta_vinculada_valor_recebido',
    'numero_nf',
    'updated_at'
  ];
BEGIN
  v_old_status := OLD.status;

  -- Reabertura de NF cancelada para correção (nf_emissao_reabrir_cancelada): só a
  -- transição cancelada -> rascunho e só dentro dessa função.
  IF TG_OP = 'UPDATE'
     AND v_old_status = 'cancelada'
     AND NEW.status = 'rascunho'
     AND current_setting('nf.reabrindo_cancelada', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- SIS-2026-0609: recálculo único das NFs com desconto pós-emissão dentro do
  -- bruto (migration 20261008000004). Só dentro da transação que liga a variável.
  IF TG_OP = 'UPDATE'
     AND current_setting('nf.recalculo_pos_emissao', true) = 'on' THEN
    RETURN NEW;
  END IF;

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
