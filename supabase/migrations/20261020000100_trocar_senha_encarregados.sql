-- =====================================================================
-- Configurações do ERP › "PODE TROCAR A SENHA" (Encarregados) — 20/10/2026.
--
-- Pedido do Pablo: o escritório (outros setores) precisa redefinir a senha
-- dos ENCARREGADOS sem ganhar a Administração inteira. Nova opção no
-- gerenciamento de acesso; quem tem, ao clicar em "Configurações do ERP", vê
-- APENAS o reset de senha, e só dos usuários do setor Encarregados.
--
--   1. app_menu 'trocar_senha_encarregados' (módulo admin, rota própria
--      /app/senhas-encarregados) — aparece em Acesso por Usuário como
--      qualquer tela; o switch "visualizar" é a permissão inteira.
--   2. senha_alvo_encarregado(alvo): o alvo é do setor Encarregados
--      (public.user_setor, Administração › Setores) e NÃO administra o ERP —
--      senão bastaria pôr um admin no setor Encarregados para tomar a conta
--      dele.
--   3. senha_pode_resetar(quem, alvo): a régua da Edge admin-reset-password.
--      Administração/alterar continua resetando qualquer um (como antes); a
--      permissão nova, só alvo Encarregado.
--   4. senha_encarregados_listar(): a lista da tela nova.
--
-- A Edge admin-reset-password passa a chamar senha_pode_resetar (deploy
-- automático no merge, cluster_pos_merge.yml).
-- =====================================================================

-- ── 1. A opção no gerenciamento de acesso ─────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'trocar_senha_encarregados', 'PODE TROCAR A SENHA (só usuários do setor Encarregados)',
       '/app/senhas-encarregados', 90, true
  FROM public.app_modulo m WHERE m.codigo = 'admin'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- ── 2. O alvo é Encarregado (e não administrador) ─────────────────────
CREATE OR REPLACE FUNCTION public.senha_alvo_encarregado(_alvo uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT _alvo IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.user_setor s
                  WHERE s.user_id = _alvo
                    AND public.sup_norm_nome(s.setor) IN ('ENCARREGADOS', 'ENCARREGADO'))
     AND NOT public.can_access(_alvo, 'administracao', 'alterar'::public.app_acao);
$$;
REVOKE ALL ON FUNCTION public.senha_alvo_encarregado(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.senha_alvo_encarregado(uuid) TO service_role;

-- ── 3. A régua do reset ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.senha_pode_resetar(_quem uuid, _alvo uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT _quem IS NOT NULL AND _alvo IS NOT NULL AND (
         public.can_access(_quem, 'administracao', 'alterar'::public.app_acao)
      OR (public.has_screen_access(_quem, 'trocar_senha_encarregados', 'visualizar'::public.app_acao)
          AND public.senha_alvo_encarregado(_alvo)));
$$;
-- Só a Edge (service_role) chama: não é para o navegador sondar quem é quem.
REVOKE ALL ON FUNCTION public.senha_pode_resetar(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.senha_pode_resetar(uuid, uuid) TO service_role;

-- ── 4. A lista da tela ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.senha_encarregados_listar()
RETURNS TABLE(user_id uuid, nome text, email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
       public.has_screen_access(auth.uid(), 'trocar_senha_encarregados', 'visualizar'::public.app_acao)
    OR public.can_access(auth.uid(), 'administracao', 'alterar'::public.app_acao)) THEN
    RAISE EXCEPTION 'Sem acesso a trocar senha.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT p.id,
           COALESCE(NULLIF(btrim(p.display_name), ''), p.email, 'Usuário')::text,
           p.email::text
      FROM public.profiles p
     WHERE COALESCE(p.ativo, true)
       AND public.senha_alvo_encarregado(p.id)
     ORDER BY 2;
END $$;
REVOKE ALL ON FUNCTION public.senha_encarregados_listar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.senha_encarregados_listar() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- (reverter antes a Edge admin-reset-password para o can_access('administracao','alterar'))
-- DROP FUNCTION IF EXISTS public.senha_encarregados_listar();
-- DROP FUNCTION IF EXISTS public.senha_pode_resetar(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.senha_alvo_encarregado(uuid);
-- DELETE FROM public.app_menu WHERE codigo = 'trocar_senha_encarregados';
