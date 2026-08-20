-- SIS-2026-0194 (ajuste pós-revisão J1.A): a exclusão permanente exigia
-- "excluir" nos menus de Despesa/Solicitação, e só o Administrador Geral
-- (concede_tudo=true) tinha essa ação — funcional, mas dá acesso total ao
-- sistema pra quem só precisa apagar despesa de teste. Cria um perfil
-- dedicado, pequeno, só com essa ação nesses 2 menus, e atribui aos 3
-- devs + Iury (dono do processo do Malote) — sem depender de dar
-- concede_tudo pra ninguém.
-- modulo_codigo fica NULL de propósito: essa coluna é UNIQUE e o valor
-- 'malote' já pertence ao perfil "Malote" (acesso completo ao módulo) —
-- esse perfil novo é só um complemento pontual, não "o" perfil do módulo.
INSERT INTO public.perfil_acesso (nome, descricao, concede_tudo, ativo)
VALUES (
  'Malote: Exclusão Permanente',
  'Só a ação de excluir permanentemente Despesa/Solicitação do Malote (SIS-2026-0194) — usado pra limpar dados de teste.',
  false,
  true
)
ON CONFLICT (nome) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, m.menu_codigo, 'excluir', true
FROM public.perfil_acesso pa
CROSS JOIN (VALUES ('malote_despesa_visualizar'), ('malote_solicitacao_visualizar')) AS m(menu_codigo)
WHERE pa.nome = 'Malote: Exclusão Permanente'
ON CONFLICT (perfil_id, menu_codigo, acao) DO UPDATE SET allow = true;

INSERT INTO public.usuario_perfil_acesso (user_id, perfil_id)
SELECT p.id, pa.id
FROM public.profiles p
CROSS JOIN public.perfil_acesso pa
WHERE pa.nome = 'Malote: Exclusão Permanente'
  AND p.email IN (
    'joaovictor.controladoria@haggltda.com.br', -- João
    'analisededados@haggltda.com.br',           -- Eduardo
    'senior@haggltda.com.br',                   -- Pablo
    'iurysilva@haggltda.com.br'                 -- Iury
  )
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DELETE FROM public.usuario_perfil_acesso WHERE perfil_id = (SELECT id FROM public.perfil_acesso WHERE nome = 'Malote: Exclusão Permanente');
--   DELETE FROM public.perfil_acesso_permissao WHERE perfil_id = (SELECT id FROM public.perfil_acesso WHERE nome = 'Malote: Exclusão Permanente');
--   DELETE FROM public.perfil_acesso WHERE nome = 'Malote: Exclusão Permanente';
