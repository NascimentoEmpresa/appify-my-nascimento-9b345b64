-- SIS-2026-0511 (Juliana, Compras/Pagamentos): "solicito que todas as
-- demandas de ajuste relacionadas a pagamento sejam direcionadas diretamente
-- para mim [quem lança/paga a despesa], evitando que essas solicitações
-- sejam encaminhadas para o setor de cotação." Hoje, quando a Conferência de
-- Pagamento devolve a despesa (status='ajuste_pagamento',
-- malote_solicitar_ajuste_pagamento_despesa), a notificação e a permissão de
-- editar vão pro `created_by` (quem criou a SOLICITAÇÃO/pediu a cotação) —
-- não pra quem de fato lança/corrige o pagamento.
--
-- Isso é exatamente o mesmo problema do SIS-2026-0378, resolvido só para
-- `necessidade_de_ajuste` (a devolução do lado da APROVAÇÃO). `ajuste_pagamento`
-- é o irmão do lado do PAGAMENTO e ficou de fora por esquecimento — mesma
-- causa raiz do "DM-2026-0246" já comentado em DespesaVisualizar.tsx.
--
-- Reaplica a mesma extensão nos 2 pontos que ainda faltavam (a notificação e
-- a RLS de UPDATE de malote_despesa — `malote_lancadores_despesa` já existe
-- desde 20260930000089, não precisa recriar):
--   1. Notificação: ajuste_pagamento passa a notificar o lançador
--      configurado (malote_lancadores_despesa), com o mesmo fallback pro
--      created_by quando a Classificação não tem lançador.
--   2. RLS de UPDATE de malote_despesa: a cláusula do lançador passa a
--      liberar edição também com status = 'ajuste_pagamento' (antes só
--      nivel_aprovacao_atual IS NULL ou necessidade_de_ajuste).
-- malote_parcela_all/malote_rateio_linha_all (mesma migration 20260930000089)
-- não precisam mudar: o solicitante já edita rateio restrito em
-- ajuste_pagamento via `created_by = auth.uid()` direto (DM-2026-0268), e
-- isso não muda aqui — só quem RECEBE a tarefa de corrigir muda.

CREATE OR REPLACE FUNCTION public.malote_despesa_notificar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_status text    := CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END;
  v_old_nivel  smallint := CASE WHEN TG_OP = 'UPDATE' THEN OLD.nivel_aprovacao_atual ELSE NULL END;
  v_link_sol  text := '/app/malote/solicitacao/' || NEW.id::text;
  v_link_desp text := '/app/malote/despesa/' || NEW.id::text;
  v_num  text := NEW.numero;
  v_aprov_sol uuid;
  v_motivo text := COALESCE(NEW.cotacao_reprovada_motivo, NEW.motivo_ajuste);
  v_lancadores uuid[];
BEGIN
  -- UPDATE OF dispara mesmo quando o valor não mudou; ignora esse caso.
  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM v_old_status
     AND NEW.nivel_aprovacao_atual IS NOT DISTINCT FROM v_old_nivel THEN
    RETURN NULL;
  END IF;

  SELECT c.aprovador_solicitacao_user_id INTO v_aprov_sol
    FROM public.planejamento_orcamentario_classificacao c
   WHERE c.id = NEW.classificacao_id;

  SELECT ARRAY(SELECT public.malote_lancadores_despesa(NEW.id)) INTO v_lancadores;

  IF NEW.status IS DISTINCT FROM v_old_status THEN
    -- ── Fase de Solicitação ──────────────────────────────────────────
    IF NEW.status = 'aguardando_aprovacao_inicial' THEN
      PERFORM public.malote_notificar_usuarios(
        ARRAY[v_aprov_sol], NEW.empresa_id,
        'Nova solicitação para aprovar',
        format('A solicitação %s aguarda sua aprovação inicial.', v_num),
        'malote_solicitacao_pendente', v_link_sol);

    ELSIF NEW.status = 'aguardando_cotacao' THEN
      PERFORM public.malote_notificar_usuarios(
        ARRAY(SELECT public.malote_usuarios_com_acesso('sup_cotacoes_malote', 'visualizar')),
        NEW.empresa_id,
        CASE WHEN v_old_status = 'cotacao_realizada'
             THEN 'Cotação reprovada — refazer' ELSE 'Nova solicitação para cotar' END,
        CASE WHEN v_old_status = 'cotacao_realizada'
             THEN format('A cotação da solicitação %s foi reprovada%s.', v_num,
                         COALESCE(': ' || v_motivo, ''))
             ELSE format('A solicitação %s está liberada para cotação.', v_num) END,
        'malote_cotacao_suprimentos', v_link_sol);

    ELSIF NEW.status = 'cotacao_realizada' THEN
      PERFORM public.malote_notificar_usuarios(
        ARRAY[v_aprov_sol], NEW.empresa_id,
        'Cotação pronta para decisão',
        format('A cotação da solicitação %s aguarda sua aprovação.', v_num),
        'malote_cotacao_decisao', v_link_sol);

    ELSIF NEW.status = 'cotacao_aprovada' THEN
      PERFORM public.malote_notificar_usuarios(
        ARRAY[NEW.created_by], NEW.empresa_id,
        'Cotação aprovada',
        format('A cotação da sua solicitação %s foi aprovada.', v_num),
        'malote_status', v_link_sol);

    ELSIF NEW.status = 'solicitacao_reprovada' THEN
      PERFORM public.malote_notificar_usuarios(
        ARRAY[NEW.created_by], NEW.empresa_id,
        'Solicitação reprovada',
        format('Sua solicitação %s foi reprovada%s.', v_num, COALESCE(': ' || v_motivo, '')),
        'malote_status', v_link_sol);

    -- ── Fase de Despesa ──────────────────────────────────────────────
    ELSIF NEW.status = 'pendente_aprovacao' THEN
      PERFORM public.malote_notificar_usuarios(
        ARRAY(SELECT public.malote_aprovadores_nivel(NEW.id, COALESCE(NEW.nivel_aprovacao_atual, 1)::smallint)),
        NEW.empresa_id,
        'Nova despesa para aprovar',
        format('A despesa %s aguarda sua aprovação (N%s).', v_num, COALESCE(NEW.nivel_aprovacao_atual, 1)),
        'malote_aprovacao_pendente', v_link_desp);

    ELSIF NEW.status = 'necessidade_de_ajuste' THEN
      PERFORM public.malote_notificar_usuarios(
        CASE WHEN COALESCE(array_length(v_lancadores, 1), 0) > 0 THEN v_lancadores ELSE ARRAY[NEW.created_by] END,
        NEW.empresa_id,
        'Despesa precisa de ajuste',
        format('A despesa %s precisa de ajuste%s.', v_num, COALESCE(': ' || NEW.motivo_ajuste, '')),
        'malote_status', v_link_desp);

    ELSIF NEW.status = 'aguardando_pagamento' THEN
      PERFORM public.malote_notificar_usuarios(
        ARRAY[NEW.created_by], NEW.empresa_id,
        'Despesa aprovada',
        format('Sua despesa %s foi aprovada e liberada para pagamento.', v_num),
        'malote_status', v_link_desp);
      PERFORM public.malote_notificar_usuarios(
        ARRAY(SELECT public.malote_usuarios_com_acesso('malote_pagamento', 'aprovar')),
        NEW.empresa_id,
        'Nova despesa para pagar',
        format('A despesa %s está liberada para pagamento.', v_num),
        'malote_status', v_link_desp);

    -- SIS-2026-0511: mesma extensão do SIS-2026-0378 (acima, em
    -- necessidade_de_ajuste), agora pro irmão do lado do pagamento — o
    -- lançador configurado é quem resolve, não o solicitante da cotação.
    ELSIF NEW.status = 'ajuste_pagamento' THEN
      PERFORM public.malote_notificar_usuarios(
        CASE WHEN COALESCE(array_length(v_lancadores, 1), 0) > 0 THEN v_lancadores ELSE ARRAY[NEW.created_by] END,
        NEW.empresa_id,
        'Pagamento precisa de ajuste',
        format('O pagamento da despesa %s voltou para ajuste%s.', v_num,
               COALESCE(': ' || NEW.motivo_ajuste, '')),
        'malote_status', v_link_desp);

    ELSIF NEW.status = 'despesa_paga' THEN
      -- Parcelada: quem notifica é o trigger de parcela, uma por parcela.
      IF NOT NEW.parcelado THEN
        PERFORM public.malote_notificar_usuarios(
          ARRAY[NEW.created_by], NEW.empresa_id,
          'Despesa paga',
          format('Sua despesa %s foi paga.', v_num),
          'malote_status', v_link_desp);
      END IF;

    ELSIF NEW.status = 'despesa_reprovada' THEN
      PERFORM public.malote_notificar_usuarios(
        ARRAY[NEW.created_by], NEW.empresa_id,
        'Despesa reprovada',
        format('Sua despesa %s foi reprovada%s.', v_num, COALESCE(': ' || NEW.motivo_ajuste, '')),
        'malote_status', v_link_desp);
    END IF;

  -- ── Só o nível mudou: escalada N -> N+1, status segue pendente_aprovacao
  ELSIF NEW.status = 'pendente_aprovacao'
        AND COALESCE(NEW.nivel_aprovacao_atual, 0) > COALESCE(v_old_nivel, 0) THEN
    PERFORM public.malote_notificar_usuarios(
      ARRAY(SELECT public.malote_aprovadores_nivel(NEW.id, NEW.nivel_aprovacao_atual::smallint)),
      NEW.empresa_id,
      'Despesa escalada para sua aprovação',
      format('A despesa %s subiu para aprovação N%s.', v_num, NEW.nivel_aprovacao_atual),
      'malote_aprovacao_pendente', v_link_desp);
  END IF;

  RETURN NULL;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- RLS de UPDATE de malote_despesa: libera o lançador também com
-- status = 'ajuste_pagamento' (antes só nivel_aprovacao_atual IS NULL ou
-- necessidade_de_ajuste).
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS malote_despesa_update ON public.malote_despesa;
CREATE POLICY malote_despesa_update ON public.malote_despesa FOR UPDATE TO authenticated
  USING (
    (created_by = auth.uid() AND status NOT IN ('despesa_paga', 'despesa_reprovada', 'solicitacao_reprovada', 'cancelada'))
    OR has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
    OR (
      origem = 'solicitacao'
      AND (nivel_aprovacao_atual IS NULL OR status IN ('necessidade_de_ajuste', 'ajuste_pagamento'))
      AND EXISTS (
        SELECT 1 FROM public.planejamento_orcamentario_classificacao c
        WHERE c.id = malote_despesa.classificacao_id
          AND auth.uid() = ANY(c.lancador_despesa_user_ids)
      )
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    OR has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
    OR (
      origem = 'solicitacao'
      AND EXISTS (
        SELECT 1 FROM public.planejamento_orcamentario_classificacao c
        WHERE c.id = malote_despesa.classificacao_id
          AND auth.uid() = ANY(c.lancador_despesa_user_ids)
      )
    )
  );

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- DROP POLICY IF EXISTS malote_despesa_update ON public.malote_despesa;
-- CREATE POLICY malote_despesa_update ON public.malote_despesa FOR UPDATE TO authenticated
--   USING (
--     (created_by = auth.uid() AND status NOT IN ('despesa_paga', 'despesa_reprovada', 'solicitacao_reprovada', 'cancelada'))
--     OR has_role(auth.uid(), 'admin')
--     OR public.malote_supervisor_por_cargo(auth.uid())
--     OR (origem = 'solicitacao' AND (nivel_aprovacao_atual IS NULL OR status = 'necessidade_de_ajuste')
--       AND EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao c WHERE c.id = malote_despesa.classificacao_id AND auth.uid() = ANY(c.lancador_despesa_user_ids)))
--   )
--   WITH CHECK (
--     created_by = auth.uid()
--     OR has_role(auth.uid(), 'admin')
--     OR public.malote_supervisor_por_cargo(auth.uid())
--     OR (origem = 'solicitacao'
--       AND EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao c WHERE c.id = malote_despesa.classificacao_id AND auth.uid() = ANY(c.lancador_despesa_user_ids)))
--   );
-- CREATE OR REPLACE FUNCTION public.malote_despesa_notificar() ... (versão anterior, sem lançador em ajuste_pagamento — ver 20260930000089_sis_2026_0378_ajuste_para_lancador.sql)
-- =====================================================================
