-- SIS-2026-0194: exclusão permanente de Despesa/Solicitação, usada pra
-- limpar dados de teste — restrita ao Administrador Geral (concede_tudo)
-- via gerenciamento de acesso, ação 'excluir' nos menus já existentes.
--
-- Achado ao investigar: o perfil "Malote" (perfil comum, atribuído a
-- usuários regulares do módulo — não é o Admin Geral) já tinha allow=true
-- pra 'excluir' em malote_despesa_visualizar/malote_solicitacao_visualizar
-- desde a criação desses menus — resquício de seed, nunca teve
-- funcionalidade real atrás até agora. Revoga aqui pra não expor o botão
-- de exclusão permanente pra usuários comuns do Malote.
UPDATE public.perfil_acesso_permissao
SET allow = false
WHERE acao = 'excluir'
  AND menu_codigo IN ('malote_despesa_visualizar', 'malote_solicitacao_visualizar')
  AND perfil_id = (SELECT id FROM public.perfil_acesso WHERE nome = 'Malote');

CREATE OR REPLACE FUNCTION public.malote_excluir_permanentemente(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_origem text;
  v_menu text;
BEGIN
  SELECT origem INTO v_origem FROM public.malote_despesa WHERE id = _id;
  IF v_origem IS NULL THEN RAISE EXCEPTION 'Item não encontrado.'; END IF;

  v_menu := CASE WHEN v_origem = 'solicitacao' THEN 'malote_solicitacao_visualizar' ELSE 'malote_despesa_visualizar' END;

  IF NOT public.can_access(auth.uid(), v_menu, 'excluir') THEN
    RAISE EXCEPTION 'Sem permissão para excluir permanentemente este item.';
  END IF;

  -- malote_despesa_rateio_linha, malote_despesa_parcela e
  -- malote_despesa_evento têm FK ON DELETE CASCADE — não precisa deletar
  -- manualmente.
  DELETE FROM public.malote_despesa WHERE id = _id;
END;
$$;

REVOKE ALL ON FUNCTION public.malote_excluir_permanentemente(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.malote_excluir_permanentemente(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.malote_excluir_permanentemente(uuid);
--   UPDATE public.perfil_acesso_permissao SET allow = true
--     WHERE acao = 'excluir' AND menu_codigo IN ('malote_despesa_visualizar', 'malote_solicitacao_visualizar')
--       AND perfil_id = (SELECT id FROM public.perfil_acesso WHERE nome = 'Malote');
