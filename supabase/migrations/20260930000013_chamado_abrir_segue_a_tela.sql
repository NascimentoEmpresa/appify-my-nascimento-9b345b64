-- =====================================================================
-- CHAMADOS DE SISTEMAS — quem alcança a tela pode abrir chamado.
--
-- SINTOMA. Usuário com a tela de Chamados de Sistemas liberada entra, vê os
-- cards e o histórico, mas não tem o botão "Abrir Novo Chamado". A tela chega
-- a dizer "Clique em Abrir Novo Chamado" num botão que não existe.
--
-- CAUSA. `chamado_pode_abrir()` nasceu (20260802000002) com a regra
-- "aberto até alguém configurar":
--
--     tem_acesso_menu('chamados_sistemas_abrir')
--     OR NOT EXISTS (SELECT 1 FROM list_configured_menu_codes()
--                    WHERE menu_codigo = 'chamados_sistemas_abrir')
--
-- O segundo ramo vale enquanto NINGUÉM tiver o código configurado. Hoje são
-- 61 exceções individuais e 40 regras de perfil — ou seja, o ramo "aberto"
-- morreu no dia em que a primeira pessoa foi configurada, e a capacidade
-- virou uma lista fechada sem que ninguém decidisse isso. Quem entrou depois
-- passou a precisar de liberação nominal para abrir chamado.
--
-- É a mesma armadilha do "menu novo nasce aberto": default permissivo que se
-- fecha sozinho no primeiro uso da tela de acesso, e o efeito só aparece
-- semanas depois, para quem chegou por último.
--
-- REGRA NOVA, e é o que o Pablo pediu: abrir chamado acompanha o ACESSO À
-- TELA. Quem consegue entrar em qualquer uma das três portas do módulo pode
-- abrir. Faz sentido além da conveniência — a tela existe para abrir e
-- acompanhar chamado; ver a tela sem poder abrir não é um estado útil.
--
-- `chamados_sistemas_abrir` continua valendo como OR, então as 101 concessões
-- existentes não são perdidas — mas deixa de RESTRINGIR: ninguém mais fica de
-- fora por não estar na lista. O nome exibido passa a dizer isso, para quem
-- administra acesso não achar que ainda precisa liberar item por item.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.chamado_pode_abrir()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  -- As três portas da MESMA tela (a rota muda, o componente é o mesmo).
  SELECT public.tem_acesso_menu('central_servicos_chamados')
      OR public.tem_acesso_menu('chamados_sistemas')
      OR public.tem_acesso_menu('encarregados_chamados')
      -- Quem gerencia chamado obviamente pode abrir um.
      OR public.chamado_sistema_gestor()
      -- Aditivo: preserva quem já tinha a capacidade avulsa.
      OR public.tem_acesso_menu('chamados_sistemas_abrir');
$$;
REVOKE ALL ON FUNCTION public.chamado_pode_abrir() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_pode_abrir() TO authenticated;

-- O rótulo na tela de Acesso por Usuário passa a dizer que a liberação
-- individual não é mais necessária. Sem isso, quem administra continuaria
-- caçando o toggle para cada pessoa nova.
UPDATE public.app_menu
   SET nome = 'Chamados — Abrir chamado (já liberado por quem vê a tela)'
 WHERE codigo = 'chamados_sistemas_abrir';

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   CREATE OR REPLACE FUNCTION public.chamado_pode_abrir()
--   RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
--   SET search_path = public, pg_temp
--   AS $$
--     SELECT public.tem_acesso_menu('chamados_sistemas_abrir')
--         OR NOT EXISTS (SELECT 1 FROM public.list_configured_menu_codes()
--                        WHERE menu_codigo = 'chamados_sistemas_abrir');
--   $$;
--   UPDATE public.app_menu SET nome = 'Chamados — Abrir chamado (solicitar)'
--    WHERE codigo = 'chamados_sistemas_abrir';
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
