-- Segunda metade da correção do gerenciamento de acesso do Suprimentos: agora
-- que o perfil "Suprimentos" tem visualizar de verdade (migration anterior),
-- tira o "Administrador Geral" (gambiarra) de duas pessoas e concede só as
-- ações de escrita que o cargo real delas precisa, pela mesma tabela que a
-- tela "Acesso por Usuário"/"Por Módulo" já usa (screen_permission_user).
--
-- Carlos Eduardo (cadunascimentor@gmail.com, Gerente de Novos Negócios)
-- mantém Administrador Geral — decisão explícita do usuário, não é gambiarra.
--
-- ROLLBACK:
-- DELETE FROM public.screen_permission_user spu USING public.profiles p
--  WHERE spu.user_id = p.id AND p.email IN ('compras@haggltda.com.br','isadoraprisco.compras@haggltda.com.br')
--    AND spu.menu_codigo IN ('sup_catalogo','sup_catalogo_aprovacao','sup_pedidos_materiais','sup_cotacoes',
--                             'sup_cotacoes_malote','fornecedores','sup_estoque','almoxarifados','sup_epis_admissao')
--    AND spu.acao IN ('incluir','alterar');
-- INSERT INTO public.usuario_perfil_acesso (user_id, perfil_id)
-- SELECT p.id, pa.id FROM public.profiles p, public.perfil_acesso pa
--  WHERE p.email IN ('compras@haggltda.com.br','isadoraprisco.compras@haggltda.com.br') AND pa.nome = 'Administrador Geral';

-- Cleidir (Supervisor Compras): incluir/alterar nas telas de compras/cotações/fornecedores
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id)
SELECT p.id, v.menu_codigo, v.acao::app_acao, true, NULL
FROM public.profiles p, (VALUES
  ('sup_catalogo','incluir'), ('sup_catalogo','alterar'),
  ('sup_catalogo_aprovacao','alterar'),
  ('sup_pedidos_materiais','incluir'), ('sup_pedidos_materiais','alterar'),
  ('sup_cotacoes','incluir'), ('sup_cotacoes','alterar'),
  ('sup_cotacoes_malote','incluir'), ('sup_cotacoes_malote','alterar'),
  ('fornecedores','incluir'), ('fornecedores','alterar')
) AS v(menu_codigo, acao)
WHERE p.email = 'compras@haggltda.com.br'
ON CONFLICT (user_id, menu_codigo, acao, empresa_id) DO UPDATE SET allow = true, updated_at = now();

-- Isadora (Supervisor Almoxarife): incluir/alterar em estoque/almoxarifados/EPIs, alterar em pedidos
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id)
SELECT p.id, v.menu_codigo, v.acao::app_acao, true, NULL
FROM public.profiles p, (VALUES
  ('sup_estoque','incluir'), ('sup_estoque','alterar'),
  ('almoxarifados','incluir'), ('almoxarifados','alterar'),
  ('sup_pedidos_materiais','alterar'),
  ('sup_epis_admissao','incluir'), ('sup_epis_admissao','alterar')
) AS v(menu_codigo, acao)
WHERE p.email = 'isadoraprisco.compras@haggltda.com.br'
ON CONFLICT (user_id, menu_codigo, acao, empresa_id) DO UPDATE SET allow = true, updated_at = now();

-- Remove Administrador Geral das duas (Carlos Eduardo não é tocado)
DELETE FROM public.usuario_perfil_acesso upa
USING public.perfil_acesso pa, public.profiles p
WHERE upa.perfil_id = pa.id AND upa.user_id = p.id
  AND pa.nome = 'Administrador Geral'
  AND p.email IN ('compras@haggltda.com.br','isadoraprisco.compras@haggltda.com.br');
