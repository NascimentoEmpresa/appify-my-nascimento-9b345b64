-- =====================================================================
-- handle_new_user — não criar perfil nem role para sessão ANÔNIMA
--
-- O login "Externo" do encarregado usa supabase.auth.signInAnonymously(), e
-- cada acesso cria um usuário novo em auth.users. O trigger atual gravava,
-- para cada um deles, uma linha em profiles (com email e nome nulos) e outra
-- em user_roles com role 'visitante'.
--
-- Consequência: a lista de Usuários em Administração ia enchendo de
-- registros sem nome, um por acesso externo, sem nada que os distinguisse
-- de um colaborador mal cadastrado. E user_roles crescia junto.
--
-- Usuário anônimo não precisa de nenhum dos dois: a identidade dele é o par
-- (login digitado, contrato) gravado em sup_ext_sessao, e o acesso dele é
-- resolvido pela allowlist do front + as RPCs sup_ext_*, nunca por perfil.
--
-- Só o ramo do anônimo muda; o resto da função é preservado como estava.
--
-- ROLLBACK: recriar a função sem o IF do topo.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Sessão anônima (login "Externo"): não gera perfil nem role.
  IF COALESCE(NEW.is_anonymous, false) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1))
  );

  IF lower(NEW.email) = 'messias.souza@cheetahconsultores.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
    ON CONFLICT DO NOTHING;
    UPDATE public.profiles
       SET display_name = 'Messias Pereira de Souza'
     WHERE id = NEW.id;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'visitante')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- ── Limpa o que já entrou ────────────────────────────────────────────
-- Os usuários anônimos em si NÃO são apagados: sup_ext_sessao pende deles, e
-- é o que faz o encarregado reencontrar os pedidos que criou. Some só o
-- ruído em profiles/user_roles.
DELETE FROM public.user_roles r
 USING auth.users u
 WHERE u.id = r.user_id AND u.is_anonymous;

DELETE FROM public.profiles p
 USING auth.users u
 WHERE u.id = p.id AND u.is_anonymous;

-- ── Confere ──────────────────────────────────────────────────────────
SELECT (SELECT count(*)::int FROM public.profiles p
          JOIN auth.users u ON u.id = p.id WHERE u.is_anonymous)   AS perfis_anonimos_restantes,
       (SELECT count(*)::int FROM public.user_roles r
          JOIN auth.users u ON u.id = r.user_id WHERE u.is_anonymous) AS roles_anonimas_restantes,
       (SELECT count(*)::int FROM auth.users WHERE is_anonymous)   AS sessoes_externas_preservadas;

NOTIFY pgrst, 'reload schema';
