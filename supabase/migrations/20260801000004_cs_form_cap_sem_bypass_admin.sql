-- =========================================================================
-- FORMULÁRIOS — remove o BYPASS DE ADMIN do cs_form_cap (seguranca)
--
-- Regra do modulo: em Formularios as capacidades (CS_FORM_ACESSOS) governam
-- TUDO, INCLUSIVE admin — sem atalho. Uma versao antiga do cs_form_cap tinha
-- `has_role(auth.uid(),'admin')` como primeira condicao, o que fazia QUALQUER
-- admin enxergar todas as respostas (o RLS cs_form_resp_select chama esse
-- cs_form_cap). Se o banco do app ainda estiver nessa versao, admin ve tudo.
--
-- Esta migration crava a versao SEM bypass (idempotente). Depois dela, admin
-- sem grant explicito NAO ve nada alem do que a capacidade dele libera. Quem
-- precisa ver tudo recebe o papel 'ver_tudo' em Administracao > Acesso por
-- Usuario — nunca por ser admin.
--
-- Idempotente. Aplicar no banco do app (traz o NOTIFY do PostgREST no fim).
-- =========================================================================

CREATE OR REPLACE FUNCTION public.cs_form_cap(_cap text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _cap = 'responder'
      OR EXISTS (SELECT 1 FROM public."CS_FORM_ACESSOS" a
                  WHERE a.papel = _cap AND a.user_id = auth.uid());
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_cap(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_cap(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
