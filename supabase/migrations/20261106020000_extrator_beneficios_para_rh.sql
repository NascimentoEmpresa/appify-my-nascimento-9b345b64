-- Extrator de Benefícios (VA/VT) sai do Financeiro e vai para o RH (06/11/2026).
--
-- Só muda o MÓDULO e a ROTA da linha de app_menu. O CÓDIGO continua
-- 'financeiro-extrator-beneficios' de propósito: é a chave de tudo o que
-- garante o acesso — screen_permission_user (concessões por usuário), as
-- policies de extrator_beneficios_job e do bucket extrator-beneficios
-- (can_access(..., 'financeiro-extrator-beneficios', ...)) e o
-- perfil_acesso_permissao. Renomear o código obrigaria a migrar as
-- concessões e recriar as policies, e quem já usa a tela perderia o acesso
-- se qualquer passo falhasse. Com o módulo trocado, Administração › Acesso
-- por Usuário passa a mostrar a tela dentro de Recursos Humanos, com as
-- mesmas pessoas liberadas.
--
-- O front acompanha: rota /app/rh/extrator-beneficios (a antiga redireciona)
-- e item no Sidebar em RH › Pessoas.

UPDATE public.app_menu
   SET modulo_id = (SELECT id FROM public.app_modulo WHERE codigo = 'rh'),
       nome      = 'RH — Extrator de Benefícios (VA/VT)',
       rota      = '/app/rh/extrator-beneficios'
 WHERE codigo = 'financeiro-extrator-beneficios'
   AND EXISTS (SELECT 1 FROM public.app_modulo WHERE codigo = 'rh');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.app_menu mn JOIN public.app_modulo m ON m.id = mn.modulo_id
     WHERE mn.codigo = 'financeiro-extrator-beneficios' AND m.codigo = 'rh'
  ) THEN
    RAISE NOTICE 'Extrator de Benefícios não ficou no módulo RH (menu ou módulo rh ausente)';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   UPDATE public.app_menu
--      SET modulo_id = (SELECT id FROM public.app_modulo WHERE codigo = 'financeiro'),
--          nome      = 'Financeiro — Extrator de Benefícios (VA/VT)',
--          rota      = '/app/financeiro/gestao-financeira/extrator-beneficios'
--    WHERE codigo = 'financeiro-extrator-beneficios';
