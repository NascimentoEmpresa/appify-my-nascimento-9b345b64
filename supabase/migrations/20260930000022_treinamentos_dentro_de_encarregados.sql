-- =====================================================================
-- TREINAMENTOS deixa de ser módulo e passa a ser um grupo dentro de
-- ENCARREGADOS.
--
-- POR QUÊ. O módulo tinha um item só (Treinamentos ERP) e, por ora, não há
-- mais nada de treinamentos previsto — um bloco no menu lateral para uma
-- linha custa mais atenção do que entrega. Quem faz o treinamento do ERP é
-- o encarregado, então é lá que a tela mora melhor. Se o assunto voltar a
-- crescer, o rollback no fim deste arquivo devolve o módulo.
--
-- O QUE NÃO MUDA, DE PROPÓSITO
--
--   A ROTA (/app/treinamentos/erp) e o CÓDIGO do menu ficam como estão. É
--   o código que carrega a permissão de quem já tem acesso — trocá-lo
--   zeraria os grants e obrigaria a remarcar pessoa por pessoa, e trocar a
--   rota quebraria link salvo e o histórico do navegador. Mesma decisão do
--   `escritorio_troca_funcao`, que manteve a rota antiga ao mudar de dono.
--
--   Nenhuma permissão é criada, apagada ou movida aqui: só o `modulo_id`
--   da linha em app_menu muda. Em "Acesso por Usuário" o item passa a
--   aparecer sob Encarregados, com os mesmos toggles marcados de antes.
--
-- O MÓDULO É REMOVIDO, não desativado: a tela de Módulos & Menus lista
-- app_modulo inteiro, sem filtrar por `ativo`, então um módulo vazio e
-- inativo continuaria aparecendo lá para sempre como sujeira. O DELETE só
-- roda depois de o módulo ficar sem nenhum menu.
-- =====================================================================

-- ── 1. Move os menus para Encarregados ───────────────────────────────
-- ordem 30: depois dos itens de solicitação, junto do fim do módulo.
UPDATE public.app_menu
   SET modulo_id = (SELECT id FROM public.app_modulo WHERE codigo = 'encarregados'),
       ordem     = 30,
       updated_at = now()
 WHERE modulo_id = (SELECT id FROM public.app_modulo WHERE codigo = 'treinamentos');

-- ── 2. Remove o módulo, se ficou vazio ───────────────────────────────
-- Guarda: se sobrou algum menu (item criado direto na tela depois desta
-- migration ser escrita), a migration falha em vez de apagar em cascata e
-- levar o menu junto.
DO $$
DECLARE v_restantes int;
BEGIN
  SELECT count(*) INTO v_restantes
    FROM public.app_menu m
    JOIN public.app_modulo mo ON mo.id = m.modulo_id
   WHERE mo.codigo = 'treinamentos';

  IF v_restantes > 0 THEN
    RAISE EXCEPTION 'Ainda há % menu(s) em treinamentos — mova antes de remover o módulo.', v_restantes;
  END IF;

  DELETE FROM public.app_modulo WHERE codigo = 'treinamentos';
END $$;

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────
-- O item tem de aparecer sob encarregados, com as permissões INTACTAS.
SELECT mo.codigo AS modulo, m.codigo, m.rota,
       (SELECT count(*) FROM public.perfil_acesso_permissao p WHERE p.menu_codigo = m.codigo) AS perm_perfil,
       (SELECT count(*) FROM public.screen_permission_user s WHERE s.menu_codigo = m.codigo) AS perm_usuario
  FROM public.app_menu m
  JOIN public.app_modulo mo ON mo.id = m.modulo_id
 WHERE m.rota LIKE '/app/treinamentos%';

-- =====================================================================
-- ROLLBACK (devolve o módulo e o menu para ele)
--   INSERT INTO public.app_modulo (codigo, nome, ordem, ativo)
--   VALUES ('treinamentos', 'Treinamentos', 76, true)
--   ON CONFLICT (codigo) DO NOTHING;
--   UPDATE public.app_menu
--      SET modulo_id = (SELECT id FROM public.app_modulo WHERE codigo = 'treinamentos'),
--          ordem = 1
--    WHERE rota LIKE '/app/treinamentos%';
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
