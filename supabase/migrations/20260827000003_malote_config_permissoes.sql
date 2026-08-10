-- SIS-2026-0082: backfill de perfil_acesso_permissao pro menu
-- 'malote_configuracoes'.
--
-- A migration anterior (20260827000002_malote_config.sql) já restringe a
-- ESCRITA no banco (RLS: has_role admin/controladoria/diretor_adm), mas o
-- FRONTEND usa um sistema de permissão separado — usePermissoes().can(),
-- que resolve por perfil_acesso_permissao/menu_codigo, não por role direto.
-- Sem este backfill, can('alterar', ..., 'malote_configuracoes') só
-- retorna true pra quem tem perfil com concede_tudo (hoje só "Legado:
-- admin"), então o botão "Salvar alterações" e as ações de editar/excluir
-- dia bloqueado ficariam escondidos até pra controladoria/diretor_adm —
-- mesmo o RLS permitindo a escrita deles.
--
-- Legado: admin não precisa (concede_tudo).
--
-- 'visualizar' também é concedido explicitamente aqui (em vez de deixar no
-- fallback "menu não configurado = aberto pra todo mundo") porque, assim
-- que este menu ganha QUALQUER linha em perfil_acesso_permissao, ele passa
-- a contar como "configurado" (list_configured_menu_codes) — e nesse ponto
-- o fallback de leitura aberta deixa de valer pra quem não tem grant. Sem
-- este INSERT, a tela ficaria com "Acesso negado" pra todo mundo que não
-- seja admin/controladoria/diretor_adm, incluindo quem só precisa ver.

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'malote_configuracoes', 'visualizar'::public.app_acao, true
FROM public.perfil_acesso pa
WHERE pa.nome IN ('Legado: controladoria', 'Legado: diretor_adm')
  AND NOT EXISTS (
    SELECT 1 FROM public.perfil_acesso_permissao pap
    WHERE pap.perfil_id = pa.id AND pap.menu_codigo = 'malote_configuracoes' AND pap.acao = 'visualizar'::public.app_acao
  );

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'malote_configuracoes', 'alterar'::public.app_acao, true
FROM public.perfil_acesso pa
WHERE pa.nome IN ('Legado: controladoria', 'Legado: diretor_adm')
  AND NOT EXISTS (
    SELECT 1 FROM public.perfil_acesso_permissao pap
    WHERE pap.perfil_id = pa.id AND pap.menu_codigo = 'malote_configuracoes' AND pap.acao = 'alterar'::public.app_acao
  );

NOTIFY pgrst, 'reload schema';
