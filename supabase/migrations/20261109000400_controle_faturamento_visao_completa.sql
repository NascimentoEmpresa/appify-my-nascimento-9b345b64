-- [SEM-CHAMADO] Controle de Faturamento: ação 'visao_completa' (abas Visão Geral e Visão Anual) no catálogo + concessão a quem já usa a tela
-- ============================================================================
-- Depende de 20261109000300 (cria o valor 'visao_completa' no enum app_acao; precisa estar aplicada antes — o aplicador roda uma
-- transação por arquivo, na ordem do número).
--
-- 1. Catálogo: 'visao_completa' vira um switch do menu controle-faturamento em Administração > Módulos.
-- 2. Backfill, para NINGUÉM perder as abas que vê hoje: quem já tem 'visualizar' liberado na tela (por exceção individual ou por perfil
--    de acesso) ganha 'visao_completa'. Só insere onde ainda não existe linha — nunca sobrescreve decisão já tomada. Perfil "concede tudo"
--    alcança a tela (criada em 30/09/2026) e recebe a ação sozinho, sem linha.
-- 3. Depois disso, quem for tirar uma pessoa das abas completas (ex.: supervisores) só desliga o switch dela; sem a ação, ela vê só a aba
--    "NFs Não Emitidas". Quem receber a tela de agora em diante NÃO ganha 'visao_completa' de brinde (fora do pacote do toggle): é ligada de propósito.
-- Restrição de tela: os dados seguem governados pelas telas de origem; esta ação só decide quais abas aparecem.
-- Idempotente.
--
-- ROLLBACK:
--   DELETE FROM public.screen_permission_user WHERE menu_codigo = 'controle-faturamento' AND acao = 'visao_completa';
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'controle-faturamento' AND acao = 'visao_completa';
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'controle-faturamento' AND acao = 'visao_completa';
--   NOTIFY pgrst, 'reload schema';

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES ('controle-faturamento', 'visao_completa')
ON CONFLICT DO NOTHING;

-- Exceções individuais: quem tem 'visualizar' liberado ganha a ação nova (e ainda não tem linha dela).
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT s.user_id, 'controle-faturamento', 'visao_completa', true, 'Backfill: já via a tela completa antes da ação existir'
  FROM public.screen_permission_user s
 WHERE s.menu_codigo = 'controle-faturamento' AND s.acao = 'visualizar' AND s.allow = true
   AND NOT EXISTS (
     SELECT 1 FROM public.screen_permission_user x
      WHERE x.user_id = s.user_id AND x.menu_codigo = 'controle-faturamento' AND x.acao = 'visao_completa'
   );

-- Perfis de acesso: quem tem 'visualizar' na tela pelo perfil ganha a ação no mesmo perfil.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT p.perfil_id, 'controle-faturamento', 'visao_completa', true
  FROM public.perfil_acesso_permissao p
 WHERE p.menu_codigo = 'controle-faturamento' AND p.acao = 'visualizar' AND p.allow = true
   AND NOT EXISTS (
     SELECT 1 FROM public.perfil_acesso_permissao x
      WHERE x.perfil_id = p.perfil_id AND x.menu_codigo = 'controle-faturamento' AND x.acao = 'visao_completa'
   );

NOTIFY pgrst, 'reload schema';
