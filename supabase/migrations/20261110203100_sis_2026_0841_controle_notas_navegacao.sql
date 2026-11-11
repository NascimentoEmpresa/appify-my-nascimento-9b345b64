-- SIS-2026-0841: mesma identificação de acesso, nomes iguais aos da navegação.
-- Preserva permissões, exceções individuais e o estado ativo de cadastros existentes.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, v.codigo, v.nome, v.rota, v.ordem, true
FROM public.app_modulo m
CROSS JOIN (VALUES
  ('nf-emissao', 'Controle de Notas', '/app/financeiro/emissao-nf', 90),
  ('nf_emissao_cadastro', 'Emissão de NF', '/app/financeiro/emissao-nf/cadastro', 91),
  ('nf_emissao_controle', 'Validação de Notas', '/app/financeiro/emissao-nf/controle-notas', 92)
) v(codigo, nome, rota, ordem)
WHERE m.codigo = 'financeiro'
ON CONFLICT (modulo_id, codigo) DO UPDATE SET nome = EXCLUDED.nome, rota = EXCLUDED.rota;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT p.id, v.codigo, 'visualizar'::public.app_acao, true
FROM public.perfil_acesso p
JOIN public.app_modulo m ON m.nome = p.nome AND m.codigo = 'financeiro'
CROSS JOIN (VALUES ('nf-emissao'), ('nf_emissao_cadastro'), ('nf_emissao_controle')) v(codigo)
WHERE p.ativo AND NOT p.concede_tudo
ON CONFLICT DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao)
SELECT v.codigo, 'visualizar'::public.app_acao
FROM (VALUES ('nf-emissao'), ('nf_emissao_cadastro'), ('nf_emissao_controle')) v(codigo)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- ROLLBACK operacional: publicar a versão anterior do frontend se necessário.
-- Não remover menus ou permissões: os códigos continuam protegendo as mesmas telas.
NOTIFY pgrst, 'reload schema';
