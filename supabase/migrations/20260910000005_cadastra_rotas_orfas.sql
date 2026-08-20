-- Cadastra as telas que existiam no roteador mas nunca foram registradas em
-- app_menu — e por isso estavam ABERTAS a qualquer usuário autenticado.
--
-- O RouteGuard trata "rota sem entrada em app_menu" como sempre liberada (é
-- uma decisão de compatibilidade da migração do controle de acesso, ver
-- src/components/auth/RouteGuard.tsx). Consequência: quem cria tela nova e
-- esquece de cadastrar deixa ela pública sem perceber. Foi o que o usuário
-- encontrou testando /app/financeiro/emissao-nf/cadastro,
-- /app/financeiro/emissao-nf/controle-notas e /app/operacional/diarias.
--
-- Levantamento completo (roteador x app_menu, com casamento por PREFIXO, que é
-- o que matchMenuCode faz): 23 rotas abertas. Divididas em duas causas:
--
--   14 delas têm menu cadastrado com a rota certa, mas INATIVO. Como
--      useAccessibleMenus filtra por ativo=true, o menu some do casamento e a
--      rota vira "não cadastrada" => ABERTA. Ou seja: desativar um menu no
--      Catálogo não fecha a tela, ABRE. Isso é corrigido no código (RouteGuard
--      passa a negar menu inativo), não aqui.
--
--    9 não têm cadastro nenhum. Destas, esta migration cadastra 6 — as que são
--      tela de módulo de verdade. Ficam de fora:
--        /app/meu-perfil e /app/meu-perfil/discord -> viram allowlist fixa no
--           código (todo autenticado precisa ver o próprio perfil);
--        /app/admin/smoke-helena -> rota de teste, tratada no código.
--
-- Cada tela é concedida ao perfil do módulo dono (decisão do usuário), pelo
-- mesmo casamento por nome exato perfil_acesso.nome = app_modulo.nome já usado
-- em 20260906000001.
--
-- ROLLBACK:
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo IN
--     ('nf_emissao_cadastro','nf_emissao_controle','juridico_home','operacional_home','operacional_diarias','rh_hierarquia');
--   DELETE FROM public.app_menu WHERE codigo IN
--     ('nf_emissao_cadastro','nf_emissao_controle','juridico_home','operacional_home','operacional_diarias','rh_hierarquia');

-- ── 1. Cadastra as 6 telas ───────────────────────────────────────────────────

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT mo.id, v.codigo, v.nome, v.rota,
       COALESCE((SELECT max(am.ordem) FROM public.app_menu am WHERE am.modulo_id = mo.id), 0) + 10
FROM public.app_modulo mo
JOIN (VALUES
  ('Financeiro',  'nf_emissao_cadastro',  'Emissão de NF — Cadastro',       '/app/financeiro/emissao-nf/cadastro'),
  ('Financeiro',  'nf_emissao_controle',  'Emissão de NF — Controle',       '/app/financeiro/emissao-nf/controle-notas'),
  ('Jurídico',    'juridico_home',        'Jurídico — Início',              '/app/juridico'),
  ('Operacional', 'operacional_home',     'Operacional — Início',           '/app/operacional'),
  ('Operacional', 'operacional_diarias',  'Diárias',                        '/app/operacional/diarias'),
  ('RH',          'rh_hierarquia',        'Hierarquia',                     '/app/rh/hierarquia')
) AS v(modulo, codigo, nome, rota) ON v.modulo = mo.nome
WHERE NOT EXISTS (SELECT 1 FROM public.app_menu am WHERE am.codigo = v.codigo);

-- ── 2. Concede ao perfil do módulo dono ─────────────────────────────────────
--
-- ATENÇÃO: sem esta parte as telas ficariam invisíveis pra todo mundo assim
-- que o deny-by-default entrar, porque cadastrar o menu tira a rota do ramo
-- "não cadastrada => aberta". Quem trabalha nelas hoje continua trabalhando.

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, v.codigo, 'visualizar'::app_acao, true
FROM public.perfil_acesso pa
JOIN (VALUES
  ('Financeiro',  'nf_emissao_cadastro'),
  ('Financeiro',  'nf_emissao_controle'),
  ('Jurídico',    'juridico_home'),
  ('Operacional', 'operacional_home'),
  ('Operacional', 'operacional_diarias'),
  ('RH',          'rh_hierarquia')
) AS v(perfil_nome, codigo) ON v.perfil_nome = pa.nome
WHERE pa.ativo = true AND pa.concede_tudo = false
ON CONFLICT DO NOTHING;

-- Emissão de NF: quem já tem a tela-mãe (/app/financeiro/nf-emissao) mantém as
-- duas filhas. Sem isto, quem trabalha com NF hoje por exceção individual
-- perderia o acesso no dia em que o deny-by-default entrasse.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT DISTINCT pap.perfil_id, v.codigo, 'visualizar'::app_acao, true
FROM public.perfil_acesso_permissao pap
JOIN (VALUES ('nf_emissao_cadastro'), ('nf_emissao_controle')) AS v(codigo) ON true
WHERE pap.menu_codigo = 'nf-emissao' AND pap.acao = 'visualizar' AND pap.allow
ON CONFLICT DO NOTHING;

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id)
SELECT DISTINCT spu.user_id, v.codigo, 'visualizar'::app_acao, true, NULL::uuid
FROM public.screen_permission_user spu
JOIN (VALUES ('nf_emissao_cadastro'), ('nf_emissao_controle')) AS v(codigo) ON true
WHERE spu.menu_codigo = 'nf-emissao' AND spu.acao = 'visualizar' AND spu.allow AND spu.empresa_id IS NULL
ON CONFLICT (user_id, menu_codigo, acao, empresa_id) DO UPDATE SET allow = true, updated_at = now();
