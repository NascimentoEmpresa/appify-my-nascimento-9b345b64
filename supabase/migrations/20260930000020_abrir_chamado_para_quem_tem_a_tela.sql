-- =====================================================================
-- CHAMADOS — quem tem a TELA marcada passa a ter também a capacidade
-- `chamados_sistemas_abrir` marcada. Ajuste de DADO, não de regra.
--
-- O PROBLEMA, CONCRETAMENTE
--
--   A conta pablinhu@haggltda.com.br tinha `encarregados_chamados` = true
--   nas cinco ações do toggle e `chamados_sistemas_abrir` = FALSE nas
--   cinco. Quem administra via "7/7 menus liberados" no módulo Encarregados
--   e concluía, com razão, que estava tudo liberado — mas a capacidade de
--   abrir mora no módulo Central de Serviços, longe dos olhos, e estava
--   negada.
--
-- POR QUE ASSIM E NÃO MEXENDO NA REGRA
--
--   `chamado_pode_abrir()` continua sendo a capacidade e só ela (a tentativa
--   de fazer a função olhar as telas foi revertida na 20260930000019: criava
--   um segundo lugar de decisão e fazia o toggle não desligar nada). Aqui só
--   se liga o toggle que a tela de Acesso por Usuário já liga — mesmas
--   tabelas, mesmas cinco ações (ACOES_DO_TOGGLE_PADRAO), e continua
--   editável por lá depois. Desligar volta a funcionar.
--
-- QUEM É ALCANÇADO
--
--   Quem tem acesso RESOLVIDO (override > perfil > concede_tudo) a qualquer
--   uma das três portas da mesma tela: encarregados_chamados,
--   chamados_sistemas, central_servicos_chamados.
--
--   1. Override que estava NEGANDO vira permitir — é o caso do print.
--   2. INSERT de override só para quem não tem perfil nenhum; para quem tem,
--      a 20260901000007 já concede via perfil, e criar override congelaria a
--      pessoa contra ajustes futuros do perfil.
--
--   Idempotente: rodar de novo não duplica nem sobrescreve quem já está ok.
-- =====================================================================

-- Acesso resolvido a alguma das três telas, na mesma ordem de precedência
-- que list_accessible_menus usa.
CREATE OR REPLACE VIEW public.v_tmp_tem_tela_chamado AS
SELECT p.id AS user_id
  FROM public.profiles p
 WHERE EXISTS (
   SELECT 1 FROM (VALUES ('encarregados_chamados'),
                         ('chamados_sistemas'),
                         ('central_servicos_chamados')) AS t(codigo)
    WHERE COALESCE(
      (SELECT s.allow FROM public.screen_permission_user s
        WHERE s.user_id = p.id AND s.menu_codigo = t.codigo
          AND s.acao = 'visualizar'::public.app_acao
        ORDER BY s.updated_at DESC LIMIT 1),
      EXISTS (SELECT 1 FROM public.usuario_perfil_acesso u
                JOIN public.perfil_acesso pf ON pf.id = u.perfil_id AND pf.ativo
               WHERE u.user_id = p.id AND pf.concede_tudo)
      OR EXISTS (SELECT 1 FROM public.usuario_perfil_acesso u
                   JOIN public.perfil_acesso pf ON pf.id = u.perfil_id AND pf.ativo
                   JOIN public.perfil_acesso_permissao pp
                     ON pp.perfil_id = pf.id AND pp.allow
                    AND pp.menu_codigo = t.codigo
                    AND pp.acao = 'visualizar'::public.app_acao
                  WHERE u.user_id = p.id)
    )
 );

-- ── 1. Destrava quem estava negado ───────────────────────────────────
UPDATE public.screen_permission_user s
   SET allow = true, updated_at = now()
  FROM public.v_tmp_tem_tela_chamado v
 WHERE s.user_id = v.user_id
   AND s.menu_codigo = 'chamados_sistemas_abrir'
   AND s.acao IN ('visualizar','incluir','alterar','aprovar','exportar')
   AND s.allow IS DISTINCT FROM true;

-- ── 2. Cria o override para quem não tem perfil ──────────────────────
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow)
SELECT v.user_id, 'chamados_sistemas_abrir', a.acao, true
  FROM public.v_tmp_tem_tela_chamado v
 CROSS JOIN (VALUES ('visualizar'::public.app_acao), ('incluir'::public.app_acao),
                    ('alterar'::public.app_acao), ('aprovar'::public.app_acao),
                    ('exportar'::public.app_acao)) AS a(acao)
 WHERE NOT EXISTS (SELECT 1 FROM public.usuario_perfil_acesso u WHERE u.user_id = v.user_id)
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user s
                    WHERE s.user_id = v.user_id
                      AND s.menu_codigo = 'chamados_sistemas_abrir'
                      AND s.acao = a.acao);

DROP VIEW public.v_tmp_tem_tela_chamado;

NOTIFY pgrst, 'reload schema';

-- Conferência: ninguém com a tela deve sobrar sem a capacidade.
SELECT count(*) FILTER (WHERE NOT pode) AS ainda_sem_abrir,
       count(*)                         AS total
  FROM (
    SELECT COALESCE(
             (SELECT s.allow FROM public.screen_permission_user s
               WHERE s.user_id = p.id AND s.menu_codigo = 'chamados_sistemas_abrir'
                 AND s.acao = 'visualizar'::public.app_acao
               ORDER BY s.updated_at DESC LIMIT 1),
             EXISTS (SELECT 1 FROM public.usuario_perfil_acesso u
                       JOIN public.perfil_acesso pf ON pf.id = u.perfil_id AND pf.ativo
                      WHERE u.user_id = p.id AND pf.concede_tudo)
             OR EXISTS (SELECT 1 FROM public.usuario_perfil_acesso u
                          JOIN public.perfil_acesso pf ON pf.id = u.perfil_id AND pf.ativo
                          JOIN public.perfil_acesso_permissao pp
                            ON pp.perfil_id = pf.id AND pp.allow
                           AND pp.menu_codigo = 'chamados_sistemas_abrir'
                           AND pp.acao = 'visualizar'::public.app_acao
                         WHERE u.user_id = p.id)
           ) AS pode
      FROM public.profiles p
  ) r;

-- =====================================================================
-- ROLLBACK (devolve a negação só de quem foi destravado aqui — na prática
-- é mais simples desmarcar a pessoa em Acesso por Usuário)
--   UPDATE public.screen_permission_user SET allow = false
--    WHERE menu_codigo = 'chamados_sistemas_abrir'
--      AND user_id IN ('195a4db7-8027-43a5-93dc-e77870d4ba2e');
--   DELETE FROM public.screen_permission_user
--    WHERE menu_codigo = 'chamados_sistemas_abrir'
--      AND user_id IN ('87e7c8c6-8e82-403f-8420-0cda69cfd49d');
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
