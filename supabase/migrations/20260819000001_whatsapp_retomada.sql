-- =====================================================================
-- WHATSAPP — retomada (cutucar quem não respondeu) + anti-repetição
--
-- Dois problemas do bot hoje:
--
-- 1) REPETIÇÃO: em modo menu, QUALQUER texto solto reapresenta o menu raiz
--    (whatsapp-bot.ts, rota "menu"). Quem escreve três vezes seguidas recebe
--    a saudação inteira três vezes. Passa a existir uma janela em minutos
--    (WA_BOT_CONFIG.nao_repetir_menu_min): dentro dela o menu não se repete.
--
-- 2) SILÊNCIO: não havia como cutucar quem parou de responder. Cada opção do
--    menu ganha um `retomada` no próprio jsonb ({minutos, mensagem}) e o que
--    for agendado cai nesta fila, processada pelo cron.
--
-- Por que uma tabela em vez de calcular na hora: a cutucada é um evento
-- ÚNICO por resposta, precisa sobreviver a reinício e não pode disparar duas
-- vezes. Estado explícito com status é o que dá idempotência.
--
-- ⚠ Janela de 24h: cutucada é mensagem iniciada pelo negócio. Fora das 24h da
-- última mensagem do contato a Meta recusa (erro 131047), então o tick marca
-- 'expirada' em vez de enfileirar uma falha. Por isso o teto de 1440 min.
--
-- Idempotente.
-- ROLLBACK:
--   SELECT cron.unschedule('whatsapp-retomada-tick');
--   DROP TABLE IF EXISTS public."WA_RETOMADA";
--   ALTER TABLE public."WA_BOT_CONFIG" DROP COLUMN IF EXISTS nao_repetir_menu_min;
-- =====================================================================

-- 1) Anti-repetição do menu ---------------------------------------------
-- 0 = desligado (repete sempre, comportamento antigo). Padrão 720 = 12h.
ALTER TABLE public."WA_BOT_CONFIG"
  ADD COLUMN IF NOT EXISTS nao_repetir_menu_min int NOT NULL DEFAULT 720;

COMMENT ON COLUMN public."WA_BOT_CONFIG".nao_repetir_menu_min IS
  'Minutos em que o menu/saudação não se repete para a mesma conversa. 0 desliga.';

-- 2) Fila de retomadas ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public."WA_RETOMADA" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id  uuid NOT NULL REFERENCES public."WA_CONVERSA"(id) ON DELETE CASCADE,
  contato_id   uuid NOT NULL REFERENCES public."WA_CONTATO"(id) ON DELETE CASCADE,
  opcao_id     text,                      -- opção do menu que agendou (rastro)
  mensagem     text NOT NULL,
  enviar_em    timestamptz NOT NULL,
  -- pendente → enviada | cancelada (a pessoa respondeu / humano assumiu)
  --                    | expirada  (passou das 24h, a Meta recusaria)
  status       text NOT NULL DEFAULT 'pendente',
  detalhe      text,
  criada_em    timestamptz NOT NULL DEFAULT now(),
  processada_em timestamptz
);

-- O tick varre por (status, enviar_em); o cancelamento varre por conversa.
CREATE INDEX IF NOT EXISTS wa_retomada_fila_idx
  ON public."WA_RETOMADA" (status, enviar_em) WHERE status = 'pendente';
CREATE INDEX IF NOT EXISTS wa_retomada_conversa_idx
  ON public."WA_RETOMADA" (conversa_id) WHERE status = 'pendente';

-- 3) RLS: mesma regra da conversa (quem enxerga a pasta enxerga a fila) ---
ALTER TABLE public."WA_RETOMADA" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wa_retomada_rw ON public."WA_RETOMADA";
CREATE POLICY wa_retomada_rw ON public."WA_RETOMADA" FOR ALL TO authenticated
  USING (
    public.tem_acesso_menu('whatsapp')
    AND EXISTS (SELECT 1 FROM public."WA_CONVERSA" c
                 WHERE c.id = conversa_id AND public.wa_pode_ver_pasta(c.pasta_codigo))
  )
  WITH CHECK (
    public.tem_acesso_menu('whatsapp')
    AND EXISTS (SELECT 1 FROM public."WA_CONVERSA" c
                 WHERE c.id = conversa_id AND public.wa_pode_ver_pasta(c.pasta_codigo))
  );

-- 4) Cron a cada 5 min ---------------------------------------------------
-- Nada de chave literal aqui. Os outros crons do projeto colam a anon key no
-- comando; ela é publicável (já vai no bundle do front), mas repetida em
-- várias migrations vira dívida: rotacionar exigiria caçar todas, e o valor
-- fica no histórico do git para sempre — num repositório público, ainda por
-- cima. Aqui o comando lê do Vault.
--
-- Além disso o tick exige `x-tick-secret`. A anon key NÃO serve de tranca:
-- qualquer pessoa a tem, então sem esse cabeçalho qualquer um poderia forçar
-- o processamento da fila de cutucadas. O mesmo segredo está nos secrets da
-- edge function (WHATSAPP_TICK_SECRET).
--
-- Pré-requisito (uma vez, fora do versionamento — são segredos):
--   SELECT vault.create_secret('<anon key>', 'anon_key', '...');
--   SELECT vault.create_secret('<aleatorio>', 'whatsapp_tick_secret', '...');
--   supabase secrets set WHATSAPP_TICK_SECRET=<o mesmo aleatorio>
DO $$
BEGIN
  PERFORM cron.unschedule('whatsapp-retomada-tick');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'whatsapp-retomada-tick',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://fwmzeaztjxrxxzxzxmgc.supabase.co/functions/v1/whatsapp-retomada-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey',        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key'),
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key'),
      'x-tick-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'whatsapp_tick_secret')
    ),
    body := jsonb_build_object('tick_at', now())
  );
  $$
);

NOTIFY pgrst, 'reload schema';
