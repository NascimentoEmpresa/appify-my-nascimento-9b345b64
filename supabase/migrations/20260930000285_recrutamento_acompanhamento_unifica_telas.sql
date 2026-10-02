-- =========================================================================
-- RECRUTAMENTO — Acompanhar Experiência funde em Acompanhar Colaboradores
-- (02/10/2026)
--
-- As duas telas (mig 245/248) eram o mesmo painel com dois recortes. Agora
-- é uma tela só — Acompanhar Colaboradores — e a Experiência virou a opção
-- "Em experiência" do filtro de situação. A rota antiga redireciona.
--
-- Aqui só sai o menu antigo da lista (ativo = false). As permissões dele
-- ficam onde estão: recrut_acomp_pode() aceita qualquer um dos dois menus,
-- e na data da fusão os 23 usuários com a Experiência já tinham a de
-- Colaboradores com as mesmas ações — ninguém perde acesso. Por garantia,
-- quem tiver só a antiga ganha a nova abaixo.
-- =========================================================================

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT DISTINCT s.user_id, 'recrutamento_acompanhar_colaboradores', s.acao, true,
       'Migração 20260930000285: tinha Acompanhar Experiência (fundida nesta tela)'
  FROM public.screen_permission_user s
 WHERE s.menu_codigo = 'recrutamento_acompanhar_experiencia' AND s.allow
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id
                      AND x.menu_codigo = 'recrutamento_acompanhar_colaboradores'
                      AND x.acao = s.acao);

UPDATE public.app_menu SET ativo = false
 WHERE codigo = 'recrutamento_acompanhar_experiencia';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- UPDATE public.app_menu SET ativo = true WHERE codigo = 'recrutamento_acompanhar_experiencia';
-- DELETE FROM public.screen_permission_user
--  WHERE menu_codigo = 'recrutamento_acompanhar_colaboradores'
--    AND motivo = 'Migração 20260930000285: tinha Acompanhar Experiência (fundida nesta tela)';
