-- =====================================================================
-- VÍNCULO DA CONTA DO DISCORD
--
-- Base para as notificações do ERP chegarem no Discord. O que o robô precisa
-- de verdade é o ID do Discord (o "snowflake"): é ele que faz a menção
-- <@id> funcionar num canal e o DM ser endereçável. O e-mail entra junto
-- porque é o que uma pessoa consegue conferir a olho — ninguém reconhece um
-- snowflake.
--
-- DUAS ORIGENS, E A TELA SABE A DIFERENÇA
--   OAuth (um clique)  → `verificado = true`. O Discord confirmou que aquela
--                        conta é de quem clicou; não há como digitar errado
--                        nem reivindicar a conta de outro.
--   Manual (colado)    → `verificado = false`. Serve para quem não quiser
--                        autorizar o app, mas ninguém provou nada: pode ser
--                        typo, pode ser o ID do colega.
--   Quem for disparar notificação depois deve tratar os dois diferente.
--
-- UMA CONTA DE DISCORD POR PESSOA. O UNIQUE em discord_id é o que impede
-- duas contas do ERP apontarem para o mesmo Discord — sem ele, o caminho
-- manual permitiria alguém receber (ou desviar) a notificação de outro.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.usuario_discord_oauth_state, public.usuario_discord;
-- =====================================================================

-- ── 1. O vínculo ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.usuario_discord (
  user_id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  discord_id       text NOT NULL,
  discord_username text,
  discord_email    text,
  discord_avatar   text,
  verificado       boolean NOT NULL DEFAULT false,
  vinculado_em     timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- Snowflake é só dígito. Barra o "@fulano" colado por engano no manual.
  CONSTRAINT usuario_discord_id_numerico CHECK (discord_id ~ '^[0-9]{5,25}$'),
  CONSTRAINT usuario_discord_unico UNIQUE (discord_id)
);

DROP TRIGGER IF EXISTS trg_usuario_discord_updated ON public.usuario_discord;
CREATE TRIGGER trg_usuario_discord_updated BEFORE UPDATE ON public.usuario_discord
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. Estado do OAuth (anti-CSRF) ───────────────────────────────────
-- O `state` amarra a volta do Discord ao usuário que iniciou. Sem isso,
-- alguém poderia induzir a vítima a concluir um fluxo iniciado por outro e
-- vincular a PRÓPRIA conta de Discord à conta de ERP da vítima.
CREATE TABLE IF NOT EXISTS public.usuario_discord_oauth_state (
  state      text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usuario_discord_state_criado
  ON public.usuario_discord_oauth_state(created_at);

-- ── 3. RLS ───────────────────────────────────────────────────────────
-- Cada um enxerga e mexe apenas no próprio vínculo. Quem administra o ERP
-- vê todos, para saber quem falta vincular. Quem dispara notificação roda
-- como service_role e não passa por aqui.
ALTER TABLE public.usuario_discord             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuario_discord_oauth_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuario_discord_select ON public.usuario_discord;
CREATE POLICY usuario_discord_select ON public.usuario_discord
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.tem_acesso_menu('administracao'));

DROP POLICY IF EXISTS usuario_discord_insert ON public.usuario_discord;
CREATE POLICY usuario_discord_insert ON public.usuario_discord
  FOR INSERT TO authenticated
  -- Só o caminho manual passa por aqui. O OAuth grava por service_role e é
  -- o único que pode marcar verificado = true.
  WITH CHECK (user_id = auth.uid() AND verificado = false);

DROP POLICY IF EXISTS usuario_discord_update ON public.usuario_discord;
CREATE POLICY usuario_discord_update ON public.usuario_discord
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND verificado = false);

DROP POLICY IF EXISTS usuario_discord_delete ON public.usuario_discord;
CREATE POLICY usuario_discord_delete ON public.usuario_discord
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.tem_acesso_menu('administracao'));

-- O state nunca é lido pelo navegador: quem valida é a Edge Function, por
-- service_role. Sem policy de SELECT, ninguém autenticado enxerga.
DROP POLICY IF EXISTS usuario_discord_state_nada ON public.usuario_discord_oauth_state;

-- ── 4. Faxina dos states vencidos ────────────────────────────────────
-- 10 minutos é folga de sobra para autorizar no Discord e voltar.
CREATE OR REPLACE FUNCTION public.usuario_discord_limpar_states()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM public.usuario_discord_oauth_state
   WHERE created_at < now() - interval '10 minutes';
$$;
REVOKE ALL ON FUNCTION public.usuario_discord_limpar_states() FROM PUBLIC, anon, authenticated;

-- ── 5. Quem ainda não vinculou ───────────────────────────────────────
-- Serve à tela de administração e, depois, ao disparo de notificação.
CREATE OR REPLACE FUNCTION public.usuarios_sem_discord()
RETURNS TABLE (user_id uuid, display_name text, email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.display_name, p.email
    FROM public.profiles p
   WHERE public.tem_acesso_menu('administracao')
     AND coalesce(p.ativo, true)
     AND NOT EXISTS (SELECT 1 FROM public.usuario_discord d WHERE d.user_id = p.id)
   ORDER BY p.display_name;
$$;
REVOKE ALL ON FUNCTION public.usuarios_sem_discord() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usuarios_sem_discord() TO authenticated;

-- ── 6. Conferência ───────────────────────────────────────────────────
SELECT count(*) AS vinculos FROM public.usuario_discord;

NOTIFY pgrst, 'reload schema';
