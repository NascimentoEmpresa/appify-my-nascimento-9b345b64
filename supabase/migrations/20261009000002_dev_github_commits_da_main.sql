-- =====================================================================
-- Painel do Desenvolvedor › GitHub: commits da história da MAIN (09/10/2026).
--
-- O painel mostrava 2.547 commits e o GitHub 4.952: a Edge só lia commits
-- DE DENTRO das PRs (/pulls/{n}/commits). Ficavam de fora os merges
-- (~2 mil) e o que o Lovable (gpt-engineer-app[bot]) commita direto na main
-- (~1,2 mil), que não passam por PR. Agora a Edge também percorre
-- /commits?sha=main (incremental) e marca cada commit:
--   na_main → está na história da main (é o que o GitHub conta);
--   merge   → commit de merge (mais de um pai).
-- Commit que só existe numa PR aberta continua com na_main = false.
-- =====================================================================
ALTER TABLE public."DEV_GITHUB_COMMIT" ADD COLUMN IF NOT EXISTS na_main boolean NOT NULL DEFAULT false;
ALTER TABLE public."DEV_GITHUB_COMMIT" ADD COLUMN IF NOT EXISTS merge boolean NOT NULL DEFAULT false;

-- O 7º item do array compacto é o merge (o front trata ausente como false).
CREATE OR REPLACE FUNCTION public.dev_github_painel()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT public.dev_github_pode_ver() THEN RAISE EXCEPTION 'Sem acesso ao Painel do Desenvolvedor.' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'sync', (SELECT to_jsonb(s) FROM public."DEV_GITHUB_SYNC" s WHERE id = 1),
    'pendentes', (SELECT count(*) FROM public."DEV_GITHUB_PR" WHERE detalhado_em IS NULL),
    'prs', COALESCE((SELECT jsonb_agg(to_jsonb(p) - 'detalhado_em' ORDER BY p.numero DESC) FROM public."DEV_GITHUB_PR" p), '[]'::jsonb),
    'commits', COALESCE((SELECT jsonb_agg(jsonb_build_array(left(c.sha, 7), c.pr_numero, c.autor_login, c.autor_nome, c.data, left(split_part(coalesce(c.mensagem, ''), E'\n', 1), 140), c.merge) ORDER BY c.data DESC) FROM public."DEV_GITHUB_COMMIT" c), '[]'::jsonb));
END $function$;

REVOKE ALL ON FUNCTION public.dev_github_painel() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dev_github_painel() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public."DEV_GITHUB_COMMIT" DROP COLUMN IF EXISTS na_main, DROP COLUMN IF EXISTS merge;
-- (dev_github_painel da 20261007000022, sem o 7º item)
