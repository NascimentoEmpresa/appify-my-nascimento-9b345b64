-- SIS-2026-0642: tela nova em Controladoria — Fechamento da Empresa (lucro dos contratos menos as despesas
-- administrativas, com projeção dos meses seguintes). Só leitura: reaproveita a RLS já existente de
-- nf_emissao/contratos/planilha_custo/Fluxo de Caixa, sem policy nova. O acesso é liberado por usuário em
-- /app/administracao?tab=modulos.

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'fechamento-empresa', 'Fechamento da Empresa', '/app/controladoria/fechamento-empresa', 53
  FROM public.app_modulo m
 WHERE m.codigo = 'controladoria'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   DELETE FROM public.screen_permission_user WHERE menu_codigo = 'fechamento-empresa';
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'fechamento-empresa';
--   DELETE FROM public.app_menu WHERE codigo = 'fechamento-empresa';
--   NOTIFY pgrst, 'reload schema';
