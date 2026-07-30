-- Expõe quem está marcado como observador automático (reuniao_observador_automatico
-- é admin-only por RLS) pra qualquer usuário com acesso à Agenda de Reunião poder
-- ver o aviso no formulário de criação ("Fulano será adicionado automaticamente
-- como observador nesse tipo de reunião") — sem abrir a tabela inteira.
CREATE OR REPLACE FUNCTION public.listar_observadores_automaticos()
RETURNS TABLE(user_id uuid, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT oa.user_id, p.display_name
    FROM public.reuniao_observador_automatico oa
    JOIN public.profiles p ON p.id = oa.user_id
   WHERE public.tem_acesso_menu('central_servicos_reunioes');
$$;
REVOKE ALL ON FUNCTION public.listar_observadores_automaticos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_observadores_automaticos() TO authenticated;

NOTIFY pgrst, 'reload schema';
