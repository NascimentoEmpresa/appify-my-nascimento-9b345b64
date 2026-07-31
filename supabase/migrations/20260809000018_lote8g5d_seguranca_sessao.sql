-- Lote 8g, bloco 5d: funções de segurança/tenant-scoping/anti-escalação com
-- has_role(admin) direto. Todas as policies irmãs (profiles_self_update,
-- "atualizar minhas sessoes", "marcar minhas notificacoes", user_empresa_*)
-- já foram migradas nos Lotes 8a/8g-4 — só restam as próprias funções
-- (trigger BEFORE UPDATE ou helper de tenant-scoping chamado por elas/RLS).
-- Todas mapeadas pra 'administracao'/'alterar', mesmo bypass já usado nas
-- policies irmãs.
-- Corpo copiado verbatim da única definição viva de cada uma (conferido
-- lendo os arquivos-fonte): user_can_see_empresa de 20260519190953,
-- user_pode_atuar_empresa de 20260519210356, profiles_block_self_escalation
-- de 20260529150054, sessoes_block_self_escalation de 20260529153607,
-- notificacoes_block_self_escalation de 20260529153842.
--
-- ROLLBACK: recriar cada função com has_role(auth.uid()/v_uid/_user,
-- 'admin'::app_role) na(s) linha(s) indicada(s), usando os arquivos-fonte
-- citados acima.

-- 1) user_can_see_empresa
CREATE OR REPLACE FUNCTION public.user_can_see_empresa(_empresa_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.can_access(auth.uid(), 'administracao', 'alterar')
    OR EXISTS (
      SELECT 1 FROM public.user_empresa ue
      WHERE ue.user_id = auth.uid() AND ue.empresa_id = _empresa_id
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.empresa_id = _empresa_id
    );
$$;

-- 2) user_pode_atuar_empresa
CREATE OR REPLACE FUNCTION public.user_pode_atuar_empresa(_user uuid, _empresa uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _empresa IS NOT NULL
    AND (
      public.can_access(_user, 'administracao', 'alterar')
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = _user
          AND p.acessa_todas_empresas = true
          AND EXISTS (SELECT 1 FROM public.empresas e WHERE e.id = _empresa AND e.ativa = true)
      )
      OR EXISTS (
        SELECT 1 FROM public.user_empresa ue
        WHERE ue.user_id = _user AND ue.empresa_id = _empresa
      )
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = _user AND p.empresa_id = _empresa
      )
    );
$$;

-- 3) profiles_block_self_escalation
CREATE OR REPLACE FUNCTION public.profiles_block_self_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_effective_role text := COALESCE(
    auth.role(),
    current_setting('request.jwt.claim.role', true),
    current_setting('role', true)
  );
BEGIN
  IF v_uid IS NULL THEN
    IF v_effective_role IN ('service_role','supabase_admin','postgres') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'sessão ausente'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF public.can_access(v_uid, 'administracao', 'alterar') THEN
    RETURN NEW;
  END IF;

  IF v_uid <> OLD.id THEN
    RAISE EXCEPTION 'alteração restrita ao fluxo administrativo'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'campo restrito ao fluxo administrativo'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.acessa_todas_empresas IS DISTINCT FROM OLD.acessa_todas_empresas
     OR NEW.empresa_id          IS DISTINCT FROM OLD.empresa_id
     OR NEW.ativo               IS DISTINCT FROM OLD.ativo
     OR NEW.email               IS DISTINCT FROM OLD.email
     OR NEW.created_at          IS DISTINCT FROM OLD.created_at
     OR NEW.updated_at          IS DISTINCT FROM OLD.updated_at
  THEN
    RAISE EXCEPTION 'campo restrito ao fluxo administrativo'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.must_change_password IS DISTINCT FROM OLD.must_change_password THEN
    IF NOT (OLD.must_change_password = true AND NEW.must_change_password = false) THEN
      RAISE EXCEPTION 'campo restrito ao fluxo administrativo'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 4) sessoes_block_self_escalation
CREATE OR REPLACE FUNCTION public.sessoes_block_self_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_eff text := COALESCE(
    auth.role(),
    current_setting('request.jwt.claim.role', true),
    current_setting('role', true)
  );
BEGIN
  IF v_uid IS NULL THEN
    IF v_eff IN ('service_role', 'supabase_admin', 'postgres') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'sessão ausente'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF public.can_access(v_uid, 'administracao', 'alterar') THEN
    RETURN NEW;
  END IF;

  IF v_uid <> OLD.user_id THEN
    RAISE EXCEPTION 'alteração restrita'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.iniciada_em IS DISTINCT FROM OLD.iniciada_em
     OR NEW.user_agent IS DISTINCT FROM OLD.user_agent
     OR NEW.ip IS DISTINCT FROM OLD.ip
  THEN
    RAISE EXCEPTION 'campo imutável'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.ativa IS DISTINCT FROM OLD.ativa THEN
    IF NOT (OLD.ativa IS TRUE AND NEW.ativa IS FALSE) THEN
      RAISE EXCEPTION 'reativação de sessão não permitida'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 5) notificacoes_block_self_escalation
CREATE OR REPLACE FUNCTION public.notificacoes_block_self_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_eff text := COALESCE(
    auth.role(),
    current_setting('request.jwt.claim.role', true),
    current_setting('role', true)
  );
BEGIN
  IF v_uid IS NULL THEN
    IF v_eff IN ('service_role', 'supabase_admin', 'postgres') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'sessão ausente'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF public.can_access(v_uid, 'administracao', 'alterar') THEN
    RETURN NEW;
  END IF;

  IF v_uid <> OLD.user_id THEN
    RAISE EXCEPTION 'alteração restrita'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
     OR NEW.titulo IS DISTINCT FROM OLD.titulo
     OR NEW.mensagem IS DISTINCT FROM OLD.mensagem
     OR NEW.tipo IS DISTINCT FROM OLD.tipo
     OR NEW.link IS DISTINCT FROM OLD.link
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'campo restrito ao fluxo administrativo'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
