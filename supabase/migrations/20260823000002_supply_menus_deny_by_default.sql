-- =====================================================================
-- SUPPLY — fechar os menus novos por padrão
--
-- PROBLEMA QUE ISTO CORRIGE
-- Este ERP trata menu SEM NENHUMA configuração como aberto: veja
-- list_configured_menu_codes e o uso dela em Sidebar.canSee e no RouteGuard.
-- A ideia é não esconder de repente uma tela que nunca teve regra definida.
--
-- Efeito colateral nos menus criados nesta sprint: como ninguém nunca marcou
-- nada para eles em "Acesso por Usuário", QUALQUER usuário autenticado
-- enxergava Catálogo, Pedidos de Materiais e Estoque & Etiquetas. Medido em
-- 2026-08-05 com um usuário real sem perfil: can_access = false para os seis
-- códigos, mas o app mostrava todos.
--
-- COMO SE FECHA
-- Basta o código passar a ter ao menos UMA regra: aí ele entra em
-- list_configured_menu_codes e o comportamento vira negado por padrão, que é
-- o que vale para o resto do sistema.
--
-- As regras semeadas aqui vão para os perfis com concede_tudo (o
-- "Administrador Geral"), que já enxergavam tudo de qualquer forma — a linha
-- não muda nada para eles, só marca o menu como configurado.
--
-- ⚠️ DEPOIS DE RODAR: só quem tem perfil concede_tudo vê o módulo Suprimentos.
-- O time de Compras/Supply precisa ser liberado em
-- /app/administracao?tab=modulos → Acesso por Usuário. É exatamente o
-- comportamento pedido: ninguém entra sem alguém marcar a flag.
--
-- ROLLBACK (volta a deixar aberto):
--   DELETE FROM public.perfil_acesso_permissao
--    WHERE menu_codigo IN ('sup_catalogo','sup_catalogo_aprovacao',
--      'sup_pedidos_materiais','sup_estoque',
--      'encarregados_solicitar_materiais','encarregados_meus_pedidos');
-- =====================================================================

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, m.codigo, a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
    ('sup_catalogo'),
    ('sup_catalogo_aprovacao'),
    ('sup_pedidos_materiais'),
    ('sup_estoque'),
    ('encarregados_solicitar_materiais'),
    ('encarregados_meus_pedidos')
 ) AS m(codigo)
 CROSS JOIN (VALUES
    ('visualizar'::public.app_acao),
    ('incluir'::public.app_acao),
    ('alterar'::public.app_acao),
    ('excluir'::public.app_acao)
 ) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- ── Conferência ──────────────────────────────────────────────────────
-- Todos os seis devem aparecer como configurado = true.
SELECT m.codigo,
       EXISTS (SELECT 1 FROM public.perfil_acesso_permissao p WHERE p.menu_codigo = m.codigo)
         AS configurado_agora
  FROM (VALUES
    ('sup_catalogo'), ('sup_catalogo_aprovacao'), ('sup_pedidos_materiais'),
    ('sup_estoque'), ('encarregados_solicitar_materiais'), ('encarregados_meus_pedidos')
  ) AS m(codigo)
 ORDER BY 1;

NOTIFY pgrst, 'reload schema';
