-- =====================================================================
-- CHAMADOS DE SISTEMAS — tela para o encarregado, e abertura livre
--
-- DUAS COISAS
--
--   1. O encarregado passa a ter a tela no módulo dele
--      (/app/encarregados/chamados). São as MESMAS telas da Central de
--      Serviços — o prop `base` já existia para isto —, só ancoradas noutro
--      menu, para quem vive em Encarregados não ter de caçar a tela.
--
--   2. Abrir chamado vira livre para qualquer um.
--
-- COMO "LIVRE" É FEITO, E POR QUE ASSIM
--
--   Não foi criado nada novo de permissão. O sistema JÁ tem o conceito:
--   `chamado_pode_abrir()` devolve true quando o menu não aparece em
--   list_configured_menu_codes(), e essa função considera configurado todo
--   menu com QUALQUER linha em perfil_acesso_permissao ou
--   screen_permission_user. O front usa a mesma regra (useChamadoPerms).
--
--   Então "livre" = apagar a configuração. Isso vale para sempre e para quem
--   entrar depois, sem ter de lembrar de conceder a cada novo perfil ou
--   usuário — o oposto de conceder a N perfis, que envelhece mal.
--
--   É SEGURO: as 39 linhas de chamados_sistemas_abrir e as 37 de
--   central_servicos_chamados são TODAS allow = true. Não há um único
--   allow = false, ou seja, ninguém tinha sido explicitamente proibido.
--   Depois disto todos continuam podendo — e os demais passam a poder.
--
--   As linhas apagadas ficam guardadas na tabela de backup abaixo, então o
--   rollback é um INSERT de volta, não um retrabalho manual em 39 usuários.
--
-- ROLLBACK:
--   INSERT INTO public.screen_permission_user
--   SELECT * FROM public.bkp_chamados_permissao_20260828;
--   DELETE FROM public.app_menu WHERE codigo = 'encarregados_chamados';
-- =====================================================================

-- ── 1. Menu do encarregado ───────────────────────────────────────────
-- Nasce SEM linha de permissão de propósito: menu não configurado é aberto,
-- que é exatamente o que se quer aqui.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'encarregados_chamados', 'Chamados de Sistemas',
       '/app/encarregados/chamados', 20, true
  FROM public.app_modulo m
 WHERE m.codigo = 'encarregados'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- ── 2. Backup antes de apagar ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bkp_chamados_permissao_20260828
  AS SELECT * FROM public.screen_permission_user WHERE false;

INSERT INTO public.bkp_chamados_permissao_20260828
SELECT s.* FROM public.screen_permission_user s
 WHERE s.menu_codigo IN ('chamados_sistemas_abrir', 'central_servicos_chamados')
   AND NOT EXISTS (SELECT 1 FROM public.bkp_chamados_permissao_20260828 b WHERE b.id = s.id);

-- A tabela de backup não é para consumo do app: fecha para todo mundo.
ALTER TABLE public.bkp_chamados_permissao_20260828 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bkp_chamados_permissao_20260828 FROM anon, authenticated;

-- ── 3. Abre para todos, removendo a configuração ─────────────────────
-- Guarda de segurança: se algum dia existir um allow = false aqui, apagar
-- tudo PROMOVERIA quem estava proibido. Nesse caso a migration falha em vez
-- de conceder acesso silenciosamente.
DO $$
DECLARE v_negados int;
BEGIN
  SELECT count(*) INTO v_negados
    FROM public.screen_permission_user
   WHERE menu_codigo IN ('chamados_sistemas_abrir', 'central_servicos_chamados')
     AND allow = false;

  IF v_negados > 0 THEN
    RAISE EXCEPTION
      'Existem % negações explícitas nesses menus. Abrir para todos apagaria a proibição de alguém — revise antes.',
      v_negados;
  END IF;
END $$;

DELETE FROM public.screen_permission_user
 WHERE menu_codigo IN ('chamados_sistemas_abrir', 'central_servicos_chamados');

DELETE FROM public.perfil_acesso_permissao
 WHERE menu_codigo IN ('chamados_sistemas_abrir', 'central_servicos_chamados');

-- ── 4. Conferência ───────────────────────────────────────────────────
-- Os três devem sair como "aberto": nenhum aparece em
-- list_configured_menu_codes(), então chamado_pode_abrir() é true para todos.
SELECT x.codigo,
       NOT EXISTS (SELECT 1 FROM public.list_configured_menu_codes() c
                    WHERE c.menu_codigo = x.codigo) AS aberto_para_todos
  FROM (VALUES ('chamados_sistemas_abrir'),
               ('central_servicos_chamados'),
               ('encarregados_chamados')) AS x(codigo);

NOTIFY pgrst, 'reload schema';
