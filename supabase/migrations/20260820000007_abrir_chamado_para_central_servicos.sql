-- =====================================================================
-- ACESSO — "Abrir chamado (solicitar)" muda de modulo
--
-- A capacidade chamados_sistemas_abrir estava listada em Sistemas, junto
-- com as permissoes de quem ATENDE o chamado (painel, coordenar, aprovar,
-- dev, excluir). Mas ela e o oposto: e a permissao de quem PEDE. Quem abre
-- chamado e o usuario comum, que nao tem nada a ver com o modulo Sistemas
-- e nao e procurado ali na hora de liberar acesso.
--
-- Passa para Central de Servicos, ao lado de "Chamados de Sistemas"
-- (central_servicos_chamados, ordem 60), que e a tela por onde o usuario
-- comum entra.
--
-- So muda o AGRUPAMENTO na tela de Acesso por Usuario. O codigo do menu
-- continua chamados_sistemas_abrir de proposito: as concessoes em
-- screen_permission_user e perfil_acesso_permissao sao gravadas por
-- menu_codigo (texto), entao renomear derrubaria as 39 liberacoes que ja
-- existem e quebraria as referencias no codigo e nas policies de RLS.
--
-- Idempotente.
-- ROLLBACK:
--   UPDATE public.app_menu SET modulo_id = (SELECT id FROM public.app_modulo WHERE codigo='sistemas'), ordem = 18
--    WHERE codigo = 'chamados_sistemas_abrir';
-- =====================================================================

UPDATE public.app_menu
   SET modulo_id = (SELECT id FROM public.app_modulo WHERE codigo = 'central_servicos'),
       ordem     = 61,   -- logo abaixo de central_servicos_chamados (60)
       updated_at = now()
 WHERE codigo = 'chamados_sistemas_abrir';

-- Trava: se o modulo nao existir, o UPDATE acima poria modulo_id NULL e o
-- menu sumiria da tela de Acesso por Usuario sem erro nenhum.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.app_menu m
      JOIN public.app_modulo mo ON mo.id = m.modulo_id
     WHERE m.codigo = 'chamados_sistemas_abrir' AND mo.codigo = 'central_servicos')
  THEN
    RAISE EXCEPTION 'chamados_sistemas_abrir nao ficou em central_servicos';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
