-- =========================================================================
-- [SEM-CHAMADO] CHAMADO SEM RETORNO: CONCLUI DE FATO E O SOLICITANTE VÊ
-- "Concluído automaticamente por falta de retorno" (18/11/2026)
--
-- O CASO: SIS-2026-0771 (Helena, Presidência) em "Aguardando retorno" desde
-- antes de 14/11, com a tela dizendo "sem resposta até quarta, 18/11, o
-- chamado é concluído automaticamente". Pablo: "já devia ter sido concluído
-- há muito tempo".
--
-- POR QUE NÃO CONCLUÍA
--   1. A regra só nasceu na mig 20261114130000. Quem JÁ estava aguardando
--      ganhou, de propósito, 3 dias úteis a contar do deploy (ninguém
--      concluído sem aviso) — por isso o 0771 vence só em 18/11, 23:59.
--   2. A rodada era UMA por dia (03:20). Uma madrugada perdida (banco
--      ocupado, job falhando) = mais um dia aberto, sem nova tentativa.
--   3. Quando concluía, o chamado ficava com conclusao_confirmada_em e SEM
--      gestao_finalizada_em — exatamente o estado "Confirmado, falta o Gestor
--      de Sistemas finalizar" (mig 20261110009000). O solicitante via
--      "Aguardando o Gestor de Sistemas", não "concluído", e o chamado caía
--      na fila "Pendente de conclusão" do gestor como se fosse entrega.
--
-- COMO ISSO SE ENCAIXA NO FLUXO NOVO (merge entrega ao Gestor de Sistemas)
--   O fluxo dev → Gestor de Sistemas conclui → solicitante confirma → gestor
--   finaliza é para ENTREGA de desenvolvimento. Falta de retorno não é
--   entrega: nada foi desenvolvido, não há o que o gestor revisar nem o que o
--   solicitante confirmar/avaliar. Então a conclusão automática fecha as três
--   etapas de uma vez (concluido + confirmada + finalizada, por = NULL, que é
--   "o sistema") e NÃO entra na fila do gestor. Se o gestor discordar, ele
--   (ou o solicitante) reabre — o chat continua aberto.
--
-- AGORA
--   · chamado_concluir_sem_retorno(): marca também gestao_finalizada_em; o
--     histórico e o sino dizem "Concluído automaticamente por falta de
--     retorno" (texto exato; a tela usa o mesmo, src/lib/chamados/
--     prazoRetorno.ts).
--   · Job de hora em hora (minuto 20): vencido às 23:59, concluído 00:20.
--   · Quem já foi concluído sem retorno e ficou "aguardando o gestor" é
--     finalizado aqui (o 0771 entra se a rodada de 19/11, 03:20, já pegou).
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================
SET lock_timeout = '5s';

-- ── 1. Concluir os vencidos (corpo da mig 20261114130000 + finalização) ───
CREATE OR REPLACE FUNCTION public.chamado_concluir_sem_retorno()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_replica boolean := false;
  v_ids     uuid[];
  v_n       integer;
BEGIN
  SELECT array_agg(id) INTO v_ids
    FROM public."CHAMADO_SISTEMA"
   WHERE status = 'aguardando_retorno'
     AND aguardando_retorno_ate IS NOT NULL
     AND aguardando_retorno_ate < now();
  IF v_ids IS NULL THEN
    RETURN 0;
  END IF;

  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
    v_replica := true;
  EXCEPTION WHEN OTHERS THEN
    -- Sem poder desligar os gatilhos: passa pelo guarda como automação.
    PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  END;

  UPDATE public."CHAMADO_SISTEMA"
     SET status = 'concluido',
         concluido_em = now(),
         concluido_sem_retorno = true,
         aguardando_retorno_ate = NULL,
         updated_at = now()
   WHERE id = ANY (v_ids) AND status = 'aguardando_retorno';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- 2º UPDATE: confirmação e finalização. Quando os gatilhos rodam, os de
  -- confirmação e de finalização limpam essas colunas no UPDATE que muda o
  -- status — por isso vêm depois, com as marcas das duas RPCs.
  PERFORM set_config('app.chamado_confirmacao', 'on', true);
  PERFORM set_config('app.chamado_finalizacao', 'on', true);
  UPDATE public."CHAMADO_SISTEMA"
     SET conclusao_confirmada_em = now(), conclusao_confirmada_por = NULL,
         gestao_finalizada_em = now(), gestao_finalizada_por = NULL,
         concluido_sem_retorno = true
   WHERE id = ANY (v_ids) AND status = 'concluido';
  PERFORM set_config('app.chamado_finalizacao', 'off', true);
  PERFORM set_config('app.chamado_confirmacao', 'off', true);

  IF v_replica THEN
    PERFORM set_config('session_replication_role', 'origin', true);
  ELSE
    PERFORM set_config('request.jwt.claim.role', '', true);
  END IF;

  -- Conversa (tipo 'evento': o solicitante vê; só observacao_interna é
  -- escondida) e sino, já com os gatilhos de volta.
  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
  SELECT c.id, COALESCE(c.responsavel_id, c.solicitante_id), 'evento',
         'Concluído automaticamente por falta de retorno: pedimos mais informações e não houve resposta em 3 dias úteis. Se ainda precisar, escreva aqui ou reabra o chamado.',
         jsonb_build_object('acao', 'concluido_sem_retorno')
    FROM public."CHAMADO_SISTEMA" c
   WHERE c.id = ANY (v_ids) AND c.concluido_sem_retorno
     AND COALESCE(c.responsavel_id, c.solicitante_id) IS NOT NULL;

  BEGIN
    INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
    SELECT c.solicitante_id,
           'Chamado #' || c.numero || ': Concluído automaticamente por falta de retorno',
           left(c.assunto, 120) || ' — pedimos mais informações e não houve resposta em 3 dias úteis. Se ainda precisar, escreva no chamado ou reabra.',
           'chamado_concluido_sem_retorno',
           '/app/central-servicos/chamados/' || c.id || '/acompanhar'
      FROM public."CHAMADO_SISTEMA" c
     WHERE c.id = ANY (v_ids) AND c.concluido_sem_retorno AND c.solicitante_id IS NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'chamado_concluir_sem_retorno: aviso não enviado: %', SQLERRM;
  END;

  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.chamado_concluir_sem_retorno() FROM PUBLIC, anon, authenticated;

-- ── 2. Já concluídos sem retorno e parados "aguardando o gestor" ─────────
DO $$
BEGIN
  PERFORM set_config('app.chamado_finalizacao', 'on', true);
  UPDATE public."CHAMADO_SISTEMA"
     SET gestao_finalizada_em = COALESCE(conclusao_confirmada_em, concluido_em, now()),
         gestao_finalizada_por = NULL
   WHERE status = 'concluido' AND concluido_sem_retorno AND gestao_finalizada_em IS NULL;
  PERFORM set_config('app.chamado_finalizacao', 'off', true);
END $$;

-- ── 3. De hora em hora ───────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron ausente - agendamento nao criado (esperado na replica)';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'chamado-concluir-sem-retorno') THEN
    PERFORM cron.unschedule('chamado-concluir-sem-retorno');
  END IF;
  PERFORM cron.schedule('chamado-concluir-sem-retorno', '20 * * * *',
                        'SELECT public.chamado_concluir_sem_retorno()');
END $$;

-- ── 4. Quem já venceu entra agora (não espera a primeira hora cheia) ─────
SELECT public.chamado_concluir_sem_retorno();

NOTIFY pgrst, 'reload schema';

-- Conferência (pgAdmin):
--   SELECT numero, status, aguardando_retorno_ate, concluido_sem_retorno, gestao_finalizada_em
--     FROM public."CHAMADO_SISTEMA" WHERE numero = 'SIS-2026-0771';
--   SELECT start_time, status, return_message FROM cron.job_run_details
--    WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'chamado-concluir-sem-retorno')
--    ORDER BY start_time DESC LIMIT 5;

-- =========================================================================
-- ROLLBACK
--   SELECT cron.unschedule('chamado-concluir-sem-retorno');
--   SELECT cron.schedule('chamado-concluir-sem-retorno', '20 6 * * *',
--                        'SELECT public.chamado_concluir_sem_retorno()');
--   Recriar chamado_concluir_sem_retorno() como na mig 20261114130000.
--   (A finalização dos já concluídos sem retorno fica: desfazer seria pôr
--   chamado de volta na fila do gestor sem motivo.)
--   NOTIFY pgrst, 'reload schema';
-- =========================================================================
