-- =========================================================================
-- RELATÓRIOS — limpa as rotas antigas da Diretoria (pós-publicação)
--
-- ⚠ APLICAR SÓ DEPOIS que a tela nova (rotas /app/relatorios/...) estiver
-- publicada pelo Lovable. Antes disso, apagar estas linhas faz o RouteGuard
-- da tela antiga negar /app/diretoria/relatorios.
--
-- Complementa a mig 20261007000010: as linhas da Diretoria com nome
-- "... (rota antiga)" eram só a ponte da transição. A tela nova redireciona
-- /app/diretoria/relatorios/* para /app/relatorios/*. Permissões não mudam
-- (são por código, e as linhas do módulo Relatórios ficam).
-- Idempotente.
-- =========================================================================

DELETE FROM public.app_menu
 WHERE modulo_id = (SELECT id FROM public.app_modulo WHERE codigo = 'diretoria')
   AND nome LIKE '%(rota antiga)'
   AND (codigo LIKE 'diretoria\_rel\_%' OR codigo = 'diretoria_relatorio_geral');

NOTIFY pgrst, 'reload schema';

-- ROLLBACK: reaplicar o passo 2 da mig 20261007000010 (recriar as linhas com a rota antiga).
