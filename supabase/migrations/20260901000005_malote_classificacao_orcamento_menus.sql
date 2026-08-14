-- SIS-2026-0125: telas de Classificação/Orçamento saem de
-- /app/controladoria/... e passam a viver dentro do Malote. Nenhuma
-- entrada de app_menu existia para as rotas antigas de controladoria
-- (cadastro-classificacao / orcamento-administrativo), então não há nada
-- pra desativar ali — só registramos as 5 rotas novas. Mesmo padrão
-- fechado-por-padrão do resto do Malote (20260828000003 / 20260829000003
-- / 20260831000002).

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem
FROM public.app_modulo m
CROSS JOIN (VALUES
  ('malote_classificacoes_administrativo', 'Malote — Classificações Administrativo', '/app/malote/classificacoes-administrativo', 20),
  ('malote_orcamento_administrativo', 'Malote — Orçamento Administrativo', '/app/malote/orcamento-administrativo', 21),
  ('malote_classificacoes_malote', 'Malote — Classificações Malote', '/app/malote/classificacoes-malote', 22),
  ('malote_orcamento_contratos', 'Malote — Orçamento de Contratos', '/app/malote/orcamento-contratos', 23),
  ('malote_orcamento_geral', 'Malote — Orçamento Geral', '/app/malote/orcamento-geral', 24)
) AS x(codigo, nome, rota, ordem)
WHERE m.codigo = 'malote'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, mc.menu_codigo, a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
    ('malote_classificacoes_administrativo'),
    ('malote_orcamento_administrativo'),
    ('malote_classificacoes_malote'),
    ('malote_orcamento_contratos'),
    ('malote_orcamento_geral')
 ) AS mc(menu_codigo)
 CROSS JOIN (VALUES
    ('visualizar'::public.app_acao),
    ('incluir'::public.app_acao),
    ('alterar'::public.app_acao),
    ('excluir'::public.app_acao)
 ) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

NOTIFY pgrst, 'reload schema';
