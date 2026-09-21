-- =========================================================================
-- Treinamentos: o módulo volta (a plataforma precisa dele) e os 13 menus
-- da 190 entram de fato
--
-- A 20260930000190 inseriu os menus com JOIN em app_modulo.codigo =
-- 'treinamentos' — mas esse módulo foi REMOVIDO pela 20260930000022
-- (Treinamentos virou grupo dentro de Encarregados enquanto só tinha o
-- "Treinamentos ERP"). Resultado ao aplicar a 190 em 21/09/2026: 20 tabelas,
-- 28 funções, bucket e RLS entraram; os menus, zero — e sem linha em
-- app_menu o RouteGuard nega todas as telas novas (/app/treinamentos/...).
--
-- O assunto cresceu (é o caso previsto no rollback da 022): o módulo
-- volta, com o Sidebar já esperando `treinamentosModule` (basePath
-- /app/treinamentos). O que fica em Encarregados continua lá: "Treinamentos
-- ERP" (treinamentos_erp / treinamentos_gerenciar / encarregados_treinamentos)
-- — o link no Sidebar de Encarregados não mudou.
--
-- `treinamentos_dashboard` JÁ EXISTE (063: menu fantasma do Dashboard de
-- vídeos, rota NULL, em Encarregados) e a plataforma usa o MESMO código pro
-- Dashboard dela (tipos.ts). Código de menu é único no ERP (J1.D), então a
-- linha é MOVIDA pro módulo e ganha a rota — quem já tinha o toggle
-- continua com ele; o gate do Dashboard de vídeos (AcessoGate pelo código)
-- segue funcionando.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- 0) O perfil de módulo "Treinamentos" sobrou da 022 com modulo_codigo NULL
--    (a 022 apagou o módulo, não o perfil): 0 permissões, 0 usuários em
--    21/09/2026. O trigger criar_perfil_acesso_do_modulo insere um perfil
--    com o nome do módulo e só trata conflito por modulo_codigo — bateria
--    em perfil_acesso_nome_key. Não dá pra reatar antes (FK pro módulo que
--    ainda não existe), então o órfão vazio sai e o trigger cria o novo.
DELETE FROM public.perfil_acesso p
 WHERE p.nome = 'Treinamentos' AND p.modulo_codigo IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.perfil_acesso_permissao pp WHERE pp.perfil_id = p.id)
   AND NOT EXISTS (SELECT 1 FROM public.usuario_perfil_acesso u WHERE u.perfil_id = p.id);

-- 1) O módulo volta
INSERT INTO public.app_modulo (codigo, nome, ordem, ativo)
VALUES ('treinamentos', 'Treinamentos', 76, true)
ON CONFLICT (codigo) DO NOTHING;
UPDATE public.app_modulo SET ativo = true WHERE codigo = 'treinamentos';

-- 2) O Dashboard (código já existente) muda de módulo e ganha a rota
UPDATE public.app_menu
   SET modulo_id = (SELECT id FROM public.app_modulo WHERE codigo = 'treinamentos'),
       rota = '/app/treinamentos', nome = 'Dashboard', ordem = 20, ativo = true
 WHERE codigo = 'treinamentos_dashboard';

-- 3) Os outros 12 menus da plataforma (mesma lista da 190)
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem, true
  FROM (VALUES
    ('treinamentos_alunos',           'Alunos — Visualizar',    '/app/treinamentos/alunos',                 30),
    ('treinamentos_alunos_novo',      'Alunos — Adicionar novo','/app/treinamentos/alunos/novo',            31),
    ('treinamentos_alunos_importar',  'Alunos — Importar',      '/app/treinamentos/alunos/importar',        32),
    ('treinamentos_alunos_tags',      'Alunos — Tags',          '/app/treinamentos/alunos/tags',            33),
    ('treinamentos_cursos',           'Cursos — Visualizar',    '/app/treinamentos/cursos',                 40),
    ('treinamentos_cursos_novo',      'Cursos — Adicionar novo','/app/treinamentos/cursos/novo',            41),
    ('treinamentos_comentarios',      'Cursos — Comentários',   '/app/treinamentos/cursos/comentarios',     42),
    ('treinamentos_categorias',       'Cursos — Categorias',    '/app/treinamentos/cursos/categorias',      43),
    ('treinamentos_certificados',     'Cursos — Certificados',  '/app/treinamentos/cursos/certificados',    44),
    ('treinamentos_avisos',           'Comunicação — Avisos',   '/app/treinamentos/comunicacao/avisos',     50),
    ('treinamentos_notificacoes',     'Comunicação — Notificações', '/app/treinamentos/comunicacao/notificacoes', 51),
    ('treinamentos_calendario',       'Comunicação — Calendário','/app/treinamentos/comunicacao/calendario', 52)
  ) AS x(codigo, nome, rota, ordem)
  JOIN public.app_modulo m ON m.codigo = 'treinamentos'
 WHERE NOT EXISTS (SELECT 1 FROM public.app_menu am WHERE am.codigo = x.codigo);

NOTIFY pgrst, 'reload schema';

-- Conferência
-- SELECT mo.codigo AS modulo, m.codigo, m.rota, m.ativo FROM public.app_menu m
--   JOIN public.app_modulo mo ON mo.id = m.modulo_id WHERE m.codigo LIKE 'treinamentos%' ORDER BY mo.codigo, m.ordem;

-- ROLLBACK
-- DELETE FROM public.app_menu WHERE codigo IN ('treinamentos_alunos','treinamentos_alunos_novo','treinamentos_alunos_importar','treinamentos_alunos_tags','treinamentos_cursos','treinamentos_cursos_novo','treinamentos_comentarios','treinamentos_categorias','treinamentos_certificados','treinamentos_avisos','treinamentos_notificacoes','treinamentos_calendario');
-- UPDATE public.app_menu SET modulo_id = (SELECT id FROM public.app_modulo WHERE codigo = 'encarregados'), rota = NULL, ordem = 30 WHERE codigo = 'treinamentos_dashboard';
-- DELETE FROM public.app_modulo WHERE codigo = 'treinamentos';
