-- SIS-2026-0104: telas de detalhe abertas a partir de "Meus Itens"
-- (visualização de Despesa e visualização/edição de Solicitação).
-- Precisam do próprio app_menu, senão o RouteGuard bloqueia mesmo quem
-- já tem "Meus Itens" liberado (matchMenuCode não cobre rotas fora do
-- prefixo já cadastrado). Mesmo padrão fechado-por-padrão do resto do
-- Malote (20260828000003 / 20260829000003).

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'malote_despesa_visualizar', 'Malote — Visualizar Despesa', '/app/malote/despesa/:id', 7
FROM public.app_modulo m
WHERE m.codigo = 'malote'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'malote_solicitacao_visualizar', 'Malote — Visualizar Solicitação', '/app/malote/solicitacao/:id', 8
FROM public.app_modulo m
WHERE m.codigo = 'malote'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, mc.menu_codigo, a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES ('malote_despesa_visualizar'), ('malote_solicitacao_visualizar')) AS mc(menu_codigo)
 CROSS JOIN (VALUES
    ('visualizar'::public.app_acao),
    ('incluir'::public.app_acao),
    ('alterar'::public.app_acao),
    ('excluir'::public.app_acao)
 ) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

NOTIFY pgrst, 'reload schema';
