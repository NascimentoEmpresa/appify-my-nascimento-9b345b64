-- =========================================================================
-- Módulo ORGANOGRAMA (30/09/2026)
--
-- PEDIDO (Pablo): "Criar um novo módulo de organograma separado de todos no
-- menu lateral, deixar possível montar o organograma com os integrantes que
-- temos como usuários no sistema. Se possível com foto, nome e função."
--
-- MODELO
--   "ORGANOGRAMA_NO" — um nó por pessoa (usuário do ERP), com quem ela
--   "reporta a" (parent_id), a ordem entre irmãos e, opcionalmente, uma
--   função escrita à mão (senão vale o cargo do cadastro).
--   Foto, nome e cargo NÃO são copiados: vêm na leitura de profiles
--   (avatar_url, display_name) e de EMPREGADOS ("Título do Cargo", pelo
--   auth_user_id) — trocar a foto ou o cargo reflete no organograma sozinho.
--
-- REGRAS NO BANCO
--   · uma pessoa aparece uma vez só (user_id único);
--   · "reporta a" não pode fechar ciclo (A → B → A) — trigger recusa;
--   · apagar um nó sobe os subordinados dele para o chefe dele (ninguém fica
--     solto nem some junto).
--
-- ACESSO — módulo próprio, menu `organograma` (deny-by-default):
--   visualizar = ver; incluir/alterar = montar; excluir = tirar pessoa.
--   Nasce liberado só para o Pablo (quem pediu, para montar o primeiro);
--   o resto se libera em Administração › Acesso por Usuário.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

-- ── 1. Módulo e menu ─────────────────────────────────────────────────────
INSERT INTO public.app_modulo (codigo, nome, ordem, ativo)
VALUES ('organograma', 'Organograma', 6, true)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'organograma', 'Organograma', '/app/organograma', 10, true
  FROM public.app_modulo m WHERE m.codigo = 'organograma'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('organograma', 'excluir'::app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- ── 2. Tabela ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."ORGANOGRAMA_NO" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id   uuid REFERENCES public."ORGANOGRAMA_NO"(id) ON DELETE SET NULL,
  funcao      text,
  ordem       integer NOT NULL DEFAULT 0,
  criado_por  uuid DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organograma_no_nao_e_chefe_de_si CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX IF NOT EXISTS idx_organograma_no_parent ON public."ORGANOGRAMA_NO"(parent_id, ordem);

DROP TRIGGER IF EXISTS trg_organograma_no_updated_at ON public."ORGANOGRAMA_NO";
CREATE TRIGGER trg_organograma_no_updated_at
  BEFORE UPDATE ON public."ORGANOGRAMA_NO"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- "Reporta a" sem ciclo: sobe a cadeia do novo chefe; se passar por si, recusa.
CREATE OR REPLACE FUNCTION public.organograma_no_sem_ciclo()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v uuid := NEW.parent_id; n int := 0;
BEGIN
  WHILE v IS NOT NULL LOOP
    IF v = NEW.id THEN
      RAISE EXCEPTION 'Essa pessoa não pode reportar a alguém que está abaixo dela no organograma.';
    END IF;
    SELECT parent_id INTO v FROM public."ORGANOGRAMA_NO" WHERE id = v;
    n := n + 1;
    IF n > 500 THEN RAISE EXCEPTION 'Organograma com ciclo — revise quem reporta a quem.'; END IF;
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_organograma_no_sem_ciclo ON public."ORGANOGRAMA_NO";
CREATE TRIGGER trg_organograma_no_sem_ciclo
  BEFORE INSERT OR UPDATE OF parent_id ON public."ORGANOGRAMA_NO"
  FOR EACH ROW EXECUTE FUNCTION public.organograma_no_sem_ciclo();

-- Tirar alguém: os subordinados sobem para o chefe dela.
CREATE OR REPLACE FUNCTION public.organograma_no_sobe_filhos()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public."ORGANOGRAMA_NO" SET parent_id = OLD.parent_id WHERE parent_id = OLD.id;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_organograma_no_sobe_filhos ON public."ORGANOGRAMA_NO";
CREATE TRIGGER trg_organograma_no_sobe_filhos
  BEFORE DELETE ON public."ORGANOGRAMA_NO"
  FOR EACH ROW EXECUTE FUNCTION public.organograma_no_sobe_filhos();

-- ── 3. RLS ───────────────────────────────────────────────────────────────
ALTER TABLE public."ORGANOGRAMA_NO" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."ORGANOGRAMA_NO" FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."ORGANOGRAMA_NO" TO authenticated;

DROP POLICY IF EXISTS organograma_no_select ON public."ORGANOGRAMA_NO";
DROP POLICY IF EXISTS organograma_no_insert ON public."ORGANOGRAMA_NO";
DROP POLICY IF EXISTS organograma_no_update ON public."ORGANOGRAMA_NO";
DROP POLICY IF EXISTS organograma_no_delete ON public."ORGANOGRAMA_NO";
CREATE POLICY organograma_no_select ON public."ORGANOGRAMA_NO" FOR SELECT TO authenticated
  USING ((select public.can_access(auth.uid(), 'organograma', 'visualizar'::app_acao)));
CREATE POLICY organograma_no_insert ON public."ORGANOGRAMA_NO" FOR INSERT TO authenticated
  WITH CHECK ((select public.can_access(auth.uid(), 'organograma', 'incluir'::app_acao))
           OR (select public.can_access(auth.uid(), 'organograma', 'alterar'::app_acao)));
CREATE POLICY organograma_no_update ON public."ORGANOGRAMA_NO" FOR UPDATE TO authenticated
  USING ((select public.can_access(auth.uid(), 'organograma', 'alterar'::app_acao)))
  WITH CHECK ((select public.can_access(auth.uid(), 'organograma', 'alterar'::app_acao)));
CREATE POLICY organograma_no_delete ON public."ORGANOGRAMA_NO" FOR DELETE TO authenticated
  USING ((select public.can_access(auth.uid(), 'organograma', 'excluir'::app_acao)));

-- ── 4. Leitura com foto, nome e função ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.organograma_nos()
RETURNS TABLE (
  id uuid, user_id uuid, parent_id uuid, ordem integer, funcao_manual text,
  nome text, email text, avatar_url text, cargo text, setor text, ativo boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'organograma', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Sem acesso ao Organograma.';
  END IF;
  RETURN QUERY
  SELECT o.id, o.user_id, o.parent_id, o.ordem, nullif(btrim(o.funcao), ''),
         coalesce(nullif(btrim(p.display_name), ''), p.email, 'Usuário'),
         p.email, p.avatar_url,
         coalesce(nullif(btrim(e."Título do Cargo"), ''), nullif(btrim(p.cargo), '')),
         coalesce(nullif(btrim(e."Setor_ERP"), ''), (SELECT min(us.setor) FROM public.user_setor us WHERE us.user_id = o.user_id)),
         coalesce(p.ativo, false)
    FROM public."ORGANOGRAMA_NO" o
    LEFT JOIN public.profiles p ON p.id = o.user_id
    LEFT JOIN LATERAL (
      SELECT x."Título do Cargo", x."Setor_ERP" FROM public."EMPREGADOS" x
       WHERE x.auth_user_id = o.user_id
       ORDER BY (x."Situação" = 'Trabalhando') DESC NULLS LAST, x."ID" DESC LIMIT 1
    ) e ON true
   ORDER BY o.ordem, 6;
END;
$$;
REVOKE ALL ON FUNCTION public.organograma_nos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organograma_nos() TO authenticated;

-- Usuários que podem entrar (para o "Adicionar pessoa"), com cargo e setor.
CREATE OR REPLACE FUNCTION public.organograma_usuarios()
RETURNS TABLE (user_id uuid, nome text, email text, avatar_url text, cargo text, setor text, no_organograma boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (public.can_access(auth.uid(), 'organograma', 'incluir'::app_acao)
       OR public.can_access(auth.uid(), 'organograma', 'alterar'::app_acao)) THEN
    RAISE EXCEPTION 'Sem permissão para montar o Organograma.';
  END IF;
  RETURN QUERY
  SELECT p.id, coalesce(nullif(btrim(p.display_name), ''), p.email, 'Usuário'), p.email, p.avatar_url,
         coalesce(nullif(btrim(e."Título do Cargo"), ''), nullif(btrim(p.cargo), '')),
         coalesce(nullif(btrim(e."Setor_ERP"), ''), (SELECT min(us.setor) FROM public.user_setor us WHERE us.user_id = p.id)),
         EXISTS (SELECT 1 FROM public."ORGANOGRAMA_NO" o WHERE o.user_id = p.id)
    FROM public.profiles p
    LEFT JOIN LATERAL (
      SELECT x."Título do Cargo", x."Setor_ERP" FROM public."EMPREGADOS" x
       WHERE x.auth_user_id = p.id
       ORDER BY (x."Situação" = 'Trabalhando') DESC NULLS LAST, x."ID" DESC LIMIT 1
    ) e ON true
   WHERE p.ativo
   ORDER BY 2;
END;
$$;
REVOKE ALL ON FUNCTION public.organograma_usuarios() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organograma_usuarios() TO authenticated;

-- ── 5. Primeiro acesso: quem pediu monta ─────────────────────────────────
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id, motivo)
SELECT p.id, 'organograma', a.acao::app_acao, true, NULL, 'Organograma (mig 277): quem pediu o módulo'
  FROM public.profiles p
 CROSS JOIN (VALUES ('visualizar'), ('incluir'), ('alterar'), ('excluir')) AS a(acao)
 WHERE p.ativo AND upper(btrim(p.display_name)) = 'PABLO FLORES SANTAREM'
ON CONFLICT (user_id, menu_codigo, acao, empresa_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.organograma_usuarios();
-- DROP FUNCTION IF EXISTS public.organograma_nos();
-- DROP TABLE IF EXISTS public."ORGANOGRAMA_NO";
-- DROP FUNCTION IF EXISTS public.organograma_no_sobe_filhos();
-- DROP FUNCTION IF EXISTS public.organograma_no_sem_ciclo();
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'organograma';
-- DELETE FROM public.app_menu_acao          WHERE menu_codigo = 'organograma';
-- DELETE FROM public.app_menu               WHERE codigo      = 'organograma';
-- DELETE FROM public.app_modulo             WHERE codigo      = 'organograma';
-- NOTIFY pgrst, 'reload schema';
