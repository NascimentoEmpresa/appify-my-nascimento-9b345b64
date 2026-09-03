-- =====================================================================
-- RH: aposenta os submódulos "Folha de Pagamento" e "Alocações em Contratos".
--
-- Decisão de 04/09/2026: tirar do Recursos Humanos tudo sobre os submódulos
-- de Folha de Pagamento e Alocação de Contratos.
--
-- Eram as duas últimas telas do RH que ainda falavam com o modelo de dados
-- ANTIGO, o que ficou de antes de EMPREGADOS virar fonte única:
--
--   • /app/rh/alocacoes  → CRUD genérico de `alocacao_colaborador`, ligando
--     as tabelas `colaborador` e `contrato`. O cadastro `colaborador` já não
--     é a fonte de nada: quem responde por pessoa é EMPREGADOS.
--   • /app/rh/folha      → `folha_periodo`/`folha_evento` + a RPC
--     `contabilizar_folha`, que gera lançamento contábil de provisão,
--     pagamento e encargos.
--
-- Nenhuma das duas chegou a ser usada de verdade: `alocacao_colaborador` e
-- `folha_evento` estão VAZIAS e `folha_periodo` tem 1 linha (conferido em
-- 04/09/2026, antes desta migration).
--
-- DESATIVA, NÃO APAGA — é o mesmo caminho de `central_servicos_denuncias`
-- (canal legado aposentado em 21/08/2026): a linha continua em `app_menu`
-- com `ativo = false`. Isso basta porque `can_access` e
-- `list_accessible_menus` exigem `ativo = true`:
--
--   · o menu some da lista concedível de Administração › Acesso por Usuário
--     (a tela separa ativos de inativos — ver ModulosMenusTab.tsx);
--   · o RouteGuard nega a rota, mesmo para quem já tinha a permissão;
--   · as ~95 permissões já concedidas nesses dois menus (54 exceções
--     individuais + 41 em perfis) ficam inertes sem precisar apagá-las, e
--     voltam a valer sozinhas se alguém reativar o menu;
--   · a RPC `contabilizar_folha` fecha junto, de graça: o gate dela é
--     `can_access(auth.uid(), 'folha', 'alterar')` (migration 20260906000004),
--     que passa a devolver false para todo mundo. Falha fechada, que é como
--     tem que falhar uma função que gera lançamento contábil.
--
-- AS TABELAS FICAM. `folha_periodo`, `folha_evento` e `alocacao_colaborador`
-- não são dropadas aqui: a de folha tem vínculo com lançamento contábil e
-- apagar dado contábil é decisão de quem responde pela contabilidade, não
-- efeito colateral de uma limpeza de menu. Sem tela e sem permissão, elas
-- não recebem escrita nova.
--
-- No front, no mesmo commit: itens saem do Sidebar, rotas saem do App.tsx e
-- as páginas `src/pages/rh/Folha.tsx` e `src/pages/rh/Alocacoes.tsx` são
-- removidas.
--
-- Idempotente.
-- =====================================================================

UPDATE public.app_menu
   SET ativo = false
 WHERE codigo IN ('folha', 'alocacoes');

-- Conferência: as duas linhas têm que sair inativas.
SELECT codigo, nome, rota, ativo
  FROM public.app_menu
 WHERE codigo IN ('folha', 'alocacoes');

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- UPDATE public.app_menu SET ativo = true WHERE codigo IN ('folha', 'alocacoes');
-- -- E reverter o commit do front (Sidebar, App.tsx e as duas páginas).
-- NOTIFY pgrst, 'reload schema';
-- =====================================================================
