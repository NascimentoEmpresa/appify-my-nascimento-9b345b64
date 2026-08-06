-- =====================================================================
-- SUPRIMENTOS — renomeia "Cotações — Licitação" e cria "Cotações do Malote"
--
-- POR QUE
--   1. "Cotações" sozinho não diz para quem a cotação é. Já existe a tela de
--      Cotações do módulo de Licitações e agora entra uma terceira ("do
--      Malote"): o nome curto vira fonte de confusão em três lugares
--      diferentes da navegação.
--   2. As Cotações do Malote ainda não começaram a ser desenvolvidas, mas a
--      entrada precisa existir e já nascer governada pelo gerenciamento de
--      acesso, como todo o resto do módulo.
--
-- ATENÇÃO PARA QUEM FOR MEXER AQUI DEPOIS
-- Criar o menu nesta tabela NÃO faz o item aparecer na sidebar. A árvore de
-- navegação é escrita à mão em src/components/layout/Sidebar.tsx (ModuleDef);
-- app_menu só FILTRA o que já está lá. As duas pontas são obrigatórias — foi
-- exatamente isso que fez as Cotações de Compras ficarem inalcançáveis pelo
-- menu apesar da rota funcionar (corrigido em 3f9a179).
-- =====================================================================

-- ── 1. Renomear o menu de Cotações de Compras ────────────────────────
-- Só o RÓTULO muda. Código (`sup_cotacoes`) e rota seguem iguais, então quem
-- já tem a permissão continua tendo. O nome aqui é o que aparece em
-- "Acesso por Usuário": deixá-lo diferente do rótulo da sidebar faria você
-- procurar por um nome que não existe na hora de liberar alguém.
UPDATE public.app_menu
   SET nome = 'Cotações para a Licitação'
 WHERE codigo = 'sup_cotacoes';

-- ── 2. Menu novo: Cotações do Malote ─────────────────────────────────
-- Ordem 64 continua a sequência 60–63 do grupo "Materiais & Catálogo".
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sup_cotacoes_malote', 'Cotações do Malote',
       '/app/suprimentos/cotacoes-malote', 64, true
  FROM public.app_modulo m
 WHERE m.codigo = 'suprimentos'
ON CONFLICT (modulo_id, codigo) DO UPDATE
   SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ativo = true;

-- ── 3. Nasce fechado ─────────────────────────────────────────────────
-- Menu sem NENHUMA regra em perfil_acesso_permissao/screen_permission_user é
-- tratado como ABERTO a todo autenticado (list_configured_menu_codes). Semear
-- aqui, nos perfis que já enxergam tudo, é o que marca o código como
-- "configurado" e faz valer negado por padrão. Sem isto, uma tela que nem
-- existe ainda apareceria para a empresa inteira.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'sup_cotacoes_malote', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES ('visualizar'::public.app_acao), ('incluir'::public.app_acao),
                    ('alterar'::public.app_acao), ('excluir'::public.app_acao)) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- ── 4. Conferência ───────────────────────────────────────────────────
SELECT am.codigo, am.nome, am.rota, am.ordem, am.ativo,
       EXISTS (SELECT 1 FROM public.perfil_acesso_permissao p
                WHERE p.menu_codigo = am.codigo) AS fechado_por_padrao
  FROM public.app_menu am
 WHERE am.codigo IN ('sup_cotacoes', 'sup_cotacoes_malote')
 ORDER BY am.ordem;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'sup_cotacoes_malote';
--   DELETE FROM public.app_menu WHERE codigo = 'sup_cotacoes_malote';
--   UPDATE public.app_menu SET nome = 'Cotações — Licitação' WHERE codigo = 'sup_cotacoes';
-- =====================================================================
