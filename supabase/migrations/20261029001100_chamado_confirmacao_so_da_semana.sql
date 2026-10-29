-- =========================================================================
-- Chamados de Sistemas: só os concluídos DESTA SEMANA esperam a confirmação
-- do solicitante (pedido do Pablo, 29/10/2026)
--
-- "não precisa aparecer os antigos que o pessoal não marcou como concluido,
-- deixa eles marcado como concluido automaticamente. só os dessa semana que
-- o pessoal precisa marcar como concluido."
--
-- A confirmação (mig 20261028001300) é a coluna conclusao_confirmada_em:
-- NULL com status 'concluido' = aguardando o solicitante. Aqui:
--   1. agora: todo concluído ANTES da segunda-feira desta semana (00:00,
--      horário de Brasília) e ainda sem confirmação fica confirmado, com
--      conclusao_confirmada_em = concluido_em e _por = NULL (automático);
--   2. toda madrugada (pg_cron, 03:10): a mesma regra, para a semana que
--      virou. Assim a regra continua valendo — chamado concluído na semana
--      passada nunca fica pendurado esperando clique.
--
-- Sem gatilhos durante o UPDATE (session_replication_role = replica, mesmo
-- cuidado da mig 20261028001300): o gatilho de updated_at acenderia a
-- bolinha de "Chamados de Sistemas" para todo solicitante afetado, e o de
-- confirmação recusaria a marca. Se o papel que roda não puder trocar o
-- session_replication_role, cai na marca de transação app.chamado_confirmacao
-- (a mesma da RPC), e aí o updated_at anda — efeito só visual.
--
-- O que NÃO muda: a avaliação do solicitante continua opcional/pendente como
-- antes; confirmar não avalia por ele.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.chamado_confirmar_conclusoes_antigas()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_corte timestamptz := date_trunc('week', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
  v_replica boolean := false;
  v_n integer;
BEGIN
  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
    v_replica := true;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.chamado_confirmacao', 'on', true);
  END;

  UPDATE public."CHAMADO_SISTEMA"
     SET conclusao_confirmada_em  = COALESCE(concluido_em, updated_at, now()),
         conclusao_confirmada_por = NULL
   WHERE status = 'concluido'
     AND conclusao_confirmada_em IS NULL
     AND COALESCE(concluido_em, updated_at) < v_corte;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- Volta ao normal já, sem esperar o fim da transação: chamada de dentro de
  -- uma migration, o resto do arquivo rodaria sem gatilho nenhum.
  IF v_replica THEN
    PERFORM set_config('session_replication_role', 'origin', true);
  ELSE
    PERFORM set_config('app.chamado_confirmacao', 'off', true);
  END IF;

  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.chamado_confirmar_conclusoes_antigas() FROM PUBLIC, anon, authenticated;

-- 1) Agora.
SELECT public.chamado_confirmar_conclusoes_antigas();

-- 2) Toda madrugada.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron ausente - agendamento nao criado (esperado na replica)';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'chamado-confirmar-conclusoes-antigas') THEN
    PERFORM cron.unschedule('chamado-confirmar-conclusoes-antigas');
  END IF;
  PERFORM cron.schedule('chamado-confirmar-conclusoes-antigas', '10 6 * * *',  -- 06:10 UTC = 03:10 em Brasília
                        'SELECT public.chamado_confirmar_conclusoes_antigas()');
END $$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   SELECT cron.unschedule('chamado-confirmar-conclusoes-antigas');
--   DROP FUNCTION IF EXISTS public.chamado_confirmar_conclusoes_antigas();
--   -- As confirmações automáticas são as com conclusao_confirmada_por NULL
--   -- e conclusao_confirmada_em = concluido_em (as da mig 20261028001300
--   -- também têm esse formato — não dá para separar só pelas colunas).
-- =========================================================================
