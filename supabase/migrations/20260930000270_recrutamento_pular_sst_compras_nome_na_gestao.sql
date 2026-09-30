-- =========================================================================
-- Recrutamento: "Pode pular etapa SST/Compras" aparece junto da Gestão
--
-- SINTOMA (30/09/2026, Pablo): o botão "Pular SST e Compras" não aparecia no
-- kanban e a permissão não estava em Administração › Acesso por Usuário.
--
-- CAUSA: a mig 20260930000264 (que cria a capacidade
-- `recrutamento_pular_sst_compras` e o trigger que trava no banco) estava na
-- fila do aplicar_no_banco_do_app.sql e nunca tinha rodado — sem a linha em
-- app_menu não há o que ligar na tela, e o front (já na main) esconde o botão
-- de quem não tem a capacidade. Aplicada junto com esta.
--
-- ESTA MIGRATION: só o nome e a posição, para o switch ficar logo abaixo de
-- "Recrutamento e Seleção" (recrutamento_gestao, ordem 10) com o rótulo que o
-- RH procura — "Pode pular etapa SST/Compras". Código, ação ('aprovar') e
-- trava não mudam.
--
-- Idempotente. Depende da 264. ROLLBACK no fim.
-- =========================================================================

UPDATE public.app_menu
   SET nome  = 'Gestão Recrutamento — Pode pular etapa SST/Compras (Documentação → Admissão)',
       ordem = 11
 WHERE codigo = 'recrutamento_pular_sst_compras';

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- UPDATE public.app_menu SET nome = 'Pular SST e Compras (Documentação → Admissão)', ordem = 23
--  WHERE codigo = 'recrutamento_pular_sst_compras';
