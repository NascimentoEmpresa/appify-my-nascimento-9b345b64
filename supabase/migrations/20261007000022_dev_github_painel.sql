-- =========================================================================
-- PAINEL DO DESENVOLVEDOR › GITHUB (07/10/2026)
--
-- PEDIDO (Pablo): "um painel dentro do painel de desenvolvedor, completo tipo
-- dashboard do GitHub: todos os commits e PRs já lançadas, contadores, quem
-- movimenta mais o BD etc."
--
-- COMO FUNCIONA
--   · O GitHub não é consultado a cada abertura da tela (centenas de PRs ×
--     3 chamadas cada). A Edge `dev-github-sync` copia o repositório para
--     duas tabelas de cache — PRs e commits — de forma INCREMENTAL (só o que
--     mudou desde a última vez) e em lotes; a tela chama até zerar.
--   · "Quem movimenta o BD" = arquivos .sql em supabase/migrations/ que cada
--     pessoa ADICIONOU nas PRs, e as linhas de SQL (mesmo critério do
--     README: migration não se auto-aplica, então quem escreve a migration é
--     quem mexe no banco).
--   · Leitura: quem tem o Painel do Desenvolvedor (chamados_sistemas_dev) ou
--     o painel de distribuição. Escrita: só a Edge (service role).
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."DEV_GITHUB_PR" (
  numero          integer PRIMARY KEY,
  titulo          text NOT NULL,
  url             text,
  estado          text NOT NULL,              -- open | closed | merged
  rascunho        boolean NOT NULL DEFAULT false,
  autor_login     text,
  autor_avatar    text,
  branch_origem   text,
  branch_destino  text,
  chamado         text,                       -- SIS-AAAA-NNNN do título, se houver
  criado_em       timestamptz NOT NULL,
  atualizado_em   timestamptz NOT NULL,
  fechado_em      timestamptz,
  mergeado_em     timestamptz,
  mergeado_por    text,
  commits         integer,
  adicoes         integer,
  remocoes        integer,
  arquivos        integer,
  migrations      integer,                    -- .sql ADICIONADOS em supabase/migrations
  linhas_sql      integer,                    -- linhas adicionadas em arquivos .sql
  migrations_lista text[],
  detalhado_em    timestamptz                 -- NULL = falta buscar commits/arquivos
);
CREATE INDEX IF NOT EXISTS idx_dev_github_pr_autor ON public."DEV_GITHUB_PR"(autor_login);
CREATE INDEX IF NOT EXISTS idx_dev_github_pr_pendente ON public."DEV_GITHUB_PR"(numero) WHERE detalhado_em IS NULL;

CREATE TABLE IF NOT EXISTS public."DEV_GITHUB_COMMIT" (
  sha          text PRIMARY KEY,
  pr_numero    integer REFERENCES public."DEV_GITHUB_PR"(numero) ON DELETE CASCADE,
  autor_login  text,
  autor_nome   text,
  data         timestamptz NOT NULL,
  mensagem     text
);
CREATE INDEX IF NOT EXISTS idx_dev_github_commit_data ON public."DEV_GITHUB_COMMIT"(data);
CREATE INDEX IF NOT EXISTS idx_dev_github_commit_pr ON public."DEV_GITHUB_COMMIT"(pr_numero);

CREATE TABLE IF NOT EXISTS public."DEV_GITHUB_SYNC" (
  id           int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ultima_em    timestamptz,
  ultima_por   text,
  ultimo_erro  text
);
INSERT INTO public."DEV_GITHUB_SYNC" (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Acesso de leitura (o mesmo do Painel do Desenvolvedor).
CREATE OR REPLACE FUNCTION public.dev_github_pode_ver()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND (
         public.tem_acesso_menu('chamados_sistemas_dev')
      OR public.tem_acesso_menu('chamados_sistemas_painel')
      OR public.tem_acesso_menu('chamados_sistemas_dev_dashboard_geral'))
$$;
REVOKE ALL ON FUNCTION public.dev_github_pode_ver() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dev_github_pode_ver() TO authenticated;

ALTER TABLE public."DEV_GITHUB_PR"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DEV_GITHUB_COMMIT" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DEV_GITHUB_SYNC"   ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."DEV_GITHUB_PR", public."DEV_GITHUB_COMMIT", public."DEV_GITHUB_SYNC" TO authenticated;

DROP POLICY IF EXISTS dev_github_pr_sel ON public."DEV_GITHUB_PR";
CREATE POLICY dev_github_pr_sel ON public."DEV_GITHUB_PR" FOR SELECT TO authenticated USING (public.dev_github_pode_ver());
DROP POLICY IF EXISTS dev_github_commit_sel ON public."DEV_GITHUB_COMMIT";
CREATE POLICY dev_github_commit_sel ON public."DEV_GITHUB_COMMIT" FOR SELECT TO authenticated USING (public.dev_github_pode_ver());
DROP POLICY IF EXISTS dev_github_sync_sel ON public."DEV_GITHUB_SYNC";
CREATE POLICY dev_github_sync_sel ON public."DEV_GITHUB_SYNC" FOR SELECT TO authenticated USING (public.dev_github_pode_ver());

-- Painel inteiro numa chamada (o PostgREST corta select em 1.000 linhas, e
-- commits passam disso). Commits vão compactos: [sha7, pr, login, nome, data, 1ª linha].
CREATE OR REPLACE FUNCTION public.dev_github_painel()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.dev_github_pode_ver() THEN
    RAISE EXCEPTION 'Sem acesso ao Painel do Desenvolvedor.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'sync', (SELECT to_jsonb(s) FROM public."DEV_GITHUB_SYNC" s WHERE id = 1),
    'pendentes', (SELECT count(*) FROM public."DEV_GITHUB_PR" WHERE detalhado_em IS NULL),
    'prs', COALESCE((SELECT jsonb_agg(to_jsonb(p) - 'detalhado_em' ORDER BY p.numero DESC) FROM public."DEV_GITHUB_PR" p), '[]'::jsonb),
    'commits', COALESCE((SELECT jsonb_agg(jsonb_build_array(left(c.sha, 7), c.pr_numero, c.autor_login, c.autor_nome, c.data,
                                  left(split_part(coalesce(c.mensagem, ''), E'\n', 1), 140)) ORDER BY c.data DESC)
                           FROM public."DEV_GITHUB_COMMIT" c), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.dev_github_painel() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dev_github_painel() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.dev_github_painel();
-- DROP TABLE IF EXISTS public."DEV_GITHUB_COMMIT";
-- DROP TABLE IF EXISTS public."DEV_GITHUB_PR";
-- DROP TABLE IF EXISTS public."DEV_GITHUB_SYNC";
-- DROP FUNCTION IF EXISTS public.dev_github_pode_ver();
