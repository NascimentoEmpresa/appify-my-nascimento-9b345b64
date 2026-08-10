-- SIS-2026-0095 (ajuste): "Ratear Classificação" virou uma rota própria
-- (/app/malote/ratear-classificacao), não um toggle interno dentro de
-- Criar Despesa — precisa do próprio app_menu, seguindo o mesmo padrão
-- fechado-por-padrão do resto do módulo Malote
-- (20260828000003_malote_menus_deny_by_default.sql).

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'malote_ratear_classificacao', 'Malote — Ratear Classificação', '/app/malote/ratear-classificacao', 6
FROM public.app_modulo m
WHERE m.codigo = 'malote'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- Fecha por padrão, igual aos outros 5 menus do Malote.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'malote_ratear_classificacao', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
    ('visualizar'::public.app_acao),
    ('incluir'::public.app_acao),
    ('alterar'::public.app_acao),
    ('excluir'::public.app_acao)
 ) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

NOTIFY pgrst, 'reload schema';
