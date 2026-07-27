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
-- Dedup SEM acento/caixa (JURIDICO == JURÍDICO — senão vira setor repetido) e,
-- entre grafias iguais, prefere a que aparece na RESPOSTA: é contra o setor
-- carimbado na resposta que 'ver_setor' casa (cs_form_cap_setor). Fora o
-- placeholder PADRAO (= "sem setor", não é setor concedível).
--
-- Idempotente. Aplicar no banco do app (traz o NOTIFY do PostgREST no fim).
-- =========================================================================

CREATE OR REPLACE FUNCTION public.cs_form_setores_catalogo()
RETURNS TABLE(setor text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH fonte AS (
    -- ordem = prioridade da grafia: a da resposta manda (ver_setor casa nela).
    SELECT setor        AS s, 0 AS ordem FROM public."CS_FORM_RESPOSTAS"
    UNION ALL
    SELECT "Setor_ERP" AS s, 1 AS ordem FROM public."EMPREGADOS"
  ),
  norm AS (
    SELECT btrim(s) AS rotulo, ordem,
           upper(translate(btrim(s),
             'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
             'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) AS chave
      FROM fonte
     WHERE btrim(coalesce(s, '')) <> ''
  )
  SELECT DISTINCT ON (chave) rotulo
    FROM norm
   WHERE chave <> 'PADRAO'                      -- placeholder de "sem setor"
     AND public.has_role(auth.uid(), 'admin')   -- só admin lista o catálogo
   ORDER BY chave, ordem, rotulo;
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_setores_catalogo() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_setores_catalogo() TO authenticated;

NOTIFY pgrst, 'reload schema';
