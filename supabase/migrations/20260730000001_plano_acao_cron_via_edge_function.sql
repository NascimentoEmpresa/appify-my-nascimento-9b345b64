-- Troca o cron "plano-acao-marcar-atrasadas" de UPDATE direto em SQL pra
-- chamar a edge function (service_role, ignora RLS de propósito) — mesmo
-- padrão de sla-escalonamento-tick / regua-cobranca-tick.
--
-- Causa do UPDATE direto não funcionar: rodando dentro do cron não existe
-- auth.uid() (não é uma sessão autenticada), e a policy de UPDATE de
-- plano_acao (pa_update) depende de auth.uid() via plano_acao_can_access —
-- então o UPDATE "rodava" sem erro mas a RLS filtrava tudo, 0 linhas
-- afetadas (confirmado: cron.job_run_details nunca teve nenhuma execução
-- registrada pro job antigo).
--
-- Header Authorization também é necessário além do apikey — testado via
-- curl manual e o gateway do Supabase devolvia 401
-- UNAUTHORIZED_NO_AUTH_HEADER só com apikey (a função tinha "Verify JWT"
-- ligado por padrão no deploy). Mandar o anon key também em Authorization
-- resolve sem precisar mexer nessa configuração da função.

DO $$
BEGIN
  PERFORM cron.unschedule('plano-acao-marcar-atrasadas');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'plano-acao-marcar-atrasadas',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://fwmzeaztjxrxxzxzxmgc.supabase.co/functions/v1/plano-acao-marcar-atrasadas',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3bXplYXp0anhyeHh6eHp4bWdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MDc0NTAsImV4cCI6MjA5MjE4MzQ1MH0.i08oF2-9N6w-CxDVy8ink29-ydHTJEc-eQBZDYRxGwI","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3bXplYXp0anhyeHh6eHp4bWdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MDc0NTAsImV4cCI6MjA5MjE4MzQ1MH0.i08oF2-9N6w-CxDVy8ink29-ydHTJEc-eQBZDYRxGwI"}'::jsonb,
    body := jsonb_build_object('tick_at', now())
  );
  $$
);
