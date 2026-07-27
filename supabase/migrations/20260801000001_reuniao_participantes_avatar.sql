-- listar_usuarios_ativos() passa a devolver avatar_url também, pra mostrar
-- foto de perfil real (com fallback de iniciais) no "Ver participantes" da
-- Agenda de Reunião. avatar_url não é dado sensível — mudança aditiva, não
-- quebra os outros lugares que já chamam essa RPC (CREATE OR REPLACE não
-- deixa mudar a lista de colunas do retorno, por isso o DROP antes).
DROP FUNCTION IF EXISTS public.listar_usuarios_ativos();
CREATE OR REPLACE FUNCTION public.listar_usuarios_ativos()
RETURNS TABLE(id uuid, display_name text, avatar_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT id, display_name, avatar_url FROM public.profiles WHERE ativo = true ORDER BY display_name;
$$;
REVOKE ALL ON FUNCTION public.listar_usuarios_ativos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_usuarios_ativos() TO authenticated;

NOTIFY pgrst, 'reload schema';
