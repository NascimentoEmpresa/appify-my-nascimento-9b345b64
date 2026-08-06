-- =====================================================================
-- MALOTE — fechar os menus novos por padrão
--
-- Mesmo problema e mesma solução já aplicados em Supply
-- (20260823000002_supply_menus_deny_by_default.sql): menu SEM NENHUMA
-- configuração em perfil_acesso_permissao é tratado como ABERTO pra
-- qualquer autenticado (ver list_configured_menu_codes, usada em
-- Sidebar.canSee e no RouteGuard). Os 5 menus do módulo Malote
-- (20260826000002_malote_modulo.sql) nunca tiveram nenhuma regra
-- explícita — resultado: "5/5 menus liberados" pra todo mundo, mesmo
-- sem ninguém ter marcado nada em Acesso por Usuário.
--
-- Pedido do usuário (junto com Eduardo): esses menus devem nascer
-- FECHADOS, e o time libera depois, pessoa por pessoa/perfil, via
-- gerenciamento de acesso — não abertos por omissão.
--
-- COMO SE FECHA: basta o código passar a ter ao menos UMA regra pra
-- entrar em list_configured_menu_codes; a partir daí o comportamento
-- vira negado por padrão. As regras semeadas aqui vão pro perfil
-- concede_tudo ("Administrador Geral"), que já enxergava tudo mesmo —
-- a linha não muda nada pra ele, só marca o menu como configurado.
--
-- 'malote_configuracoes' já tinha grants explícitos (20260827000003 e
-- 20260828000002, pra Legado: controladoria/diretor_adm e pro perfil
-- Malote) — então já estava "configurado" e fechado por tabela pra
-- quem não tem esses grants. Os outros 4 (aprovacoes, criar_despesa,
-- dashboard, meus_itens) ainda não tinham nenhuma regra — são o alvo
-- real desta migration.
--
-- ⚠️ DEPOIS DE RODAR: só quem tem perfil concede_tudo, ou os grants
-- específicos já dados a malote_configuracoes, vê o módulo Malote. O
-- time precisa ser liberado em /app/administracao → Acesso por Usuário.
-- É o comportamento pedido: ninguém entra sem alguém marcar a flag.
--
-- ROLLBACK (volta a deixar aberto):
--   DELETE FROM public.perfil_acesso_permissao
--    WHERE menu_codigo IN ('malote_aprovacoes','malote_criar_despesa',
--      'malote_dashboard','malote_meus_itens')
--      AND perfil_id IN (SELECT id FROM public.perfil_acesso WHERE concede_tudo);
-- =====================================================================

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, m.codigo, a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
    ('malote_aprovacoes'),
    ('malote_configuracoes'),
    ('malote_criar_despesa'),
    ('malote_dashboard'),
    ('malote_meus_itens')
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
-- Todos os cinco devem aparecer como configurado = true.
SELECT m.codigo,
       EXISTS (SELECT 1 FROM public.perfil_acesso_permissao p WHERE p.menu_codigo = m.codigo)
         AS configurado_agora
  FROM (VALUES
    ('malote_aprovacoes'), ('malote_configuracoes'), ('malote_criar_despesa'),
    ('malote_dashboard'), ('malote_meus_itens')
  ) AS m(codigo)
 ORDER BY 1;

NOTIFY pgrst, 'reload schema';
