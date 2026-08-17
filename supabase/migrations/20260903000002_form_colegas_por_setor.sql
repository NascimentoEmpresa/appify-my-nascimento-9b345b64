-- =========================================================================
-- FORMULÁRIOS — pergunta "colegas": escolher o SETOR e depois a pessoa
--
-- Bug que isto conserta: a tela montava a lista de setores lendo a
-- VW_EMPREGADOS_BASICO inteira e distinguindo no navegador. Só que o
-- PostgREST corta a resposta (max-rows) — e como o setor "PADRAO" sozinho
-- tem centenas de pessoas, o pedaço que chegava continha só 6 dos 14
-- setores. Setor pequeno (SISTEMAS, JURIDICO, SST, TREINAMENTOS…)
-- simplesmente não aparecia.
--
-- Conserto: duas RPCs que fazem o DISTINCT/filtro no banco e devolvem
-- poucas linhas — nada de paginar cadastro no cliente.
--
--   cs_form_setores()          → setores com gente ativa, em ordem
--   cs_form_colegas(_setor)    → quem trabalha naquele setor
--
-- Ambas SECURITY DEFINER porque a EMPREGADOS é fechada por RLS, e liberadas
-- p/ anon: o formulário pode ser respondido sem login. Não expõem nada novo
-- — nome, setor e cargo já saem na VW_EMPREGADOS_BASICO, que anon lê desde
-- a migration 20260724000002. CPF/salário/PIS continuam fora.
--
-- Demitido não entra em nenhuma das duas.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.cs_form_setores()
RETURNS TABLE(setor text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT btrim(e."Setor_ERP") AS setor
    FROM public."EMPREGADOS" e
   WHERE btrim(coalesce(e."Setor_ERP", '')) <> ''
     AND coalesce(e."Situação", '') !~* 'demitid'
   ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION public.cs_form_colegas(_setor text)
RETURNS TABLE(id bigint, nome text, setor text, cargo text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e."ID"::bigint, btrim(e."Nome"), btrim(e."Setor_ERP"), btrim(coalesce(e."Título do Cargo", ''))
    FROM public."EMPREGADOS" e
   WHERE btrim(coalesce(e."Nome", '')) <> ''
     AND coalesce(e."Situação", '') !~* 'demitid'
     AND upper(btrim(coalesce(e."Setor_ERP", ''))) = upper(btrim(coalesce(_setor, '')))
   ORDER BY 2;
$$;

REVOKE EXECUTE ON FUNCTION public.cs_form_setores(), public.cs_form_colegas(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cs_form_setores(), public.cs_form_colegas(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   DROP FUNCTION public.cs_form_colegas(text), public.cs_form_setores();
--   (a tela volta a ler a VW_EMPREGADOS_BASICO — com o bug de truncamento)
