-- ============================================================================
--  QUEM ESTÁ ONLINE — painel na lateral direita (estilo lista de amigos do
--  Discord), 30/10/2026.
--
--  POR QUE HEARTBEAT E NÃO REALTIME PRESENCE
--  O cluster próprio (Patroni + PostgREST/GoTrue/Storage/Kong) não tem o
--  serviço de Realtime — o Kong nem roteia /realtime. E mesmo quando a
--  Supabase hospedada tinha, o Realtime segurava conexões do banco o tempo
--  todo (ver o cabeçalho de useContratosCatalogoRealtime, 21/09/2026: o
--  Postgres reiniciou por esgotamento de conexões). Heartbeat é um POST
--  curto pelo PostgREST a cada 60 s por aba: não prende conexão nenhuma.
--
--  O MODELO
--  Uma linha por usuário em usuario_presenca:
--    visto_em  — último heartbeat (a aba está aberta);
--    ativo_em  — último heartbeat em que a pessoa estava de fato usando
--                (aba visível ou mexeu no mouse/teclado há pouco).
--  A regra de status (online / ausente / offline) mora em
--  src/lib/presencaOnline.ts, com teste; o banco só corta o que já está
--  offline há muito tempo para a lista não trazer todo mundo.
--
--  O QUE SAI DO BANCO
--  Só nome (profiles.display_name — o oficial da Senior quando o login está
--  vinculado), foto e setor (EMPREGADOS."Setor_ERP"). Nada de CPF, cargo,
--  e-mail: o card do painel mostra nome completo e setor e mais nada.
--  Todo usuário vê todos — "todos são amigos" (Pablo). Anônimo (encarregado
--  externo) não tem profiles e por isso nem grava nem aparece.
-- ============================================================================

-- 1) Tabela ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.usuario_presenca (
  user_id  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  visto_em timestamptz NOT NULL DEFAULT now(),
  ativo_em timestamptz NOT NULL DEFAULT now()
);

-- Sem policy de propósito: ninguém lê nem escreve direto, só pelas RPCs.
ALTER TABLE public.usuario_presenca ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.usuario_presenca FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_usuario_presenca_visto_em
  ON public.usuario_presenca (visto_em DESC);

-- 2) Heartbeat ----------------------------------------------------------------
-- Chamado pelo front a cada 60 s. Upsert de uma linha só; o anônimo e quem
-- não tem perfil ativo saem sem gravar nada.
CREATE OR REPLACE FUNCTION public.presenca_registrar(_ativo boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid AND COALESCE(p.ativo, true)) THEN
    RETURN;
  END IF;

  INSERT INTO public.usuario_presenca AS up (user_id, visto_em, ativo_em)
  VALUES (v_uid, now(), now())
  ON CONFLICT (user_id) DO UPDATE
     SET visto_em = now(),
         ativo_em = CASE WHEN _ativo THEN now() ELSE up.ativo_em END;
END $$;

-- 3) Lista --------------------------------------------------------------------
-- Quem deu sinal nos últimos 10 min (a janela de "ausente" do front é menor;
-- a folga é para o relógio do navegador não cortar ninguém antes da hora).
-- Devolve também `agora` do servidor: o front calcula o status contra ele,
-- não contra o relógio da máquina da pessoa, que pode estar adiantado.
CREATE OR REPLACE FUNCTION public.presenca_listar()
RETURNS TABLE (user_id uuid, nome text, avatar_url text, setor text,
               visto_em timestamptz, ativo_em timestamptz, agora timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT up.user_id,
         COALESCE(NULLIF(btrim(p.display_name), ''), split_part(p.email, '@', 1))::text,
         p.avatar_url::text,
         (SELECT NULLIF(btrim(e."Setor_ERP"), '')
            FROM public."EMPREGADOS" e
           WHERE e.auth_user_id = up.user_id
           ORDER BY public.col_desligado(e."Situação") ASC, e."ID" DESC
           LIMIT 1)::text,
         up.visto_em, up.ativo_em, now()
    FROM public.usuario_presenca up
    JOIN public.profiles p ON p.id = up.user_id AND COALESCE(p.ativo, true)
   WHERE auth.uid() IS NOT NULL
     AND NOT COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false)
     AND up.visto_em > now() - interval '10 minutes'
   ORDER BY 2;
$$;

REVOKE ALL ON FUNCTION public.presenca_registrar(boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.presenca_listar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.presenca_registrar(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.presenca_listar() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.presenca_listar();
-- DROP FUNCTION IF EXISTS public.presenca_registrar(boolean);
-- DROP TABLE IF EXISTS public.usuario_presenca;
-- NOTIFY pgrst, 'reload schema';
