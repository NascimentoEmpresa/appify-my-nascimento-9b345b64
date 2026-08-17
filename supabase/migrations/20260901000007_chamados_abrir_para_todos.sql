-- =====================================================================
-- ABRIR CHAMADO — capacidade de todo mundo
--
-- POR QUE
-- Solicitar chamado não é privilégio de área: qualquer pessoa do grupo
-- precisa conseguir pedir ajuda ao Sistemas. Hoje só 12 dos 66 usuários
-- têm a capacidade `chamados_sistemas_abrir` liberada, então o resto
-- simplesmente não consegue abrir chamado.
--
-- COMO — e por que NÃO foi linha por usuário
-- `list_accessible_menus` resolve nesta ordem:
--     override do usuário (screen_permission_user)  >  perfil  >  concede_tudo
-- Ou seja, linha por usuário VENCE o perfil. Se eu criasse override para os
-- 66, qualquer ajuste futuro feito no perfil deixaria de valer para eles —
-- 66 exceções congeladas, e ninguém lembraria disso daqui a seis meses.
--
-- Então:
--   1. Libera no PERFIL (todos os perfis ativos). É o caminho que o
--      "Acesso por Usuário" já usa, continua editável por lá, e pega
--      automaticamente quem for criado depois com qualquer perfil.
--   2. Override individual SÓ para quem não tem perfil nenhum (13 pessoas),
--      porque para essas o passo 1 não alcança.
--
-- Idempotente: rodar de novo não duplica nem sobrescreve quem já tem.
-- =====================================================================

-- ── 1. Todos os perfis ativos ────────────────────────────────────────
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'chamados_sistemas_abrir', 'visualizar'::public.app_acao, true
  FROM public.perfil_acesso pa
 WHERE pa.ativo = true
   AND NOT EXISTS (
     SELECT 1 FROM public.perfil_acesso_permissao x
      WHERE x.perfil_id = pa.id
        AND x.menu_codigo = 'chamados_sistemas_abrir'
        AND x.acao = 'visualizar'::public.app_acao
   );

-- Perfil que já tinha a linha marcada como negada passa a permitir: o
-- objetivo é "todo mundo abre chamado", sem exceção herdada do legado.
UPDATE public.perfil_acesso_permissao
   SET allow = true, updated_at = now()
 WHERE menu_codigo = 'chamados_sistemas_abrir'
   AND acao = 'visualizar'::public.app_acao
   AND allow IS DISTINCT FROM true;

-- ── 2. Quem não tem perfil ───────────────────────────────────────────
-- Sem perfil, o passo 1 não alcança: aqui o override é a única via.
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow)
SELECT p.id, 'chamados_sistemas_abrir', 'visualizar'::public.app_acao, true
  FROM public.profiles p
 WHERE NOT EXISTS (
         SELECT 1 FROM public.usuario_perfil_acesso u WHERE u.user_id = p.id
       )
   AND NOT EXISTS (
         SELECT 1 FROM public.screen_permission_user s
          WHERE s.user_id = p.id
            AND s.menu_codigo = 'chamados_sistemas_abrir'
            AND s.acao = 'visualizar'::public.app_acao
       );

-- Override individual que estivesse NEGANDO passa a permitir — senão a
-- pessoa continuaria sem conseguir abrir chamado mesmo com o perfil liberado.
UPDATE public.screen_permission_user
   SET allow = true, updated_at = now()
 WHERE menu_codigo = 'chamados_sistemas_abrir'
   AND acao = 'visualizar'::public.app_acao
   AND allow IS DISTINCT FROM true;

NOTIFY pgrst, 'reload schema';

-- ── Conferência: quantos usuários REALMENTE enxergam a capacidade ────
-- Reproduz a mesma resolução da list_accessible_menus, em vez de contar
-- linhas inseridas — o que importa é o resultado, não o insert.
WITH resolvido AS (
  SELECT p.id,
         COALESCE(
           (SELECT s.allow FROM public.screen_permission_user s
             WHERE s.user_id = p.id AND s.menu_codigo = 'chamados_sistemas_abrir'
               AND s.acao = 'visualizar'::public.app_acao
             ORDER BY s.updated_at DESC LIMIT 1),
           EXISTS (SELECT 1 FROM public.usuario_perfil_acesso upa
                     JOIN public.perfil_acesso pf ON pf.id = upa.perfil_id AND pf.ativo
                    WHERE upa.user_id = p.id AND pf.concede_tudo)
           OR EXISTS (SELECT 1 FROM public.usuario_perfil_acesso upa
                        JOIN public.perfil_acesso pf ON pf.id = upa.perfil_id AND pf.ativo
                        JOIN public.perfil_acesso_permissao pp
                          ON pp.perfil_id = pf.id AND pp.allow
                         AND pp.menu_codigo = 'chamados_sistemas_abrir'
                         AND pp.acao = 'visualizar'::public.app_acao
                       WHERE upa.user_id = p.id)
         ) AS pode
    FROM public.profiles p
)
SELECT count(*) FILTER (WHERE pode)       AS usuarios_com_acesso,
       count(*) FILTER (WHERE NOT pode)   AS usuarios_sem_acesso,
       count(*)                           AS total
  FROM resolvido;

-- =====================================================================
-- ROLLBACK
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo='chamados_sistemas_abrir';
--   DELETE FROM public.screen_permission_user  WHERE menu_codigo='chamados_sistemas_abrir';
--   -- (apaga TAMBÉM as 12 liberações que já existiam antes desta migration)
-- =====================================================================
