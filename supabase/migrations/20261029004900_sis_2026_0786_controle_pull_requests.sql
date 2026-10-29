-- =========================================================================
-- SIS-2026-0786 — CONTROLE DE PULL REQUESTS (PR)  (29/10/2026)
--
-- PEDIDO (Iury Silva): tela no módulo Sistemas com as PRs mergeadas na main —
-- Desenvolvedor, Nº da PR, Chamado atendido, Commits, Linhas alteradas,
-- Arquivos alterados e Data/hora da aprovação — preenchida sozinha a partir
-- do GitHub.
--
-- DECISÕES (Eduardo, 29/10/2026)
--   · "Data e hora da aprovação" = o MERGE na main (mergeado_em). É o momento
--     em que a alteração foi de fato para produção.
--   · Desenvolvedor = quem CRIOU a PR (autor no GitHub), com o nome do ERP.
--   · PRs com chamado no título e [SEM-CHAMADO] ficam na mesma lista.
--
-- DE ONDE VÊM OS DADOS
--   · Cache "DEV_GITHUB_PR" (mig 20261007000022), o mesmo do Painel GitHub.
--   · Novo: o workflow .github/workflows/pr_registrar_painel.yml grava cada
--     PR no momento do merge (Edge dev-github-pr-registrar), sem ninguém
--     clicar em "Sincronizar". Os números vêm do próprio evento do GitHub —
--     nenhuma chamada extra à API (a sincronização em massa já suspendeu as
--     contas do Pablo uma vez).
--   · O nome do desenvolvedor sai de "DEV_GITHUB_USUARIO" (login → profiles).
--     Até aqui essa lista vivia chumbada em três lugares (chamado-vincular-pr,
--     chamado-concluir-pr e notify_discord.yml) e já estava velha: o Pablo
--     abre PR como PabloTasuyuk desde a suspensão, e lá só existe Tasuyuk1.
--     Login sem linha aqui aparece como o próprio login (ex. haggltda).
--
-- ACESSO
--   · Menu sistemas_controle_pr. Liberação inicial: Administrador Geral
--     (concede_tudo) e, por usuário, Iury Silva e Eduardo Jeiel. O resto se
--     libera no Gerenciamento de Acesso.
--   · screen_permission_user: o menu é novo, então não existe linha anterior
--     (nem allow = false) para nenhum usuário; ON CONFLICT DO NOTHING só
--     protege o reexecutar.
--
-- Idempotente.
-- =========================================================================

-- ── 1) Login do GitHub → pessoa do ERP ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public."DEV_GITHUB_USUARIO" (
  login       text PRIMARY KEY,
  profile_id  uuid,          -- profiles.id; sem FK, profiles.id não tem FK real
  nome        text,          -- reserva para quem não tem usuário no ERP
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dev_github_usuario_login_lower
  ON public."DEV_GITHUB_USUARIO" (lower(login));

-- Só a RPC (SECURITY DEFINER) lê; ninguém lê nem escreve direto pela API.
ALTER TABLE public."DEV_GITHUB_USUARIO" ENABLE ROW LEVEL SECURITY;

INSERT INTO public."DEV_GITHUB_USUARIO" (login, profile_id) VALUES
  ('EduardoJeiel007', '97260632-2f1a-44e3-9f93-58b2b1f3702c'),
  ('joaovperetti',    'e2c4faf6-289e-4f80-a235-628c2d674f46'),
  ('Tasuyuk1',        '301bfa45-d01a-4e81-abd9-18d48bccef97'),
  ('PabloTasuyuk',    '301bfa45-d01a-4e81-abd9-18d48bccef97')
ON CONFLICT (login) DO NOTHING;

-- ── 2) Menu ─────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sistemas_controle_pr', 'Controle de Pull Requests (PR)',
       '/app/sistemas/chamados/pull-requests', 18, true
  FROM public.app_modulo m WHERE m.codigo = 'sistemas'
ON CONFLICT (modulo_id, codigo) DO UPDATE
  SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ordem = EXCLUDED.ordem, ativo = true;

-- ── 3) Semente de acesso ────────────────────────────────────────────────
-- Menu novo nasce ABERTO sem regra (J2): o Administrador Geral recebe aqui.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'sistemas_controle_pr', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES ('visualizar'::public.app_acao), ('exportar'::public.app_acao)) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- Iury Silva (solicitante) e Eduardo Jeiel (quem desenvolveu e valida). Mesmo
-- pacote que o toggle "Acesso por Usuário" concede (ACOES_DO_TOGGLE_PADRAO),
-- para a linha ficar igual à de quem foi liberado pelo painel.
-- Por id e não por nome: "Iury Silva - Testes" colide com o nome oficial.
-- Perfil ausente não aborta a migration — aborto aqui pararia a fila do
-- aplicador para o time inteiro; vira WARNING e a liberação se faz no painel.
DO $$
DECLARE
  _u record;
BEGIN
  FOR _u IN
    SELECT v.id, v.quem, p.id AS achou
      FROM (VALUES
        ('d1dbc8d4-bf9b-4125-a6b1-11b6195155a4'::uuid, 'Iury de Jesus Silva'),
        ('97260632-2f1a-44e3-9f93-58b2b1f3702c'::uuid, 'Eduardo Jeiel Padilha Monteiro')
      ) AS v(id, quem)
      LEFT JOIN public.profiles p ON p.id = v.id
  LOOP
    IF _u.achou IS NULL THEN
      RAISE WARNING 'SIS-2026-0786: perfil % (%) não existe — liberar pelo Gerenciamento de Acesso.', _u.quem, _u.id;
      CONTINUE;
    END IF;
    INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
    SELECT _u.id, 'sistemas_controle_pr', a.acao, true, 'SIS-2026-0786: liberação inicial do Controle de PRs'
      FROM (VALUES ('visualizar'::public.app_acao), ('incluir'::public.app_acao), ('alterar'::public.app_acao),
                   ('aprovar'::public.app_acao), ('exportar'::public.app_acao)) AS a(acao)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ── 4) Leitura da tela ──────────────────────────────────────────────────
-- Tudo numa chamada: o PostgREST corta select em 1.000 linhas e já passam
-- de 1.000 PRs. Só PR mergeada na main — é o que foi para produção.
CREATE OR REPLACE FUNCTION public.dev_github_controle_pr()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_screen_access(auth.uid(), 'sistemas_controle_pr', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso ao Controle de Pull Requests.' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'prs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'numero',          pr.numero,
               'titulo',          pr.titulo,
               'url',             pr.url,
               'autor_login',     pr.autor_login,
               'autor_avatar',    pr.autor_avatar,
               'desenvolvedor',   COALESCE(NULLIF(trim(p.display_name), ''), NULLIF(trim(u.nome), ''), pr.autor_login, 'desconhecido'),
               'chamado',         pr.chamado,
               'chamado_id',      c.id,
               'chamado_assunto', c.assunto,
               'commits',         pr.commits,
               'adicoes',         pr.adicoes,
               'remocoes',        pr.remocoes,
               'arquivos',        pr.arquivos,
               'mergeado_em',     pr.mergeado_em
             ) ORDER BY pr.mergeado_em DESC, pr.numero DESC)
        FROM public."DEV_GITHUB_PR" pr
        LEFT JOIN public."DEV_GITHUB_USUARIO" u ON lower(u.login) = lower(pr.autor_login)
        LEFT JOIN public.profiles p ON p.id = u.profile_id
        LEFT JOIN LATERAL (
          SELECT ch.id, ch.assunto FROM public."CHAMADO_SISTEMA" ch
           WHERE ch.numero = pr.chamado
           LIMIT 1
        ) c ON true
       WHERE pr.estado = 'merged' AND pr.branch_destino = 'main' AND pr.mergeado_em IS NOT NULL
    ), '[]'::jsonb)
  );
END $$;
REVOKE ALL ON FUNCTION public.dev_github_controle_pr() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dev_github_controle_pr() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.dev_github_controle_pr();
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'sistemas_controle_pr';
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'sistemas_controle_pr';
-- DELETE FROM public.app_menu WHERE codigo = 'sistemas_controle_pr';
-- DROP TABLE IF EXISTS public."DEV_GITHUB_USUARIO";
-- NOTIFY pgrst, 'reload schema';
