-- =========================================================================
-- RELATÓRIOS — sai da Diretoria e vira MÓDULO PRÓPRIO (07/10/2026)
--
-- PEDIDO (Pablo): "tira o submódulo RELATÓRIOS da diretoria, move ele pra
-- um módulo real separado, as permissões também".
--
-- O QUE MUDA
--   · app_modulo 'relatorios' (Relatórios), logo depois da Diretoria.
--   · Os 13 menus dos relatórios (mig 20261005000006: Relatório Geral, os 10
--     relatórios e a Análise com I.A) MUDAM DE MÓDULO para Relatórios, com
--     rota nova /app/relatorios/... e nome sem o prefixo "Relatórios — ".
--   · PERMISSÕES: a liberação é por CÓDIGO de menu (screen_permission_user e
--     perfil_acesso_permissao.menu_codigo; has_screen_access não olha
--     módulo). Os códigos ficam os MESMOS — então cada pessoa continua com
--     exatamente o acesso que tem hoje, agora listado em Acesso por Usuário
--     dentro do módulo Relatórios. As RPCs dir_rel_* / dir_turnover_* não
--     mudam (checam os mesmos códigos).
--
-- TRANSIÇÃO (a tela publicada usa /app/diretoria/relatorios até o Lovable
-- publicar a nova; o RouteGuard nega rota fora do app_menu): ficam, NA
-- DIRETORIA, cópias ATIVAS com a rota antiga e o nome "(rota antiga)",
-- mesmos códigos. app_menu só proíbe
-- código repetido no MESMO módulo. Liberar/negar em qualquer uma das duas
-- linhas é a mesma permissão (é por código). Depois que a tela nova estiver
-- no ar, aplicar 20261007000011_relatorios_limpa_rotas_antigas.sql.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

INSERT INTO public.app_modulo (codigo, nome, descricao, icone, ordem, ativo)
VALUES ('relatorios', 'Relatórios', 'Relatórios de todos os sistemas de solicitação, quadro e turn-over', 'BarChart3', 143, true)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, descricao = EXCLUDED.descricao, icone = EXCLUDED.icone, ativo = true;

DO $$
DECLARE
  v_dir uuid := (SELECT id FROM public.app_modulo WHERE codigo = 'diretoria');
  v_rel uuid := (SELECT id FROM public.app_modulo WHERE codigo = 'relatorios');
  r record;
BEGIN
  IF v_dir IS NULL OR v_rel IS NULL THEN RAISE EXCEPTION 'Módulo diretoria/relatorios não encontrado.'; END IF;

  FOR r IN
    SELECT * FROM public.app_menu
     WHERE modulo_id = v_dir
       AND (codigo LIKE 'diretoria\_rel\_%' OR codigo IN ('diretoria_relatorio_geral', 'diretoria_relatorios_ia'))
       AND nome NOT LIKE '%(rota antiga)'
  LOOP
    -- 1) a linha "de verdade" vai para Relatórios, com rota e nome novos
    IF NOT EXISTS (SELECT 1 FROM public.app_menu WHERE modulo_id = v_rel AND codigo = r.codigo) THEN
      INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
      VALUES (v_rel, r.codigo,
              regexp_replace(r.nome, '^Relatórios\s*—\s*', ''),
              CASE WHEN r.rota IS NULL THEN NULL ELSE replace(r.rota, '/app/diretoria/relatorios', '/app/relatorios') END,
              r.ordem - 39, r.ativo);
    END IF;
    -- 2) a linha antiga fica na Diretoria só como ponte da rota antiga
    IF r.rota IS NULL THEN
      DELETE FROM public.app_menu WHERE id = r.id;   -- menu-fantasma (I.A) não tem rota a preservar
    ELSE
      UPDATE public.app_menu SET nome = r.nome || ' (rota antiga)' WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DELETE FROM app_menu WHERE modulo_id = (SELECT id FROM app_modulo WHERE codigo = 'relatorios');
-- UPDATE app_menu SET nome = replace(nome, ' (rota antiga)', '') WHERE nome LIKE '%(rota antiga)';
-- INSERT da linha 'diretoria_relatorios_ia' (rota NULL, ordem 51) de volta na Diretoria.
-- DELETE FROM app_modulo WHERE codigo = 'relatorios';
