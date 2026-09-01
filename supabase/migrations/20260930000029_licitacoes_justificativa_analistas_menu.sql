-- SIS-2026-0283 (Iury): "Criar um Submódulo em Malote e Licitações chamado
-- 'Justificativa Analistas' onde só apareça os itens do malote que os
-- analistas precisam justificar" — decidido junto com o usuário: fica
-- dentro do módulo Licitações (não duplicado em Malote), mesma tela
-- servindo os dois contextos de origem citados no chamado.
--
-- Registro de menu novo (README: "toda tela nova ganha 1 linha em
-- app_menu"). Sem isso a tela não aparece pra ninguém em
-- Gerenciamento de Acesso, e o RouteGuard trataria a rota como "não
-- cadastrada" = aberta pra qualquer autenticado (o oposto do
-- deny-by-default do projeto).
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT id, 'licitacoes_justificativa_analistas', 'Justificativa Analistas', '/app/licitacoes/justificativa-analistas', 270, true
FROM public.app_modulo WHERE codigo = 'licitacoes'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- =====================================================================
-- ROLLBACK
--   DELETE FROM public.app_menu WHERE codigo = 'licitacoes_justificativa_analistas';
