-- SIS-2026-0082 (ajuste): além dos perfis "Legado: controladoria" e
-- "Legado: diretor_adm" (que têm os usuários reais hoje — ver
-- 20260827000003), também concede visualizar/alterar em
-- 'malote_configuracoes' pro perfil "Malote" — perfil novo (curado, não
-- "Legado: <role>"), criado em 06/08/2026, pensado como o destino oficial
-- de quem vai mexer neste módulo daqui pra frente. Está vazio hoje (nenhum
-- usuário vinculado ainda), mas o grant já fica pronto: assim que alguém
-- for vinculado a ele pelo admin, a tela já funciona sem precisar de nova
-- migration.

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'malote_configuracoes', 'visualizar'::public.app_acao, true
FROM public.perfil_acesso pa
WHERE pa.nome = 'Malote'
  AND NOT EXISTS (
    SELECT 1 FROM public.perfil_acesso_permissao pap
    WHERE pap.perfil_id = pa.id AND pap.menu_codigo = 'malote_configuracoes' AND pap.acao = 'visualizar'::public.app_acao
  );

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'malote_configuracoes', 'alterar'::public.app_acao, true
FROM public.perfil_acesso pa
WHERE pa.nome = 'Malote'
  AND NOT EXISTS (
    SELECT 1 FROM public.perfil_acesso_permissao pap
    WHERE pap.perfil_id = pa.id AND pap.menu_codigo = 'malote_configuracoes' AND pap.acao = 'alterar'::public.app_acao
  );

NOTIFY pgrst, 'reload schema';
