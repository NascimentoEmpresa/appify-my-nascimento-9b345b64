-- =========================================================================
-- NOVIDADE AUTOMÁTICA AO CONCLUIR CHAMADO (pedido do Pablo, 21/08/2026)
--
-- Quando um Chamado de Sistemas é concluído, a IA lê o chamado, escreve o
-- aviso em linguagem de usuário e PUBLICA em SISTEMA_NOVIDADES — que já
-- alimenta o sino do topo, o painel do Início e /app/novidades. Nenhuma tela
-- nova: a novidade automática é uma novidade como as outras.
--
-- "Só os próximos, não os antigos": o gatilho é a TRANSIÇÃO de status, então
-- chamado já concluído nunca dispara nada. A edge function ainda confere
-- concluido_em >= o marco, para o caso de um UPDATE em massa reencostar em
-- linha velha.
--
-- Quem escreve é a edge function novidade-ia-chamado (service_role, ignora
-- RLS de propósito — não existe auth.uid() dentro de um trigger disparado
-- pelo GitHub Actions, e o INSERT direto aqui esbarraria na policy que cobra
-- o flag novidades_publicar).
-- =========================================================================

-- ── 1) De onde veio cada novidade ────────────────────────────────────────
ALTER TABLE public."SISTEMA_NOVIDADES"
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS chamado_id uuid;

DO $$
BEGIN
  ALTER TABLE public."SISTEMA_NOVIDADES"
    ADD CONSTRAINT sistema_novidades_origem_chk CHECK (origem IN ('manual', 'ia'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public."SISTEMA_NOVIDADES"
    ADD CONSTRAINT sistema_novidades_chamado_fk
    FOREIGN KEY (chamado_id) REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Um chamado, uma novidade. Reabrir e reconcluir não gera a segunda.
CREATE UNIQUE INDEX IF NOT EXISTS sistema_novidades_chamado_uk
  ON public."SISTEMA_NOVIDADES" (chamado_id) WHERE chamado_id IS NOT NULL;

COMMENT ON COLUMN public."SISTEMA_NOVIDADES".origem IS
  'manual = alguém escreveu na tela; ia = gerada ao concluir o chamado em chamado_id.';

-- ── 2) O que a IA decidiu, chamado a chamado ─────────────────────────────
-- Serve para duas coisas: idempotência (a PK é o chamado, então o mesmo
-- chamado não gasta duas chamadas de IA) e auditoria — quando o Pablo
-- perguntar "por que o SIS-2026-0123 não virou novidade?", o motivo está aqui.
CREATE TABLE IF NOT EXISTS public."SISTEMA_NOVIDADES_IA_LOG" (
  chamado_id  uuid PRIMARY KEY REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE CASCADE,
  decisao     text        NOT NULL CHECK (decisao IN ('publicado', 'descartado')),
  motivo      text,
  novidade_id bigint      REFERENCES public."SISTEMA_NOVIDADES"(id) ON DELETE SET NULL,
  criado_em   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."SISTEMA_NOVIDADES_IA_LOG" IS
  'Uma linha por chamado avaliado pela IA de novidades. Garante idempotência e explica os descartes.';

ALTER TABLE public."SISTEMA_NOVIDADES_IA_LOG" ENABLE ROW LEVEL SECURITY;

-- Leitura só para quem publica novidades; escrita só via service_role (a edge
-- function), que não passa por RLS. Sem policy de INSERT de propósito.
DROP POLICY IF EXISTS sistema_novidades_ia_log_ler ON public."SISTEMA_NOVIDADES_IA_LOG";
CREATE POLICY sistema_novidades_ia_log_ler ON public."SISTEMA_NOVIDADES_IA_LOG"
  FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'novidades_publicar', 'incluir'));

REVOKE ALL ON public."SISTEMA_NOVIDADES_IA_LOG" FROM anon;
GRANT SELECT ON public."SISTEMA_NOVIDADES_IA_LOG" TO authenticated;

-- ── 3) O gatilho ─────────────────────────────────────────────────────────
-- SECURITY DEFINER porque net.http_post não é executável pelo `authenticated`
-- que fez o UPDATE (nem pela service_role do chamado-concluir-pr).
--
-- O corpo inteiro é best-effort: se o pg_net estiver fora do ar ou a extensão
-- sumir, o chamado TEM que concluir do mesmo jeito. Deixar a exceção subir
-- transformaria "a IA falhou" em "o dev não consegue concluir o chamado".
CREATE OR REPLACE FUNCTION public.chamado_concluido_gera_novidade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, extensions, pg_temp
AS $$
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := 'https://fwmzeaztjxrxxzxzxmgc.supabase.co/functions/v1/novidade-ia-chamado',
      headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3bXplYXp0anhyeHh6eHp4bWdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MDc0NTAsImV4cCI6MjA5MjE4MzQ1MH0.i08oF2-9N6w-CxDVy8ink29-ydHTJEc-eQBZDYRxGwI","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3bXplYXp0anhyeHh6eHp4bWdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MDc0NTAsImV4cCI6MjA5MjE4MzQ1MH0.i08oF2-9N6w-CxDVy8ink29-ydHTJEc-eQBZDYRxGwI"}'::jsonb,
      body := jsonb_build_object('chamado_id', NEW.id)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'novidade-ia-chamado não foi disparada para %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;  -- AFTER trigger: o retorno é ignorado
END $$;

REVOKE ALL ON FUNCTION public.chamado_concluido_gera_novidade() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chamado_concluido_novidade_ia ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_concluido_novidade_ia
  AFTER UPDATE ON public."CHAMADO_SISTEMA"
  FOR EACH ROW
  -- Só a transição para concluído. Salvar prazo, trocar responsável ou editar
  -- um chamado que JÁ estava concluído não redispara nada.
  WHEN (NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM 'concluido')
  EXECUTE FUNCTION public.chamado_concluido_gera_novidade();

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_chamado_concluido_novidade_ia ON public."CHAMADO_SISTEMA";
--   DROP FUNCTION IF EXISTS public.chamado_concluido_gera_novidade();
--   DROP TABLE IF EXISTS public."SISTEMA_NOVIDADES_IA_LOG";
--   DROP INDEX IF EXISTS public.sistema_novidades_chamado_uk;
--   ALTER TABLE public."SISTEMA_NOVIDADES"
--     DROP CONSTRAINT IF EXISTS sistema_novidades_chamado_fk,
--     DROP CONSTRAINT IF EXISTS sistema_novidades_origem_chk,
--     DROP COLUMN IF EXISTS chamado_id, DROP COLUMN IF EXISTS origem;
-- =========================================================================
