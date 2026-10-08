-- ============================================================================
-- nf_emissao: a analista pode REABRIR uma NF cancelada pelo Financeiro para
-- corrigir e reenviar (em vez de refazer a nota inteira)
-- ============================================================================
-- Hoje: o Financeiro cancela a validação (às vezes por uma descrição ou um valor
-- mínimo), registra o motivo em observacoes_financeiro, e a nota fica 'cancelada'.
-- O guard nf_emissao_guard_enviada recusa qualquer alteração de NF cancelada para
-- quem não tem 'excluir', então a analista (Anne) não consegue corrigir e tem que
-- preencher tudo de novo.
--
-- Agora: nf_emissao_reabrir_cancelada(_id) devolve a MESMA nota para 'rascunho'
-- (mantém itens, anexos e histórico), preservando observacoes_financeiro — o motivo
-- do Financeiro fica visível na tela para ela saber o que corrigir — e registra no
-- histórico "NF reaberta" com o motivo e quem reabriu. Depois ela edita e envia de
-- novo pelo fluxo normal.
--
-- Regras da reabertura (todas no banco):
--   • só NF 'cancelada' (a validação do Financeiro) e fora da lixeira;
--   • quem tem 'incluir' em nf-emissao (a ação de criar/enviar NF);
--   • NÃO reabre nota cancelada/substituída no site ou no Domínio
--     (situacao_site_pmt / situacao_dominio): isso é cancelamento de verdade, fora
--     do ERP;
--   • NÃO reabre nota com pagamento registrado;
--   • zera concluida_em (SIS-2026-0614): quando o Financeiro concluir de novo, a
--     nota entra na ordem dos relatórios pela NOVA conclusão.
--
-- O guard ganha UMA exceção, estreita: UPDATE de 'cancelada' para 'rascunho' feito
-- por esta função (sinalizado por uma variável local da transação). O resto do
-- guard é idêntico à versão de 20261005000012.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.nf_emissao_reabrir_cancelada(uuid);
--   (reaplicar a função nf_emissao_guard_enviada de 20261005000012_nf_emissao_guard_numero_nf_livre.sql)
--   NOTIFY pgrst, 'reload schema';

SET lock_timeout = '5s';

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

  -- Reabertura de NF cancelada para correção (nf_emissao_reabrir_cancelada): só a
  -- transição cancelada -> rascunho e só dentro dessa função.
  IF TG_OP = 'UPDATE'
     AND v_old_status = 'cancelada'
     AND NEW.status = 'rascunho'
     AND current_setting('nf.reabrindo_cancelada', true) = 'on' THEN
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

CREATE OR REPLACE FUNCTION public.nf_emissao_reabrir_cancelada(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_nf public.nf_emissao%ROWTYPE;
  v_motivo text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida.';
  END IF;
  IF NOT public.can_access(auth.uid(), 'nf-emissao', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para reabrir NF.';
  END IF;

  SELECT * INTO v_nf FROM public.nf_emissao WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR v_nf.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'NF não encontrada.';
  END IF;
  IF v_nf.status <> 'cancelada' THEN
    RAISE EXCEPTION 'Só uma NF cancelada pelo Financeiro pode ser reaberta para correção.';
  END IF;
  IF upper(coalesce(v_nf.situacao_site_pmt::text, '')) IN ('CANCELADA', 'SUBSTITUIDA')
     OR upper(coalesce(v_nf.situacao_dominio::text, '')) IN ('CANCELADA', 'SUBSTITUIDA') THEN
    RAISE EXCEPTION 'Esta NF consta como cancelada/substituída no site ou no Domínio e não pode ser reaberta por aqui.';
  END IF;
  IF v_nf.data_pagamento IS NOT NULL OR coalesce(v_nf.valor_pago, 0) > 0 THEN
    RAISE EXCEPTION 'NF com pagamento registrado não pode ser reaberta.';
  END IF;

  v_motivo := coalesce(nullif(btrim(v_nf.observacoes_financeiro), ''), '(motivo não informado)');

  PERFORM set_config('nf.reabrindo_cancelada', 'on', true);
  UPDATE public.nf_emissao
     SET status = 'rascunho', concluida_em = NULL, updated_by = auth.uid()
   WHERE id = _id;
  PERFORM set_config('nf.reabrindo_cancelada', 'off', true);

  INSERT INTO public.nf_emissao_historico (nf_emissao_id, acao, detalhe)
  VALUES (_id, 'nf_reaberta', format('NF reaberta para correção. Motivo do cancelamento pelo Financeiro: %s', v_motivo));
END;
$$;

REVOKE ALL ON FUNCTION public.nf_emissao_reabrir_cancelada(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nf_emissao_reabrir_cancelada(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
