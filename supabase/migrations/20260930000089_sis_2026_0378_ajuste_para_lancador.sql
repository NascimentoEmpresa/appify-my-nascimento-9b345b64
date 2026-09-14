-- SIS-2026-0378 (Iury): "Ajustar para que seja o criador da despesa após a
-- cotação aprovada seja o responsável por fazer ajustes na despesa quando
-- for solicitado." Hoje, quando o aprovador pede ajuste em um item que
-- passou por cotação, o pedido vai para o solicitante original e não para
-- quem de fato lançou a despesa (ex. Juliana) — faz mais sentido voltar pra
-- quem lança, já que é ela quem vai corrigir. Mesma semântica de
-- substituição do SIS-2026-0340
-- (lancador_despesa_user_ids, migration 20260930000074): uma vez que a
-- Classificação tem lançador configurado, é ele — não o solicitante — quem
-- deve receber e resolver o pedido de ajuste (status='necessidade_de_ajuste').
-- Sem lançador configurado, nada muda (comportamento de sempre: volta pro
-- solicitante).
--
-- Três pontas, cada uma já existia e cobria só a fase de LANÇAMENTO
-- (nivel_aprovacao_atual IS NULL), não a de AJUSTE pós-aprovação:
--   1. Notificação (malote_despesa_notificar, 20260930000083) — notificava
--      NEW.created_by sem olhar lançador nenhum.
--   2. RLS de UPDATE de malote_despesa/parcela/rateio (20260930000074) — a
--      cláusula do lançador só liberava com nivel_aprovacao_atual IS NULL;
--      uma vez que a despesa entra em aprovação e depois volta pra ajuste,
--      essa condição já não vale mais, mesmo com WITH CHECK já permissivo.
-- SELECT (20260930000083) e evento_insert (20260930000074) já eram amplos o
-- bastante (sem essa restrição) — não precisam mudar.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Helper: lançadores configurados pra despesa (cobre classificação
--    única e rateio, mesmo padrão de malote_aprovadores_nivel).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.malote_lancadores_despesa(_despesa_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT u
  FROM (
    SELECT unnest(c.lancador_despesa_user_ids) AS u
      FROM public.malote_despesa d
      JOIN public.planejamento_orcamentario_classificacao c ON c.id = d.classificacao_id
     WHERE d.id = _despesa_id
    UNION ALL
    SELECT unnest(c.lancador_despesa_user_ids) AS u
      FROM public.malote_despesa_rateio_linha rl
      JOIN public.planejamento_orcamentario_classificacao c ON c.id = rl.classificacao_id
     WHERE rl.despesa_id = _despesa_id
  ) x
  WHERE u IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.malote_lancadores_despesa(uuid) FROM PUBLIC, anon;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Notificação de necessidade_de_ajuste — vai pro lançador quando
--    configurado, senão mantém created_by.
-- ─────────────────────────────────────────────────────────────────────
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

    ELSIF NEW.status = 'ajuste_pagamento' THEN
      PERFORM public.malote_notificar_usuarios(
        ARRAY[NEW.created_by], NEW.empresa_id,
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
-- 3. RLS de edição — libera o lançador também com
--    status = 'necessidade_de_ajuste' (antes só nivel_aprovacao_atual
--    IS NULL, ou seja, só na conversão inicial da cotação).
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS malote_despesa_update ON public.malote_despesa;
CREATE POLICY malote_despesa_update ON public.malote_despesa FOR UPDATE TO authenticated
  USING (
    (created_by = auth.uid() AND status NOT IN ('despesa_paga', 'despesa_reprovada', 'solicitacao_reprovada', 'cancelada'))
    OR has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
    OR (
      origem = 'solicitacao'
      AND (nivel_aprovacao_atual IS NULL OR status = 'necessidade_de_ajuste')
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

DROP POLICY IF EXISTS malote_parcela_all ON public.malote_despesa_parcela;
CREATE POLICY malote_parcela_all ON public.malote_despesa_parcela
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.malote_despesa d
       WHERE d.id = malote_despesa_parcela.despesa_id
         AND (
           d.created_by = auth.uid()
           OR has_role(auth.uid(), 'admin'::app_role)
           OR (public.user_pode_ver_empresa(auth.uid(), d.empresa_id) AND malote_despesa_visivel_por_setor(auth.uid(), d.classificacao_id))
           OR (
             d.origem = 'solicitacao' AND (d.nivel_aprovacao_atual IS NULL OR d.status = 'necessidade_de_ajuste')
             AND EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao c WHERE c.id = d.classificacao_id AND auth.uid() = ANY(c.lancador_despesa_user_ids))
           )
         )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.malote_despesa d
       WHERE d.id = malote_despesa_parcela.despesa_id
         AND (
           d.created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role) OR malote_supervisor_por_cargo(auth.uid())
           OR (
             d.origem = 'solicitacao'
             AND EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao c WHERE c.id = d.classificacao_id AND auth.uid() = ANY(c.lancador_despesa_user_ids))
           )
         )
    )
  );

DROP POLICY IF EXISTS malote_rateio_linha_all ON public.malote_despesa_rateio_linha;
CREATE POLICY malote_rateio_linha_all ON public.malote_despesa_rateio_linha
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.malote_despesa d
       WHERE d.id = malote_despesa_rateio_linha.despesa_id
         AND (
           d.created_by = auth.uid()
           OR has_role(auth.uid(), 'admin'::app_role)
           OR (public.user_pode_ver_empresa(auth.uid(), d.empresa_id) AND malote_despesa_visivel_por_setor(auth.uid(), d.classificacao_id))
           OR (
             d.origem = 'solicitacao' AND (d.nivel_aprovacao_atual IS NULL OR d.status = 'necessidade_de_ajuste')
             AND EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao c WHERE c.id = d.classificacao_id AND auth.uid() = ANY(c.lancador_despesa_user_ids))
           )
         )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.malote_despesa d
       WHERE d.id = malote_despesa_rateio_linha.despesa_id
         AND (
           has_role(auth.uid(), 'admin'::app_role)
           OR (
             (d.created_by = auth.uid() OR malote_supervisor_por_cargo(auth.uid()))
             AND NOT (d.parcelado AND d.status = ANY (ARRAY['aguardando_pagamento'::text, 'pronto_para_pagar'::text, 'ajuste_pagamento'::text, 'despesa_paga'::text]))
           )
           OR (
             d.origem = 'solicitacao'
             AND EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao c WHERE c.id = d.classificacao_id AND auth.uid() = ANY(c.lancador_despesa_user_ids))
           )
         )
    )
  );

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- DROP POLICY IF EXISTS malote_rateio_linha_all ON public.malote_despesa_rateio_linha;
-- CREATE POLICY malote_rateio_linha_all ON public.malote_despesa_rateio_linha
--   FOR ALL TO authenticated
--   USING (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = malote_despesa_rateio_linha.despesa_id
--     AND (d.created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role)
--     OR (public.user_pode_ver_empresa(auth.uid(), d.empresa_id) AND malote_despesa_visivel_por_setor(auth.uid(), d.classificacao_id))
--     OR (d.origem = 'solicitacao' AND d.nivel_aprovacao_atual IS NULL
--       AND EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao c WHERE c.id = d.classificacao_id AND auth.uid() = ANY(c.lancador_despesa_user_ids))))))
--   WITH CHECK (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = malote_despesa_rateio_linha.despesa_id
--     AND (has_role(auth.uid(), 'admin'::app_role)
--     OR ((d.created_by = auth.uid() OR malote_supervisor_por_cargo(auth.uid()))
--     AND NOT (d.parcelado AND d.status = ANY (ARRAY['aguardando_pagamento'::text, 'pronto_para_pagar'::text, 'ajuste_pagamento'::text, 'despesa_paga'::text])))
--     OR (d.origem = 'solicitacao' AND EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao c WHERE c.id = d.classificacao_id AND auth.uid() = ANY(c.lancador_despesa_user_ids))))));
-- DROP POLICY IF EXISTS malote_parcela_all ON public.malote_despesa_parcela;
-- CREATE POLICY malote_parcela_all ON public.malote_despesa_parcela
--   FOR ALL TO authenticated
--   USING (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = malote_despesa_parcela.despesa_id
--     AND (d.created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role)
--     OR (public.user_pode_ver_empresa(auth.uid(), d.empresa_id) AND malote_despesa_visivel_por_setor(auth.uid(), d.classificacao_id))
--     OR (d.origem = 'solicitacao' AND d.nivel_aprovacao_atual IS NULL
--       AND EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao c WHERE c.id = d.classificacao_id AND auth.uid() = ANY(c.lancador_despesa_user_ids))))))
--   WITH CHECK (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = malote_despesa_parcela.despesa_id
--     AND (d.created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role) OR malote_supervisor_por_cargo(auth.uid())
--     OR (d.origem = 'solicitacao' AND EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao c WHERE c.id = d.classificacao_id AND auth.uid() = ANY(c.lancador_despesa_user_ids))))));
-- DROP POLICY IF EXISTS malote_despesa_update ON public.malote_despesa;
-- CREATE POLICY malote_despesa_update ON public.malote_despesa FOR UPDATE TO authenticated
--   USING (
--     (created_by = auth.uid() AND status NOT IN ('despesa_paga', 'despesa_reprovada', 'solicitacao_reprovada', 'cancelada'))
--     OR has_role(auth.uid(), 'admin')
--     OR public.malote_supervisor_por_cargo(auth.uid())
--     OR (origem = 'solicitacao' AND nivel_aprovacao_atual IS NULL
--       AND EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao c WHERE c.id = malote_despesa.classificacao_id AND auth.uid() = ANY(c.lancador_despesa_user_ids)))
--   )
--   WITH CHECK (
--     created_by = auth.uid()
--     OR has_role(auth.uid(), 'admin')
--     OR public.malote_supervisor_por_cargo(auth.uid())
--     OR (origem = 'solicitacao'
--       AND EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao c WHERE c.id = malote_despesa.classificacao_id AND auth.uid() = ANY(c.lancador_despesa_user_ids)))
--   );
-- CREATE OR REPLACE FUNCTION public.malote_despesa_notificar() ... (versão anterior, sem lançador em necessidade_de_ajuste — ver 20260930000083_malote_notificacoes_status.sql)
-- DROP FUNCTION IF EXISTS public.malote_lancadores_despesa(uuid);
-- =====================================================================
