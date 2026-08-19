-- =========================================================================
-- ACESSO POR USUÁRIO — marcar a tela passa a liberar a tela
--
-- O PROBLEMA
-- O toggle de Administração › Acesso por Usuário gravava só a ação
-- 'visualizar'. As ações de trabalho (incluir/alterar/aprovar/exportar) só
-- saíam para 7 menus escritos numa lista fixa dentro do ModulosMenusTab, e
-- todo menu novo nascia fora dela. O admin marcava a tela, o usuário entrava
-- e não conseguia fazer nada: ou o botão não aparecia (a tela pergunta
-- `can("alterar", …)`), ou aparecia e o RLS recusava a gravação.
--
-- Em 09/09/2026, no menu recrutamento_gestao: 45 pessoas com a tela marcada e
-- apenas 1 conseguindo aprovar uma vaga. Foi assim que o problema apareceu.
--
-- O QUE MUDA
-- A tela passou a gravar sempre o conjunto de trabalho, para qualquer menu
-- (ver ACOES_DO_TOGGLE_PADRAO em ModulosMenusTab.tsx). Esta migration alinha
-- o que JÁ ESTÁ gravado: para cada (usuário, menu) com linha de 'visualizar'
-- sem empresa, completa as ações que faltam com o MESMO valor de allow —
-- quem estava liberado passa a poder trabalhar, quem estava explicitamente
-- negado continua negado em todas.
--
-- ESCOPO DESTA RODADA: só os menus do Recrutamento e Seleção, que é onde o
-- problema apareceu e trava gente hoje. O resto do sistema fica como está,
-- para ser conferido com calma — são 91 pessoas em 171 telas no total. Para
-- ampliar depois, troque o filtro `menu_codigo LIKE 'recrutamento%'` pelo
-- conjunto desejado e rode de novo: a migration é idempotente.
--
-- 'excluir', 'executar_ia' e 'alterar_dre' ficam de fora de propósito:
-- liberar a tela não é autorizar apagar registro nem gastar IA. Essas
-- continuam vindo de perfil de acesso, concedidas caso a caso.
--
-- Só mexe em linhas com empresa_id IS NULL, que é o recorte que o toggle
-- escreve. Exceções por empresa, se existirem, continuam mandando.
--
-- Idempotente: roda de novo sem duplicar (NOT EXISTS, e não ON CONFLICT — a
-- UNIQUE da tabela inclui empresa_id, e NULL não conflita com NULL no
-- Postgres, então ON CONFLICT não pegaria nada aqui).
--
-- ROLLBACK:
--   DELETE FROM public.screen_permission_user
--    WHERE motivo = 'backfill 20260909: toggle concede as acoes de trabalho';
-- =========================================================================

-- ── 1. Foto de antes, para conferência e para desfazer com segurança ──
CREATE TABLE IF NOT EXISTS public.bkp_screen_permission_20260909 AS
SELECT * FROM public.screen_permission_user;

-- ── 2. Completa as ações que faltam ──────────────────────────────────
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id, motivo)
SELECT base.user_id, base.menu_codigo, a.acao, base.allow, NULL,
       'backfill 20260909: toggle concede as acoes de trabalho'
  FROM (
    SELECT DISTINCT ON (user_id, menu_codigo) user_id, menu_codigo, allow
      FROM public.screen_permission_user
     WHERE acao = 'visualizar'
       AND empresa_id IS NULL
       AND menu_codigo LIKE 'recrutamento%'      -- ← escopo desta rodada
     ORDER BY user_id, menu_codigo, updated_at DESC
  ) base
  CROSS JOIN (VALUES
    ('incluir'::public.app_acao),
    ('alterar'::public.app_acao),
    ('aprovar'::public.app_acao),
    ('exportar'::public.app_acao)
  ) AS a(acao)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.screen_permission_user x
    WHERE x.user_id     = base.user_id
      AND x.menu_codigo = base.menu_codigo
      AND x.acao        = a.acao
      AND x.empresa_id IS NULL
 );

-- ── 3. Conferência ───────────────────────────────────────────────────
-- Antes: 45 pessoas viam o Recrutamento e 1 conseguia agir. Depois, as duas
-- colunas têm que bater.
SELECT
  count(*) FILTER (WHERE acao = 'visualizar' AND allow) AS veem_a_tela,
  count(*) FILTER (WHERE acao = 'alterar'    AND allow) AS podem_trabalhar
  FROM public.screen_permission_user
 WHERE menu_codigo = 'recrutamento_gestao' AND empresa_id IS NULL;

NOTIFY pgrst, 'reload schema';
