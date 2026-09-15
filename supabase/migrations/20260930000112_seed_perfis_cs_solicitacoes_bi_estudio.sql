-- =========================================================================
-- Semear os menus novos nos perfis de módulo (J2 da revisão da PR #566)
--
-- As migrations 20260930000106 (bi_estudio) e 20260930000111
-- (central_servicos_solicitacoes) criaram o menu e pararam aí — quem
-- quisesse liberar tinha que marcar usuário por usuário. Mesmo caso da
-- 20260925000008 (troca de função): NÃO é tranca, é conveniência. O
-- RouteGuard nega por padrão; medido em 15/09/2026, só os 7 de
-- `concede_tudo` enxergavam as duas telas.
--
-- O que entra:
--   perfil "Central de Serviços" → central_servicos_solicitacoes
--        visualizar / incluir / alterar (as mesmas ações que a RLS de vaga
--        checa; a tela é a do encarregado, que só tem visualizar no perfil
--        dele porque o menu raiz cobre o resto)
--   perfil "BI"                  → bi_estudio
--        visualizar / incluir / alterar / excluir / executar_ia / exportar
--        (o analista de dados é o dono do Estúdio; quem só olha painel
--        recebe visualizar em Acesso por Usuário)
--
-- O perfil de módulo (modulo_codigo) já concede todos os menus do módulo
-- pela regra do has_screen_access; a linha explícita existe pra Acesso por
-- Usuário mostrar a ação certa e pra revisão não acusar menu sem dono.
--
-- Idempotente.
-- =========================================================================
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, x.menu, x.acao::public.app_acao, true
  FROM (VALUES
    ('Central de Serviços', 'central_servicos_solicitacoes', 'visualizar'),
    ('Central de Serviços', 'central_servicos_solicitacoes', 'incluir'),
    ('Central de Serviços', 'central_servicos_solicitacoes', 'alterar'),
    ('BI',                  'bi_estudio',                    'visualizar'),
    ('BI',                  'bi_estudio',                    'incluir'),
    ('BI',                  'bi_estudio',                    'alterar'),
    ('BI',                  'bi_estudio',                    'excluir'),
    ('BI',                  'bi_estudio',                    'executar_ia'),
    ('BI',                  'bi_estudio',                    'exportar')
  ) AS x(perfil, menu, acao)
  JOIN public.perfil_acesso pa ON pa.nome = x.perfil AND pa.ativo
 WHERE EXISTS (SELECT 1 FROM public.app_menu m WHERE m.codigo = x.menu)
   AND NOT EXISTS (
     SELECT 1 FROM public.perfil_acesso_permissao p
      WHERE p.perfil_id = pa.id AND p.menu_codigo = x.menu AND p.acao::text = x.acao);

NOTIFY pgrst, 'reload schema';

-- Conferência
-- SELECT pa.nome, pap.menu_codigo, string_agg(pap.acao::text, ', ' ORDER BY pap.acao::text)
--   FROM public.perfil_acesso pa JOIN public.perfil_acesso_permissao pap ON pap.perfil_id = pa.id AND pap.allow
--  WHERE pap.menu_codigo IN ('central_servicos_solicitacoes', 'bi_estudio') GROUP BY 1, 2;

-- ROLLBACK
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo IN ('central_servicos_solicitacoes', 'bi_estudio');
