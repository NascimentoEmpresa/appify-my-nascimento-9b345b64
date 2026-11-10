-- SIS-2026-0841: expõe no Gerenciamento de Acesso as ações reais do piloto.
-- A migration da fila já foi aplicada; o complemento preserva seu histórico.
INSERT INTO public.app_menu_acao (menu_codigo, acao)
SELECT 'financeiro-nfse', a.acao::public.app_acao
FROM (VALUES ('visualizar'), ('incluir'), ('alterar'), ('exportar')) a(acao)
WHERE EXISTS (SELECT 1 FROM public.app_menu WHERE codigo = 'financeiro-nfse')
ON CONFLICT (menu_codigo, acao) DO NOTHING;

NOTIFY pgrst, 'reload schema';
