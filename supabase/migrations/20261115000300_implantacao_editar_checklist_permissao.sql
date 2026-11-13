-- =====================================================================
-- [SEM-CHAMADO] — Implantação de Contratos: "Pode editar o checklist"
--                 vira permissão própria, separada de ver a tela
--
-- PEDIDO (Pablo, 13/11/2026): "aqui precisa de um gerenciamento de acesso
-- diferente, adiciona lá em licitacao e Pode Editar o Checklist de
-- implantação".
--
-- ANTES
--   Quem tinha 'incluir'/'alterar' no menu da Implantação
--   ('licitacoes.implantacao', ou o legado 'implantacao') gravava o checklist
--   (20261021000080 + 20261028000003). Na prática quem abria a tela para
--   acompanhar também via Confirmar / Preencher / lápis e conseguia mudar
--   resposta de outro setor.
--
-- AGORA
--   1) Menu fantasma 'licitacoes-implantacao-editar-checklist' (rota NULL)
--      no módulo Licitação — aparece em Administração › Acesso por Usuário
--      como "Licitações — Implantação: Pode editar o checklist". Mesmo padrão
--      do 'licitacoes-implantacao-confirmar-setor' (20261113220000).
--   2) Gravar em checklist_respostas (INSERT e UPDATE do upsert) e renomear
--      o contrato (UPDATE em implantacao_contrato — o lápis do "Nome do
--      contrato") passam a exigir SÓ esse menu fantasma.
--   3) Ler continua igual: quem vê a Implantação vê o checklist e o painel.
--   4) Excluir o contrato e a inclusão continuam no menu da tela
--      ('excluir'/'incluir'), sem mudança.
--
-- SEMENTE — para ninguém que edita hoje perder a edição no dia do merge:
--   perfis concede_tudo e quem já tem 'alterar' ou 'incluir' na Implantação
--   (perfil ou pessoa, nos dois códigos de menu). A partir daí quem decide é
--   o Gerenciamento de Acesso: tirar dali quem só deve ler.
--
-- Os gatilhos SECURITY DEFINER que escrevem em implantacao_contrato a partir
-- da Capa de Edital não passam por RLS — não são afetados.
--
-- Migration leve (3 policies + 1 menu). Idempotente. ROLLBACK no fim.
-- =====================================================================
SET lock_timeout = '5s';

-- 1) Menu fantasma ---------------------------------------------------------
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'licitacoes-implantacao-editar-checklist',
       'Licitações — Implantação: Pode editar o checklist', NULL, 33, true
  FROM public.app_modulo m WHERE m.codigo = 'licitacoes'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('licitacoes-implantacao-editar-checklist', 'visualizar')
ON CONFLICT DO NOTHING;

-- 2) Semente ----------------------------------------------------------------
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'licitacoes-implantacao-editar-checklist', 'visualizar'::public.app_acao, true
  FROM public.perfil_acesso pa
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT DISTINCT p.perfil_id, 'licitacoes-implantacao-editar-checklist', 'visualizar'::public.app_acao, true
  FROM public.perfil_acesso_permissao p
  JOIN public.perfil_acesso pa ON pa.id = p.perfil_id AND pa.ativo AND NOT pa.concede_tudo
 WHERE p.menu_codigo IN ('licitacoes.implantacao', 'implantacao')
   AND p.acao IN ('alterar', 'incluir') AND p.allow
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- empresa_id nulo nunca conflita no UNIQUE: o NOT EXISTS é que garante que reexecutar não duplica.
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id, motivo)
SELECT DISTINCT s.user_id, 'licitacoes-implantacao-editar-checklist', 'visualizar'::public.app_acao, true, s.empresa_id,
       'Implantação: quem já editava o checklist continua editando (permissão separada em 15/11/2026)'
  FROM public.screen_permission_user s
 WHERE s.menu_codigo IN ('licitacoes.implantacao', 'implantacao')
   AND s.acao IN ('alterar', 'incluir') AND s.allow
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id AND x.menu_codigo = 'licitacoes-implantacao-editar-checklist'
                      AND x.acao = 'visualizar' AND x.empresa_id IS NOT DISTINCT FROM s.empresa_id);

-- 3) RLS da escrita ------------------------------------------------------------
DROP POLICY IF EXISTS checklist_respostas_insert ON public.checklist_respostas;
CREATE POLICY checklist_respostas_insert ON public.checklist_respostas FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.can_access(auth.uid(), 'licitacoes-implantacao-editar-checklist'::text, 'visualizar'::app_acao)));

DROP POLICY IF EXISTS checklist_respostas_update ON public.checklist_respostas;
CREATE POLICY checklist_respostas_update ON public.checklist_respostas FOR UPDATE TO authenticated
  USING ((SELECT public.can_access(auth.uid(), 'licitacoes-implantacao-editar-checklist'::text, 'visualizar'::app_acao)))
  WITH CHECK ((SELECT public.can_access(auth.uid(), 'licitacoes-implantacao-editar-checklist'::text, 'visualizar'::app_acao)));

DROP POLICY IF EXISTS implantacao_update ON public.implantacao_contrato;
CREATE POLICY implantacao_update ON public.implantacao_contrato FOR UPDATE TO authenticated
  USING ((SELECT public.can_access(auth.uid(), 'licitacoes-implantacao-editar-checklist'::text, 'visualizar'::app_acao)))
  WITH CHECK ((SELECT public.can_access(auth.uid(), 'licitacoes-implantacao-editar-checklist'::text, 'visualizar'::app_acao)));

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK (volta a gravação para 'incluir'/'alterar' do menu da tela)
--
-- DROP POLICY IF EXISTS checklist_respostas_insert ON public.checklist_respostas;
-- CREATE POLICY checklist_respostas_insert ON public.checklist_respostas FOR INSERT TO authenticated
--   WITH CHECK ((
--     SELECT public.can_access(auth.uid(), 'licitacoes.implantacao'::text, 'incluir'::app_acao)
--         OR public.can_access(auth.uid(), 'licitacoes.implantacao'::text, 'alterar'::app_acao)
--         OR public.can_access(auth.uid(), 'implantacao'::text, 'incluir'::app_acao)
--         OR public.can_access(auth.uid(), 'implantacao'::text, 'alterar'::app_acao)
--   ));
-- DROP POLICY IF EXISTS checklist_respostas_update ON public.checklist_respostas;
-- CREATE POLICY checklist_respostas_update ON public.checklist_respostas FOR UPDATE TO authenticated
--   USING ((
--     SELECT public.can_access(auth.uid(), 'licitacoes.implantacao'::text, 'alterar'::app_acao)
--         OR public.can_access(auth.uid(), 'implantacao'::text, 'alterar'::app_acao)
--   ))
--   WITH CHECK ((
--     SELECT public.can_access(auth.uid(), 'licitacoes.implantacao'::text, 'alterar'::app_acao)
--         OR public.can_access(auth.uid(), 'implantacao'::text, 'alterar'::app_acao)
--   ));
-- DROP POLICY IF EXISTS implantacao_update ON public.implantacao_contrato;
-- CREATE POLICY implantacao_update ON public.implantacao_contrato FOR UPDATE TO authenticated
--   USING (
--     public.can_access(auth.uid(), 'licitacoes.implantacao', 'alterar'::app_acao)
--     OR public.can_access(auth.uid(), 'implantacao', 'alterar'::app_acao)
--   );
-- DELETE FROM public.screen_permission_user  WHERE menu_codigo = 'licitacoes-implantacao-editar-checklist';
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'licitacoes-implantacao-editar-checklist';
-- DELETE FROM public.app_menu_acao           WHERE menu_codigo = 'licitacoes-implantacao-editar-checklist';
-- DELETE FROM public.app_menu                WHERE codigo      = 'licitacoes-implantacao-editar-checklist';
-- NOTIFY pgrst, 'reload schema';
-- =====================================================================
