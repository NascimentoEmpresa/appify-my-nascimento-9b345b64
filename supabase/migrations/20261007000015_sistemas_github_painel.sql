-- =========================================================================
-- SISTEMAS › CHAMADOS › PAINEL DO DESENVOLVEDOR › GitHub (07/10/2026)
--
-- PEDIDO (Pablo): "integra com o GitHub pra mostrar gráficos de lá: quantas
-- PRs um dev lançou, quantos commits, podendo ver dos outros, quantas linhas
-- de código foram alteradas etc."
--
-- COMO FUNCIONA
--   · O GitHub é lento para devolver linhas por PR (~10 s a cada 100 PRs) e
--     tem limite de consultas — então os dados ficam GUARDADOS aqui e a tela
--     lê do banco (abre na hora):
--       GITHUB_PR — uma linha por PR (autor, datas, linhas +/-, arquivos,
--                   commits, branch);
--       GITHUB_COMMITS_SEMANA — commits e linhas por autor por semana, na
--                   main (estatística de contribuidores do GitHub);
--       GITHUB_SYNC — quando sincronizou e até onde.
--   · Edge github-painel-sync (GITHUB_TOKEN, o mesmo da Hora Extra) traz só o
--     que mudou desde a última vez (PRs por data de atualização), no máximo a
--     cada 15 min; a 1ª carga completa foi feita na criação.
--   · Login do GitHub → nome: GITHUB_DEV (editável na própria tela).
-- Leitura: quem tem o Painel do Desenvolvedor (chamados_sistemas_dev).
-- Escrita: só a Edge (service role) — e GITHUB_DEV por quem tem 'alterar'.
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."GITHUB_PR" (
  numero         int PRIMARY KEY,
  titulo         text,
  estado         text,                 -- OPEN | MERGED | CLOSED
  autor          text,                 -- login do GitHub
  branch         text,
  criado_em      timestamptz,
  mergeado_em    timestamptz,
  fechado_em     timestamptz,
  atualizado_gh  timestamptz,
  adicoes        int NOT NULL DEFAULT 0,
  remocoes       int NOT NULL DEFAULT 0,
  arquivos       int NOT NULL DEFAULT 0,
  commits        int NOT NULL DEFAULT 0,
  sincronizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_github_pr_autor ON public."GITHUB_PR" (autor, criado_em);

CREATE TABLE IF NOT EXISTS public."GITHUB_COMMITS_SEMANA" (
  autor     text NOT NULL,
  semana    date NOT NULL,           -- domingo (início da semana no GitHub)
  commits   int NOT NULL DEFAULT 0,
  adicoes   int NOT NULL DEFAULT 0,
  remocoes  int NOT NULL DEFAULT 0,
  PRIMARY KEY (autor, semana)
);

CREATE TABLE IF NOT EXISTS public."GITHUB_SYNC" (
  id           text PRIMARY KEY,     -- 'prs' | 'commits'
  sincronizado_em timestamptz,
  info         jsonb
);

CREATE TABLE IF NOT EXISTS public."GITHUB_DEV" (
  login  text PRIMARY KEY,
  nome   text NOT NULL,
  ativo  boolean NOT NULL DEFAULT true
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['GITHUB_PR', 'GITHUB_COMMITS_SEMANA', 'GITHUB_SYNC', 'GITHUB_DEV'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS github_pr_select ON public."GITHUB_PR";
CREATE POLICY github_pr_select ON public."GITHUB_PR" FOR SELECT TO authenticated USING (public.has_screen_access(auth.uid(), 'chamados_sistemas_dev', 'visualizar'));
DROP POLICY IF EXISTS github_commits_semana_select ON public."GITHUB_COMMITS_SEMANA";
CREATE POLICY github_commits_semana_select ON public."GITHUB_COMMITS_SEMANA" FOR SELECT TO authenticated USING (public.has_screen_access(auth.uid(), 'chamados_sistemas_dev', 'visualizar'));
DROP POLICY IF EXISTS github_sync_select ON public."GITHUB_SYNC";
CREATE POLICY github_sync_select ON public."GITHUB_SYNC" FOR SELECT TO authenticated USING (public.has_screen_access(auth.uid(), 'chamados_sistemas_dev', 'visualizar'));
DROP POLICY IF EXISTS github_dev_select ON public."GITHUB_DEV";
CREATE POLICY github_dev_select ON public."GITHUB_DEV" FOR SELECT TO authenticated USING (public.has_screen_access(auth.uid(), 'chamados_sistemas_dev', 'visualizar'));
DROP POLICY IF EXISTS github_dev_insert ON public."GITHUB_DEV";
CREATE POLICY github_dev_insert ON public."GITHUB_DEV" FOR INSERT TO authenticated WITH CHECK (public.has_screen_access(auth.uid(), 'chamados_sistemas_dev', 'alterar'));
DROP POLICY IF EXISTS github_dev_update ON public."GITHUB_DEV";
CREATE POLICY github_dev_update ON public."GITHUB_DEV" FOR UPDATE TO authenticated USING (public.has_screen_access(auth.uid(), 'chamados_sistemas_dev', 'alterar'));

-- Login novo (PR ou commit) entra em GITHUB_DEV com o próprio login como nome,
-- para aparecer na tela e alguém dar o nome certo. Chamada pela Edge.
CREATE OR REPLACE FUNCTION public.github_dev_completar()
RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH n AS (
    INSERT INTO public."GITHUB_DEV" (login, nome)
    SELECT DISTINCT x.autor, x.autor FROM (
      SELECT autor FROM public."GITHUB_PR" UNION SELECT autor FROM public."GITHUB_COMMITS_SEMANA") x
     WHERE x.autor IS NOT NULL AND x.autor <> ''
    ON CONFLICT (login) DO NOTHING RETURNING 1)
  SELECT count(*)::int FROM n
$$;
REVOKE ALL ON FUNCTION public.github_dev_completar() FROM PUBLIC, anon, authenticated;

-- Nomes já conhecidos (07/10/2026).
INSERT INTO public."GITHUB_DEV" (login, nome) VALUES ('Tasuyuk1', 'Pablo'), ('EduardoJeiel007', 'Eduardo'), ('joaovperetti', 'João'), ('haggltda', 'Conta da empresa (haggltda)')
ON CONFLICT (login) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.github_dev_completar();
-- DROP TABLE IF EXISTS public."GITHUB_DEV", public."GITHUB_SYNC", public."GITHUB_COMMITS_SEMANA", public."GITHUB_PR";
