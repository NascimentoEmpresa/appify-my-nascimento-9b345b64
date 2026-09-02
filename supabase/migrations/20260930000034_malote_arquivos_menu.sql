-- SIS-2026-0290 (Iury): "Criar um submódulo onde o usuário consegue buscar
-- os arquivos do malote como o de pagamento e o comprovante" —
-- /app/malote/arquivos, tela só de consulta (não cria/altera/exclui nada,
-- só lê malote_despesa/malote_despesa_parcela já cobertos pela RLS
-- existente dessas tabelas). Só precisa do menu pra liberar a rota — nada
-- de tabela/policy nova.

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'malote_arquivos', 'Malote — Arquivos do Malote', '/app/malote/arquivos', 7
FROM public.app_modulo m
WHERE m.codigo = 'malote'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- Fecha por padrão, igual ao resto do módulo Malote (deny-by-default) —
-- só visualizar/exportar fazem sentido aqui, a tela não inclui/altera/
-- exclui nada.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'malote_arquivos', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
    ('visualizar'::public.app_acao),
    ('exportar'::public.app_acao)
 ) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'malote_arquivos';
--   DELETE FROM public.app_menu WHERE codigo = 'malote_arquivos';
-- =====================================================================
