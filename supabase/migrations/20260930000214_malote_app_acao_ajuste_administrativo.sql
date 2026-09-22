-- [SEM-CHAMADO] (Iury): "aprovador master" fantasma pra despesa presa em
-- aprovação (ex. "Pendente aprovação N2") que precisa ser empurrada direto
-- pra outro status por decisão administrativa, fora do fluxo normal de
-- aprovação. Isso já era feito na prática — duas vezes, via UPDATE manual
-- no SQL Editor do Supabase, sem rastro de permissão nem histórico
-- distinguível de uma aprovação de verdade (o tipo_evento
-- 'ajuste_administrativo' em malote_despesa_evento já existe desde a
-- 20260930000188 exatamente pra marcar isso na timeline). Esta migration
-- cria a AÇÃO própria pra autorizar quem pode disparar esse ajuste pelo
-- sistema — a RPC e o perfil dedicado vêm na 20260930000215.
--
-- 'ajuste_administrativo' fica de propósito FORA do pacote padrão do
-- toggle de Acesso por Usuário (ACOES_DO_TOGGLE_PADRAO) — não é de brinde
-- pra quem já tem a tela liberada, mesma família de 'excluir'/'executar_ia'/
-- 'alterar_dre' (J1.A do nosso guia de revisão de PR). Só quem receber o
-- perfil dedicado (Iury, por decisão do próprio Iury) ganha essa ação.
--
-- MIGRATION SEPARADA DE PROPÓSITO (mesmo motivo da 20260930000154 —
-- 'enviar_malote'): Postgres aceita ALTER TYPE ... ADD VALUE dentro de
-- transação (12+), mas não deixa usar o valor novo na mesma transação que
-- o adicionou — e a 20260930000215 usa 'ajuste_administrativo' num INSERT
-- em perfil_acesso_permissao. Aplique esta primeiro.

ALTER TYPE public.app_acao ADD VALUE IF NOT EXISTS 'ajuste_administrativo';

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- Postgres não remove valor de enum. Desfazer exige recriar o tipo (ver
-- ROLLBACK completo na 20260930000154). Na prática: deixe o valor no enum
-- e apague só quem o usa:
--   DELETE FROM public.perfil_acesso_permissao WHERE acao = 'ajuste_administrativo';
