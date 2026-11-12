-- [SEM-CHAMADO] Emissão de NF: a analista pode EXCLUIR uma NF cancelada pelo Financeiro (pedido do Ruan)
-- ============================================================================
-- Hoje só o Excluir do RASCUNHO existe. NF cancelada pelo Financeiro fica na lista da Emissão para sempre, e o guard nf_emissao_guard_enviada impede
-- qualquer mudança nela por quem não tem a ação 'excluir' de nf-emissao (que também liberaria mexer em NF CONCLUÍDA — amplo demais para a analista).
--
-- nf_emissao_excluir_cancelada(_id): SECURITY DEFINER, no mesmo molde de nf_emissao_reabrir_cancelada. Manda a NF para a LIXEIRA (deleted_at/deleted_by,
-- a mesma do Relatório Geral): some da Emissão e dos relatórios, mas o Financeiro ainda restaura. Não apaga linha nem anexo. Confere dentro da função:
--   · sessão válida e ação 'incluir' em nf-emissao (a mesma da reabertura), e (como a RLS da tabela) 'excluir' OU atuar na empresa da NF;
--   · a NF existe, não está na lixeira e está CANCELADA pelo Financeiro;
--   · sem pagamento registrado e sem situação cancelada/substituída no site ou no Domínio (essas são registro fiscal real: ficam no relatório).
-- O guard ganha um desvio estreito (variável nf.excluindo_cancelada, ligada só dentro da função) para esse único UPDATE. Registra no histórico da NF.
-- Idempotente. NOTIFY ao final.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.nf_emissao_excluir_cancelada(uuid);
--   (e recriar nf_emissao_guard_enviada sem o bloco "SIS-2026 excluir cancelada", conforme a migration que a definiu)
--   NOTIFY pgrst, 'reload schema';

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

  -- Exclusão (envio para a lixeira) de NF cancelada pela analista (nf_emissao_excluir_cancelada): só a NF cancelada que continua cancelada
  -- e só dentro dessa função, que confere permissão, pagamento e situação antes.
  IF TG_OP = 'UPDATE'
     AND v_old_status = 'cancelada'
     AND NEW.status = 'cancelada'
     AND current_setting('nf.excluindo_cancelada', true) = 'on' THEN
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

CREATE OR REPLACE FUNCTION public.nf_emissao_excluir_cancelada(_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_nf public.nf_emissao%ROWTYPE;
  v_motivo text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida.';
  END IF;
  IF NOT public.can_access(auth.uid(), 'nf-emissao', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para excluir NF.';
  END IF;

  SELECT * INTO v_nf FROM public.nf_emissao WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR v_nf.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'NF não encontrada.';
  END IF;
  IF NOT (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR public.user_pode_atuar_empresa(auth.uid(), v_nf.empresa_id)) THEN
    RAISE EXCEPTION 'Sem permissão para excluir NF desta empresa.';
  END IF;
  IF v_nf.status <> 'cancelada' THEN
    RAISE EXCEPTION 'Só uma NF cancelada pelo Financeiro pode ser excluída por aqui.';
  END IF;
  IF upper(coalesce(v_nf.situacao_site_pmt::text, '')) IN ('CANCELADA', 'SUBSTITUIDA')
     OR upper(coalesce(v_nf.situacao_dominio::text, '')) IN ('CANCELADA', 'SUBSTITUIDA') THEN
    RAISE EXCEPTION 'Esta NF consta como cancelada/substituída no site ou no Domínio e não pode ser excluída por aqui.';
  END IF;
  IF v_nf.data_pagamento IS NOT NULL OR coalesce(v_nf.valor_pago, 0) > 0 THEN
    RAISE EXCEPTION 'NF com pagamento registrado não pode ser excluída.';
  END IF;

  v_motivo := coalesce(nullif(btrim(v_nf.observacoes_financeiro), ''), '(motivo não informado)');

  PERFORM set_config('nf.excluindo_cancelada', 'on', true);
  UPDATE public.nf_emissao
     SET deleted_at = now(), deleted_by = auth.uid(), updated_by = auth.uid()
   WHERE id = _id;
  PERFORM set_config('nf.excluindo_cancelada', 'off', true);

  INSERT INTO public.nf_emissao_historico (nf_emissao_id, user_id, acao, detalhe)
  VALUES (_id, auth.uid(), 'nf_excluida', format('NF cancelada pelo Financeiro excluída da Emissão (enviada para a lixeira). Motivo do cancelamento: %s', v_motivo));
END;
$function$;
REVOKE ALL ON FUNCTION public.nf_emissao_excluir_cancelada(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nf_emissao_excluir_cancelada(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
