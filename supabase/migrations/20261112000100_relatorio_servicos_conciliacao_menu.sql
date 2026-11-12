-- SIS-2026-0869: aba "Conciliação" do Relatório de Serviços (Relatório Geral × Dashboard × Faturamento da Empresa).
-- ============================================================================
-- Só leitura, calculada no front a partir de nf_emissao/contratos/planilha_custo, que já têm as próprias RLS — esta migration só
-- cria o MENU FANTASMA (rota NULL: não aparece na sidebar) que decide quem vê a aba. A liberação por pessoa é feita em
-- /app/administracao?tab=modulos. Perfis "concede tudo" já alcançam o menu; os demais ficam sem a aba até serem liberados
-- (deny-by-default). Idempotente.
--
-- ROLLBACK:
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'relatorio-servicos-conciliacao';
--   DELETE FROM public.screen_permission_user WHERE menu_codigo = 'relatorio-servicos-conciliacao';
--   DELETE FROM public.app_menu WHERE codigo = 'relatorio-servicos-conciliacao';
--   NOTIFY pgrst, 'reload schema';

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'relatorio-servicos-conciliacao',
       'Relatório de Serviços — Conciliação Financeira (aba)', NULL, 28, true
  FROM public.app_modulo m WHERE m.codigo = 'financeiro'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'relatorio-servicos-conciliacao', 'visualizar'::public.app_acao, true
  FROM public.perfil_acesso pa
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

NOTIFY pgrst, 'reload schema';
