-- =========================================================================
-- ACESSO — completa o resíduo de quem ficou só com 'visualizar'
--
-- O SINTOMA: "o menu está ligado para o Joel no Gerenciamento de Acesso,
-- mas ele não consegue agendar veículo nem entrar na Manutenção".
--
-- A CAUSA: acesso concedido antes de ~20/08/2026 gravava UMA linha só,
-- `visualizar`. O toggle da tela hoje concede o pacote inteiro
-- (visualizar, incluir, alterar, aprovar, exportar — ACOES_DO_TOGGLE_PADRAO
-- em ModulosMenusTab.tsx), mas quem foi liberado antes ficou como estava:
-- a tela mostra o menu ligado e o botão devolve erro de RLS.
--
-- No caso do Joel (compras2@haggltda.com.br) a policy é explícita:
--
--   cs_veiculo_agendamento / INSERT
--     WITH CHECK (tem_acesso_menu('central_servicos_veiculos','incluir') AND …)
--
-- Ele tinha `visualizar` e só. Por isso via a tela, via a frota, via os
-- próximos agendamentos — e o "Agendar" batia na RLS, virando
-- "Seu perfil não tem permissão para isso em Agendamento de Veículos"
-- (a tradução de `violates row-level security` em useAgendamentoVeiculos).
--
-- O ESCOPO desta migration é DELIBERADAMENTE ESTREITO: os três menus do
-- chamado, e só para quem JÁ TEM `visualizar` neles. Não inventa acesso
-- para ninguém — completa o que a tela já diz estar liberado. Medido em
-- 26/08/2026, antes de rodar:
--
--   central_servicos_veiculos → 3 de 11 usuários com só visualizar
--   sup_manutencao            → 4 de 12
--   sup_patrimonio            → 5 de 13
--
-- `excluir` fica DE FORA, como no toggle da tela: liberar o menu não é
-- autorizar apagar registro.
--
-- Idempotente.
-- ROLLBACK: no fim do arquivo.
-- =========================================================================

-- ── Antes: quem está com o resíduo ───────────────────────────────────────
SELECT p.email, s.menu_codigo, string_agg(s.acao::text, ', ' ORDER BY s.acao::text) AS acoes_hoje
  FROM public.screen_permission_user s
  JOIN public.profiles p ON p.id = s.user_id
 WHERE s.menu_codigo IN ('central_servicos_veiculos','sup_manutencao','sup_patrimonio')
   AND s.allow
 GROUP BY 1, 2
HAVING bool_and(s.acao::text = 'visualizar')
 ORDER BY 1, 2;

-- ── O ajuste ─────────────────────────────────────────────────────────────
-- Só para o par (usuário, menu) que já tem visualizar e NADA além disso.
-- Quem já tinha alguma ação a mais foi configurado de propósito por alguém
-- e não é resíduo — fica intocado.
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow)
SELECT j.user_id, j.menu_codigo, a.acao::public.app_acao, true
  FROM (
    SELECT s.user_id, s.menu_codigo
      FROM public.screen_permission_user s
     WHERE s.menu_codigo IN ('central_servicos_veiculos','sup_manutencao','sup_patrimonio')
       AND s.allow
     GROUP BY s.user_id, s.menu_codigo
    HAVING bool_and(s.acao::text = 'visualizar')
  ) j
  CROSS JOIN (VALUES ('incluir'), ('alterar'), ('aprovar'), ('exportar')) AS a(acao)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.screen_permission_user x
    WHERE x.user_id = j.user_id AND x.menu_codigo = j.menu_codigo
      AND x.acao::text = a.acao
 );

-- ── Depois: conferência ──────────────────────────────────────────────────
SELECT p.email, s.menu_codigo, string_agg(s.acao::text, ', ' ORDER BY s.acao::text) AS acoes
  FROM public.screen_permission_user s
  JOIN public.profiles p ON p.id = s.user_id
 WHERE s.menu_codigo IN ('central_servicos_veiculos','sup_manutencao','sup_patrimonio')
   AND s.allow
 GROUP BY 1, 2 ORDER BY 1, 2;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- O RESÍDUO EXISTE EM OUTROS MENUS. Esta migration NÃO os toca de propósito:
-- completar permissão em massa, sem alguém olhando menu a menu, é o tipo de
-- coisa que dá acesso a quem ninguém pretendia. Para descobrir onde mais
-- dói, a consulta é esta (roda sozinha, não altera nada):
--
--   SELECT s.menu_codigo, count(*) AS usuarios_so_com_visualizar
--     FROM public.screen_permission_user s
--    WHERE s.allow
--    GROUP BY s.user_id, s.menu_codigo
--   HAVING bool_and(s.acao::text = 'visualizar');
-- =========================================================================
-- ROLLBACK
--   Devolve os três menus ao estado de resíduo (só visualizar) PARA TODOS,
--   inclusive quem tinha ação a mais de propósito. Confira a listagem do
--   "Depois" acima antes de rodar.
--
--   DELETE FROM public.screen_permission_user
--    WHERE menu_codigo IN ('central_servicos_veiculos','sup_manutencao','sup_patrimonio')
--      AND acao::text <> 'visualizar';
-- =========================================================================
