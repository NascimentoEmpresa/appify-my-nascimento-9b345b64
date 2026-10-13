-- =====================================================================
-- Treinamentos › Todos os alunos: filtro por CONTRATO (09/10/2026).
--
-- A lista não trazia o contrato — ele só vinha da trn_alunos_recorte, que
-- exige "alterar" (é das ações em massa). Quem só visualiza a lista ficaria
-- sem o filtro. A trn_alunos_lista passa a devolver o contrato do cadastro
-- (TRN_ALUNO.contrato), mesma regra de acesso de antes (trn_ve_modulo).
--
-- Mudou o RETURNS TABLE → DROP + CREATE (CREATE OR REPLACE não troca o tipo).
-- =====================================================================
DROP FUNCTION IF EXISTS public.trn_alunos_lista(boolean);
CREATE FUNCTION public.trn_alunos_lista(_incluir_inativos boolean DEFAULT false)
 RETURNS TABLE(id uuid, nome text, email text, telefone text, documento text, status text, acesso_completo boolean, expira_em date, created_at timestamp with time zone, ultimo_acesso_em timestamp with time zone, tags jsonb, tag_ids uuid[], cursos integer, aulas_concluidas integer, contrato text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  SELECT a.id, a.nome, a.email, a.telefone, a.documento, a.status,
         a.acesso_completo, a.expira_em, a.created_at, a.ultimo_acesso_em,
         coalesce((SELECT jsonb_agg(t.nome ORDER BY t.nome) FROM public."TRN_ALUNO_TAG" at JOIN public."TRN_TAG" t ON t.id = at.tag_id WHERE at.aluno_id = a.id), '[]'::jsonb),
         coalesce((SELECT array_agg(at.tag_id) FROM public."TRN_ALUNO_TAG" at WHERE at.aluno_id = a.id), '{}'::uuid[]),
         (SELECT count(*)::int FROM public."TRN_MATRICULA" m WHERE m.aluno_id = a.id),
         (SELECT count(*)::int FROM public."TRN_PROGRESSO" p WHERE p.aluno_id = a.id AND p.concluida),
         a.contrato::text
    FROM public."TRN_ALUNO" a
   WHERE public.trn_ve_modulo()
     AND (_incluir_inativos OR a.status <> 'demitido')
   ORDER BY a.created_at DESC;
$function$;

REVOKE ALL ON FUNCTION public.trn_alunos_lista(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_alunos_lista(boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Recriar a versão da 20260930000237 (sem a coluna contrato):
-- DROP FUNCTION IF EXISTS public.trn_alunos_lista(boolean);
-- (CREATE FUNCTION ... da 20260930000237, linhas 237-256)
