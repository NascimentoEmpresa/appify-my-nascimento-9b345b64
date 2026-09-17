-- =========================================================================
-- Orientações Jurídicas também no módulo Encarregados
--
-- Pedido do Pablo (17/09/2026): "duplicar esse sistema na Central de
-- Serviços e Encarregados — o pessoal vai ver todas as respostas e as
-- próprias solicitações". A Central de Serviços já tem a tela
-- (central_servicos_orientacoes, mig 20260713000001); o que falta é a porta
-- no módulo Encarregados. É a MESMA tela React (OrientacoesJuridicas) na
-- rota /app/encarregados/orientacoes-juridicas, com menu próprio — o mesmo
-- desenho de Treinamentos (mig 054): liberar uma porta não abre a outra.
--
-- Os dados (JUR_DUVIDAS / JUR_DUVIDAS_COMPLEMENTOS) não mudam: a RLS de
-- leitura é aberta a autenticados, a de escrita já é por autor.
--
-- J2: menu novo nasce com regra no perfil "Encarregados" (visualizar), pra
-- não ficar sem dono. Item estático no Sidebar.tsx e rota no App.tsx vão
-- na mesma PR.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem
  FROM (VALUES
    ('encarregados_orientacoes', 'Orientações Jurídicas', '/app/encarregados/orientacoes-juridicas', 45)
  ) AS x(codigo, nome, rota, ordem)
  JOIN public.app_modulo m ON m.codigo = 'encarregados'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

UPDATE public.app_menu SET ativo = true WHERE codigo = 'encarregados_orientacoes';

-- Perfil Encarregados enxerga a tela (perguntar é livre pela RLS: autor = auth.uid()).
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'encarregados_orientacoes', 'visualizar'::public.app_acao, true
  FROM public.perfil_acesso pa
 WHERE pa.nome = 'Encarregados' AND pa.ativo
   AND NOT EXISTS (
     SELECT 1 FROM public.perfil_acesso_permissao pp
      WHERE pp.perfil_id = pa.id AND pp.menu_codigo = 'encarregados_orientacoes' AND pp.acao = 'visualizar'::public.app_acao);

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'encarregados_orientacoes';
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'encarregados_orientacoes';
-- DELETE FROM public.app_menu WHERE codigo = 'encarregados_orientacoes';
-- NOTIFY pgrst, 'reload schema';
