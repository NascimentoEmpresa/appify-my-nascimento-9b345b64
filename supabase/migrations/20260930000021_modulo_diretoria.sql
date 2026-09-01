-- =====================================================================
-- MÓDULO DIRETORIA — as telas de aprovação que a diretoria já usa,
-- ancoradas num módulo próprio.
--
-- O QUE É, E O QUE NÃO É
--
--   NÃO há tela nova, componente novo nem regra de acesso nova. São as
--   MESMAS telas do Malote e do RH, servidas por outra rota — o mesmo
--   arranjo dos Chamados no módulo do encarregado (20260828000008), onde
--   um componente atende três módulos e só o prefixo muda.
--
--   Quem enxerga cada item continua 100% em Administração › Acesso por
--   Usuário. Estes menus NASCEM SEM NENHUMA LINHA DE PERMISSÃO: o sistema
--   nega por padrão (RouteGuard e canSee do Sidebar não têm mais o ramo
--   "ninguém configurou → aberto"), então o módulo começa invisível para
--   todo mundo, inclusive para quem já acessa as telas originais. Liberar
--   é marcar o toggle, como em qualquer outra tela.
--
-- POR QUE AS DUAS TELAS DE DETALHE DO MALOTE ENTRAM
--
--   A lista de aprovações abre a despesa/solicitação ao clicar no item.
--   Sem cadastrar esses dois destinos aqui, quem entrasse pela Diretoria
--   aprovava... até clicar, e tomava "Acesso negado" — o destino é menu de
--   outro módulo.
--
-- ⚠ O QUE ESTES MENUS DÃO, E O QUE NÃO DÃO
--
--   Eles abrem a PORTA (a rota). Os DADOS continuam governados pelos
--   códigos originais, que é onde a RLS cobra e que esta migration
--   deliberadamente NÃO altera:
--     • `malote_pode()` cobra can_access('malote_despesa_visualizar') e
--       can_access('malote_solicitacao_visualizar') — é o que autoriza
--       aprovar/reprovar de fato (20260906000002);
--     • o painel de Mudança de Função decide o recorte por
--       can('visualizar', 'escritorio_troca_funcao') — sem esse código, a
--       fila do escritório vem vazia.
--
--   Ou seja: liberar o módulo Diretoria para alguém que JÁ aprova hoje
--   funciona direto (a pessoa já tem os códigos acima). Para alguém que
--   nunca aprovou, marque também o menu original — na MESMA tela de Acesso
--   por Usuário. Fazer a RLS aceitar códigos novos seria inventar regra de
--   acesso, e é justamente o que não se quer aqui.
-- =====================================================================

INSERT INTO public.app_modulo (codigo, nome, ordem, ativo)
VALUES ('diretoria', 'Diretoria', 142, true)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem, true
  FROM public.app_modulo m
 CROSS JOIN (VALUES
   ('diretoria_malote_aprovacoes',  'Diretoria — Aprovações do Malote',        '/app/diretoria/malote-aprovacoes',    1),
   ('diretoria_malote_despesa',     'Diretoria — Visualizar Despesa',          '/app/diretoria/despesa/:id',          2),
   ('diretoria_malote_solicitacao', 'Diretoria — Visualizar Solicitação',      '/app/diretoria/solicitacao/:id',      3),
   ('diretoria_troca_funcao',       'Diretoria — Mudança de Função (aprovar)', '/app/diretoria/troca-funcao-escritorio', 4)
 ) AS x(codigo, nome, rota, ordem)
 WHERE m.codigo = 'diretoria'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────
-- Os quatro menus têm de existir e ter ZERO permissão: é o "ninguém por
-- padrão". Se `permissoes` vier > 0, alguém já liberou e o módulo não
-- estará mais fechado.
SELECT m.codigo,
       (SELECT count(*) FROM public.perfil_acesso_permissao p WHERE p.menu_codigo = m.codigo)
     + (SELECT count(*) FROM public.screen_permission_user s WHERE s.menu_codigo = m.codigo) AS permissoes
  FROM public.app_menu m
  JOIN public.app_modulo mo ON mo.id = m.modulo_id
 WHERE mo.codigo = 'diretoria'
 ORDER BY m.ordem;

-- =====================================================================
-- ROLLBACK
--   DELETE FROM public.app_menu
--    WHERE modulo_id = (SELECT id FROM public.app_modulo WHERE codigo = 'diretoria');
--   DELETE FROM public.app_modulo WHERE codigo = 'diretoria';
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
