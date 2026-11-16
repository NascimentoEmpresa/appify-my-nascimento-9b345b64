-- =========================================================================
-- [SEM-CHAMADO] CHAMADO SEM RETORNO DO SOLICITANTE: CONCLUI SOZINHO EM 3 DIAS
--
-- O PEDIDO (14/11/2026, Pablo)
--   "Quando a pessoa abre chamado e nós solicitamos mais informações o
--   chamado fica 3 dias aguardando mais informações, após isso ele conclui
--   automaticamente por falta de comunicação"
--
-- ANTES: "Solicitar mais informações" põe o chamado em 'aguardando_retorno'
-- e ele fica lá para sempre se o solicitante não responder.
--
-- AGORA
--   1. Coluna aguardando_retorno_ate: ao ENTRAR em 'aguardando_retorno',
--      o gatilho marca o fim do 3º DIA ÚTIL (23:59 de Brasília, sem fim de
--      semana nem feriado — chamado_previsao_entrega, a mesma conta do
--      prazo do chamado). Pedido na sexta não vence na segunda. Saiu do
--      status (o solicitante respondeu, o time mudou) → limpa. Pedir de
--      novo depois → conta de novo.
--   2. chamado_concluir_sem_retorno(), toda madrugada (pg_cron, 03:20):
--      vencidos viram 'concluido' com concluido_sem_retorno = true e a
--      conclusão já confirmada — não fica pendência de "Confirmar
--      conclusão" nem de avaliação travando o solicitante de abrir chamado
--      novo (chamado_pendencias_solicitante ignora estes). Entra um evento
--      na conversa e uma notificação para o solicitante. Ele ainda pode
--      escrever na conversa (só reprovado/cancelado fecham) e reabrir.
--      O UPDATE roda sem gatilhos (session_replication_role = replica,
--      como chamado_confirmar_conclusoes_antigas): uma conclusão por falta
--      de retorno NÃO é entrega — não gera Novidade por IA, parecer da IA
--      nem o "Confirme a conclusão". Se o papel não puder trocar o
--      replication_role, entra como automação de servidor (service_role).
--   3. Quem JÁ está aguardando retorno ganha 3 dias úteis a partir de
--      hoje — ninguém é concluído no dia do deploy sem aviso.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================
SET lock_timeout = '5s';

-- ── 1. Colunas ────────────────────────────────────────────────────────────
ALTER TABLE public."CHAMADO_SISTEMA"
  ADD COLUMN IF NOT EXISTS aguardando_retorno_ate timestamptz,
  ADD COLUMN IF NOT EXISTS concluido_sem_retorno boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_chamado_sistema_aguardando_retorno_ate
  ON public."CHAMADO_SISTEMA" (aguardando_retorno_ate)
  WHERE status = 'aguardando_retorno';

-- ── 2. Gatilho: marca e limpa o prazo ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_sistema_prazo_retorno()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'aguardando_retorno' THEN
    IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'aguardando_retorno' OR NEW.aguardando_retorno_ate IS NULL THEN
      NEW.aguardando_retorno_ate := public.chamado_previsao_entrega(now(), 3);
    END IF;
  ELSE
    NEW.aguardando_retorno_ate := NULL;
  END IF;
  IF NEW.status IS DISTINCT FROM 'concluido' THEN
    NEW.concluido_sem_retorno := false;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.chamado_sistema_prazo_retorno() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chamado_sistema_prazo_retorno ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_sistema_prazo_retorno
  BEFORE INSERT OR UPDATE ON public."CHAMADO_SISTEMA"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_sistema_prazo_retorno();

-- Quem já está aguardando: 3 dias úteis a partir de hoje.
UPDATE public."CHAMADO_SISTEMA"
   SET aguardando_retorno_ate = public.chamado_previsao_entrega(now(), 3)
 WHERE status = 'aguardando_retorno' AND aguardando_retorno_ate IS NULL;

-- ── 3. Concluir os vencidos ───────────────────────────────────────────────
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

  -- Conclusão já confirmada (2º UPDATE: o gatilho de confirmação limpa a
  -- marca no mesmo UPDATE que muda o status, quando os gatilhos rodam).
  PERFORM set_config('app.chamado_confirmacao', 'on', true);
  UPDATE public."CHAMADO_SISTEMA"
     SET conclusao_confirmada_em = now(), conclusao_confirmada_por = NULL,
         concluido_sem_retorno = true
   WHERE id = ANY (v_ids) AND status = 'concluido';
  PERFORM set_config('app.chamado_confirmacao', 'off', true);

  IF v_replica THEN
    PERFORM set_config('session_replication_role', 'origin', true);
  ELSE
    PERFORM set_config('request.jwt.claim.role', '', true);
  END IF;

  -- Conversa e aviso, já com os gatilhos de volta (a notificação segue o
  -- caminho normal dela).
  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
  SELECT c.id, COALESCE(c.responsavel_id, c.solicitante_id), 'evento',
         'Chamado concluído automaticamente por falta de retorno: o pedido de mais informações ficou 3 dias úteis sem resposta do solicitante.',
         jsonb_build_object('acao', 'concluido_sem_retorno')
    FROM public."CHAMADO_SISTEMA" c
   WHERE c.id = ANY (v_ids) AND c.concluido_sem_retorno
     AND COALESCE(c.responsavel_id, c.solicitante_id) IS NOT NULL;

  BEGIN
    INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
    SELECT c.solicitante_id,
           'Chamado #' || c.numero || ' concluído por falta de retorno',
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

-- ── 4. Sem pendência de confirmar/avaliar para os concluídos sem retorno ──
-- Mesmo corpo da mig 20261028001300; só entra `NOT c.concluido_sem_retorno`.
CREATE OR REPLACE FUNCTION public.chamado_pendencias_solicitante(p_uid uuid)
 RETURNS TABLE(id uuid, numero text, assunto text, concluido_em timestamp with time zone, pendencia text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  SELECT * FROM (
    -- Concluído pelo time, solicitante ainda não confirmou (mig 20261028001300).
    SELECT c.id, c.numero, c.assunto, c.concluido_em, 'confirmacao'::text
      FROM public."CHAMADO_SISTEMA" c
      LEFT JOIN public."CHAMADO_SISTEMA_VALIDACAO" v ON v.chamado_id = c.id
     WHERE c.solicitante_id = p_uid
       AND c.status = 'concluido'
       AND NOT c.concluido_sem_retorno
       AND c.conclusao_confirmada_em IS NULL
       AND (v.chamado_id IS NULL OR v.etapa IN ('treinamento', 'finalizado'))
    UNION ALL
    SELECT c.id, c.numero, c.assunto, c.concluido_em, 'avaliacao'::text
      FROM public."CHAMADO_SISTEMA" c
      LEFT JOIN public."CHAMADO_SISTEMA_VALIDACAO" v ON v.chamado_id = c.id
     WHERE c.solicitante_id = p_uid
       AND c.status = 'concluido'
       AND NOT c.concluido_sem_retorno
       AND c.conclusao_confirmada_em IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_AVALIACAO" a WHERE a.chamado_id = c.id)
       -- Presidência ainda validando (ou devolvido ao dev): nada a fazer pelo solicitante.
       AND (v.chamado_id IS NULL OR v.etapa IN ('treinamento', 'finalizado'))
    UNION ALL
    -- Participante extra (mig 20261009000003): mesma janela do solicitante.
    SELECT c.id, c.numero, c.assunto, c.concluido_em, 'avaliacao_participante'::text
      FROM public."CHAMADO_SISTEMA_PARTICIPANTE" pp
      JOIN public."CHAMADO_SISTEMA" c ON c.id = pp.chamado_id
      LEFT JOIN public."CHAMADO_SISTEMA_VALIDACAO" v ON v.chamado_id = c.id
     WHERE pp.user_id = p_uid
       AND c.status = 'concluido'
       AND NOT c.concluido_sem_retorno
       AND NOT EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_PARTICIPANTE_AVALIACAO" a WHERE a.chamado_id = c.id AND a.user_id = p_uid)
       AND (v.chamado_id IS NULL OR v.etapa IN ('treinamento', 'finalizado'))
  ) x
  ORDER BY x.concluido_em NULLS LAST;
$function$;

-- ── 5. Toda madrugada ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron ausente - agendamento nao criado (esperado na replica)';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'chamado-concluir-sem-retorno') THEN
    PERFORM cron.unschedule('chamado-concluir-sem-retorno');
  END IF;
  PERFORM cron.schedule('chamado-concluir-sem-retorno', '20 6 * * *',  -- 06:20 UTC = 03:20 em Brasília
                        'SELECT public.chamado_concluir_sem_retorno()');
END $$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   SELECT cron.unschedule('chamado-concluir-sem-retorno');
--   Recriar chamado_pendencias_solicitante como na mig 20261028001300.
--   DROP FUNCTION IF EXISTS public.chamado_concluir_sem_retorno();
--   DROP TRIGGER IF EXISTS trg_chamado_sistema_prazo_retorno ON public."CHAMADO_SISTEMA";
--   DROP FUNCTION IF EXISTS public.chamado_sistema_prazo_retorno();
--   DROP INDEX IF EXISTS public.idx_chamado_sistema_aguardando_retorno_ate;
--   ALTER TABLE public."CHAMADO_SISTEMA" DROP COLUMN IF EXISTS concluido_sem_retorno,
--                                        DROP COLUMN IF EXISTS aguardando_retorno_ate;
--   NOTIFY pgrst, 'reload schema';
-- =========================================================================
