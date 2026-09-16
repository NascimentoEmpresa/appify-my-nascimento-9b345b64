-- =========================================================================
-- Semear os menus novos da Diretoria no perfil "Diretoria" (J2 da revisão
-- da PR #596)
--
-- A 20260930000127 criou diretoria_solicitacoes_demissao e
-- diretoria_recrutamento e parou aí — quem quisesse liberar tinha que
-- marcar usuário por usuário em Acesso por Usuário. Mesmo caso da 112
-- (Central de Serviços / BI): NÃO é tranca, é conveniência. O RouteGuard
-- nega por padrão; sem esta linha só os `concede_tudo` enxergavam as duas
-- telas. Teste J1.G feito no banco em 16/09/2026: usuário sem perfil, só com
-- os toggles, vê e aprova demissão e vaga administrativas.
--
-- O que entra no perfil "Diretoria" (modulo_codigo = diretoria):
--   diretoria_solicitacoes_demissao → visualizar / aprovar
--   diretoria_recrutamento          → visualizar / aprovar
--   diretoria_troca_funcao          → visualizar (já era do módulo; a linha
--                                     explícita é pra Acesso por Usuário
--                                     mostrar a ação certa)
--
-- Idempotente.
-- =========================================================================
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, x.menu, x.acao::public.app_acao, true
  FROM (VALUES
    ('Diretoria', 'diretoria_solicitacoes_demissao', 'visualizar'),
    ('Diretoria', 'diretoria_solicitacoes_demissao', 'aprovar'),
    ('Diretoria', 'diretoria_recrutamento',          'visualizar'),
    ('Diretoria', 'diretoria_recrutamento',          'aprovar'),
    ('Diretoria', 'diretoria_troca_funcao',          'visualizar')
  ) AS x(perfil, menu, acao)
  JOIN public.perfil_acesso pa ON pa.nome = x.perfil AND pa.ativo
 WHERE NOT EXISTS (
   SELECT 1 FROM public.perfil_acesso_permissao pp
    WHERE pp.perfil_id = pa.id AND pp.menu_codigo = x.menu AND pp.acao = x.acao::public.app_acao);

NOTIFY pgrst, 'reload schema';

-- Conferência
-- SELECT pp.menu_codigo, pp.acao FROM public.perfil_acesso_permissao pp JOIN public.perfil_acesso p ON p.id = pp.perfil_id
--  WHERE p.nome = 'Diretoria' ORDER BY 1, 2;

-- ROLLBACK
-- DELETE FROM public.perfil_acesso_permissao pp USING public.perfil_acesso p
--  WHERE p.id = pp.perfil_id AND p.nome = 'Diretoria'
--    AND pp.menu_codigo IN ('diretoria_solicitacoes_demissao', 'diretoria_recrutamento', 'diretoria_troca_funcao');
