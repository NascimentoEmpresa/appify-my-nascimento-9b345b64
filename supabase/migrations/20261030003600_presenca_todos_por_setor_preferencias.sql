-- ============================================================================
--  PAINEL ONLINE: TODO MUNDO, POR SETOR, COM FAVORITOS E ORDEM PRÓPRIA
--  (30/10/2026, pedido do Pablo em cima de 20261030003100)
--
--  "Em Online tá aparecendo só alguns, tem que aparecer todos, separados por
--  setor, e cada um pode arrastar e organizar o seu do jeito que quiser,
--  adicionar favoritos etc."
--
--  POR QUE DUAS RPCs E NÃO UMA
--  A lista de pessoas (centenas) quase não muda; a presença (quem deu sinal
--  nos últimos minutos) muda a cada minuto e é pequena. Juntar as duas numa
--  RPC só faria cada aba refazer, POR MINUTO, o erp_login_bloqueado de
--  centenas de usuários. Então:
--    presenca_usuarios() — elenco: nome, foto, setor. O front guarda em cache
--                          por 10 min;
--    presenca_listar()   — a de 20261030003100, intocada, segue por minuto.
--  O front cruza as duas por user_id (src/lib/presencaOnline.ts).
--
--  QUEM ENTRA NO ELENCO
--  A mesma régua de cs_form_participacao_mes: profiles.ativo e login não
--  bloqueado (erp_login_bloqueado — demitido/afastado sem exceção fica fora).
--  Só nome, foto e setor: o card do painel não mostra mais nada.
--
--  PREFERÊNCIA POR USUÁRIO
--  usuario_presenca_preferencia: uma linha por pessoa, jsonb com favoritos,
--  ordem dos setores, ordem das pessoas por grupo e grupos recolhidos. No
--  banco, e não em localStorage, para valer em qualquer máquina. Cada um só
--  lê e grava a própria linha. O formato é validado no front
--  (normalizarPreferencias) — o banco só guarda.
-- ============================================================================

-- 1) Elenco --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.presenca_usuarios()
RETURNS TABLE (user_id uuid, nome text, avatar_url text, setor text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH base AS MATERIALIZED (
    SELECT p.id, p.display_name, p.email, p.avatar_url
      FROM public.profiles p
     WHERE p.ativo
       AND auth.uid() IS NOT NULL
       AND NOT COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false)
  )
  SELECT b.id,
         COALESCE(NULLIF(btrim(b.display_name), ''), split_part(b.email, '@', 1))::text,
         b.avatar_url::text,
         (SELECT NULLIF(btrim(e."Setor_ERP"), '')
            FROM public."EMPREGADOS" e
           WHERE e.auth_user_id = b.id
           ORDER BY public.col_desligado(e."Situação") ASC, e."ID" DESC
           LIMIT 1)::text
    FROM base b
   WHERE NOT public.erp_login_bloqueado(b.id)
   ORDER BY 2;
$$;

REVOKE ALL ON FUNCTION public.presenca_usuarios() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.presenca_usuarios() TO authenticated;

-- 2) Preferência do painel -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.usuario_presenca_preferencia (
  user_id       uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  preferencias  jsonb NOT NULL DEFAULT '{}'::jsonb,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  -- Teto de tamanho: centenas de ids cabem folgado em 64 KB; impede que
  -- alguém use a linha como depósito.
  CONSTRAINT usuario_presenca_preferencia_tamanho CHECK (pg_column_size(preferencias) <= 65536)
);

ALTER TABLE public.usuario_presenca_preferencia ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.usuario_presenca_preferencia FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.usuario_presenca_preferencia TO authenticated;

DROP POLICY IF EXISTS "presenca preferencia select" ON public.usuario_presenca_preferencia;
CREATE POLICY "presenca preferencia select" ON public.usuario_presenca_preferencia
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "presenca preferencia insert" ON public.usuario_presenca_preferencia;
CREATE POLICY "presenca preferencia insert" ON public.usuario_presenca_preferencia
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "presenca preferencia update" ON public.usuario_presenca_preferencia;
CREATE POLICY "presenca preferencia update" ON public.usuario_presenca_preferencia
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP TRIGGER IF EXISTS trg_usuario_presenca_preferencia_updated ON public.usuario_presenca_preferencia;
CREATE OR REPLACE FUNCTION public.usuario_presenca_preferencia_toca()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_usuario_presenca_preferencia_updated
  BEFORE UPDATE ON public.usuario_presenca_preferencia
  FOR EACH ROW EXECUTE FUNCTION public.usuario_presenca_preferencia_toca();

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS trg_usuario_presenca_preferencia_updated ON public.usuario_presenca_preferencia;
-- DROP FUNCTION IF EXISTS public.usuario_presenca_preferencia_toca();
-- DROP TABLE IF EXISTS public.usuario_presenca_preferencia;
-- DROP FUNCTION IF EXISTS public.presenca_usuarios();
-- NOTIFY pgrst, 'reload schema';
