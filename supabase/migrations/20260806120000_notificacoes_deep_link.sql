-- ============================================================================
-- Notificações do sininho: link apontando para o registro de origem
--
-- O clique na notificação passou a navegar para `notificacoes.link` (ver
-- src/lib/notificacaoLink.ts + src/components/layout/Topbar.tsx). Dois
-- produtores gravavam link inútil:
--   1. sup_aprov_avancar() -> '/app/aprovacoes' (tela de licitações; o motor
--      unificado sup_aprov é lido em /app/aprovacoes/inbox) e sem referência
--      nenhuma à instância.
--   2. edge function sla-escalonamento-tick -> '/aprovacoes/inbox', sem o
--      prefixo /app do shell, ou seja, 404 (corrigida no deploy da função;
--      aqui fica só o backfill das linhas já gravadas).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. sup_aprov_avancar: mesma função de 20260520163846, só o link do INSERT
--    em notificacoes muda (passa a levar o id da instância).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sup_aprov_avancar(_instancia_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _inst public.sup_aprov_instancia%ROWTYPE;
  _proxima public.sup_aprov_etapa%ROWTYPE;
  _alvo_label text;
  _resp_user uuid;
BEGIN
  SELECT * INTO _inst FROM public.sup_aprov_instancia WHERE id = _instancia_id FOR UPDATE;
  IF _inst.status <> 'pendente' THEN RETURN; END IF;

  SELECT e.* INTO _proxima FROM public.sup_aprov_etapa e
  WHERE e.fluxo_id = _inst.fluxo_id
    AND e.ativo
    AND e.tipo_parecer = 'bloqueante'
    AND (e.instancia_id IS NULL OR e.instancia_id = _inst.id)
    AND COALESCE(_inst.valor,0) >= COALESCE(e.valor_min,0)
    AND (e.valor_max IS NULL OR COALESCE(_inst.valor,0) <= e.valor_max)
    AND NOT EXISTS (
      SELECT 1 FROM public.sup_aprov_voto v
      WHERE v.instancia_id=_inst.id AND v.etapa_id=e.id
    )
  ORDER BY e.ordem
  LIMIT 1;

  IF _proxima.id IS NULL THEN
    UPDATE public.sup_aprov_instancia
      SET status='aprovado', etapa_atual_id=NULL, fechada_em=now()
      WHERE id=_inst.id;
    RETURN;
  END IF;

  UPDATE public.sup_aprov_instancia SET etapa_atual_id=_proxima.id WHERE id=_inst.id;

  IF _proxima.regra_auto ? 'tipo' AND _proxima.regra_auto->>'tipo' = 'orcamento_cc' THEN
    IF public.sup_aprov_tem_orcamento_cc(_inst.centro_custo_id, _inst.valor) THEN
      INSERT INTO public.sup_aprov_voto(instancia_id, etapa_id, usuario_id, parecer, justificativa)
      VALUES (_inst.id, _proxima.id,
              COALESCE(_inst.solicitante_user_id, _proxima.responsavel_user_id),
              'aprovado', 'Auto-aprovado: orçamento do CC disponível.');
      PERFORM public.sup_aprov_avancar(_inst.id);
      RETURN;
    END IF;
  END IF;

  -- Notificação no sininho para o responsável efetivo (delegação considerada)
  _resp_user := public.sup_aprov_responsavel_efetivo(_proxima.id);
  IF _resp_user IS NOT NULL THEN
    _alvo_label := CASE _inst.alvo::text
      WHEN 'requisicao_compra' THEN 'Requisição de compra'
      WHEN 'pedido_compra' THEN 'Pedido de compra'
      WHEN 'licitacao_etapa' THEN 'Licitação'
      WHEN 'programacao_pagamento' THEN 'Programação de pagamento'
      ELSE _inst.alvo::text END;

    INSERT INTO public.notificacoes (user_id, empresa_id, titulo, mensagem, tipo, link)
    VALUES (
      _resp_user,
      _inst.empresa_id,
      'Aprovação pendente: ' || _alvo_label,
      coalesce(_inst.referencia_codigo, _proxima.nome) || ' aguarda sua decisão.',
      'sup_aprov_pendente',
      '/app/aprovacoes/inbox?ref=' || _inst.id::text
    );
  END IF;
END $function$;

-- ----------------------------------------------------------------------------
-- 2. Backfill das notificações já gravadas com caminho sem o prefixo /app
--    (tipo 'aprovacao_sla'). Sem isso elas continuariam caindo no NotFound.
--    Roda como superusuário no SQL Editor, então passa pelo trigger
--    a_trg_notificacoes_block_self_escalation, que impede usuário comum de
--    alterar `link`.
-- ----------------------------------------------------------------------------
UPDATE public.notificacoes
   SET link = '/app' || link
 WHERE link LIKE '/aprovacoes%';

-- ----------------------------------------------------------------------------
-- 3. Notificações antigas do motor unificado apontam para a tela de aprovações
--    de licitações; o destino certo é o inbox. Só as que não têm referência
--    nenhuma (link cru) — as novas já nascem com ?ref=.
-- ----------------------------------------------------------------------------
UPDATE public.notificacoes
   SET link = '/app/aprovacoes/inbox'
 WHERE tipo = 'sup_aprov_pendente'
   AND link = '/app/aprovacoes';

NOTIFY pgrst, 'reload schema';
