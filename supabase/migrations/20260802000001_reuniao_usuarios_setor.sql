-- listar_usuarios_ativos() passa a devolver também o setor (Setor_ERP da
-- EMPREGADOS, ligada via auth_user_id), pra dar pra montar "comitês"
-- dinâmicos por setor no seletor de Convidados da Agenda de Reunião — sem
-- lista fixa de nomes no frontend, e sem afrouxar a RLS de EMPREGADOS
-- (setor não é dado sensível, já é exposto via VW_EMPREGADOS_BASICO).
-- LEFT JOIN: quem não tem vínculo com EMPREGADOS continua aparecendo na
-- lista normalmente, só com setor nulo (não entra em nenhum comitê).
DROP FUNCTION IF EXISTS public.listar_usuarios_ativos();
CREATE OR REPLACE FUNCTION public.listar_usuarios_ativos()
RETURNS TABLE(id uuid, display_name text, avatar_url text, setor text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.display_name, p.avatar_url, e."Setor_ERP"
  FROM public.profiles p
  LEFT JOIN public."EMPREGADOS" e ON e.auth_user_id = p.id
  WHERE p.ativo = true
  ORDER BY p.display_name;
$$;
REVOKE ALL ON FUNCTION public.listar_usuarios_ativos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_usuarios_ativos() TO authenticated;

NOTIFY pgrst, 'reload schema';
