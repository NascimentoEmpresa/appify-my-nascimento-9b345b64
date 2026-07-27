-- =========================================================================
-- FORMULÁRIOS — catálogo de setores para a tela de permissões (Acesso por
-- Usuário). Antes o React montava a lista lendo EMPREGADOS.Setor_ERP E
-- CS_FORM_RESPOSTAS.setor direto. Como CS_FORM_RESPOSTAS agora é gated por RLS
-- (sem bypass de admin — ver 20260801000004), um admin sem 'ver_tudo' NÃO lê as
-- respostas, então os setores que só existem carimbados em resposta (COMPRAS,
-- JURÍDICO, LICITAÇÃO, TREINAMENTOS — sem colaborador com esse Setor_ERP)
-- sumiam da lista de toggles.
--
-- Esta RPC devolve SÓ os NOMES dos setores (união EMPREGADOS ∪ CS_FORM_RESPOSTAS),
-- via SECURITY DEFINER — sem expor conteúdo de nenhuma resposta. Restrita a
-- admin, que é quem abre a tela de permissões.
--
-- Idempotente. Aplicar no banco do app (traz o NOTIFY do PostgREST no fim).
-- =========================================================================

CREATE OR REPLACE FUNCTION public.cs_form_setores_catalogo()
RETURNS TABLE(setor text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT rotulo FROM (
    -- 1 rótulo por setor (dedup por caixa alta), preferindo o 1º que aparecer.
    SELECT DISTINCT ON (upper(s)) btrim(s) AS rotulo
      FROM (
        SELECT "Setor_ERP" AS s FROM public."EMPREGADOS"
        UNION ALL
        SELECT setor        AS s FROM public."CS_FORM_RESPOSTAS"
      ) u
     WHERE btrim(coalesce(s, '')) <> ''
       AND public.has_role(auth.uid(), 'admin')   -- só admin lista o catálogo
     ORDER BY upper(s), btrim(s)
  ) d
  ORDER BY rotulo;
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_setores_catalogo() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_setores_catalogo() TO authenticated;

NOTIFY pgrst, 'reload schema';
