-- =====================================================================
-- AGENDAMENTO DE VEÍCULOS — liberar o menu para quem usa o ERP
--
-- A 20260828000001 semeou permissão só nos perfis `concede_tudo`, para o
-- módulo não nascer inacessível até para quem administra. Efeito colateral:
-- ficou acessível SÓ para eles. Os perfis que a empresa realmente usa
-- (Legado: comercial, rh, operacional, financeiro, sst…) tinham zero linhas,
-- então has_screen_access devolvia false e a RPC da frota, zero veículos.
--
-- Agendar um carro da frota é tarefa de colaborador, não de administrador,
-- então o menu é liberado para todo perfil ativo que tenha ao menos um
-- usuário.
--
-- POR QUE SÓ visualizar E incluir
--   visualizar → abre a tela, lê a frota e a agenda. É também o que a policy
--                de UPDATE exige para alguém cancelar a PRÓPRIA reserva
--                (o `solicitante_id = auth.uid()` é quem faz o resto).
--   incluir    → cria a reserva.
--   alterar/excluir NÃO entram: mexer em reserva alheia é de quem administra
--                Suprimentos › Patrimônio, decidido na 20260828000003.
--
-- Idempotente e aditivo: ON CONFLICT DO NOTHING não sobrescreve quem já foi
-- configurado à mão, e nenhum `allow = false` existente é tocado.
--
-- ROLLBACK:
--   DELETE FROM public.perfil_acesso_permissao
--    WHERE menu_codigo = 'central_servicos_veiculos'
--      AND acao IN ('visualizar','incluir')
--      AND perfil_id IN (SELECT perfil_id FROM public.usuario_perfil_acesso);
-- =====================================================================

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT DISTINCT pa.id, 'central_servicos_veiculos', a.acao, true
  FROM public.perfil_acesso pa
  JOIN public.usuario_perfil_acesso upa ON upa.perfil_id = pa.id
 CROSS JOIN (VALUES ('visualizar'::public.app_acao),
                    ('incluir'::public.app_acao)) AS a(acao)
 WHERE pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- ── Conferência: quantos usuários passam a enxergar a tela ───────────
SELECT count(DISTINCT upa.user_id) AS usuarios_com_acesso
  FROM public.usuario_perfil_acesso upa
  JOIN public.perfil_acesso pa           ON pa.id = upa.perfil_id AND pa.ativo
  JOIN public.perfil_acesso_permissao p  ON p.perfil_id = pa.id
 WHERE p.menu_codigo = 'central_servicos_veiculos'
   AND p.acao = 'visualizar' AND p.allow;

NOTIFY pgrst, 'reload schema';
